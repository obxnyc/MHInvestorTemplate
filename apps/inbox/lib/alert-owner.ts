import { supabaseAdmin } from "./supabase-admin";
import { sendSms } from "./notify";
import { pushToStaff } from "./push";
import { loadSetup } from "./crew-data";

/**
 * Send a "Check: ..." alert to everybody ticked for integrity alerts -- the
 * owner -- by text, or by the app's own notification when their number
 * cannot be texted from the company line.
 *
 * Written to the same ledger as every clock text, CLAIMED before it is sent,
 * keyed per event per person: so an alert goes once, and there is a record
 * of what the owner was told and when, which matters on the day somebody
 * says "nobody ever said".
 *
 * Never throws: an alert that cannot go must not undo the clock-in it is
 * about. It says what happened in the ledger instead.
 */
export async function alertOwners(event: string, body: string, link: string): Promise<number> {
  try {
    const db = supabaseAdmin();
    const who = (await loadSetup()).filter((p) => p.integrityAlerts && (p.textsTo || p.push));
    let sent = 0;
    for (const p of who) {
      const key = `integrity:${event}:${p.id}`;
      const claim = await db.from("clock_texts_sent").insert({
        key, kind: "integrity", staff_id: p.id, to_phone: p.textsTo ?? "app", body,
      });
      if (claim.error) continue; // already told about this one
      let ok = false;
      if (p.textsTo) {
        const sid = await sendSms(p.textsTo, body);
        ok = !!sid;
        await db.from("clock_texts_sent").update(sid ? { sid } : { error: "Twilio did not accept it" }).eq("key", key);
      } else {
        const took = await pushToStaff([p.id], { title: "Larabee: check this", body, url: link, tag: key })
          .catch(() => 0);
        ok = took > 0;
        await db.from("clock_texts_sent")
          .update(took ? { sid: `push:${took}` } : { error: "No device took the notification" }).eq("key", key);
      }
      if (ok) sent++;
    }
    return sent;
  } catch (e) {
    console.error("integrity alert failed", e);
    return 0;
  }
}
