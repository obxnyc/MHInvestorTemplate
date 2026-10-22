import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Changing your own PIN.
 *
 *  The office cannot set one and cannot read one. A PIN somebody else typed
 *  is written on a pad by the person who typed it and read out across a yard;
 *  the only version of this that means anything is one person knowing it.
 *
 *  THE PROOF IS THE SESSION. Whoever is making this request is already signed
 *  in as this person -- they used the old PIN, or a setup link, or an email.
 *  Asking for the old PIN as well would lock out the one case this most needs
 *  to serve: somebody who got in another way BECAUSE they forgot it.
 *
 *  `p_staff` is `me.id` and comes from the session, never from the body. A
 *  route that took an id from the request would let anybody signed in set
 *  anybody else's PIN, and it would look exactly like this one.
 */
export async function PATCH(req: Request) {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  let body: { pin?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }

  const chosen = String(body.pin ?? "").trim();
  // Shape only; the database decides whether it is too easy, and for whom.
  if (!/^[0-9]{4,8}$/.test(chosen)) {
    return NextResponse.json({ error: "A PIN is 4 to 8 numbers." }, { status: 400 });
  }

  const { error } = await supabaseAdmin().rpc("set_staff_pin", {
    p_staff: me.id, p_pin: chosen,
  });
  if (error) {
    // Never log the PIN; the message is enough to act on.
    if (/too easy/i.test(error.message)) {
      return NextResponse.json({
        error: "That PIN is too easy to guess. Try one that isn't all the same number or in order.",
      }, { status: 400 });
    }
    if (/field staff/i.test(error.message)) {
      return NextResponse.json({
        error: "Office accounts sign in with an email rather than a PIN.",
      }, { status: 400 });
    }
    console.error("set_staff_pin failed", error.message);
    return NextResponse.json({ error: "Could not save that PIN." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
