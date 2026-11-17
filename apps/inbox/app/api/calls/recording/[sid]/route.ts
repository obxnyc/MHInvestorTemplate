import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Plays a recording, through us.
 *
 * Twilio's recording links need the account's credentials on accounts with
 * media authentication switched on -- every account opened since 2023 -- so
 * an <audio> pointed straight at them is a player that never plays. They are
 * fetched here with the account's own key, only for somebody signed in, and
 * only for a recording that belongs to a call on file.
 *
 * The Range header is passed through, which is what lets the player seek.
 */
export async function GET(req: Request, ctx: { params: Promise<{ sid: string }> }) {
  const staff = await requireStaff();
  if (!staff) return new NextResponse("not signed in", { status: 401 });
  const { sid } = await ctx.params;
  if (!/^RE[0-9a-f]{32}$/i.test(sid)) return new NextResponse("not a recording", { status: 400 });

  const db = supabaseAdmin();
  const [{ data: rec }, { data: legacy }] = await Promise.all([
    db.from("call_recordings").select("id").eq("recording_sid", sid).maybeSingle(),
    db.from("calls").select("id").eq("recording_sid", sid).maybeSingle(),
  ]);
  if (!rec && !legacy) return new NextResponse("no such recording", { status: 404 });

  const account = process.env.TWILIO_ACCOUNT_SID!;
  const auth = Buffer.from(`${account}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const range = req.headers.get("range");
  const upstream = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${account}/Recordings/${sid}.mp3`,
    { headers: { Authorization: `Basic ${auth}`, ...(range ? { Range: range } : {}) } },
  );
  if (!upstream.ok && upstream.status !== 206) {
    return new NextResponse(`Twilio answered ${upstream.status}`, { status: 502 });
  }

  const headers = new Headers({ "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=3600" });
  for (const h of ["content-length", "content-range", "accept-ranges"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new NextResponse(upstream.body, { status: upstream.status, headers });
}
