/**
 * The clock on the wall where the work is.
 *
 * Every property is in North Carolina, so there is one answer, and it is
 * better written down than left to whichever machine happens to format the
 * string -- every server here runs in UTC, so a shift that began at 8:08 in
 * the evening was written into a message as "since 12:08 AM", and a 2pm
 * showing would have been texted to a prospect as 6pm.
 *
 * In its own file, with nothing else in it, because it used to live in
 * format.ts -- behind an import of a phone-number library. A one-line fact
 * about the business should not drag a parser in with it, and anything that
 * cannot be imported cheaply ends up copied instead, which is how the role
 * list came to be hardcoded in seven files.
 *
 * If a property is ever bought in another zone this becomes a column on the
 * property and this becomes its default, which is a far smaller change than
 * finding every place a time was printed.
 */
export const ZONE = "America/New_York";
