"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ThreadPane from "./ThreadPane";
import DmPane from "./DmPane";
import RowMenu, { type RowTarget } from "./RowMenu";
import HandOff from "./HandOff";

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
  const router = useRouter();

  // Right-click on a row, and what it opens next.
  const [menu, setMenu] = useState<RowTarget | null>(null);
  const [forward, setForward] = useState<
    { messageId: string; preview: string } | "loading" | null>(null);
  const [forwardError, setForwardError] = useState<string | null>(null);

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

  function onContextMenu(e: React.MouseEvent) {
    const row = (e.target as HTMLElement).closest<HTMLElement>("a.row");
    // Staff threads are not handed off or claimed, so they keep the browser's
    // own menu rather than being given one with nothing useful in it.
    if (!row || !row.dataset.cid) return;
    e.preventDefault();
    setForward(null);
    setMenu({
      id: row.dataset.cid,
      name: row.dataset.name || "This conversation",
      phone: row.dataset.phone || null,
      claimed: row.dataset.claimed === "1",
      mine: row.dataset.mine === "1",
      x: e.clientX, y: e.clientY,
    });
  }

  /** Forward works on the last thing SAID, because that is what somebody means
   *  by "send this to the plumber" -- the leak, not the thread. The list does
   *  not carry message ids, so it is fetched when asked for rather than for
   *  every row on every render. */
  async function openForward(t: RowTarget) {
    setMenu(null);
    setForward("loading");
    setForwardError(null);
    try {
      const res = await fetch(`/api/conversations/${t.id}/thread`);
      const data = await res.json();
      const last = (data.messages ?? []).at(-1);
      if (!last?.id) throw new Error("There is nothing in this thread to send on.");
      setForward({ messageId: last.id, preview: last.body ?? "" });
    } catch (err) {
      setForward(null);
      setForwardError(err instanceof Error ? err.message : "Couldn't open that.");
    }
  }

  function back() {
    setSelected(null);
    setDm(null);
    window.history.pushState({}, "", "/");
  }

  return (
    <div ref={root} className={`split${selected || dm ? " split-open" : ""}`}
         onClick={onClick} onContextMenu={onContextMenu}>
      {children}
      {dm
        ? <DmPane id={dm} onBack={back} />
        : <ThreadPane id={selected} onBack={back} />}

      {menu && (
        <RowMenu at={menu} onClose={() => setMenu(null)}
                 onOpen={(id) => { setDm(null); setSelected(id);
                                   window.history.pushState({}, "", `/c/${id}`); }}
                 onForward={openForward}
                 onChanged={() => router.refresh()} />
      )}
      {forward === "loading" && <div className="modal"><div className="sheet"><p>Opening…</p></div></div>}
      {forward && forward !== "loading" && (
        <HandOff messageId={forward.messageId} preview={forward.preview}
                 onClose={() => setForward(null)} />
      )}
      {forwardError && (
        <div className="modal" onClick={() => setForwardError(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h3>Couldn&rsquo;t forward that</h3>
            <p>{forwardError}</p>
            <div className="acts">
              <button className="btn pri" onClick={() => setForwardError(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
