"use client";
import { useEffect, useRef, useState } from "react";
import ThreadPane from "./ThreadPane";
import DmPane from "./DmPane";

/**
 * The inbox: a list and a conversation, on one screen, permanently.
 *
 * Selecting a conversation is a variable changing, not a navigation. That is
 * the point and it is the fourth attempt at it -- the first three kept the list
 * in the markup and still felt like being taken somewhere, because the URL
 * changed and the page re-rendered underneath. The complaint was never about
 * where the list was in the HTML.
 *
 * The rows stay real links, so middle-click, copy-link and a pasted URL all
 * behave. The click is intercepted rather than removed.
 */
export default function InboxClient(
  { initialId, initialDm, children }:
  { initialId: string | null; initialDm?: string | null; children: React.ReactNode },
) {
  const [selected, setSelected] = useState<string | null>(initialId);
  // A staff thread and a tenant conversation are both "what is open", but they
  // are different things with different panes, so which one is remembered
  // rather than guessed from the id.
  const [dm, setDm] = useState<string | null>(initialDm ?? null);
  const root = useRef<HTMLDivElement>(null);

  // The list is rendered on the server, so its highlight cannot come from React
  // state. Setting it here keeps one source of truth -- what is selected --
  // instead of a second copy that drifts.
  useEffect(() => {
    const rows = root.current?.querySelectorAll<HTMLElement>("a.row");
    rows?.forEach((row) => {
      const mine = row.dataset.cid === selected
        || (Boolean(dm) && row.dataset.dm === dm);
      row.classList.toggle("sel", mine);
      if (mine) row.setAttribute("aria-current", "true");
      else row.removeAttribute("aria-current");
    });
  }, [selected, dm, children]);

  // Back and forward still work, because the URL is still kept up to date --
  // it just is not what drives the render.
  useEffect(() => {
    const pop = () => {
      const m = window.location.pathname.match(/^\/c\/([0-9a-f-]{36})/i);
      const t = new URLSearchParams(window.location.search).get("t");
      setSelected(m ? m[1] : null);
      setDm(window.location.pathname.startsWith("/team") ? t : null);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);

  function onClick(e: React.MouseEvent) {
    // Modified clicks belong to the browser: a new tab is a reasonable thing
    // to want and hijacking it is the kind of cleverness people hate.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    const row = (e.target as HTMLElement).closest<HTMLElement>("a.row");
    if (!row) return;

    const thread = row.dataset.dm;
    if (thread) {
      e.preventDefault();
      setSelected(null);
      setDm(thread);
      window.history.pushState({}, "", `/team?t=${thread}`);
      return;
    }

    const id = row.dataset.cid;
    if (!id) return;
    e.preventDefault();
    setDm(null);
    setSelected(id);
    window.history.pushState({}, "", `/c/${id}`);
  }

  function back() {
    setSelected(null);
    setDm(null);
    window.history.pushState({}, "", "/");
  }

  return (
    <div ref={root} className={`split${selected || dm ? " split-open" : ""}`} onClick={onClick}>
      {children}
      {dm
        ? <DmPane id={dm} onBack={back} />
        : <ThreadPane id={selected} onBack={back} />}
    </div>
  );
}
