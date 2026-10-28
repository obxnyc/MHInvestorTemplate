/**
 * The line that comes after "certain personal property, to wit:".
 *
 * It is the only thing in the purchase agreement that says WHICH home is
 * being sold, and it was being filled with three words -- a year, a make
 * and a serial number -- because those are the only three a sale records.
 * Size, bedrooms, bathrooms and where the home stands are not in the
 * database at all.
 *
 * So this writes the fullest sentence the records allow and the screen
 * opens it for somebody to finish. Guessing the rest would be worse than
 * leaving room for it: a contract that reads almost right reads right.
 */
export type Described = {
  homeYear: number | null;
  homeMake: string | null;
  homeSerial: string | null;
  lot: string;
  parkName: string;
  parkAddress: string | null;
};

/** The year, make and serial as the sale records them. */
export function describe(h: Pick<Described, "homeYear" | "homeMake" | "homeSerial">): string {
  return [
    h.homeYear ? String(h.homeYear) : "",
    h.homeMake ?? "",
    h.homeSerial ? `Serial# ${h.homeSerial}` : "",
  ].filter(Boolean).join(" ");
}

export function homeSentence(h: Described): string {
  const what = describe(h);
  const where = [
    h.lot ? `Lot ${h.lot}` : "",
    h.parkName || "",
    h.parkAddress || "",
  ].filter(Boolean).join(", ");
  if (!where) return what;
  return `${what ? what + ", " : ""}situated on ${where}`;
}
