import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { supabaseAdmin } from "./supabase-admin";
import { twilioClient } from "./twilio";
import { CALL_CATEGORIES } from "./callcats";

/**
 * Turning a recorded call into words, and the words into a note.
 *
 * The recording is dual-channel -- the caller on channel 1, whoever answered
 * on channel 2 -- so the transcript knows who said what without guessing from
 * voices. Twilio Voice Intelligence does the listening, on the account that
 * already holds the recording, so the audio never leaves Twilio.
 *
 * The service it needs is found or made on first use and remembered in
 * call_settings. Nobody copies an id between two dashboards.
 */

/* One service per language: Voice Intelligence listens for the language the
   service was made with, and a Spanish call through an English service comes
   back as English-shaped nonsense. */
const SERVICES = {
  en: { name: "larabee-office-line", code: "en-US", column: "intel_service_sid" },
  es: { name: "larabee-office-line-es", code: "es-US", column: "intel_service_sid_es" },
} as const;

export type Line = { who: "caller" | "us"; at: number; text: string };

async function serviceSid(lang: "en" | "es"): Promise<string> {
  const want = SERVICES[lang];
  const db = supabaseAdmin();
  const { data: s } = await db.from("call_settings").select(want.column).maybeSingle();
  const saved = (s as Record<string, string | null> | null)?.[want.column];
  if (saved) return saved;

  const client = twilioClient();
  const existing = (await client.intelligence.v2.services.list({ limit: 50 }))
    .find((x) => x.uniqueName === want.name);
  const base = (process.env.PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const sid = existing?.sid ?? (await client.intelligence.v2.services.create({
    uniqueName: want.name,
    friendlyName: lang === "es" ? "Larabee office line (Spanish)" : "Larabee office line",
    autoTranscribe: false,
    languageCode: want.code,
    ...(base ? { webhookUrl: `${base}/api/twilio/voice/transcript`, webhookHttpMethod: "POST" as const } : {}),
  })).sid;

  await db.from("call_settings").update({ [want.column]: sid }).eq("id", true);
  return sid;
}

/** Make sure both transcript services exist, now rather than on the first
 *  real call -- an account without Voice Intelligence switched on says so
 *  here, in words, instead of in a log nobody reads. */
export async function transcriptServiceCheck(): Promise<string> {
  try {
    const en = await serviceSid("en");
    const es = await serviceSid("es");
    return `ready (${en}, ${es})`;
  } catch (e) {
    return `not available: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Ask for the transcript. Never throws: a call that cannot be transcribed is
 *  still a call with a recording, and says why on the Calls page. */
export async function startTranscript(recordingRowId: string, recordingSid: string) {
  const db = supabaseAdmin();
  try {
    const { data: rec } = await db.from("call_recordings")
      .select("calls(language)").eq("id", recordingRowId).maybeSingle();
    const lang = (rec?.calls as unknown as { language: string | null } | null)?.language === "es" ? "es" : "en";
    const t = await twilioClient().intelligence.v2.transcripts.create({
      serviceSid: await serviceSid(lang),
      customerKey: recordingRowId,
      channel: {
        media_properties: { source_sid: recordingSid },
        participants: [
          { channel_participant: 1, role: "Customer", full_name: "Caller" },
          { channel_participant: 2, role: "Agent", full_name: "Larabee Homes" },
        ],
      },
    });
    await db.from("call_recordings")
      .update({ transcript_sid: t.sid, transcript_status: t.status })
      .eq("id", recordingRowId);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    console.error("transcript request failed", why);
    await db.from("call_recordings")
      .update({ transcript_status: `could not start: ${why}`.slice(0, 300) })
      .eq("id", recordingRowId);
  }
}

/**
 * Fetch a finished transcript and file it. Called by Twilio's webhook, and by
 * the Calls page for anything the webhook never delivered -- the webhook body
 * is only ever used for the transcript's sid, and everything else is read
 * back from Twilio, so a forged webhook can at most make us re-read our own
 * transcript.
 */
export async function collectTranscript(transcriptSid: string): Promise<"done" | "waiting" | "unknown"> {
  const db = supabaseAdmin();
  const client = twilioClient();
  const t = await client.intelligence.v2.transcripts(transcriptSid).fetch();

  const { data: rec } = await db.from("call_recordings")
    .select("id, call_id")
    .or(`transcript_sid.eq.${transcriptSid},id.eq.${t.customerKey || "00000000-0000-0000-0000-000000000000"}`)
    .maybeSingle();
  if (!rec) return "unknown";

  if (t.status !== "completed") {
    await db.from("call_recordings").update({ transcript_status: t.status }).eq("id", rec.id);
    return "waiting";
  }

  const sentences = await client.intelligence.v2.transcripts(transcriptSid).sentences.list({ limit: 1000 });
  const lines: Line[] = sentences
    .map((x) => ({
      who: (x.mediaChannel === 1 ? "caller" : "us") as Line["who"],
      at: Number(x.startTime) || 0,
      text: x.transcript,
    }))
    .sort((a, b) => a.at - b.at);

  await db.from("call_recordings").update({
    transcript_sid: transcriptSid, transcript_status: "completed", transcript: lines,
  }).eq("id", rec.id);

  await summarizeCall(rec.call_id);
  return "done";
}

/* ---------------------------------------------------------------- the note */

const Note = z.object({
  summary: z.string(),
  property: z.string().nullable(),
  promised: z.string().nullable(),
  category: z.enum(CALL_CATEGORIES),
  follow_up: z.enum(["none", "call_back", "maintenance_request", "send_listings",
                     "send_application", "other"]),
  follow_up_detail: z.string().nullable(),
});

const SYSTEM = `You write the note for a phone call to Larabee Homes, a property \
company in North Carolina that rents and sells single-family homes and homes in \
its manufactured-home communities, and buys homes and properties.

Write the way an office manager would jot it down: plain, short, specific.
- summary: two or three sentences. Who called, what they need, what happened.
- property: the address, lot or community they mentioned, exactly as said, or null.
- promised: anything our side committed to (a callback time, a visit, sending \
something), or null.
- category: the best fit from the list.
- follow_up: the one next step, if there is one, and follow_up_detail says it in \
a short phrase ("Repair request: kitchen sink leaking, 214 Oak St").

Write the note in English even when the call was in Spanish.

Use only what is in the transcript. Never guess at a name, an amount or an address \
that was not said. Never comment on anybody's family, health, race, religion or \
national origin.`;

export async function summarizeCall(callId: string) {
  if (!process.env.ANTHROPIC_API_KEY) return;
  const db = supabaseAdmin();

  const { data: call } = await db.from("calls")
    .select("id, category, after_hours, language, voicemail_text, contacts(full_name, phone)")
    .eq("id", callId).maybeSingle();
  if (!call) return;
  const { data: recs } = await db.from("call_recordings")
    .select("kind, transcript").eq("call_id", callId).order("created_at");

  const conversation = (recs ?? [])
    .flatMap((r) => (r.transcript as Line[] | null) ?? [])
    .map((l) => `${l.who === "caller" ? "Caller" : "Larabee"}: ${l.text}`)
    .join("\n");
  const voicemail = call.voicemail_text ? `Voicemail left by the caller:\n${call.voicemail_text}` : "";
  if (!conversation && !voicemail) return;

  const who = call.contacts as unknown as { full_name: string | null; phone: string } | null;
  const context = [
    `Caller on file as: ${who?.full_name ?? "unknown"}.`,
    `They chose from the phone menu: ${call.category ?? "nothing"}.`,
    call.after_hours ? "The call came in outside office hours." : "",
    call.language === "es" ? "The caller chose Spanish." : "",
  ].filter(Boolean).join(" ");

  try {
    const response = await new Anthropic().messages.parse({
      model: "claude-opus-5",
      max_tokens: 600,
      system: SYSTEM,
      output_config: { format: zodOutputFormat(Note), effort: "low" },
      messages: [{ role: "user", content: `${context}\n\n${conversation}\n\n${voicemail}`.trim() }],
    });
    const n = response.parsed_output;
    if (!n || response.stop_reason === "refusal") return;

    const lines = [
      n.summary,
      n.property ? `Property: ${n.property}` : "",
      n.promised ? `We said: ${n.promised}` : "",
    ].filter(Boolean);

    await db.from("calls").update({
      summary: lines.join("\n"),
      suggested_category: n.category,
      follow_up: n.follow_up === "none" ? null
        : (n.follow_up_detail || n.follow_up.replace(/_/g, " ")),
    }).eq("id", callId);
  } catch (e) {
    console.error("call summary unavailable", e);
  }
}
