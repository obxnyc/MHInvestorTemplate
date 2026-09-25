"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Directory from "./Directory";
import AccessRequests from "./AccessRequests";

type Staff = {
  id: string; full_name: string; role: string;
  forward_to: string | null; active: boolean;
};
type Vendor = { id: string; full_name: string; phone: string };

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin", office: "Office", tech: "Maintenance", shower: "Showings",
};

/**
 * Who is on the line.
 *
 * Three tabs because there are three genuinely different relationships, not
 * three flavours of user. Office staff sign in with a link or a password and
 * can see everything their role allows. Field staff sign in with a four-digit
 * PIN because they are standing in a yard. Trades do not sign in at all -- they
 * get a link to their own jobs when work is sent to them, and asking a plumber
 * to keep a password is how the completion photo stops arriving.
 *
 * Nobody signs themselves up. This is a list of every tenant's phone number and
 * every applicant's credit score; an open registration page on it would be a
 * breach with a form in front of it.
 */
export default function PeopleAdmin(
  { tab, isAdmin, office, field, vendors, requests }:
  { tab: string; isAdmin: boolean; office: Staff[]; field: Staff[];
    vendors: Vendor[]; requests: number },
) {
  const router = useRouter();
  const [, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [role, setRole] = useState("office");
  const [email, setEmail] = useState("");
  const [cell, setCell] = useState("");

  const refresh = () => start(() => router.refresh());

  async function post(url: string, body: unknown, method = "POST") {
    setBusy(true); setError(null); setDone(null);
    const res = await fetch(url, {
      method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(out.error ?? "That didn't work."); return false; }
    return true;
  }

  const [invitePhone, setInvitePhone] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState("office");
  const [invites, setInvites] = useState<{ id: string; name: string | null; phone: string; role: string }[]>([]);

  useEffect(() => {
    if (!isAdmin) return;
    fetch("/api/people/invite").then((r) => r.json())
      .then((d) => setInvites(d.invites ?? [])).catch(() => {});
  }, [isAdmin, done]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (!await post("/api/people/invite",
      { fullName: inviteName, phone: invitePhone, role: inviteRole })) return;
    setDone(`Texted ${invitePhone}. They'll set themselves up from the link.`);
    setInviteName(""); setInvitePhone("");
    refresh();
  }

  async function addStaff(e: React.FormEvent) {
    e.preventDefault();
    if (!await post("/api/people", { fullName: name, role, email, forwardTo: cell })) return;
    setDone(`${name} can now sign in with ${email}.`);
    setName(""); setEmail(""); setCell("");
    refresh();
  }

  async function setPin(person: Staff) {
    const pin = window.prompt(
      `Four digits for ${person.full_name}. They'll use this to sign in on a phone.`);
    if (pin === null) return;
    if (!await post(`/api/people/${person.id}`, { pin: pin.trim() }, "PATCH")) return;
    setDone(`${person.full_name}'s PIN is set.`);
    refresh();
  }

  async function toggleActive(person: Staff) {
    if (person.active && !window.confirm(
      `Turn off access for ${person.full_name}? Their PIN and sign-in link stop working immediately.`
    )) return;
    if (!await post(`/api/people/${person.id}`, { active: !person.active }, "PATCH")) return;
    refresh();
  }

  const tabs: [string, string, number][] = [
    ["office", "Office", office.length],
    ["field", "Field staff", field.length],
    ["vendors", "Directory", vendors.length],
    ...(isAdmin ? [["requests", "Requests", requests] as [string, string, number]] : []),
  ];

  return (
    <main className="people">
      <h1 className="pagetitle">People</h1>
      <p className="muted">
        Everyone who can reach the shared line, and everyone you can send work to.
      </p>

      <div className="tabsrow">
        <div className="tabs">
          {tabs.map(([k, label, n]) => (
            <a key={k} href={`/people?tab=${k}`} className={tab === k ? "on" : ""}>
              {label} <span className="n">{n}</span>
            </a>
          ))}
        </div>
      </div>

      {error && <p className="err">{error}</p>}
      {done && <p className="okmsg">{done}</p>}

      {tab === "requests" ? (
        <AccessRequests />
      ) : tab !== "vendors" ? (
        <>
          <ul className="people-list">
            {(tab === "office" ? office : field).map((p) => (
              <li key={p.id} className={p.active ? "" : "off"}>
                <span className="p-name">
                  {p.full_name}
                  {!p.active && <span className="tag">no access</span>}
                </span>
                <span className="p-sub">
                  {ROLE_LABEL[p.role] ?? p.role}
                  {p.forward_to ? ` · ${p.forward_to}` : ""}
                </span>
                {isAdmin && (
                  <span className="p-acts">
                    {(p.role === "tech" || p.role === "shower") && (
                      <button className="mini" disabled={busy}
                              onClick={() => setPin(p)}>Set PIN</button>
                    )}
                    <button className="mini" disabled={busy}
                            onClick={() => toggleActive(p)}>
                      {p.active ? "Turn off access" : "Turn access back on"}
                    </button>
                  </span>
                )}
              </li>
            ))}
            {!(tab === "office" ? office : field).length && (
              <li className="none">Nobody here yet.</li>
            )}
          </ul>

          {isAdmin && (
            <form className="addbox" onSubmit={invite}>
              <h2>Text someone a setup link</h2>
              <p className="muted">
                They fill in their own name, email and password on their phone —
                nothing for you to type and nothing for them to be told. The link
                works once and expires in a week.
              </p>
              <label htmlFor="in">Name <span className="opt">— optional</span></label>
              <input id="in" value={inviteName}
                     onChange={(e) => setInviteName(e.target.value)} />
              <label htmlFor="ip">Mobile number</label>
              <input id="ip" type="tel" value={invitePhone}
                     onChange={(e) => setInvitePhone(e.target.value)}
                     placeholder="(252) 555-0142" required />
              <label htmlFor="ir">What they&rsquo;ll be doing</label>
              <select id="ir" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                <option value="office">Office — the inbox, leasing, tenants</option>
                <option value="admin">Admin — everything, including filings and the audit trail</option>
                <option value="tech">Maintenance — work orders assigned to them</option>
                <option value="shower">Showings — prospects and viewings</option>
              </select>
              <button className="btn pri" disabled={busy}>
                {busy ? "Texting…" : "Text them a link"}
              </button>

              {invites.length > 0 && (
                <>
                  <p className="fieldlab" style={{ marginTop: "1.2rem" }}>
                    Sent, not taken up yet
                  </p>
                  <ul className="invitelist">
                    {invites.map((i) => (
                      <li key={i.id}>
                        <span>{i.name || i.phone}</span>
                        <span className="muted">
                          {i.name ? i.phone : ""} · {ROLE_LABEL[i.role] ?? i.role}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </form>
          )}

          {isAdmin && (
            <form className="addbox" onSubmit={addStaff}>
              <h2>Or add them by hand</h2>
              <p className="muted">
                For somebody without a mobile you can text, or when you&rsquo;d
                rather type it yourself. They then use &ldquo;Set or reset my
                password&rdquo; at sign-in.
              </p>
              <label htmlFor="n">Name</label>
              <input id="n" value={name} onChange={(e) => setName(e.target.value)} required />
              <label htmlFor="r">What they do</label>
              <select id="r" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="office">Office — the inbox, leasing, tenants</option>
                <option value="admin">Admin — everything, including filings and the audit trail</option>
                <option value="tech">Maintenance — work orders assigned to them</option>
                <option value="shower">Showings — prospects and viewings</option>
              </select>
              <label htmlFor="e">Work email</label>
              <input id="e" type="email" value={email}
                     onChange={(e) => setEmail(e.target.value)} required />
              <label htmlFor="c">Cell <span className="opt">— optional, rings on calls</span></label>
              <input id="c" type="tel" value={cell} onChange={(e) => setCell(e.target.value)}
                     placeholder="(252) 555-0142" />
              <button className="btn pri" disabled={busy}>
                {busy ? "Adding…" : "Add them"}
              </button>
            </form>
          )}
        </>
      ) : (
        <Directory />
      )}
    </main>
  );
}
