/**
 * Is the caller a machine holding the right key?
 *
 * Two keys exist and they are deliberately separate: `reports_cron_key` in
 * Vault, which the morning report's schedule presents, and the clock texts'
 * token in `private.cron_tokens`. Both are generated INSIDE Postgres and
 * checked inside Postgres (migration 051), so neither is ever copied between
 * two dashboards by a person -- which is the step that costs a round trip
 * every time and the step where a secret ends up in a chat window.
 *
 * `CRON_SECRET` is the third way in and is for a person with the environment
 * variable, not for the schedule.
 *
 * THE REASON THIS IS A FILE. The same twelve lines sat in two routes, and
 * the setup check now needs them too -- because a diagnostic only a signed-in
 * admin can read is a diagnostic nobody can run from anywhere else, and
 * "open this page and read me the line" is a question that should not have to
 * be asked. Three copies of an authorization rule is three places for it to
 * drift, and the one that drifts quietly is the one that stops refusing.
 */
import { timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";

/** Which of the two database-side checks to ask. Named rather than passed as
 *  a string so a typo is a compile error instead of a 401 nobody can explain. */
export type CronKeyCheck = "report_key_ok" | "clock_cron_ok";

export async function cronKeyOk(req: Request, which: CronKeyCheck): Promise<boolean> {
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!given) return false;

  const secret = process.env.CRON_SECRET;
  if (secret) {
    /* Length first: timingSafeEqual throws on a length mismatch, and a thrown
       comparison in an authorization path is a 500 where a 401 belongs. */
    const a = Buffer.from(given), b = Buffer.from(secret);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }

  /* The argument names differ between the two functions, so they are two
     calls rather than one call with a built object -- which the typed client
     cannot check. */
  const { data, error } = which === "report_key_ok"
    ? await supabaseAdmin().rpc("report_key_ok", { k: given })
    : await supabaseAdmin().rpc("clock_cron_ok", { p_token: given });

  if (error) console.error(`${which} failed`, error.message);
  return data === true;
}
