"use client";
import { useState } from "react";

type Call = {
  path: string; status: number; ok: boolean;
  count: number | null; shape: string[] | null; detail: string | null;
};
type Attempt = { base: string; status: number; ok: boolean; detail: string };
type EmbedTry = {
  embed: string; ok: boolean; status: number;
  added: string[]; within: Record<string, string[]>; detail: string | null;
};
type Found = { entity: string; base: string[]; tries: EmbedTry[] };
type Tally = { seen: number; written: number };
type Row = {
  code: string; name: string; kind: string; units: number;
  unitNames: string[]; vacant: number;
  owner: string | null; address: string | null; existing: boolean;
  groups: string[]; flags: string[];
};
/** What a pull of the maintenance requests came back with. */
type Issues = {
  ok: boolean;
  dryRun: boolean;
  found: number;
  more: boolean;
  filed: number;
  alreadyHad: number;
  failed: number;
  samples: {
    id: string; title: string | null; description: string | null;
    tenant: string | null; unit: string | null; property: string | null;
    status: string | null;
  }[];
  error: string | null;
};

/** What a repair of the requests already filed came back with. */
type Repair = {
  ok: boolean;
  dryRun: boolean;
  /** Threads from Rent Manager that cannot say who or where. The size of
   *  the problem, whether or not this run got through them. */
  unidentified: number;
  looked: number;
  found: number;
  mended: number;
  placed: number;
  merged: number;
  failed: number;
  more: boolean;
  /** Why it stopped where it did. "nothing-coming-back" means Rent
   *  Manager is answering and telling us nothing, which no amount of
   *  pressing the button again will change. */
  stopped: "time" | "nothing-coming-back" | null;
  /** Every path tried for the first web-user lookup. This is the whole
   *  point of the preview: whether Rent Manager will turn a web user id
   *  into a person is not knowable from here, and a run that mends
   *  nothing has to say which names it asked for. */
  whoTried?: { path: string; status: number; ok: boolean; detail: string | null }[];
  whoShape?: string[] | null;
  samples: {
    conversationId: string; issueId: string;
    missing: ("who" | "reach" | "where")[];
    from: "issue" | "webuser" | null;
    mend: { name?: string; phone?: string; email?: string; placeHint?: string };
    placed: boolean; mergedInto: string | null; note: string | null;
  }[];
  error: string | null;
};

/** What a pull of the tenant roster came back with. */
type Tenants = {
  ok: boolean; dryRun: boolean;
  tenants: number; leases: number; placed: number;
  added: number; updated: number; merged: number; failed: number;
  more: boolean;
  usingTenants: string | null; usingLeases: string | null;
  readAs: Record<string, string>;
  tenantShape: string[] | null; leaseShape: string[] | null;
  samples: { rmTenantId: number; name: string | null; phone: string | null;
             email: string | null; status: string | null;
             rmUnitId: number | null }[];
  error: string | null;
};

type Undone = {
  ok: boolean; dryRun: boolean; error?: string;
  units: { removed: number };
  properties: { removed: number; unlinked: number };
  parks: { removed: number };
  kept: string[];
};
type Import = {
  ok: boolean; dryRun: boolean; error?: string;
  owners: Tally; properties: Tally; units: Tally; notes: string[];
  preview?: Row[];
};
type Result = {
  configured: boolean; company?: string; signedIn?: boolean;
  base?: string; header?: string; hint?: string;
  attempts?: Attempt[]; open?: number; tried?: number; calls?: Call[];
};

/**
 * The button that finds out.
 *
 * Everything it learns comes from the deployment talking to Rent Manager.
 * Nothing in the browser knows a password and nothing it prints contains
 * one -- the hostname and the field names are all that come back.
 */
export default function RentManagerProbe() {
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<Result | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deep, setDeep] = useState<{ found?: Found[]; hint?: string } | null>(null);
  const [digging, setDigging] = useState(false);
  const [pulled, setPulled] = useState<Import | null>(null);
  const [pulling, setPulling] = useState<"" | "dry" | "real">("");
  const [undone, setUndone] = useState<Undone | null>(null);
  const [undoing, setUndoing] = useState<"" | "dry" | "real">("");
  const [issues, setIssues] = useState<Issues | null>(null);
  const [getting, setGetting] = useState<"" | "dry" | "real">("");
  const [repair, setRepair] = useState<Repair | null>(null);
  const [roster, setRoster] = useState<Tenants | null>(null);
  const [rostering, setRostering] = useState<"" | "dry" | "real">("");
  const [mending, setMending] = useState<"" | "dry" | "real">("");

  async function run() {
    setBusy(true); setFailed(null); setOut(null); setCopied(false);
    try {
      const res = await fetch("/api/rentmanager/probe", { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setFailed(data.error ?? "That didn't run."); return; }
      setOut(data as Result);
    } catch (e) {
      setFailed((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Where the rent, the balances and the lease dates actually live. */
  async function dig() {
    setDigging(true); setDeep(null);
    try {
      const res = await fetch("/api/rentmanager/probe/deep", { method: "POST" });
      setDeep(await res.json());
    } catch (e) {
      setFailed((e as Error).message);
    } finally {
      setDigging(false);
    }
  }

  /** The rehearsal, then the thing itself. Nothing writes without `go`. */
  async function pull(go: boolean) {
    setPulling(go ? "real" : "dry"); setPulled(null); setFailed(null);
    try {
      const res = await fetch("/api/rentmanager/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ go }),
      });
      setPulled(await res.json());
    } catch (e) {
      setFailed((e as Error).message);
    } finally {
      setPulling("");
    }
  }

  /**
   * The maintenance requests tenants have already submitted.
   *
   * Separate from the portfolio import because it is a different cadence:
   * the portfolio comes across once, and this wants running whenever
   * somebody wants to know what has come in. Safe to run as often as you
   * like -- an issue already filed is recognised and skipped.
   */
  async function getIssues(go: boolean) {
    setGetting(go ? "real" : "dry"); setIssues(null); setFailed(null);
    try {
      const res = await fetch("/api/rentmanager/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ go }),
      });
      // Read it, then try to parse it. `res.json()` on a reply that is
      // not JSON throws "Unexpected end of JSON input", which names the
      // parser and not the problem -- and the problem here was a
      // function killed at the plan's sixty-second ceiling, which is a
      // thing somebody can act on only if they are told it.
      const body = await res.text();
      try {
        setIssues(JSON.parse(body));
      } catch {
        setFailed(
          res.status === 504 || res.status === 502 || !body.trim()
            ? `Rent Manager took too long and the request was cut off after`
              + ` ${res.status || "no"} — press it again and it will carry on`
              + " from where it stopped."
            : `The server answered ${res.status} with something that is not`
              + ` JSON: ${body.slice(0, 160)}`);
      }
    } catch (e) {
      setFailed((e as Error).message);
    } finally {
      setGetting("");
    }
  }

  /**
   * Going back for the ones that arrived naming nobody.
   *
   * Not the same button as the pull and it cannot be. `ingest` returns
   * the moment it recognises a request it has already filed -- which is
   * what makes the pull safe to press twice, and what makes it walk
   * straight past every request that is already in and anonymous.
   */
  async function mend(go: boolean) {
    setMending(go ? "real" : "dry"); setRepair(null); setFailed(null);
    try {
      const res = await fetch("/api/rentmanager/repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ go }),
      });
      // Read, then parse. A function killed at the plan's sixty-second
      // ceiling does not return JSON at all, and `res.json()` reports
      // that as the parser's fault.
      const body = await res.text();
      try {
        setRepair(JSON.parse(body));
      } catch {
        setFailed(
          res.status === 504 || res.status === 502 || !body.trim()
            ? `Rent Manager took too long and the request was cut off after`
              + ` ${res.status || "no"} — press it again and it will carry on`
              + " from where it stopped."
            : `The server answered ${res.status} with something that is not`
              + ` JSON: ${body.slice(0, 160)}`);
      }
    } catch (e) {
      setFailed((e as Error).message);
    } finally { setMending(""); }
  }

  /** Who lives in each unit, from the lease. */
  async function pullRoster(go: boolean) {
    setRostering(go ? "real" : "dry"); setRoster(null); setFailed(null);
    try {
      const res = await fetch("/api/rentmanager/tenants", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ go }),
      });
      const body = await res.text();
      try { setRoster(JSON.parse(body)); } catch {
        setFailed(res.status === 504 || res.status === 502 || !body.trim()
          ? `Rent Manager took too long and the request was cut off after`
            + ` ${res.status || "no"} — press it again and it carries on.`
          : `The server answered ${res.status} with something that is not`
            + ` JSON: ${body.slice(0, 160)}`);
      }
    } catch (e) {
      setFailed((e as Error).message);
    } finally { setRostering(""); }
  }

  /** Taking it back out, with the same rehearse-then-commit rule. */
  async function undo(go: boolean) {
    setUndoing(go ? "real" : "dry"); setUndone(null); setFailed(null);
    try {
      const res = await fetch("/api/rentmanager/undo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ go }),
      });
      setUndone(await res.json());
    } catch (e) {
      setFailed((e as Error).message);
    } finally { setUndoing(""); }
  }

  /** So the result can be pasted as text rather than photographed. A
   *  screenshot of forty field names is a screenshot nobody can read. */
  async function copy() {
    if (!out && !deep) return;
    await navigator.clipboard.writeText(JSON.stringify(deep ?? out, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <div className="acts" style={{ justifyContent: "flex-start" }}>
        <button className="btn pri" disabled={busy} onClick={run}>
          {busy ? "Asking Rent Manager…" : "Test the connection"}
        </button>
        {out?.signedIn && (
          <button className="btn" disabled={digging} onClick={dig}>
            {digging ? "Digging…" : "Find the detail"}
          </button>
        )}
        {(out || deep) && (
          <button className="btn" onClick={copy}>
            {copied ? "Copied" : "Copy the result"}
          </button>
        )}
      </div>
      {busy && (
        <p className="hint">
          Trying each address in turn. Up to a minute if some of them do not
          answer at all.
        </p>
      )}

      {failed && <p className="err">{failed}</p>}

      {out && !out.configured && <p className="notice">{out.hint}</p>}

      {out?.configured && out.signedIn === false && (
        <div className="rmresult">
          <p className="err">Could not sign in to Rent Manager as &ldquo;{out.company}&rdquo;.</p>
          <ul className="rmlist">
            {(out.attempts ?? []).map((a) => (
              <li key={a.base} className="no">
                <span className="rmpath">{a.base}</span>
                <span className="rmstatus">{a.status ? `HTTP ${a.status}` : "no answer"}</span>
                <span className="rmwhy">{a.detail}</span>
              </li>
            ))}
          </ul>
          <p className="hint">{out.hint}</p>
        </div>
      )}

      {out?.signedIn && (
        <div className="rmresult">
          <p className="okmsg">
            Signed in at {out.base} — token accepted as {out.header}.{" "}
            {out.open} of {out.tried} endpoints answered.
          </p>
          <ul className="rmlist">
            {(out.calls ?? []).map((c) => (
              <li key={c.path} className={c.ok ? "ok" : "no"}>
                <span className="rmpath">{c.path.split("?")[0]}</span>
                <span className="rmstatus">
                  {c.ok ? (c.count === null ? "answered" : `${c.count} record`)
                        : `HTTP ${c.status || "—"}`}
                </span>
                {c.shape && (
                  <details className="rmshape">
                    <summary>{c.shape.length} fields</summary>
                    <p>{c.shape.join(", ")}</p>
                  </details>
                )}
                {c.detail && <span className="rmwhy">{c.detail}</span>}
              </li>
            ))}
          </ul>
          <p className="whosnote">
            One record per endpoint, and only the field names left Rent
            Manager. No resident data was fetched.
          </p>
        </div>
      )}

      {digging && (
        <p className="hint">
          Around sixty requests, one at a time. Two or three minutes.
        </p>
      )}

      {/* The thing a tenant actually did. Above the portfolio import
          because it is the one somebody opens this page to do: the
          requests exist, in Rent Manager, and nothing here has them. */}
      <div className="rmpull">
        <h3>Maintenance requests from Tenant Web Access</h3>
        <div className="acts" style={{ justifyContent: "flex-start" }}>
          <button className="btn" disabled={getting !== ""}
                  onClick={() => void getIssues(false)}>
            {getting === "dry" ? "Looking…" : "See what's there — changes nothing"}
          </button>
          {issues?.dryRun && issues.ok && issues.found > 0 && (
            <button className="btn pri" disabled={getting !== ""}
                    onClick={() => void getIssues(true)}>
              {getting === "real" ? "Bringing them in…" : `Bring in all ${issues.found}`}
            </button>
          )}
        </div>
        <p className="hint">
          When a tenant submits a request in Tenant Web Access, Rent Manager
          records it and emails a notification. This asks Rent Manager
          directly instead of waiting for that email, so a request cannot go
          missing between a mail filter and a webhook. Everything already
          submitted comes across the first time, and running it again brings
          only what is new.
        </p>

        {issues && !issues.ok && (
          <p className="err">{issues.error ?? "Rent Manager would not answer."}</p>
        )}
        {issues?.ok && issues.found === 0 && (
          <p className="hint">
            Rent Manager answered, and has no service issues on this account at
            all. If tenants have been submitting them, they are going somewhere
            else — check that Tenant Web Access is pointed at this company.
          </p>
        )}
        {issues?.ok && issues.found > 0 && (
          <>
            <p className="hint">
              <strong>{issues.found} found{issues.more ? " so far" : ""}.</strong>{" "}
              {issues.dryRun
                ? "Nothing written yet."
                : `${issues.filed} brought in, ${issues.alreadyHad} already here`
                  + `${issues.failed ? `, ${issues.failed} could not be` : ""}.`}
              {issues.more && (
                <>
                  {" "}Rent Manager has more than one run can fetch inside the
                  time a request is allowed — press the button again and it
                  carries on. Nothing is fetched twice.
                </>
              )}
            </p>
            <ul className="rmlist">
              {issues.samples.map((i) => (
                <li key={i.id}>
                  <strong>{[i.property, i.unit && `Lot ${i.unit}`]
                    .filter(Boolean).join(" ") || "Somewhere"}</strong>
                  {" — "}{i.title || i.description || "no description"}
                  {i.tenant && <span className="dim"> · {i.tenant}</span>}
                  {i.status && <span className="dim"> · {i.status}</span>}
                </li>
              ))}
            </ul>
            {issues.found > issues.samples.length && (
              <p className="hint">
                …and {issues.found - issues.samples.length} more.
              </p>
            )}
          </>
        )}
      </div>

      {/* WHO LIVES IN THE UNIT.
          One unit out of 417 knew. /Tenants and /Leases both answer on
          this account and nothing had ever fetched either. */}
      <div className="rmpull">
        <h3>Who lives in each unit</h3>
        <div className="acts" style={{ justifyContent: "flex-start" }}>
          <button className="btn" disabled={rostering !== ""}
                  onClick={() => void pullRoster(false)}>
            {rostering === "dry" ? "Looking…" : "Show me — changes nothing"}
          </button>
          {roster?.dryRun && roster.ok && roster.tenants > 0 && (
            <button className="btn pri" disabled={rostering !== ""}
                    onClick={() => void pullRoster(true)}>
              {rostering === "real" ? "Bringing them in…"
                                    : `Bring in all ${roster.tenants}`}
            </button>
          )}
        </div>
        <p className="hint">
          The portfolio brought your properties, units and owners across and
          stopped there, so the app knows every address and not one of the
          people in them. That is why a maintenance request makes you type
          the tenant&rsquo;s name from memory. The lease is what joins a
          person to a unit — with it, picking the property fills the person
          in. Safe to run again: it updates the people it already has.
        </p>

        {roster && !roster.ok && (
          <p className="err">{roster.error ?? "Rent Manager would not answer."}</p>
        )}
        {roster?.ok && roster.tenants === 0 && (
          <p className="hint">
            Rent Manager answered and returned no tenants at all. If that is
            wrong, the endpoint it asked is below.
          </p>
        )}
        {roster?.ok && roster.tenants > 0 && (
          <>
            <p className="hint">
              <strong>{roster.tenants} tenants and {roster.leases} leases.</strong>{" "}
              {roster.placed} of them can be put in one of your units.
              {" "}
              {roster.dryRun
                ? "Nothing written yet."
                : `${roster.added} added, ${roster.updated} already here and`
                  + ` updated`
                  + `${roster.merged ? `, ${roster.merged} joined to somebody `
                      + "you already had" : ""}`
                  + `${roster.failed ? `, ${roster.failed} could not be` : ""}.`}
              {roster.more && " That is as many as fit in one go — press again."}
            </p>
            {roster.placed < roster.tenants && (
              <p className="hint">
                {roster.tenants - roster.placed} have no lease pointing at a
                unit we hold, so they come in as people without an address.
                That is a lease in Rent Manager with no unit on it, or a unit
                that has not been imported.
              </p>
            )}
            <ul className="rmlist">
              {roster.samples.map((t) => (
                <li key={t.rmTenantId}>
                  <strong>{t.name ?? `Tenant ${t.rmTenantId}`}</strong>
                  {t.phone && <> · {t.phone}</>}
                  {t.email && <span className="dim"> · {t.email}</span>}
                  {t.status && <span className="dim"> · {t.status}</span>}
                  {t.rmUnitId === null && (
                    <span className="dim"> · no unit on the lease</span>
                  )}
                </li>
              ))}
            </ul>
            <details className="rmwhy">
              <summary>What it asked for, and which field answered</summary>
              <p className="hint">
                Tenants from <strong>{roster.usingTenants ?? "nothing"}</strong>,
                leases from <strong>{roster.usingLeases ?? "nothing"}</strong>.
                The field names on this account are a guess until a run says
                otherwise, so here is what answered for each thing:
              </p>
              <ul className="rmlist">
                {Object.entries(roster.readAs).map(([want, got]) => (
                  <li key={want}><strong>{want}</strong> — {got}</li>
                ))}
              </ul>
              {roster.tenantShape?.length ? (
                <p className="hint">
                  A tenant record here carries:{" "}
                  <strong>{roster.tenantShape.join(", ")}</strong>
                </p>
              ) : null}
            </details>
          </>
        )}
      </div>

      {/* The requests that are already in and name nobody.
          Its own block, below the pull, because the pull cannot do this
          and pressing it harder will never start. */}
      <div className="rmpull">
        <h3>Requests that do not say who sent them</h3>
        <p className="hint">
          This happens on its own — a few every time anybody opens the
          inbox, until there are none left. Nothing here needs pressing.
          The buttons are for when you want to watch it work or find out
          why it is not.
        </p>
        <div className="acts" style={{ justifyContent: "flex-start" }}>
          <button className="btn" disabled={mending !== ""}
                  onClick={() => void mend(false)}>
            {mending === "dry" ? "Looking…" : "Show me — changes nothing"}
          </button>
          {repair?.dryRun && repair.ok && repair.found > 0 && (
            <button className="btn pri" disabled={mending !== ""}
                    onClick={() => void mend(true)}>
              {mending === "real"
                ? "Filling them in…"
                : `Fill in ${repair.found} now`}
            </button>
          )}
        </div>
        <p className="hint">
          When Rent Manager hands over a maintenance request it does not
          include the tenant, their number or the lot — only an id for the
          account that submitted it. Fetching the same request again will
          not help: it is recognised and skipped. So this goes the other
          way, and asks Rent Manager who was behind each id. It only ever
          fills a blank, and never changes anything already there.
        </p>

        {repair && !repair.ok && (
          <p className="err">{repair.error ?? "Rent Manager would not answer."}</p>
        )}
        {repair?.ok && repair.unidentified === 0 && (
          <p className="hint">
            Every request from Rent Manager has a name or a lot on it. Nothing
            to mend.
          </p>
        )}
        {repair?.ok && repair.unidentified > 0 && (
          <>
            <p className="hint">
              <strong>{repair.unidentified} requests do not say who sent them
              or which lot they are for.</strong>{" "}
              {repair.dryRun
                ? `Checked ${repair.looked} of them, and ${repair.found} can be`
                  + " filled in. Nothing changed yet."
                : `${repair.mended} filled in`
                  + `${repair.placed ? `, ${repair.placed} matched to a lot` : ""}`
                  + `${repair.merged ? `, ${repair.merged} joined to someone `
                      + "already in your contacts" : ""}`
                  + `${repair.failed ? `, ${repair.failed} could not be` : ""}.`}
              {repair.more && repair.stopped !== "nothing-coming-back" && (
                <>
                  {" "}That is as many as fit in one go. The rest carry on by
                  themselves as the inbox is used, or press the button again.
                </>
              )}
            </p>

            {/* THE ANSWER TO "WHY DID IT MEND NOTHING".
                Which endpoint turns a web user id into a person is a guess:
                this account is on Rent Manager Express and the docs are not
                reachable from where this was written. So a run that finds
                nobody prints every name it asked for and what came back,
                which is a thing somebody can correct in one round. */}
            {repair.found === 0 && repair.looked > 0 && (
              <>
                <p className="hint">
                  Rent Manager is answering, but it will not tell us who the
                  tenant is. That is a setting on the Rent Manager side, not
                  something that can be fixed from here — so nothing will
                  come of pressing this again until it changes.
                </p>
                {/* The engineering detail is the answer to "why", and it is
                    also forty lines of endpoint paths. Folded away: the
                    sentence above is what the owner needs, and this is what
                    somebody needs to act on it. */}
                <details className="rmwhy">
                  <summary>What it asked Rent Manager for</summary>
                  <p className="hint">
                    Which address turns a Tenant Web Access login into a
                    person is a guess — this account is on Rent Manager
                    Express and the documentation is not public. Every one
                    of these was tried:
                  </p>
                  <ul className="rmlist">
                    {(repair.whoTried ?? []).map((a) => (
                      <li key={a.path}>
                        <strong>{a.path}</strong>
                        {" — "}{a.status || "no reply"}
                        {a.detail && <span className="dim"> · {a.detail}</span>}
                      </li>
                    ))}
                  </ul>
                  {repair.whoShape?.length ? (
                    <p className="hint">
                      One answered, with a record containing{" "}
                      <strong>{repair.whoShape.join(", ")}</strong>. If the
                      tenant&rsquo;s name is in there under a spelling we do
                      not try, that is the fix — send this list on.
                    </p>
                  ) : null}
                </details>
              </>
            )}

            {repair.samples.length > 0 && (
              <ul className="rmlist">
                {repair.samples.map((s) => (
                  <li key={s.conversationId}>
                    <strong>Issue {s.issueId}</strong>
                    {s.mend.name && <> — {s.mend.name}</>}
                    {s.mend.placeHint && <> · {s.mend.placeHint}</>}
                    {s.mend.phone && <> · {s.mend.phone}</>}
                    {s.placed && <span className="dim"> · matched to a lot</span>}
                    {s.mergedInto && (
                      <span className="dim">
                        {" "}· joined to someone already in your contacts
                      </span>
                    )}
                    {s.from && <span className="dim"> · from {
                      s.from === "issue"
                        ? "the request itself"
                        : "their Tenant Web Access login"}</span>}
                    {s.note && <span className="dim"> · {s.note}</span>}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {/* Always here, not only after somebody has just pressed the test.
          Gating it on that meant the whole import disappeared the moment the
          page was reloaded -- which is exactly what reloading to set the
          groups does. The import authenticates for itself; it never needed
          the button to have been pressed first. */}
      {(
        <div className="rmpull">
          <h3>Bring the portfolio across</h3>
          <div className="acts" style={{ justifyContent: "flex-start" }}>
            <button className="btn" disabled={pulling !== ""}
                    onClick={() => pull(false)}>
              {pulling === "dry" ? "Checking…" : "Preview — changes nothing"}
            </button>
            {pulled?.dryRun && pulled.ok && (
              <button className="btn pri" disabled={pulling !== ""}
                      onClick={() => pull(true)}>
                {pulling === "real" ? "Importing…" : "Import it for real"}
              </button>
            )}
          </div>
          <p className="hint">
            The preview reads everything from Rent Manager, works out what it
            would create here, and shows you — without writing anything. Click
            it as often as you like. Nothing is ever sent back to Rent Manager
            either way.
          </p>

          {pulled && !pulled.ok && <p className="err">{pulled.error}</p>}

          {/* Offered only once a real import has happened, because there is
              nothing to take out before then. */}
          {pulled?.ok && !pulled.dryRun && (
            <details className="rmundo">
              <summary>Take it back out</summary>
              <p className="hint">
                Removes what an import created and nothing else. Anything with
                a conversation or a job filed against it is kept and simply
                unlinked, and properties you typed in by hand are never
                touched. Owner LLCs stay — a company is a fact about the
                business, not a row an import invented.
              </p>
              <div className="acts" style={{ justifyContent: "flex-start" }}>
                <button className="btn" disabled={undoing !== ""}
                        onClick={() => undo(false)}>
                  {undoing === "dry" ? "Checking…" : "Preview the undo"}
                </button>
                {undone?.ok && undone.dryRun && (
                  <button className="btn danger" disabled={undoing !== ""}
                          onClick={() => undo(true)}>
                    {undoing === "real" ? "Removing…" : "Remove it"}
                  </button>
                )}
              </div>

              {undone?.ok && (
                <>
                  <p className={undone.dryRun ? "notice" : "okmsg"}>
                    {undone.dryRun ? "Preview only — nothing removed. " : "Removed. "}
                    {undone.units.removed} unit{undone.units.removed === 1 ? "" : "s"},{" "}
                    {undone.properties.removed} propert
                    {undone.properties.removed === 1 ? "y" : "ies"},{" "}
                    {undone.parks.removed} park{undone.parks.removed === 1 ? "" : "s"}
                    {undone.properties.unlinked
                      ? `, and ${undone.properties.unlinked} kept but unlinked`
                      : ""}.
                  </p>
                  {undone.kept.length > 0 && (
                    <>
                      <p className="hint">
                        Kept because something is filed against {undone.kept.length === 1
                          ? "it" : "them"}:
                      </p>
                      <ul className="rmnotes">
                        {undone.kept.map((k, i) => <li key={i}>{k}</li>)}
                      </ul>
                    </>
                  )}
                </>
              )}
              {undone && !undone.ok && <p className="err">{undone.error}</p>}
            </details>
          )}

          {pulled?.ok && (
            <>
              <p className={pulled.dryRun ? "notice" : "okmsg"}>
                {pulled.dryRun ? "Preview only — nothing was written. " : "Imported. "}
                {pulled.properties.seen} properties ({pulled.properties.written}{" "}
                {pulled.dryRun ? "would be added" : "added"}),{" "}
                {pulled.units.seen} units ({pulled.units.written}{" "}
                {pulled.dryRun ? "would be added" : "added"}),{" "}
                {pulled.owners.seen} owners ({pulled.owners.written}{" "}
                {pulled.dryRun ? "would be added" : "added"}).
              </p>
              {pulled.preview && <Rehearsal rows={pulled.preview} />}

              {pulled.notes.length > 0 && (
                <>
                  <p className="hint">
                    {pulled.notes.length} thing{pulled.notes.length === 1 ? "" : "s"}{" "}
                    that did not fit. These are jobs in Rent Manager, not errors here:
                  </p>
                  <ul className="rmnotes">
                    {pulled.notes.map((n, i) => <li key={i}>{n}</li>)}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
      )}

      {deep?.found && (
        <div className="rmresult">
          <p className="okmsg">
            {deep.found.reduce((n, f) => n + f.tries.filter((t) => t.ok && t.added.length).length, 0)}
            {" "}useful embeds found.
          </p>
          {deep.found.map((f) => (
            <div key={f.entity} className="rmentity">
              <h3>{f.entity}</h3>
              <ul className="rmlist">
                {f.tries.map((t) => (
                  <li key={t.embed} className={t.ok && t.added.length ? "ok" : "no"}>
                    <span className="rmpath">{t.embed}</span>
                    <span className="rmstatus">
                      {t.ok ? (t.added.length ? `+${t.added.length}` : "empty")
                            : `HTTP ${t.status || "—"}`}
                    </span>
                    {t.added.length > 0 && (
                      <details className="rmshape">
                        <summary>{t.added.join(", ")}</summary>
                        {Object.entries(t.within).map(([k, keys]) => (
                          <p key={k}><strong>{k}</strong>: {keys.join(", ") || "—"}</p>
                        ))}
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </>
  );
}


/**
 * What the import would actually make, listed.
 *
 * A total is not a check. "259 properties" reads identically whether the
 * mapping is right or has flattened every park into two hundred separate
 * addresses -- and the only way to tell is to look at the rows and see
 * whether you recognise your own portfolio in them.
 *
 * So: the counts that would give it away first, then every row.
 */
function Rehearsal({ rows }: { rows: Row[] }) {
  const [all, setAll] = useState(false);

  const byKind = new Map<string, number>();
  for (const r of rows) byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1);

  const noUnits = rows.filter((r) => r.units === 0);

  // One row can have several things wrong with it, and each wants a
  // different fix, so it appears under each.
  const byFlag = new Map<string, Row[]>();
  for (const r of rows) {
    for (const f of r.flags ?? []) {
      (byFlag.get(f) ?? byFlag.set(f, []).get(f)!).push(r);
    }
  }
  const noAddress = rows.filter((r) => !r.address);
  const noOwner = rows.filter((r) => !r.owner);
  const multi = rows.filter((r) => r.units > 1);
  const shown = all ? rows : rows.slice(0, 25);

  const orphanLots = rows.filter((r) =>
    (r.flags ?? []).some((f) => f.startsWith("looks like a lot"))).length;

  const groupCount = new Map<string, number>();
  for (const r of rows) {
    for (const g of r.groups ?? []) groupCount.set(g, (groupCount.get(g) ?? 0) + 1);
  }
  const groupNames = [...groupCount.entries()].sort((a, b) => b[1] - a[1]);

  const ownerCount = new Map<string, number>();
  for (const r of rows) {
    if (r.owner) ownerCount.set(r.owner, (ownerCount.get(r.owner) ?? 0) + 1);
  }
  const owners = [...ownerCount.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="rehearsal">
      <ul className="rehstats">
        <li><b>{rows.length}</b> properties</li>
        <li><b>{multi.length}</b> with more than one unit</li>
        <li className={noUnits.length ? "warn" : ""}>
          <b>{noUnits.length}</b> with no units at all
        </li>
        <li className={orphanLots ? "warn" : ""}>
          <b>{orphanLots}</b> lots outside any park
        </li>
        <li className={noAddress.length ? "warn" : ""}>
          <b>{noAddress.length}</b> with no address
        </li>
        <li className={noOwner.length ? "warn" : ""}>
          <b>{noOwner.length}</b> with no owner LLC
        </li>
      </ul>
      <p className="hint">
        Guessed as: {[...byKind.entries()].map(([k, n]) => `${n} ${k}`).join(", ")}.
        {" "}If a park you own is not in that list as <code>mhp</code>, the shape
        did not come across and this should not be run for real yet.
      </p>

      {/* Grouped by what is actually wrong with them rather than by a
          symptom. "Twenty-four with no units" was one list holding three
          different problems, each with a different fix. */}
      {[...byFlag.entries()].map(([flag, list]) => (
        <details key={flag} className="rehodd" open>
          <summary>{list.length} {flag}</summary>
          <p className="mono">{list.map((r) => r.name).join(" · ")}</p>
        </details>
      ))}
      {multi.length > 0 && (
        <details className="rehodd" open>
          <summary>{multi.length} with more than one unit</summary>
          <ul className="rehmulti">
            {multi.map((r) => (
              <li key={r.code}>
                <b>{r.name}</b> — {r.units} units
                <span className="unames">{r.unitNames.join(", ")}…</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {/* Who owns what, by count. An owner with forty properties is one of
          your own LLCs; an owner with one is somebody whose house you manage.
          The shape of this list separates the portfolio from the management
          book without anybody having to label them. */}
      {owners.length > 0 && (
        <details className="rehodd" open>
          <summary>{owners.length} owners — yours and the ones you manage for</summary>
          <ul className="rehmulti">
            {owners.slice(0, 15).map(([name, n]) => (
              <li key={name}><b>{name}</b> — {n} propert{n === 1 ? "y" : "ies"}</li>
            ))}
            {owners.length > 15 && (
              <li className="pinmuted">
                …and {owners.length - 15} more, all with{" "}
                {owners[15]?.[1] ?? 1} or fewer
              </li>
            )}
          </ul>
        </details>
      )}

      {groupNames.length > 0 && (
        <details className="rehodd" open>
          <summary>
            {groupNames.length} group{groupNames.length === 1 ? "" : "s"} across these
            rows — a park counts once however many lots it holds
          </summary>
          <p className="mono">
            {groupNames.map(([g, n]) => `${g} (${n})`).join(" · ")}
          </p>
        </details>
      )}

      <table className="rehtable">
        <thead>
          <tr><th>Code</th><th>Name</th><th>Type</th><th>Units</th>
              <th>Group</th><th>Owner</th><th>Address</th></tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.code} className={r.units === 0 ? "warn" : ""}>
              <td className="mono">{r.code}</td>
              <td>{r.name}{r.existing && <span className="already">already here</span>}</td>
              <td className="mono">{r.kind}</td>
              <td>
                {r.units}
                {r.unitNames.length > 0 && (
                  <span className="unames">{r.unitNames.join(", ")}</span>
                )}
              </td>
              <td className="mono">{(r.groups ?? []).join(", ") || "—"}</td>
              <td>{r.owner ?? "—"}</td>
              <td>{r.address ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 25 && (
        <button type="button" className="btn" onClick={() => setAll((v) => !v)}>
          {all ? "Show the first 25" : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}
