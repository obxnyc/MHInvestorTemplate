"use client";
import { useState } from "react";

const ROLES: [string, string, string][] = [
  ["office", "Office", "The shared inbox, leasing, tenants, work orders"],
  ["tech", "Maintenance", "Work orders assigned to you, and the threads they came from"],
  ["shower", "Showings", "Prospects and viewings"],
  ["admin", "Admin", "Everything, including court filings and the audit trail"],
];

/**
 * Asking to be let in.
 *
 * Public, and it grants nothing at all: what it produces is an item of work for
 * an admin. Saying so plainly on the page matters -- somebody who thinks they
 * have an account will try to sign in, fail, and ring the office, which is the
 * phone call this is meant to remove.
 */
export default function Join() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("office");
  const [reason, setReason] = useState("");
  const [website, setWebsite] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const res = await fetch("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName, email, phone, role, reason, website }),
    });
    if (!res.ok) {
      setState("error");
      setMessage((await res.json().catch(() => ({}))).error ?? "Something went wrong.");
      return;
    }
    setState("done");
  }

  if (state === "done") {
    return (
      <main className="apply">
        <p className="brand">Larabee Homes</p>
        <h1>Sent</h1>
        <p className="lede">
          An admin has been notified. Once they approve it you&rsquo;ll be able
          to sign in at <strong>/login</strong> — choose &ldquo;Set or reset my
          password&rdquo; and use <strong>{email}</strong>.
        </p>
        <p className="fineprint">
          Nothing is open to you yet. Signing in before it&rsquo;s approved
          won&rsquo;t work, and that&rsquo;s not a fault.
        </p>
      </main>
    );
  }

  return (
    <main className="apply">
      <p className="brand">Larabee Homes</p>
      <h1>Ask for access</h1>
      <p className="lede">
        For people working at Larabee Homes. Fill this in and an admin decides
        what you get — this form gives you nothing on its own.
      </p>

      <form onSubmit={submit}>
        <fieldset>
          <legend>You</legend>

          <label htmlFor="n">Your name</label>
          <input id="n" value={fullName} onChange={(e) => setFullName(e.target.value)} required />

          <label htmlFor="e">Work email</label>
          <input id="e" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                 placeholder="you@larabeehomesllc.com" required />
          <p className="hint">This is what you&rsquo;ll sign in with.</p>

          <label htmlFor="p">Cell <span className="hint">optional</span></label>
          <input id="p" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                 placeholder="(252) 555-0142" />
          <p className="hint">Rings when a call comes in to the shared line.</p>

          <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true"
                 value={website} onChange={(e) => setWebsite(e.target.value)} />
        </fieldset>

        <fieldset>
          <legend>What you need</legend>
          {ROLES.map(([v, label, what]) => (
            <label key={v} className="check">
              <input type="radio" name="role" value={v} checked={role === v}
                     onChange={() => setRole(v)} />
              <span>{label}<small>{what}</small></span>
            </label>
          ))}

          <label htmlFor="r">Anything the office should know</label>
          <input id="r" value={reason} onChange={(e) => setReason(e.target.value)}
                 placeholder="Who you report to, what you'll be doing" />
        </fieldset>

        {state === "error" && <p className="error">{message}</p>}
        <button type="submit" disabled={state === "sending"}>
          {state === "sending" ? "Sending…" : "Ask for access"}
        </button>
      </form>
    </main>
  );
}
