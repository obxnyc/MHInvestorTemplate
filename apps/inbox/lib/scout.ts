/** Driving for dollars (075): the words, and the one rule about photos. */

export const SPOT_KINDS: [string, string][] = [
  ["mhp", "Mobile home park"], ["multifamily", "Multifamily"], ["single_family", "House"],
  ["land", "Land"], ["commercial", "Commercial"], ["other", "Other"],
];

/** What made them stop. Picked with a thumb at a stop sign, so short. */
export const SPOT_TAGS: [string, string][] = [
  ["overgrown", "Overgrown"], ["vacant", "Looks vacant"], ["boarded", "Boarded up"],
  ["roof", "Roof damage / tarp"], ["junk", "Junk or debris"], ["empty_lots", "Empty lots"],
  ["abandoned_homes", "Abandoned homes"], ["for_sale", "For sale sign"], ["code", "Code notice"],
  ["septic", "Septic / water trouble"], ["mom_pop", "Mom-and-pop"],
];

export const SPOT_STAGES: [string, string][] = [
  ["new", "New"], ["researching", "Researching"], ["contacted", "Contacted"], ["talking", "Talking"],
  ["offer", "Offer out"], ["contract", "Under contract"], ["closed", "Closed"], ["pass", "Pass"],
];

/** A photo may go on a sighting only if THIS person uploaded it, in the
 *  last hour, through /api/scout/photo -- which names it
 *  scout/<their id>/<server ms>-<random>.<ext>. The time is the server's,
 *  so neither the phone's clock nor the photo's own date can change it. */
export function photoPathOk(path: string, staffId: string, now: number, windowMs = 60 * 60 * 1000) {
  const m = /^scout\/([0-9a-f-]{36})\/(\d{13})-[a-z0-9]{1,8}\.(jpg|png|webp|heic|heif)$/.exec(path);
  if (!m || m[1] !== staffId) return false;
  const at = Number(m[2]);
  return at <= now + 60_000 && now - at <= windowMs;
}
