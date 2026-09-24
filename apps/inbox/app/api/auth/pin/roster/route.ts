import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

/** The names on the sign-in keypad.
 *
 *  Necessarily readable by anyone who loads the page -- the whole point is that
 *  a tech taps their name before proving anything. So it returns the narrowest
 *  thing that still works: the id and name of active FIELD staff who have a PIN,
 *  and nothing else. No office staff, no admins, no emails, no phone numbers,
 *  no roles.
 *
 *  What it does leak is who does maintenance for Larabee Homes. That is the
 *  accepted cost of a name-picker, and it is the same information anyone gets
 *  by watching a van pull up. Worth stating rather than pretending otherwise.
 */
export async function GET() {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("staff")
    .select("id, full_name")
    .eq("active", true)
    .in("role", ["tech", "shower"])
    .not("pin_hash", "is", null)
    .order("full_name");

  if (error) {
    console.error("pin roster failed", error);
    return NextResponse.json({ staff: [] }, { status: 200 });
  }
  return NextResponse.json({ staff: data ?? [] }, {
    // Never cached at the edge: someone removed this morning must not keep
    // appearing on the keypad because a CDN is holding yesterday's list.
    headers: { "Cache-Control": "no-store" },
  });
}
