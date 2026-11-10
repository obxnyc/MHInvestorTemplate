import { supabaseAdmin } from "./supabase-admin";
import { toE164, isValidPhone, canSmsFromLine } from "./phone";
import { isField } from "./roles";
import { DEFAULTS, KINDS, type Kind, type Person, type Settings } from "./clock-texts";
import type { Method } from "./pay";

/**
 * Who is on which crew, how they are paid, and when the texts go.
 *
 * Read with the service role, so callers must have checked who is asking
 * first. crew_setup holds wages and is office-only by row policy; this
 * module is the server side of that line, never the browser's.
 */

export type SetupRow = {
  id: string;
  name: string;
  role: string;
  field: boolean;
  leadId: string | null;
  onClock: boolean;
  allReports: boolean;
  rateCents: number | null;
  method: Method | null;
  handle: string | null;
  /** The number on crew_setup, as typed. */
  phone: string | null;
  lang: "en" | "es";
  /** What a text would actually go to: crew_setup.phone, else the number
   *  they gave when they joined. Null when neither is a real mobile. */
  textsTo: string | null;
};

export async function loadSetup(): Promise<SetupRow[]> {
  const db = supabaseAdmin();
  const [{ data: staff }, { data: setup, error }] = await Promise.all([
    db.from("staff").select("id, full_name, role, forward_to").eq("active", true).order("full_name"),
    db.from("crew_setup").select("*"),
  ]);
  // Absent until 051 is run: everybody shows with nothing set up, rather than
  // the screen failing to load.
  const by = new Map((error ? [] : setup ?? []).map((r) => [String(r.staff_id), r]));

  return (staff ?? []).map((s) => {
    const c = by.get(String(s.id));
    const typed = (c?.phone as string | null) ?? null;
    const raw = typed || (s.forward_to as string | null) || "";
    const e164 = raw ? toE164(raw) : "";
    return {
      id: String(s.id),
      name: String(s.full_name ?? "Unknown"),
      role: String(s.role),
      field: isField(s.role),
      leadId: (c?.lead_id as string | null) ?? null,
      onClock: !!c?.on_clock,
      allReports: !!c?.all_reports,
      rateCents: c?.rate_cents === null || c?.rate_cents === undefined ? null : Number(c.rate_cents),
      method: (c?.pay_method as Method | null) ?? null,
      handle: (c?.pay_handle as string | null) ?? null,
      phone: typed,
      lang: c?.lang === "es" ? "es" : "en",
      textsTo: e164 && isValidPhone(e164) && canSmsFromLine(e164) ? e164 : null,
    };
  });
}

export type TextSettings = Omit<Settings, "base"> & { enabled: boolean; overtime: boolean };

export async function loadTextSettings(): Promise<TextSettings> {
  const { data } = await supabaseAdmin().from("clock_text_settings").select("*").maybeSingle();
  const at = { ...DEFAULTS.at };
  const given = (data?.at ?? {}) as Record<string, unknown>;
  for (const k of KINDS) {
    if (k in given) at[k as Kind] = typeof given[k] === "string" && given[k] ? String(given[k]) : null;
  }
  return {
    enabled: data ? !!data.enabled : false,
    tz: String(data?.tz ?? DEFAULTS.tz),
    at,
    days: Array.isArray(data?.days) ? (data!.days as number[]).map(Number) : DEFAULTS.days,
    optionalDays: Array.isArray(data?.optional_days)
      ? (data!.optional_days as number[]).map(Number) : DEFAULTS.optionalDays,
    // Absent column (052 not run) is the default; a stored null is "off".
    autoOut: data && "auto_out" in data
      ? (typeof data.auto_out === "string" && data.auto_out ? data.auto_out : null)
      : DEFAULTS.autoOut,
    overtime: data ? data.overtime !== false : true,
  };
}

export const asPerson = (r: SetupRow): Person => ({
  id: r.id, name: r.name, phone: r.textsTo,
  onClock: r.onClock, leadId: r.leadId, allReports: r.allReports, lang: r.lang,
});
