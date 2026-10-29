import { NextResponse } from "next/server";
import { toE164 } from "@/lib/phone";
import { realPhone } from "@/lib/format";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const PARTIES = new Set([
  "current_tenant", "prospect", "vendor", "tech", "owner", "other",
]);

/** Put a name to a number.
 *
 *  Any member of staff, from inside the conversation. Naming the person you are
 *  talking to is not an administrative act -- it is part of answering them, and
 *  routing it through a separate screen and a separate permission is how a line
 *  ends up full of threads labelled (862) 368-6847 eighteen months later. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { id } = await ctx.params;
  const { fullName, party, unitId, language, phone, email } = await req.json();

  const patch: Record<string, unknown> = {};
  if (fullName !== undefined) patch.full_name = String(fullName).trim() || null;
  if (party !== undefined) {
    if (!PARTIES.has(party)) return NextResponse.json({ error: "unknown type" }, { status: 400 });
    patch.party = party;
  }
  // An empty selection means "not at one of our addresses", which is a real
  // answer and has to be storable, not just skippable.
  if (unitId !== undefined) patch.unit_id = unitId || null;
  if (language !== undefined) patch.language = language || null;

  /* A NUMBER WHERE THERE WAS NONE.
   *
   * A request from Rent Manager arrives with nobody attached: the phone
   * column holds a key like `email:rm:issue:307`, which is not a number,
   * and the office cannot answer the tenant. Putting the real number on
   * is the one thing that unsticks it -- so this accepts one, and checks
   * it is a number rather than taking whatever was typed.
   */
  if (phone !== undefined) {
    const typed = String(phone ?? "").trim();
    if (!typed) {
      return NextResponse.json({
        error: "Leave the number alone or give a real one; blanking it would"
          + " lose the only handle on this person.",
      }, { status: 400 });
    }
    const e164 = realPhone(toE164(typed));
    if (!e164) {
      return NextResponse.json({
        error: `"${typed}" is not a number we can text. Ten digits, or +1 and`
          + " ten digits.",
      }, { status: 400 });
    }
    /* SOMEBODY ELSE MAY ALREADY BE THAT NUMBER. Two contacts with one
       number is two threads for one person, and every later message
       picks whichever the query happens to find first. Said plainly
       rather than merged behind somebody's back. */
    const { data: taken } = await supabaseAdmin()
      .from("contacts").select("id, full_name").eq("phone", e164)
      .neq("id", id).maybeSingle();
    if (taken) {
      const who = (taken as { full_name: string | null }).full_name;
      return NextResponse.json({
        error: `${who || "Somebody else"} is already on that number, so this`
          + " would make two records for one person. Open their thread"
          + " instead, or use a different number.",
      }, { status: 409 });
    }
    patch.phone = e164;
  }
  if (email !== undefined) {
    const typed = String(email ?? "").trim();
    if (typed && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(typed)) {
      return NextResponse.json({
        error: `"${typed}" is not an email address.`,
      }, { status: 400 });
    }
    patch.email = typed || null;
  }

  if (!Object.keys(patch).length) return NextResponse.json({ ok: true });

  const db = supabaseAdmin();
  const { error } = await db.from("contacts").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
