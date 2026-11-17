/**
 * Which clock-in photos may be attached to a clock-in.
 *
 * Pure, so the rule that stops a buddy's photo or yesterday's from being
 * used can be checked without a database. A path is
 *   clock/<staff id>/<server ms>-<face|site>.<ext>
 * and the server ms is when it ARRIVED (see app/api/clock/photo).
 */

/** How old a photo may be and still be "taken at this clock-in". */
export const PHOTO_FRESH_MS = 15 * 60_000;

const SHAPE = /^clock\/([0-9a-f-]{36})\/(\d{13})-(face|site)\.(jpg|png|webp|heic|heif)$/;

export type PhotoCheck =
  | { ok: true; face: string; site: string }
  | { ok: false; why: string };

/** Both a face and a site photo, this person's own, from the last 15 minutes. */
export function checkPhotos(paths: unknown, staffId: string, now: number): PhotoCheck {
  const list = Array.isArray(paths) ? paths.map(String) : [];
  let face: string | null = null, site: string | null = null;
  for (const p of list) {
    const m = SHAPE.exec(p);
    if (!m) return { ok: false, why: "That photo is not one taken here." };
    if (m[1] !== staffId) return { ok: false, why: "That photo was taken on somebody else's account." };
    const age = now - Number(m[2]);
    if (age < -60_000 || age > PHOTO_FRESH_MS) {
      return { ok: false, why: "That photo is too old. Take new ones." };
    }
    if (m[3] === "face") face = p; else site = p;
  }
  if (!face) return { ok: false, why: "Take a selfie first." };
  if (!site) return { ok: false, why: "Take a photo of the job too." };
  return { ok: true, face, site };
}
