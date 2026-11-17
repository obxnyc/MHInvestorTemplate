import { supabaseAdmin } from "./supabase-admin";
import { isOpen, type Hours } from "./hours";
import { keepRinging, type Person, type Stage } from "./ringorder";
export type { Person, Stage };

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

export type Lang = "en" | "es";
export const VOICE: Record<Lang, string> = { en: "Polly.Joanna", es: "Polly.Lupe" };
export const say = (text: string, lang: Lang = "en") =>
  `<Say voice="${VOICE[lang] ?? VOICE.en}">${escapeXml(text)}</Say>`;
export const asLang = (v: unknown): Lang => (v === "es" ? "es" : "en");

/** The handful of sentences the line says that are not in settings. */
export const PHRASE: Record<string, Record<Lang, string>> = {
  hold: { en: "Please hold while we connect you.", es: "Por favor espere mientras le comunicamos." },
  nudge: { en: "Sorry, that is not one of the options.", es: "Lo sentimos, esa no es una de las opciones." },
  transfer: { en: "Please hold while I transfer your call.", es: "Por favor espere mientras transfiero su llamada." },
  nothing: { en: "We did not receive a message. Goodbye.", es: "No recibimos ningún mensaje. Adiós." },
  thanks: { en: "Thank you. We have your message. Goodbye.", es: "Gracias. Recibimos su mensaje. Adiós." },
};

/* ---------------------------------------------------------------- settings
 *
 * Office hours, greetings and the texts the line sends. One row, edited
 * without a deployment. If the row is missing -- migration 053 not run --
 * the defaults below are what 053 would have written, so the line still
 * answers properly rather than falling over on a null.
 */

export type CallSettings = Hours & {
  day_greeting: string;
  night_greeting: string;
  voicemail_prompt: string;
  voicemail_prompt_es: string;
  leasing_prompt: string;
  leasing_prompt_es: string;
  portal_prompt: string;
  portal_prompt_es: string;
  portal_url: string | null;
  portal_text: string;
  portal_text_es: string;
  homes_url: string | null;
  homes_text: string;
  missed_text_on: boolean;
  missed_text: string;
  missed_text_es: string;
  after_hours_notify: string | null;
  intel_service_sid: string | null;
  intel_service_sid_es: string | null;
};

/** A settings sentence in the caller's language. */
export const inLang = (s: CallSettings, key: "voicemail_prompt" | "leasing_prompt"
  | "portal_prompt" | "portal_text" | "missed_text", lang: Lang): string =>
  (lang === "es" ? s[`${key}_es`] : s[key]) || s[key];

const DEFAULTS: CallSettings = {
  tz: "America/New_York", open_at: "08:00", close_at: "18:00", open_days: [1, 2, 3, 4, 5],
  day_greeting: "Thank you for calling Larabee Homes. Our office is open from 8 a.m. to 6 p.m. Emergency maintenance is available at any hour.",
  night_greeting: "Thank you for calling Larabee Homes. Our office is open from 8 a.m. to 6 p.m. Emergency maintenance is available at any hour.",
  voicemail_prompt: "We're sorry we missed your call. Please leave your name, number, and the reason for your call. A member of our team will return your call as soon as possible.",
  voicemail_prompt_es: "Lamentamos no haber podido atender su llamada. Por favor deje su nombre, su número y el motivo de su llamada. Un miembro de nuestro equipo le devolverá la llamada lo antes posible.",
  leasing_prompt: "Thank you for your interest. Please leave your name, number, and the home you are calling about, and a member of our team will call you back as soon as possible.",
  leasing_prompt_es: "Gracias por su interés. Por favor deje su nombre, su número y la casa por la que llama, y un miembro de nuestro equipo le devolverá la llamada lo antes posible.",
  portal_prompt: "Non-emergency repairs are handled through our online resident portal, where you can submit a request and follow its progress. We are sending you a text message with the link now. Thank you.",
  portal_prompt_es: "Las reparaciones que no son de emergencia se manejan a través de nuestro portal en línea para residentes, donde puede enviar una solicitud y seguir su progreso. Le estamos enviando un mensaje de texto con el enlace ahora. Gracias.",
  portal_url: null,
  portal_text: "Larabee Homes: submit your maintenance request here and follow its progress: {link}",
  portal_text_es: "Larabee Homes: envíe su solicitud de mantenimiento aquí y siga su progreso: {link}",
  homes_url: null,
  homes_text: "Larabee Homes: thanks for calling. Here are the homes we have available right now: {link} We'll call you first thing in the morning.",
  missed_text_on: true,
  missed_text: "This is Larabee Homes. Sorry we missed your call. Reply to this message or call us back at this number and we'll help you as soon as possible.",
  missed_text_es: "Le habla Larabee Homes. Lamentamos no haber podido atender su llamada. Responda a este mensaje o llámenos a este número y le ayudaremos lo antes posible.",
  after_hours_notify: null,
  intel_service_sid: null,
  intel_service_sid_es: null,
};

export async function callSettings(): Promise<CallSettings> {
  const { data } = await supabaseAdmin().from("call_settings").select("*").maybeSingle();
  return data ? { ...DEFAULTS, ...(data as Partial<CallSettings>) } : DEFAULTS;
}

export async function officeOpen(at = new Date()): Promise<boolean> {
  return isOpen(await callSettings(), at);
}

/* ---------------------------------------------------------------- the menu
 *
 * The call flow is data. Who answers the leasing line changes when somebody is
 * hired, goes on holiday or leaves, and that must not be a deployment -- a
 * phone tree that needs an engineer is a phone tree that stays wrong for a
 * fortnight.
 */

export type MenuOption = {
  digit: string; label: string;
  nextMenuKey: string | null; nextMenuLang: Lang | null;
  routeKey: string | null; ringGroupId: string | null;
  announce: string | null; announceLang: Lang;
};
export type Menu = {
  id: string; key: string; prompt: string; lang: Lang;
  fallbackRoute: string | null; fallbackGroup: string | null; options: MenuOption[];
};

export async function loadMenu(key: string): Promise<Menu | null> {
  const { data } = await supabaseAdmin()
    .from("call_menus")
    .select("id, key, lang, prompt, fallback_group, fallback_route:fallback_route(key), call_options(digit, label, sort, ring_group_id, announce, announce_lang, next_menu:next_menu_id(key, lang), route:route_id(key))")
    .eq("key", key).maybeSingle();
  if (!data) return null;

  const options = ((data.call_options ?? []) as unknown as {
    digit: string; label: string; sort: number; ring_group_id: string | null;
    announce: string | null; announce_lang: string | null;
    next_menu: { key: string; lang: string } | null; route: { key: string } | null;
  }[])
    .sort((a, b) => a.sort - b.sort)
    .map((o) => ({
      digit: o.digit, label: o.label,
      nextMenuKey: o.next_menu?.key ?? null,
      nextMenuLang: o.next_menu ? asLang(o.next_menu.lang) : null,
      routeKey: o.route?.key ?? null,
      ringGroupId: o.ring_group_id,
      announce: o.announce, announceLang: asLang(o.announce_lang),
    }));

  return {
    id: data.id, key: data.key, prompt: data.prompt, lang: asLang(data.lang),
    fallbackRoute: (data.fallback_route as unknown as { key: string } | null)?.key ?? null,
    fallbackGroup: data.fallback_group, options,
  };
}

/** The menu itself, as TwiML. Repeated once if nothing is pressed, then handed
 *  to the fallback -- ringing somebody beats hanging up on a person who cannot
 *  work a keypad or is driving. `lead` is said first, inside the Gather, so a
 *  caller who knows the tree can press through the greeting. */
export function menuTwiml(menu: Menu, base: string, attempt: number, lead = ""): string {
  const action = `${base}/api/twilio/voice/menu?m=${encodeURIComponent(menu.key)}`
    + `&amp;a=${attempt + 1}`;
  return `<Gather numDigits="1" timeout="6" action="${action}" method="POST"`
    + ` actionOnEmptyResult="true">`
    + (lead ? say(lead, menu.lang) : "")
    + say(menu.prompt, menu.lang)
    // "Para español, oprima 8" -- said in Spanish, at the end of the English menu.
    + menu.options.filter((o) => o.announce).map((o) => say(o.announce!, o.announceLang)).join("")
    + `</Gather>`
    // Reached only if Twilio does not post the empty result back; belt and braces.
    + `<Redirect method="POST">${action}</Redirect>`;
}

/* ---------------------------------------------------------------- routes */

export type Action = "ring" | "portal" | "voicemail" | "leasing_voicemail";
export type Route = {
  key: string; category: string; whisper: string;
  dayAction: Action; dayGroup: string | null;
  nightAction: Action; nightGroup: string | null;
};

export async function loadRoute(key: string): Promise<Route | null> {
  const { data } = await supabaseAdmin().from("call_routes")
    .select("key, category, whisper, day_action, day_group, night_action, night_group")
    .eq("key", key).maybeSingle();
  if (!data) return null;
  return {
    key: data.key, category: data.category, whisper: data.whisper,
    dayAction: data.day_action as Action, dayGroup: data.day_group,
    nightAction: data.night_action as Action, nightGroup: data.night_group,
  };
}

/** What a route does right now. */
export function routeNow(r: Route, open: boolean): { action: Action; group: string | null } {
  return open
    ? { action: r.dayAction, group: r.dayGroup }
    : { action: r.nightAction, group: r.nightGroup };
}

/* ---------------------------------------------------------------- who rings */

/* One rung: who rings, and for how long (Stage, in ringorder.ts). Empty rungs
 * are skipped rather than ringing nobody for twelve seconds, which from the
 * caller's end is indistinguishable from being ignored. */

type PersonRow = { id: string; full_name: string; phone: string; staff_id: string | null; active: boolean };
const asPerson = (p: PersonRow): Person =>
  ({ id: p.id, name: p.full_name, phone: p.phone, staffId: p.staff_id });

export async function ringStages(groupId: string): Promise<Stage[]> {
  const db = supabaseAdmin();
  const { data: group } = await db.from("ring_groups")
    .select("keep_ringing").eq("id", groupId).maybeSingle();
  const { data } = await db
    .from("ring_stages")
    .select("position, ring_seconds, ring_stage_people(person:person_id(id, full_name, phone, staff_id, active))")
    .eq("group_id", groupId)
    .order("position");

  const stages = (data ?? []).map((s) => ({
    position: s.position,
    seconds: s.ring_seconds,
    people: ((s.ring_stage_people ?? []) as unknown as { person: PersonRow | null }[])
      .map((m) => m.person)
      .filter((p): p is PersonRow => Boolean(p?.active && p.phone))
      .map(asPerson),
  }));
  return group?.keep_ringing === false ? stages : keepRinging(stages);
}

export async function loadPerson(id: string): Promise<Person | null> {
  const { data } = await supabaseAdmin().from("phone_people")
    .select("id, full_name, phone, staff_id, active").eq("id", id).maybeSingle();
  return data && data.active ? asPerson(data as PersonRow) : null;
}

/** A person, by the number their phone rang on. Twilio hands the dialled
 *  number back on the child leg as `To`. */
export async function personByPhone(phone: string): Promise<Person | null> {
  const { data } = await supabaseAdmin().from("phone_people")
    .select("id, full_name, phone, staff_id, active").eq("phone", phone).maybeSingle();
  return data ? asPerson(data as PersonRow) : null;
}
