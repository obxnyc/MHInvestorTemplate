import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { statusOf, type Status } from "@/lib/presence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Migration 018 adds these columns. Until it is run the whole feature is
 *  absent rather than broken -- the same rule as every other pending
 *  migration on this deployment. */
function missingColumn(e: { code?: string; message?: string } | null) {
  if (!e) return false;
  return e.code === "PGRST204" || e.code === "42703" || e.code === "42P01"
    || /could not find the .* column|column .* does not exist/i.test(e.message ?? "");
}

/** "I am still here." Sent by every open tab every 45 seconds.
 *
 *  Cheap on purpose: one row, two columns, no read. It runs on every tab of
 *  every employee all day and the cost of it has to be nothing. */
export async function POST(req: Request) {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { state } = await req.json().catch(() => ({}));
  // Normalised here rather than trusted. The column has a check constraint on
  // it and an unrecognised word would take the whole write down -- which is
  // the same mistake that made outbound texts sit on "Sending" for a week.
  const presence = state === "idle" ? "idle" : "active";

  const { error } = await supabaseAdmin().from("staff")
    .update({ last_seen_at: new Date().toISOString(), presence })
    .eq("id", me.id);

  if (error && !missingColumn(error)) {
    console.error("heartbeat failed", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  return NextResponse.json({ ok: !error, pending: missingColumn(error) });
}

type Row = {
  id: string; full_name: string; role: string;
  last_seen_at: string | null; presence: string | null;
  last_login_at?: string | null;
};

/**
 * Everybody, and where they are.
 *
 * Read with the service role and filtered here, because `last_login_at` is not
 * granted to employees at all -- that is the point of it, and a query made as
 * the signed-in person could not return it even to an admin. So the privilege
 * check happens once, in this function, and the field is simply not in the
 * response for anybody else. Not hidden by the client: absent from the wire.
 */
export async function GET(req: Request) {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const admin = me.role === "admin";
  // Only looked up when somebody has actually asked to see it. It is an extra
  // call to the auth service and this endpoint is polled every half minute.
  const wantLogins = new URL(req.url).searchParams.get("logins") === "1";
  const db = supabaseAdmin();

  const wide = await db.from("staff")
    .select("id, full_name, role, last_seen_at, presence, last_login_at")
    .eq("active", true).order("full_name");

  if (wide.error) {
    if (!missingColumn(wide.error)) {
      return NextResponse.json({ error: wide.error.message }, { status: 500 });
    }
    // 018 has not been run. Say so rather than showing everybody as offline,
    // which is a wrong answer dressed as a real one.
    return NextResponse.json({ pending: true, people: [] });
  }

  /**
   * Sign-ins come from the auth service, not from our own column.
   *
   * `staff.last_login_at` only started being written when migration 018 ran,
   * so everybody who had signed in before that read as "never" -- which was
   * not a gap in the data, it was a gap in ours. Supabase has recorded every
   * sign-in since the account was made, and it is the thing actually doing
   * the authenticating, so it is the honest source. Our column stays as a
   * fallback for a deployment whose auth service will not answer.
   */
  const signIns = new Map<string, string | null>();
  if (admin && wantLogins) {
    try {
      // Pages, because the default is fifty and a staff list can outgrow it
      // quietly -- at which point the people missing would read as "never"
      // and nobody would know why.
      for (let page = 1; page <= 5; page++) {
        const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
        if (error) break;
        for (const u of data.users) signIns.set(u.id, u.last_sign_in_at ?? null);
        if (data.users.length < 200) break;
      }
    } catch (e) {
      console.error("could not read sign-in times", e);
    }
  }

  const now = Date.now();
  const people = ((wide.data ?? []) as Row[]).map((s) => ({
    id: s.id,
    name: s.full_name,
    role: s.role,
    status: statusOf({ lastSeen: s.last_seen_at, presence: s.presence }, now) as Status,
    lastSeen: s.last_seen_at,
    me: s.id === me.id,
    // Yours is always yours. Everyone else's only if you are an admin.
    ...(wantLogins && (admin || s.id === me.id)
      ? { lastLogin: signIns.get(s.id) ?? s.last_login_at ?? null }
      : {}),
  }));

  return NextResponse.json({ people, canSeeLogins: admin });
}
