/**
 * Rent Manager, talked to directly.
 *
 * Written against rmAPI v12, the REST interface behind the hosted product:
 *
 *   POST {base}/Authentication/AuthorizeUser
 *        {"Username": "...", "Password": "...", "LocationID": 1}
 *   -> a token, as a bare JSON string
 *
 *   GET  {base}/Properties?pagesize=1
 *        X-RM12Api-ApiToken: {token}
 *
 * Everything about that is treated as a hypothesis rather than a fact, and
 * for a specific reason: this account is on Rent Manager Express, whose web
 * app lives on a different hostname from the documented API, the docs are not
 * reachable from the machine this was written on, and there is nobody at Rent
 * Manager to ask. Guessing once and failing costs a redeploy and a round trip
 * through a person. So instead of guessing, it tries: several hostnames,
 * several token headers, and it reports which combination answered.
 *
 * Once something works it is remembered for the life of the instance, so the
 * searching happens once and every call after it goes straight there.
 */

export type RmSettings = {
  company: string;
  username: string;
  password: string;
  locationId: number;
  /** Set only when somebody has overridden the hostname by hand. */
  fixedBase: string | null;
};

export function rmSettings(): RmSettings | null {
  const username = (process.env.RENTMANAGER_USERNAME ?? "").trim();
  const password = process.env.RENTMANAGER_PASSWORD ?? "";
  const fixed = (process.env.RENTMANAGER_BASE_URL ?? "").trim().replace(/\/+$/, "");
  let company = (process.env.RENTMANAGER_COMPANY ?? "").trim().toLowerCase();

  // The company code is in the hostname if a URL was given, so it never has
  // to be typed twice.
  if (!company && fixed) company = fixed.replace(/^https?:\/\//, "").split(".")[0] ?? "";
  if (!username || !password || !company) return null;

  const locationId = Number(process.env.RENTMANAGER_LOCATION_ID ?? 1);
  return {
    company, username, password,
    locationId: Number.isFinite(locationId) ? locationId : 1,
    fixedBase: fixed || null,
  };
}

export function rmConfigured() { return rmSettings() !== null; }

/** Where the API might be, most likely first. `rmx` is the Express web app's
 *  own hostname and is here because that is demonstrably where this account
 *  lives, even though the documented API host is the first one. */
export function candidateBases(company: string): string[] {
  return [
    `https://${company}.api.rentmanager.com`,
    `https://${company}.rmx.rentmanager.com/api`,
    `https://${company}.rmx.rentmanager.com`,
    `https://${company}.rentmanager.com/api`,
  ];
}

/** The same token, spelled the way each generation of the API wants it. */
const TOKEN_HEADERS = [
  "X-RM12Api-ApiToken",
  "X-RMApi-ApiToken",
  "X-RM11Api-ApiToken",
] as const;

export type Attempt = {
  base: string;
  status: number;
  ok: boolean;
  detail: string;
};

export type RmSession = { base: string; token: string; header: string };

/** Found once, then reused. Not a cache of data -- a cache of which of the
 *  guesses turned out to be right. */
let known: { session: RmSession; until: number } | null = null;

export type RmAuthResult =
  | { ok: true; session: RmSession; cached: boolean; attempts: Attempt[] }
  | { ok: false; attempts: Attempt[] };

/**
 * Sign in, trying each candidate hostname until one accepts the credentials.
 *
 * Every attempt is recorded and returned, including the failures, because
 * which way it failed is the diagnosis: nothing at all is a wrong company
 * code, a 401 is a real server refusing a real credential, and a 404 on this
 * endpoint is an account with no API on it.
 */
export async function rmAuthorize(force = false): Promise<RmAuthResult> {
  const s = rmSettings();
  if (!s) return { ok: false, attempts: [] };

  if (!force && known && known.until > Date.now()) {
    return { ok: true, session: known.session, cached: true, attempts: [] };
  }

  const bases = s.fixedBase ? [s.fixedBase] : candidateBases(s.company);
  const attempts: Attempt[] = [];

  for (const base of bases) {
    let res: Response;
    try {
      res = await fetch(`${base}/Authentication/AuthorizeUser`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          Username: s.username, Password: s.password, LocationID: s.locationId,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      attempts.push({ base, status: 0, ok: false,
        detail: `no answer — ${(e as Error).message}` });
      continue;
    }

    const body = (await res.text()).trim();
    if (!res.ok) {
      attempts.push({ base, status: res.status, ok: false,
        detail: body.slice(0, 200) || res.statusText });
      // A 401 means this IS the right server and the credential is the
      // problem. Carrying on down the list would only collect noise.
      if (res.status === 401 || res.status === 403) break;
      continue;
    }

    const token = readToken(body);
    if (!token) {
      attempts.push({ base, status: res.status, ok: false,
        detail: `accepted the sign-in but returned no token: ${body.slice(0, 160)}` });
      continue;
    }

    // Which header spelling this server wants, settled by trying one cheap
    // read with each rather than by knowing.
    const header = await workingHeader(base, token);
    attempts.push({ base, status: res.status, ok: true,
      detail: header ? `signed in, token accepted as ${header}`
                     : "signed in, but no token header was accepted" });
    if (!header) continue;

    const session = { base, token, header };
    // Short of the real lifetime on purpose: re-authenticating early is free,
    // and a token expiring mid-import is a confusing failure.
    known = { session, until: Date.now() + 45 * 60_000 };
    return { ok: true, session, cached: false, attempts };
  }

  return { ok: false, attempts };
}

function readToken(body: string): string | null {
  let token = body.replace(/^"|"$/g, "");
  if (body.startsWith("{")) {
    try {
      const j = JSON.parse(body) as Record<string, string>;
      token = j.Token ?? j.token ?? j.ApiToken ?? j.apiToken ?? token;
    } catch { /* keep the raw string */ }
  }
  return token && token.length >= 8 ? token : null;
}

/** One trivial authenticated read per header spelling. Properties is used
 *  because every Rent Manager account has properties. */
async function workingHeader(base: string, token: string): Promise<string | null> {
  for (const header of TOKEN_HEADERS) {
    try {
      const res = await fetch(`${base}/Properties?pagesize=1`, {
        headers: { [header]: token, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return header;
    } catch { /* try the next spelling */ }
  }
  return null;
}

export type RmCall = {
  path: string;
  status: number;
  ok: boolean;
  /** How many records came back, when the answer was a list. */
  count: number | null;
  /** Field names on the first record. This is the map: it is what says
   *  whether their Unit carries the lot number everything here is keyed on,
   *  and what it is called when it does. */
  shape: string[] | null;
  detail: string | null;
};

/** One GET, reported rather than thrown -- the probe makes a dozen of these
 *  and a 404 is an answer, not an exception. */
export async function rmGet(path: string, session: RmSession): Promise<RmCall> {
  try {
    const res = await fetch(`${session.base}${path}`, {
      headers: { [session.header]: session.token, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    if (!res.ok) {
      return { path, status: res.status, ok: false, count: null, shape: null,
               detail: text.slice(0, 220) || res.statusText };
    }
    let data: unknown;
    try { data = JSON.parse(text); } catch {
      return { path, status: res.status, ok: true, count: null, shape: null,
               detail: `answered, but not JSON: ${text.slice(0, 120)}` };
    }
    const list = Array.isArray(data) ? data : null;
    const first = list?.[0] ?? (list ? null : data);
    return {
      path, status: res.status, ok: true,
      count: list ? list.length : null,
      shape: first && typeof first === "object"
        ? Object.keys(first as Record<string, unknown>) : null,
      detail: list && !list.length ? "answered, but this account has none" : null,
    };
  } catch (e) {
    return { path, status: 0, ok: false, count: null, shape: null,
             detail: (e as Error).message };
  }
}

/* ------------------------------------------------------------------ embeds
 *
 * The base records are skeletons. /Leases has no end date on it, /Units has
 * no rent and no bed count, /Tenants has no balance and no phone number --
 * and yet the Rent Manager dashboard shows all of those, so they exist. In
 * rmAPI that detail hangs off an `embeds` parameter, and which embeds a given
 * endpoint accepts is not something that can be looked up from here.
 *
 * So the same approach as finding the hostname: ask, one at a time, and
 * report what each one added. One at a time specifically, because a list with
 * a single bad name in it fails whole and tells you nothing about the good
 * ones.
 */

export type EmbedTry = {
  embed: string;
  ok: boolean;
  status: number;
  /** Field names this embed added that the bare record did not have. */
  added: string[];
  /** For each added field that is itself a record, its own field names. This
   *  is where the rent, the balance and the lease dates will be. */
  within: Record<string, string[]>;
  detail: string | null;
};

/** Keys only, never values. Finding out that a tenant record carries a
 *  Balance is the job; reading somebody's balance is not. */
function keysOf(v: unknown): string[] | null {
  if (Array.isArray(v)) return v.length ? keysOf(v[0]) : [];
  if (v && typeof v === "object") return Object.keys(v as Record<string, unknown>);
  return null;
}

async function firstRecord(
  path: string, session: RmSession,
): Promise<{ status: number; record: Record<string, unknown> | null; detail: string | null }> {
  try {
    const res = await fetch(`${session.base}${path}`, {
      headers: { [session.header]: session.token, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
    const text = await res.text();
    if (!res.ok) return { status: res.status, record: null, detail: text.slice(0, 200) };
    const data = JSON.parse(text) as unknown;
    const first = Array.isArray(data) ? data[0] ?? null : data;
    return {
      status: res.status,
      record: first && typeof first === "object" ? first as Record<string, unknown> : null,
      detail: null,
    };
  } catch (e) {
    return { status: 0, record: null, detail: (e as Error).message };
  }
}

export async function rmEmbedProbe(
  entity: string, candidates: string[], session: RmSession,
): Promise<{ entity: string; base: string[]; tries: EmbedTry[] }> {
  const bare = await firstRecord(`/${entity}?pagesize=1`, session);
  const base = bare.record ? Object.keys(bare.record) : [];
  const tries: EmbedTry[] = [];

  for (const embed of candidates) {
    const got = await firstRecord(
      `/${entity}?pagesize=1&embeds=${encodeURIComponent(embed)}`, session);
    if (!got.record) {
      tries.push({ embed, ok: false, status: got.status, added: [], within: {},
                   detail: got.detail });
      continue;
    }
    const added = Object.keys(got.record).filter((k) => !base.includes(k));
    const within: Record<string, string[]> = {};
    for (const key of added) {
      const sub = keysOf(got.record[key]);
      if (sub) within[key] = sub;
    }
    tries.push({
      embed, ok: true, status: got.status, added, within,
      // An embed that is accepted and adds nothing is an embed that exists
      // but is empty for this record -- worth distinguishing from a refusal.
      detail: added.length ? null : "accepted, but added nothing to this record",
    });
  }

  return { entity, base, tries };
}
