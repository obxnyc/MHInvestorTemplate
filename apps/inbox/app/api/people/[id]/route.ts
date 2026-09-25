import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

/** Change one person: their PIN, or whether they still work here.
 *
 *  Deactivating is the important one and it has to be instant. The hour someone
 *  leaves, their PIN stops working, their magic link stops working, and their
 *  name comes off the sign-in list -- one flag, checked by every policy. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await requireStaff();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "admins only" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const { pin, active } = await req.json();
  const db = supabaseAdmin();

  if (typeof active === "boolean") {
    const { error } = await db.from("staff").update({ active }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (pin !== undefined) {
    // The database decides what a PIN may be -- four to eight digits, nothing
    // anyone would guess first, field staff only. Those rules live in one place
    // so a second caller cannot quietly disagree with them.
    const { error } = pin === null
      ? await db.rpc("clear_staff_pin", { p_staff: id })
      : await db.rpc("set_staff_pin", { p_staff: id, p_pin: String(pin) });
    if (error) {
      return NextResponse.json({ error: error.message.replace(/^.*: /, "") }, { status: 400 });
    }
  }

  return NextResponse.json({ ok: true });
}
