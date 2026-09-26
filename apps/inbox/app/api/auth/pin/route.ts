import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { supabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/** Sign in with a name and a PIN.
 *
 *  The decision is not made here. verify_staff_pin() in the database decides,
 *  because it is the only thing that can read pin_hash -- there is no query
 *  this route could run, however compromised, that returns anyone's PIN. It
 *  also owns the lockout and writes the audit entry, so those cannot be skipped
 *  by a caller that forgets.
 *
 *  This route's job is narrow: check the shape of the input, ask the database,
 *  and on a yes turn that into a real Supabase session so the rest of the app
 *  treats this person exactly like someone who used an email link. */
export async function POST(req: NextRequest) {
  let body: { staffId?: string; pin?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const staffId = String(body.staffId ?? "");
  const pin = String(body.pin ?? "");

  // Shape only. Whether this PIN is right is not ours to say.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(staffId)
      || !/^[0-9]{4,8}$/.test(pin)) {
    return NextResponse.json({ error: "Check your PIN and try again." }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data, error } = await admin.rpc("verify_staff_pin", {
    p_staff: staffId, p_pin: pin,
  });
  if (error) {
    console.error("verify_staff_pin failed", error);   // never log the PIN
    return NextResponse.json({ error: "Sign-in is unavailable right now." }, { status: 500 });
  }

  const result = (Array.isArray(data) ? data[0] : data) as
    { ok: boolean; locked_until: string | null } | undefined;

  if (!result?.ok) {
    if (result?.locked_until) {
      const mins = Math.max(1, Math.ceil(
        (new Date(result.locked_until).getTime() - Date.now()) / 60000));
      // Saying how long is deliberate: the person who mistyped four times needs
      // to know whether to wait or to phone the office, and an attacker already
      // knows they are locked out.
      return NextResponse.json(
        { error: `Too many tries. Try again in ${mins} minute${mins === 1 ? "" : "s"}, `
               + `or call the office.` }, { status: 429 });
    }
    return NextResponse.json({ error: "That PIN doesn't match." }, { status: 401 });
  }

  // Right PIN. Turn it into an ordinary session.
  const { data: userRes, error: userErr } = await admin.auth.admin.getUserById(staffId);
  const email = userRes?.user?.email;
  if (userErr || !email) {
    console.error("no auth user behind staff row", staffId, userErr);
    return NextResponse.json({ error: "Sign-in is unavailable right now." }, { status: 500 });
  }

  // generateLink mints a one-time token without emailing anybody; verifying it
  // here is what writes the session cookies onto this response.
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink", email,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (linkErr || !tokenHash) {
    console.error("generateLink failed", linkErr);
    return NextResponse.json({ error: "Sign-in is unavailable right now." }, { status: 500 });
  }

  const supabase = await supabaseServer();
  const { error: otpErr } = await supabase.auth.verifyOtp({
    token_hash: tokenHash, type: "email",
  });
  if (otpErr) {
    console.error("verifyOtp failed", otpErr);
    return NextResponse.json({ error: "Sign-in is unavailable right now." }, { status: 500 });
  }

  // Signed in. Recorded after the session exists, so a failed attempt never
  // counts as one -- and best-effort, because a sign-in that worked must not
  // be turned into a sign-in that failed by a bookkeeping write. The column
  // arrives with migration 018; before that this quietly does nothing.
  await admin.from("staff")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", staffId);

  return NextResponse.json({ ok: true });
}
