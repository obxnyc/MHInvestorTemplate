import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import {
  groupMembers, rmAuthorize, rmGet, rmPost, rmPut, type RmSession, type RmWrite,
} from "@/lib/rentmanager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

/**
 * Put properties into a group that already exists, and take them out again.
 *
 * Every other write here creates something. This one CHANGES something, and
 * that is a different risk: the likeliest shape of the call is "send the
 * group back with its members", and a call built from only the properties
 * being added would quietly empty the group of everything else. Sixty-four
 * lots would leave a park and nobody would find out until somebody went
 * looking for one.
 *
 * So the current membership is read first and the new list is the union of
 * it and the change, never the change alone. And it is read AGAIN afterwards,
 * because a write that is reported as succeeding and a write that actually
 * landed are different claims, and only the second one is worth making on
 * somebody's book of record.
 */

type Move = { groupId: number; add?: number[]; remove?: number[] };

export async function POST(req: Request) {
  const me = await requireStaff();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }

  const { moves, go } = await req.json().catch(() => ({}));
  if (!Array.isArray(moves) || !moves.length) {
    return NextResponse.json({ error: "nothing to move" }, { status: 400 });
  }

  const auth = await rmAuthorize();
  if (!auth.ok) return NextResponse.json({ signedIn: false });
  const session = auth.session;

  const out = [];
  for (const raw of moves as Move[]) {
    const groupId = Number(raw.groupId);
    const add = (raw.add ?? []).map(Number).filter(Number.isFinite);
    const remove = (raw.remove ?? []).map(Number).filter(Number.isFinite);
    if (!Number.isFinite(groupId)) continue;

    const before = await groupMembers(groupId, session);
    if (!before.ok) {
      out.push({ groupId, ok: false, reason: `could not read the group: ${before.detail}` });
      continue;
    }

    const wanted = [...new Set([...before.ids, ...add])]
      .filter((id) => !remove.includes(id));

    if (wanted.length === before.ids.length
        && wanted.every((id) => before.ids.includes(id))) {
      out.push({ groupId, name: before.name, ok: true, already: true,
                 was: before.ids.length, now: before.ids.length, tried: [] });
      continue;
    }
    // Rent Manager refuses an empty group, and so does this -- a change that
    // would leave nothing behind is a mistake in the request, not a write to
    // attempt and see.
    if (!wanted.length) {
      out.push({ groupId, name: before.name, ok: false,
                 reason: "that would empty the group, which Rent Manager will not allow anyway" });
      continue;
    }

    if (go !== true) {
      out.push({ groupId, name: before.name, ok: true, dryRun: true,
                 was: before.ids.length, now: wanted.length, tried: [] });
      continue;
    }

    // Three plausible spellings, stopping at the first that takes. Every
    // failure is reported; a refusal changes nothing, which is the same rule
    // the create probe established.
    const shapes: [string, () => Promise<RmWrite>][] = [
      ["replace the member list",
       () => rmPut(`/PropertyGroups/${groupId}`, session, {
         PropertyGroupID: groupId, Name: before.name,
         Properties: wanted.map((id) => ({ PropertyID: id })),
       })],
      ["replace with bare ids",
       () => rmPut(`/PropertyGroups/${groupId}`, session, {
         PropertyGroupID: groupId, Name: before.name, Properties: wanted,
       })],
      ["post the members",
       () => rmPost(`/PropertyGroups/${groupId}/Properties`, session,
         wanted.map((id) => ({ PropertyID: id })))],
    ];

    const tried: { shape: string; status: number; body: string }[] = [];
    let landed = false;
    for (const [shape, run] of shapes) {
      const res = await run();
      tried.push({ shape, status: res.status, body: res.body.slice(0, 200) });
      if (res.ok) { landed = true; break; }
    }

    // Asked again, because "the call returned 200" and "the group changed"
    // are different claims.
    const after = await groupMembers(groupId, session);
    out.push({
      groupId, name: before.name,
      ok: landed && after.ok && after.ids.length === wanted.length,
      was: before.ids.length,
      now: after.ok ? after.ids.length : null,
      expected: wanted.length,
      tried,
      reason: !landed ? "Rent Manager refused every shape — nothing changed."
        : !after.ok ? "The write was accepted but the group could not be re-read."
        : after.ids.length !== wanted.length
          ? `Accepted, but the group now holds ${after.ids.length} and should hold ${wanted.length}.`
          : undefined,
    });
  }

  return NextResponse.json({ signedIn: true, dryRun: go !== true, results: out });
}

/** Which group is which, so the screen can name them. */
export async function GET() {
  const me = await requireStaff();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }
  const auth = await rmAuthorize();
  if (!auth.ok) return NextResponse.json({ signedIn: false, groups: [] });

  const got = await rmGet("/PropertyGroups?pagesize=200", auth.session);
  return NextResponse.json({ signedIn: true, ok: got.ok, shape: got.shape });
}
