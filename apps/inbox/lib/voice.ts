import { supabaseAdmin } from "./supabase-admin";

/** The ring group, in the order Twilio should dial them. Everyone rings at
 *  once; the whisper decides who actually gets the call. */
export async function ringGroup() {
  const { data } = await supabaseAdmin()
    .from("staff")
    .select("id, full_name, forward_to")
    .eq("active", true)
    .not("forward_to", "is", null);
  return data ?? [];
}

export function escapeXml(s: string) {
  return s.replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]!));
}

export function twiml(body: string) {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
