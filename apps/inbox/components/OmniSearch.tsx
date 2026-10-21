"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { rank } from "@/lib/fuzzy";
import { sum } from "@/lib/sums";

/**
 * One box for people who do not know where to click.
 *
 * Three kinds of answer, and the order they are tried in is the design.
 *
 * ARITHMETIC first, and only when it is unmistakably arithmetic. "775 * 12"
 * is a sum; "3114" is a lot number and "cross creek" is a park, and a
 * calculator that answers those has stolen the search bar. `lib/sums.ts`
 * refuses everything that is not plainly a sum, which is what lets this go
 * first.
 *
 * PAGES next, from a list held right here, so typing "timesheet" is instant
 * and owes nothing to the network. Every page carries the words somebody
 * would actually type for it -- "payroll" and "hours" both mean the
 * timesheet, and nobody searches for "Looking for a home".
 *
 * THINGS last, because they need asking. Debounced, so a word typed at speed
 * is one request and not nine.
 *
 * And nothing matched is a SENTENCE. An empty box is the screen telling
 * somebody their park does not exist.
 */

type Found = {
  kind: "place" | "lot" | "owner" | "person" | "job" | "report";
  id: string; title: string; sub?: string; href: string; answer?: string;
};

/** The screens, and what a person would type to look for each.
 *
 *  Nobody types "Looking for a home". They type "vacant", or "leasing", or
 *  the name of the thing they are trying to get done. */
const PAGES: { title: string; href: string; sub: string; words: string[] }[] = [
  { title: "Home", href: "/home", sub: "The dashboard",
    words: ["dashboard", "overview", "start", "money"] },
  { title: "Messages", href: "/", sub: "The shared line",
    words: ["inbox", "texts", "sms", "conversations", "threads"] },
  { title: "Team chat", href: "/team", sub: "Staff only",
    words: ["chat", "staff", "internal", "dm"] },
  { title: "Jobs", href: "/jobs", sub: "Work orders",
    words: ["work orders", "maintenance", "repairs", "tickets", "dispatch"] },
  { title: "Properties", href: "/properties", sub: "Parks, lots and homes",
    words: ["parks", "lots", "units", "homes", "rent roll", "portfolio"] },
  { title: "Looking for a home", href: "/leasing", sub: "Leasing",
    words: ["leasing", "vacant", "empty", "prospects", "applicants", "showings"] },
  { title: "Timesheets", href: "/timesheets", sub: "Everybody's hours",
    words: ["hours", "payroll", "clock", "crew", "labour", "labor", "time"] },
  { title: "On the clock", href: "/clock", sub: "Clock yourself in",
    words: ["clock in", "clock out", "my hours", "break"] },
  { title: "People", href: "/people", sub: "Staff and invitations",
    words: ["staff", "employees", "users", "invite", "crew", "team"] },
  { title: "Report a repair", href: "/report", sub: "The tenants' form",
    words: ["tenant form", "repair form", "request"] },
  { title: "Rent Manager", href: "/rentmanager", sub: "Sync and probes",
    words: ["rm", "rmapi", "sync", "import"] },
  { title: "Setup check", href: "/setup", sub: "What is configured",
    words: ["setup", "diagnostics", "health", "config", "settings"] },
];

const KIND_WORD: Record<Found["kind"], string> = {
  place: "Property", lot: "Lot", owner: "Owner",
  person: "Contact", job: "Job", report: "",
};

export default function OmniSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState<Found[]>([]);
  const [meant, setMeant] = useState<string | null>(null);
  const [at, setAt] = useState(0);
  const box = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLDivElement>(null);

  const maths = sum(q);

  // The pages, ranked here and now. No request, no debounce, no wait.
  const pages = q.trim().length >= 1
    ? rank(q, PAGES.map((p) => ({ item: p, text: p.title, also: p.words })), 5)
        .map((h) => ({
          kind: "place" as const, id: h.item.href, title: h.item.title,
          sub: h.item.sub, href: h.item.href,
        }))
    : [];

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setFound([]); setMeant(null); return; }
    // Debounced: a word typed at speed is one request, not nine. The abort
    // matters as much -- without it the answer to "cro" can arrive after the
    // answer to "cross creek" and overwrite it.
    const ac = new AbortController();
    const id = setTimeout(async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`,
                              { signal: ac.signal }).catch(() => null);
      if (!res?.ok) return;
      const d = await res.json().catch(() => null);
      if (!d) return;
      setFound(d.results ?? []);
      setMeant(d.meant ?? null);
    }, 160);
    return () => { clearTimeout(id); ac.abort(); };
  }, [q]);

  const rows: Found[] = [...pages, ...found.filter(
    (f) => !pages.some((p) => p.href === f.href && f.kind === "place"))];

  const go = useCallback((f: Found) => {
    setOpen(false);
    setQ("");
    box.current?.blur();
    router.push(f.href);
  }, [router]);

  // Slash to search, the way every tool with a search box works. Ignored
  // while somebody is typing in another box, or it eats the slash.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && /^(input|textarea|select)$/i.test(el.tagName);
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault(); box.current?.focus();
      }
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault(); box.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // A click anywhere else puts it away. Pointerdown rather than click, or a
  // press on a result closes the panel before the press lands on the row.
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, []);

  const showing = open && (q.trim().length >= 1);
  const anything = rows.length > 0 || !!maths;

  return (
    <div className="omni" ref={wrap}>
      {/* The magnifier is decoration, not a control: the input beside it is
          already labelled, and a second thing for a screen reader to
          announce is noise. */}
      <svg className="omniglass" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor"
                strokeWidth="2" />
        <path d="M12.8 12.8 L17 17" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" />
      </svg>
      <input
        ref={box}
        className="omnibox"
        type="search"
        value={q}
        placeholder="Command Launch"
        aria-label="Search everything"
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setAt(0); }}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setOpen(false); box.current?.blur(); return; }
          if (!showing || !rows.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setAt((i) => (i + 1) % rows.length); }
          if (e.key === "ArrowUp") { e.preventDefault(); setAt((i) => (i - 1 + rows.length) % rows.length); }
          if (e.key === "Enter") { e.preventDefault(); go(rows[at] ?? rows[0]); }
        }} />

      {showing ? (
        <div className="omnipanel" role="listbox" aria-label="Results">
          {maths ? (
            <div className="omnisum">
              <span className="omnisumq">{q.trim()}</span>
              <span className="omnisumv">{maths.pretty}</span>
            </div>
          ) : null}

          {rows.map((f, i) => (
            <button key={`${f.kind}:${f.id}`} type="button"
                    className={`omnirow${i === at ? " on" : ""}`}
                    role="option" aria-selected={i === at}
                    onMouseEnter={() => setAt(i)}
                    onClick={() => go(f)}>
              <span className="omnit">{f.title}</span>
              {f.answer ? <span className="omnia">{f.answer}</span> : null}
              <span className="omnik">{f.sub || KIND_WORD[f.kind]}</span>
            </button>
          ))}

          {/* Nothing matched is a sentence. An empty box is the screen
              telling somebody their park does not exist. */}
          {!anything ? (
            <div className="omninone">
              {meant ? (
                <>Nothing matched &ldquo;{q.trim()}&rdquo;. Did you mean{" "}
                  <button type="button" className="omnimeant"
                          onClick={() => { setQ(meant); box.current?.focus(); }}>
                    {meant}
                  </button>?</>
              ) : (
                <>Nothing matched &ldquo;{q.trim()}&rdquo;. Try a park, a lot
                  number, somebody&rsquo;s name, or a sum.</>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
