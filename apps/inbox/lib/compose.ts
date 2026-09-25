/** Somebody a new message can go to.
 *
 *  Named rather than declared in the route, because the picker and the route
 *  have to agree on it and a type imported out of a route file is a quiet way
 *  to pull server code into the browser bundle.
 *
 *  `id` is a staff id, a contact id, or an E.164 number for somebody not on
 *  file yet -- which is exactly what the caller has to send back to open the
 *  right kind of thread.
 */
export type Recipient = {
  kind: "staff" | "contact" | "number";
  id: string;
  name: string;
  sub: string | null;
};
