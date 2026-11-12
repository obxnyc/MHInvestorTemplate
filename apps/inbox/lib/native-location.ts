/**
 * Location from the installed Android app, while somebody is on the clock.
 *
 * A web page gets no position once the phone is locked or another app is in
 * front -- no setting changes that. The installed app (apps/mobile) is a thin
 * shell that loads https://app.larabeehomesllc.com/clock, so the JavaScript
 * running inside it is THIS app; what the shell adds is a native plugin,
 * @capacitor-community/background-geolocation, which keeps a foreground
 * service with a notification running and hands fixes to this page even
 * with the screen off.
 *
 * Nothing here imports Capacitor. The native side injects
 * `window.Capacitor.Plugins.<name>` into the page itself, and in an ordinary
 * browser (and on the server) none of it exists, so every entry point asks
 * first and the web bundle carries no native code at all.
 *
 * The plugin hands over a fix about once a second. The trail wants one every
 * two minutes, so the throttle below decides which ones are sent -- and it is
 * pure, so the rule can be tested without a phone.
 */

export type NativeFix = { lat: number; lng: number; accuracy: number | null };

/** The same interval as the clock screen's PING_MS. */
export const PING_EVERY_MS = 2 * 60_000;

/** How long to wait for a first fix or a refusal before handing back the
 *  stop function anyway. Without this a phone indoors that never gets a fix
 *  would leave the caller holding no way to stop the service. */
export const SETTLE_MS = 30_000;

export const BACKGROUND_TITLE = "On the clock";
export const BACKGROUND_MESSAGE = "Larabee is recording your location while you're clocked in.";

/* ------------------------------------------------------------- the plugin */

type PluginLocation = { latitude?: unknown; longitude?: unknown; accuracy?: unknown };
type PluginError = { code?: string; message?: string };
type BgGeo = {
  addWatcher: (
    options: Record<string, unknown>,
    cb: (location?: PluginLocation, error?: PluginError) => void,
  ) => string | Promise<string>;
  removeWatcher: (options: { id: string }) => unknown;
  openSettings?: () => unknown;
};
type HttpPlugin = {
  request: (options: {
    url: string; method: string; headers?: Record<string, string>; data?: unknown;
  }) => Promise<{ status: number }>;
};
type Cap = {
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, unknown>;
};

function cap(): Cap | null {
  if (typeof window === "undefined") return null;
  const c = (window as unknown as { Capacitor?: Cap }).Capacitor;
  return c && typeof c === "object" ? c : null;
}

function plugin<T>(name: string): T | null {
  const p = cap()?.Plugins?.[name];
  return p && typeof p === "object" ? (p as T) : null;
}

/** True only inside the installed app. False in a browser and on the server. */
export function isNativeApp(): boolean {
  try {
    return cap()?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------- the pure rules */

/** The plugin's Location to the shape /api/clock/ping takes. A fix without a
 *  real position is no fix; an accuracy that is missing or nonsense is null,
 *  never zero -- a device that did not say how sure it is has not said it is
 *  certain (lib/fence.ts reads null as "cannot tell"). */
export function toFix(loc: PluginLocation | null | undefined): NativeFix | null {
  if (!loc) return null;
  const lat = loc.latitude, lng = loc.longitude, acc = loc.accuracy;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return {
    lat, lng,
    accuracy: typeof acc === "number" && Number.isFinite(acc) && acc >= 0 ? acc : null,
  };
}

/**
 * Decides which fixes are sent. The first goes at once; after that, one per
 * `everyMs`, measured from the last one SENT (a dropped fix does not restart
 * the wait, or a phone reporting every second would never send again). A
 * clock that jumps backwards sends rather than going quiet for however far it
 * jumped.
 */
export function makeThrottle(everyMs: number = PING_EVERY_MS): (now: number) => boolean {
  let last: number | null = null;
  return (now: number) => {
    if (last === null || now < last || now - last >= everyMs) {
      last = now;
      return true;
    }
    return false;
  };
}

/* ----------------------------------------------------------- the tracking */

export type TrackOptions = {
  /** A refusal that arrives after the start has already been handed back
   *  (somebody took longer than SETTLE_MS over the permission prompt, or
   *  turned location off mid-shift). The watcher is already stopped. */
  onDenied?: () => void;
  now?: () => number;
  settleMs?: number;
  everyMs?: number;
};

/**
 * Starts the plugin's watcher for the length of a shift. Resolves with a stop
 * function once the first fix arrives (or after SETTLE_MS, whichever first).
 * Rejects with Error("location-denied") if location is refused or switched
 * off before then, and Error("not-native") outside the installed app.
 */
export function startShiftTracking(
  send: (fix: NativeFix) => void,
  opts: TrackOptions = {},
): Promise<() => void> {
  const geo = isNativeApp() ? plugin<BgGeo>("BackgroundGeolocation") : null;
  if (!geo) return Promise.reject(new Error("not-native"));

  const now = opts.now ?? Date.now;
  const due = makeThrottle(opts.everyMs ?? PING_EVERY_MS);
  let id: string | null = null;
  let stopped = false;
  let settled = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (id !== null) {
      try { void Promise.resolve(geo.removeWatcher({ id })).catch(() => null); } catch { /* gone already */ }
    }
  };

  return new Promise<() => void>((resolve, reject) => {
    const settle = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (ok) resolve(stop);
      else reject(new Error("location-denied"));
    };
    const timer = setTimeout(() => settle(true), opts.settleMs ?? SETTLE_MS);

    const cb = (location?: PluginLocation, error?: PluginError) => {
      if (stopped) return;
      if (error) {
        if (error.code !== "NOT_AUTHORIZED") return; // a passing failure; the next fix may come
        const before = settled;
        stop();
        if (before) opts.onDenied?.();
        else settle(false);
        return;
      }
      const fix = toFix(location);
      if (!fix) return;
      settle(true);
      if (due(now())) {
        try { send(fix); } catch { /* the sender's own problem; tracking carries on */ }
      }
    };

    let added: string | Promise<string>;
    try {
      added = geo.addWatcher({
        backgroundMessage: BACKGROUND_MESSAGE,
        backgroundTitle: BACKGROUND_TITLE,
        requestPermissions: true,
        stale: false,
        distanceFilter: 0,
      }, cb);
    } catch (e) {
      clearTimeout(timer);
      settled = true;
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    Promise.resolve(added).then((got) => {
      id = String(got);
      // Stopped (or refused) before the id came back: remove it now, or the
      // foreground service outlives the shift.
      if (stopped) {
        try { void Promise.resolve(geo.removeWatcher({ id })).catch(() => null); } catch { /* gone */ }
      }
    }, (e) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  });
}

/**
 * POSTs a fix to /api/clock/ping. Inside the app it goes through Capacitor's
 * native HTTP, because Android throttles requests made by a WebView that has
 * been in the background for a few minutes; the native request carries the
 * same sign-in cookie (Capacitor shares the WebView's cookie store). In a
 * browser it is an ordinary fetch.
 */
export async function postPing(fix: NativeFix): Promise<boolean> {
  const http = isNativeApp() ? plugin<HttpPlugin>("CapacitorHttp") : null;
  try {
    if (http && typeof window !== "undefined") {
      const r = await http.request({
        url: new URL("/api/clock/ping", window.location.href).toString(),
        method: "POST",
        headers: { "content-type": "application/json" },
        data: fix,
      });
      return r.status >= 200 && r.status < 300;
    }
    const r = await fetch("/api/clock/ping", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(fix),
    });
    return r.ok;
  } catch {
    return false;
  }
}
