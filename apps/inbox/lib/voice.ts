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

/* ------------------------------------------------------------------ the menu
 *
 * The call flow is data. Who answers the leasing line changes when somebody is
 * hired, goes on holiday or leaves, and that must not be a deployment -- a
 * phone tree that needs an engineer is a phone tree that stays wrong for a
 * fortnight.
 */

export type MenuOption = {
  digit: string; label: string;
  nextMenuKey: string | null; ringGroupId: string | null;
};
export type Menu = {
  id: string; key: string; prompt: string;
  fallbackGroup: string | null; options: MenuOption[];
};

export async function loadMenu(key: string): Promise<Menu | null> {
  const { data } = await supabaseAdmin()
    .from("call_menus")
    .select("id, key, prompt, fallback_group, call_options(digit, label, sort, ring_group_id, next_menu:next_menu_id(key))")
    .eq("key", key).maybeSingle();
  if (!data) return null;

  const options = ((data.call_options ?? []) as unknown as {
    digit: string; label: string; sort: number;
    ring_group_id: string | null; next_menu: { key: string } | null;
  }[])
    .sort((a, b) => a.sort - b.sort)
    .map((o) => ({
      digit: o.digit, label: o.label,
      nextMenuKey: o.next_menu?.key ?? null,
      ringGroupId: o.ring_group_id,
    }));

  return {
    id: data.id, key: data.key, prompt: data.prompt,
    fallbackGroup: data.fallback_group, options,
  };
}

/** One rung: who rings, and for how long. Empty rungs are skipped rather than
 *  ringing nobody for forty seconds, which from the caller's end is
 *  indistinguishable from being ignored. */
export type Stage = { position: number; seconds: number; numbers: string[] };

export async function ringStages(groupId: string): Promise<Stage[]> {
  const { data } = await supabaseAdmin()
    .from("ring_stages")
    .select("position, ring_seconds, ring_stage_members(staff:staff_id(id, forward_to, active))")
    .eq("group_id", groupId)
    .order("position");

  return (data ?? []).map((s) => ({
    position: s.position,
    seconds: s.ring_seconds,
    numbers: ((s.ring_stage_members ?? []) as unknown as {
      staff: { id: string; forward_to: string | null; active: boolean } | null;
    }[])
      .map((m) => m.staff)
      .filter((p): p is { id: string; forward_to: string; active: boolean } =>
        Boolean(p?.active && p.forward_to))
      .map((p) => p.forward_to),
  }));
}

export async function groupIntro(groupId: string): Promise<string | null> {
  const { data } = await supabaseAdmin()
    .from("ring_groups").select("intro").eq("id", groupId).maybeSingle();
  return data?.intro ?? null;
}

/** The menu itself, as TwiML. Repeated once if nothing is pressed, then handed
 *  to the fallback group -- ringing somebody beats hanging up on a person who
 *  cannot work a keypad or is driving. */
export function menuTwiml(menu: Menu, base: string, attempt: number): string {
  const action = `${base}/api/twilio/voice/menu?m=${encodeURIComponent(menu.key)}`
    + `&a=${attempt + 1}`;
  const digits = menu.options.map((o) => o.digit).join("");
  return `<Gather numDigits="1" timeout="6" action="${action}" method="POST"`
    + ` actionOnEmptyResult="true"`
    + (digits ? ` finishOnKey=""` : "")
    + `><Say voice="Polly.Joanna">${escapeXml(menu.prompt)}</Say></Gather>`;
}
