/**
 * Rent Manager, talked to directly.
 *
 * Written against rmAPI version 12, which is the REST interface behind the
 * hosted product. The shape of it:
 *
 *   POST https://<company>.api.rentmanager.com/Authentication/AuthorizeUser
 *        {"Username": "...", "Password": "...", "LocationID": 1}
 *   -> a token, as a bare JSON string
 *
 *   GET  .../Properties?fields=Name&pagesize=5
 *        X-RM12Api-ApiToken: <token>
 *
 * Everything here is deliberately defensive about that, because two things
 * are true at once: this is the documented shape, and no two Rent Manager
 * accounts are switched on quite the same way. API access is a thing that has
 * to be enabled, the endpoints available depend on what the account has
 * bought, and the token header has been spelled differently across versions.
 * So the code reports what it actually got rather than assuming it knows --
 * see the probe route, which is the whole reason this file exists tonight.
 */

export type RmSettings = {
  base: string;
  username: string;
  password: string;
  locationId: number;
};

/** Where the credentials live: the deployment's environment, never the
 *  database and never a config file in the repository. */
export function rmSettings(): RmSettings | null {
  const raw = (process.env.RENTMANAGER_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const company = (process.env.RENTMANAGER_COMPANY ?? "").trim();
  const username = (process.env.RENTMANAGER_USERNAME ?? "").trim();
  const password = process.env.RENTMANAGER_PASSWORD ?? "";
  const locationId = Number(process.env.RENTMANAGER_LOCATION_ID ?? 1);

  // Either the whole URL or just the company code, because people have one or
  // the other to hand and guessing wrong costs an evening.
  const base = raw || (company ? `https://${company}.api.rentmanager.com` : "");
  if (!base || !username || !password) return null;
  return { base, username, password, locationId: Number.isFinite(locationId) ? locationId : 1 };
}

export function rmConfigured() { return rmSettings() !== null; }

/** Tokens last hours, not seconds, and authenticating on every call is both
 *  slow and a good way to get an integration user locked out. Held in module
 *  memory: a serverless instance reuses it while it is warm and re-fetches
 *  when it is not, which is exactly the behaviour wanted and needs no store. */
let cached: { token: string; until: number } | null = null;

export type RmAuth =
  | { ok: true; token: string; cached: boolean }
  | { ok: false; status: number; detail: string };

export async function rmAuthorize(force = false): Promise<RmAuth> {
  const s = rmSettings();
  if (!s) return { ok: false, status: 0, detail: "No Rent Manager credentials on this deployment." };

  if (!force && cached && cached.until > Date.now()) {
    return { ok: true, token: cached.token, cached: true };
  }

  let res: Response;
  try {
    res = await fetch(`${s.base}/Authentication/AuthorizeUser`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        Username: s.username, Password: s.password, LocationID: s.locationId,
      }),
      cache: "no-store",
    });
  } catch (e) {
    // Nearly always DNS: a company code that is not theirs resolves to
    // nothing, and that is a five-second fix worth naming.
    return { ok: false, status: 0,
      detail: `Could not reach ${s.base} — ${(e as Error).message}` };
  }

  const body = (await res.text()).trim();
  if (!res.ok) {
    return { ok: false, status: res.status, detail: body.slice(0, 300) || res.statusText };
  }

  // The token comes back as a bare JSON string, quotes and all. Tolerated
  // either way in case an account is fronted by something that wraps it.
  let token = body.replace(/^"|"$/g, "");
  if (token.startsWith("{")) {
    try {
      const j = JSON.parse(body) as Record<string, string>;
      token = j.Token ?? j.token ?? j.ApiToken ?? token;
    } catch { /* keep the raw string */ }
  }
  if (!token || token.length < 8) {
    return { ok: false, status: res.status, detail: `Signed in but got no token back: ${body.slice(0, 200)}` };
  }

  // Deliberately short of the real lifetime. A token that expires mid-import
  // is a confusing failure; re-authenticating an hour early is free.
  cached = { token, until: Date.now() + 45 * 60_000 };
  return { ok: true, token, cached: false };
}

export type RmCall = {
  path: string;
  status: number;
  ok: boolean;
  /** How many records came back, when the answer was a list. */
  count: number | null;
  /** The field names on the first record, which is what tells us how to map
   *  their data onto ours without guessing. */
  shape: string[] | null;
  detail: string | null;
};

/** One GET, reported rather than thrown. The probe needs to try a dozen of
 *  these and say what happened to each, so a 404 is an answer and not an
 *  exception. */
export async function rmGet(path: string, token: string): Promise<RmCall> {
  const s = rmSettings();
  if (!s) return { path, status: 0, ok: false, count: null, shape: null,
                   detail: "not configured" };

  try {
    const res = await fetch(`${s.base}${path}`, {
      headers: { "X-RM12Api-ApiToken": token, Accept: "application/json" },
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) {
      return { path, status: res.status, ok: false, count: null, shape: null,
               detail: text.slice(0, 250) || res.statusText };
    }
    let data: unknown;
    try { data = JSON.parse(text); } catch {
      return { path, status: res.status, ok: true, count: null, shape: null,
               detail: `Answered, but not JSON: ${text.slice(0, 120)}` };
    }
    const list = Array.isArray(data) ? data : null;
    const first = list?.[0] ?? (list ? null : data);
    return {
      path, status: res.status, ok: true,
      count: list ? list.length : null,
      shape: first && typeof first === "object"
        ? Object.keys(first as Record<string, unknown>).slice(0, 40) : null,
      detail: null,
    };
  } catch (e) {
    return { path, status: 0, ok: false, count: null, shape: null,
             detail: (e as Error).message };
  }
}
