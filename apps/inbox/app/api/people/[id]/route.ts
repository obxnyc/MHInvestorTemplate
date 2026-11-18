import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isArea } from "@/lib/areas";

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
  const { pin, active, hidden_areas } = await req.json();
  const db = supabaseAdmin();

  // Parts of the app this person is not shown. Only names the app knows are
  // kept: an unknown one would hide nothing and read as if it did.
  if (hidden_areas !== undefined) {
    if (!Array.isArray(hidden_areas) || !hidden_areas.every(isArea)) {
      return NextResponse.json({ error: "Unknown part of the app." }, { status: 400 });
    }
    const { data: who } = await db.from("staff").select("role").eq("id", id).maybeSingle();
    if (who?.role === "admin") {
      return NextResponse.json({ error: "An admin sees everything." }, { status: 400 });
    }
    const { error } = await db.from("staff")
      .update({ hidden_areas: [...new Set(hidden_areas)] }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (typeof active === "boolean") {
    const { error } = await db.from("staff").update({ active }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (pin !== undefined) {
    /* THE OFFICE CAN TAKE A PIN AWAY AND CANNOT GIVE ONE.
     *
     * "I would prefer not to give people their own PINs. They should make
     * their own." A PIN somebody else typed is written on a pad by the person
     * who typed it and read out across a yard, and it signs another man's
     * hours. The only version of this that means anything is one person
     * knowing it, so setting one is done by its owner -- from the setup link,
     * or from their own screen afterwards.
     *
     * Clearing stays here, because that is a different power and a real need:
     * somebody leaves, or tells a mate their number, and the office has to be
     * able to shut the door the same hour. Taking access away and handing it
     * out are not the same authority and should not be the same button.
     */
    if (pin !== null) {
      return NextResponse.json({
        error: "A PIN is set by the person it belongs to. Send them a setup link instead.",
      }, { status: 400 });
    }
    const { error } = await db.rpc("clear_staff_pin", { p_staff: id });
    if (error) {
      return NextResponse.json({ error: error.message.replace(/^.*: /, "") }, { status: 400 });
    }
  }

  return NextResponse.json({ ok: true });
}
