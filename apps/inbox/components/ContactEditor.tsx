"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { threadChanged } from "@/lib/refresh";

const PARTIES: [string, string][] = [
  ["current_tenant", "Tenant"],
  ["prospect", "Prospective tenant"],
  ["vendor", "Trade / contractor"],
  ["owner", "Owner"],
  ["tech", "Our maintenance staff"],
  ["other", "Someone else"],
];

const LANGUAGES: [string, string][] = [
  ["", "English"], ["es", "Spanish"], ["ht", "Haitian Creole"],
  ["pt", "Portuguese"], ["vi", "Vietnamese"], ["fr", "French"],
];

/**
 * Putting a name to a number, from inside the conversation.
 *
 * A shared line accumulates threads labelled (862) 368-6847, and whoever picks
 * one up two weeks later has no idea who that is. Naming them is part of
 * answering them, not an administrative act -- so it lives here, on the
 * header, available to anyone, rather than behind a separate screen nobody
 * walks over to.
 *
 * The address matters as much as the name: a contact tied to a unit is what
 * makes their open jobs follow them into every future thread.
 */
export default function ContactEditor(
  { contactId, name, phone, party, unitId, language, onClose }:
  { contactId: string; name: string | null; phone: string; party: string;
    unitId: string | null; language: string | null; onClose: () => void },
) {
  const router = useRouter();
  const [, start] = useTransition();
  const [fullName, setFullName] = useState(name ?? "");
  const [who, setWho] = useState(party || "other");
  const [unit, setUnit] = useState(unitId ?? "");
  const [lang, setLang] = useState(language ?? "");
  const [units, setUnits] = useState<{ id: string; label: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/units").then((r) => r.json())
      .then((d) => setUnits(d.units ?? []))
      .catch(() => setUnits([]));
  }, []);

  async function save() {
    setBusy(true); setError(null);
    const res = await fetch(`/api/contacts/${contactId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName, party: who, unitId: unit, language: lang }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "That didn't save.");
      return;
    }
    onClose();
    threadChanged();
    start(() => router.refresh());
  }

  return (
    <div className="modal" role="dialog" aria-modal="true"
         aria-label="Who is this" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>Who is this?</h3>
        <p>{phone}</p>

        {error && <p className="err">{error}</p>}

        <label className="fieldlab" htmlFor="cn">Name</label>
        <input id="cn" value={fullName} autoFocus
               onChange={(e) => setFullName(e.target.value)}
               placeholder="e.g. Maria Alvarez" />

        <label className="fieldlab" htmlFor="cw">What they are to us</label>
        <select id="cw" value={who} onChange={(e) => setWho(e.target.value)}>
          {PARTIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>

        <label className="fieldlab" htmlFor="cu">
          Address <span className="opt">— ties their open jobs to this person</span>
        </label>
        <select id="cu" value={unit} onChange={(e) => setUnit(e.target.value)}>
          <option value="">Not at one of our addresses</option>
          {(units ?? []).map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
        </select>

        <label className="fieldlab" htmlFor="cl">
          Language <span className="opt">— replies are sent in this</span>
        </label>
        <select id="cl" value={lang} onChange={(e) => setLang(e.target.value)}>
          {LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>

        <div className="acts">
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn pri" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
