import { NextResponse } from "next/server";
import { requireStaff, supabaseServer } from "@/lib/supabase-server";
import { readFix, whichSite, defaultRadius, type Fence, type Fix } from "@/lib/fence";
import { worked, nudges, type Shift, type Rules, RULES } from "@/lib/shift";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * On, off, break, and what the day looks like.
 *
 * Everything here goes through the signed-in client rather than the service
 * role. The row policies in 038 say a ping belongs to an open shift that is
 * this person's own, and a route using the service key would walk past them --
 * which would make the policy a comment rather than a rule.
 */

type Db = Awaited<ReturnType<typeof supabaseServer>>;

const asFix = (v: unknown): Fix | null => {
  const f = v as { lat?: unknown; lng?: unknown; accuracy?: unknown } | null;
  if (!f || typeof f.lat !== "number" || typeof f.lng !== "number") return null;
  return {
    lat: f.lat, lng: f.lng,
    // Not `?? 0`. A device that did not say how sure it is has not said it is
    // certain, and the fence reader needs to be able to tell those apart.
    accuracy: typeof f.accuracy === "number" ? f.accuracy : null,
  };
};

async function fences(db: Db): Promise<Fence[]> {
  const { data } = await db.from("properties")
    .select("id, name, kind, lat, lng, fence_m")
    .not("lat", "is", null).not("lng", "is", null);
  return (data ?? []).map((p) => ({
    propertyId: String(p.id),
    name: String(p.name),
    lat: Number(p.lat), lng: Number(p.lng),
    radius: p.fence_m ? Number(p.fence_m) : defaultRadius(p.kind as string | null),
  }));
}

async function rulesOf(db: Db): Promise<Rules> {
  const { data } = await db.from("clock_rules").select("*").maybeSingle();
  if (!data) return RULES;
  return {
    dailyCap: Number(data.daily_cap ?? RULES.dailyCap),
    breakAfter: Number(data.break_after ?? RULES.breakAfter),
    breakMinutes: Number(data.break_minutes ?? RULES.breakMinutes),
    abandonedAfter: Number(data.abandoned_after ?? RULES.abandonedAfter),
  };
}

/** Today's shifts for this person, breaks attached. */
async function today(db: Db, staffId: string): Promise<Shift[]> {
  // Back to yesterday morning rather than to midnight: a shift that started
  // at ten last night and is still running is today's problem, and a day
  // window that begins at midnight would not see it.
  const from = new Date(Date.now() - 36 * 3_600_000).toISOString();
  const { data } = await db.from("shifts")
    // One string literal. The client infers the row type from the select
    // text, and a joined string turns every field on the result into an
    // error rather than a column.
    .select("id, staff_id, property_id, property_from, started_at, ended_at, signed_off_at, start_fence, end_fence, shift_breaks(started_at, ended_at)")
    .eq("staff_id", staffId).gte("started_at", from)
    .order("started_at", { ascending: true });

  return (data ?? []).map((s) => ({
    id: String(s.id),
    staffId: String(s.staff_id),
    propertyId: (s.property_id as string | null) ?? null,
    startedAt: String(s.started_at),
    endedAt: (s.ended_at as string | null) ?? null,
    signedOffAt: (s.signed_off_at as string | null) ?? null,
    breaks: ((s.shift_breaks ?? []) as { started_at: string; ended_at: string | null }[])
      .map((b) => ({ startedAt: b.started_at, endedAt: b.ended_at })),
  }));
}

async function state(db: Db, staffId: string) {
  const [shifts, rules, fence] = await Promise.all([
    today(db, staffId), rulesOf(db), fences(db),
  ]);
  const now = new Date();
  const w = worked(shifts, now, rules);
  const open = shifts.find((s) => !s.endedAt) ?? null;
  const onBreak = open?.breaks?.some((b) => !b.endedAt) ?? false;
  return {
    shifts, rules, worked: w, onBreak,
    openShiftId: open?.id ?? null,
    nudges: nudges(w, shifts, now, rules),
    places: fence.map((f) => ({ id: f.propertyId, name: f.name })),
  };
}

export async function GET() {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "sign in" }, { status: 401 });
  const db = await supabaseServer();
  return NextResponse.json(await state(db, me.id));
}

export async function POST(req: Request) {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "sign in" }, { status: 401 });

  const db = await supabaseServer();
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "");
  const fix = asFix(body.fix);

  if (action === "in") {
    const sites = await fences(db);
    const { on } = whichSite(fix, sites);
    const reading = on ? on.reading : null;

    // The fix is recorded, never enforced. Off site goes in as off site --
    // refusing it would leave somebody who worked a day with no record of it,
    // which is the worse failure by a long way.
    const { data, error } = await db.from("shifts").insert({
      staff_id: me.id,
      property_id: on?.fence.propertyId ?? null,
      property_from: on ? "fence" : null,
      start_lat: fix?.lat ?? null,
      start_lng: fix?.lng ?? null,
      start_acc: fix?.accuracy ?? null,
      start_fence: reading?.verdict
        ?? (fix && sites.length ? whichSite(fix, sites).maybe[0]?.reading.verdict : null)
        ?? "unsure",
    }).select("id").single();

    if (error) {
      // The one-open-shift index. Somebody double-tapped, or a second phone
      // is on. Saying which it is beats "could not save".
      const already = /shifts_one_open_per_person/.test(error.message);
      return NextResponse.json({
        error: already
          ? "You are already clocked in. Pull down to refresh."
          : error.message,
      }, { status: already ? 409 : 500 });
    }

    return NextResponse.json({ ok: true, shiftId: data!.id, ...await state(db, me.id) });
  }

  if (action === "out") {
    const { data: open } = await db.from("shifts")
      .select("id, property_id").eq("staff_id", me.id).is("ended_at", null).maybeSingle();
    if (!open) {
      return NextResponse.json({ error: "You are not clocked in." }, { status: 409 });
    }

    // End any break still running first, or the shift closes around an open
    // break and the hours come out longer than the man was there.
    await db.from("shift_breaks").update({ ended_at: new Date().toISOString() })
      .eq("shift_id", open.id).is("ended_at", null);

    const sites = await fences(db);
    const here = open.property_id
      ? sites.find((f) => f.propertyId === open.property_id) ?? null
      : null;

    const { error } = await db.from("shifts").update({
      ended_at: new Date().toISOString(),
      end_lat: fix?.lat ?? null,
      end_lng: fix?.lng ?? null,
      end_acc: fix?.accuracy ?? null,
      end_fence: here ? readFix(fix, here).verdict : "unsure",
    }).eq("id", open.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, ...await state(db, me.id) });
  }

  if (action === "break-start" || action === "break-end") {
    const { data: open } = await db.from("shifts")
      .select("id").eq("staff_id", me.id).is("ended_at", null).maybeSingle();
    if (!open) {
      return NextResponse.json({ error: "You are not clocked in." }, { status: 409 });
    }
    const { error } = action === "break-start"
      ? await db.from("shift_breaks").insert({ shift_id: open.id }).select("id").single()
      : await db.from("shift_breaks").update({ ended_at: new Date().toISOString() })
          .eq("shift_id", open.id).is("ended_at", null);
    if (error) {
      const twice = /breaks_one_open_per_shift/.test(error.message);
      return NextResponse.json({
        error: twice ? "You are already on a break." : error.message,
      }, { status: twice ? 409 : 500 });
    }
    return NextResponse.json({ ok: true, ...await state(db, me.id) });
  }

  if (action === "sign-off") {
    // Only the finished ones, and only this person's. Nothing still running
    // can be agreed, because the number is still moving.
    const { error } = await db.from("shifts")
      .update({ signed_off_at: new Date().toISOString() })
      .eq("staff_id", me.id).not("ended_at", "is", null).is("signed_off_at", null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, ...await state(db, me.id) });
  }

  if (action === "where") {
    // The site, chosen by hand, when the fence could not tell or said two.
    const { data: open } = await db.from("shifts")
      .select("id").eq("staff_id", me.id).is("ended_at", null).maybeSingle();
    if (!open) return NextResponse.json({ error: "You are not clocked in." }, { status: 409 });
    const propertyId = String(body.propertyId ?? "") || null;
    const { error } = await db.from("shifts")
      .update({ property_id: propertyId, property_from: propertyId ? "chosen" : null })
      .eq("id", open.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, ...await state(db, me.id) });
  }

  return NextResponse.json({ error: `not an action: ${action}` }, { status: 400 });
}
