"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { clockTime, dayLabel } from "@/lib/format";
import Seen, { type Read } from "./Seen";
import { supabaseBrowser } from "@/lib/supabase-client";
import { continues } from "@/lib/runs";
import { AttachStrip, AttachButton } from "./Attach";
import { useAttachments } from "./useAttachments";
import Attachment from "./Attachment";

type Msg = { id: string; body: string; at: string; who: string; media?: string[] };
type Person = { id: string; full_name: string };
type Thread = {
  me: string; members: Person[]; messages: Msg[];
  /** Signed URLs for every attachment on the thread, by storage path. Minutes
   *  long, minted per request. */
  media?: Record<string, string>;
  /** When each person last opened the thread, which is what read receipts are
   *  worked out from. */
  reads: Read[];
  oversight: string[]; viewingOnly: boolean;
};

/**
 * A conversation with a colleague, in the same pane as everything else.
 *
 * Sitting in the same list as the tenants is the point: you do not keep a
 * separate app open to ask Hannah whether she called the plumber. What keeps it
 * safe is that it is plainly marked and structurally incapable of leaving the
 * building -- there is no phone number on this thread and no way to send one.
 */
export default function DmPane(
  { id, onBack }: { id: string; onBack: () => void },
) {
  const [data, setData] = useState<Thread | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const files = useAttachments(`/api/team/${id}/attach`);
  const [roster, setRoster] = useState<Person[]>([]);
  const bottom = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [, startRefresh] = useTransition();

  /** The list beside this pane is rendered on the server and has no idea
   *  anything happened here. Sending reloaded the thread and left the row
   *  showing a preview from before the message, which reads as a message that
   *  did not send -- the same shape of bug as the tenant composer had, in the
   *  one place that had not been given the same fix. */
  const refreshList = useCallback(() => startRefresh(() => router.refresh()), [router]);

  /** Who had opened this thread at or after the moment a message landed, which
   *  is as close to "read it" as a thread view can honestly claim. Never
   *  includes you: your own receipt on your own message is noise. */
  const seenBy = (at: string): Read[] =>
    (data?.reads ?? []).filter((r) => r.staffId !== data?.me && r.at >= at);

  const load = useCallback(async () => {
    const res = await fetch(`/api/team/${id}`, { cache: "no-store" });
    if (res.ok) setData(await res.json());
  }, [id]);

  // Opening marks the thread read server-side, so the list has to be told or
  // the "new" pill sits on a thread you are looking at.
  useEffect(() => { setData(null); load().then(refreshList); }, [load, refreshList]);

  useEffect(() => {
    if (!editing || roster.length) return;
    fetch("/api/team").then((r) => r.json())
      .then((d) => setRoster(d.colleagues ?? [])).catch(() => {});
  }, [editing, roster.length]);

  async function changeMembers(patch: { add?: string; remove?: string }) {
    await fetch(`/api/team/${id}/members`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    await load();
    // Adding or removing somebody changes the thread's name in the list.
    refreshList();
  }
  useEffect(() => { bottom.current?.scrollIntoView(); }, [data]);

  useEffect(() => {
    const channel = supabaseBrowser()
      .channel(`dm:${id}`)
      .on("postgres_changes",
          { event: "INSERT", schema: "public", table: "dm_messages" },
          () => { load(); refreshList(); })
      .subscribe();
    return () => { supabaseBrowser().removeChannel(channel); };
  }, [id, load]);

  /** Files off a paste or a drop. A clipboard carries a screenshot as an item
   *  with no name, which is the case this exists for -- most of what gets
   *  shown to a colleague is a screenshot of something on screen. */
  function fromTransfer(list: DataTransferItemList | null, fallback: FileList | null): File[] {
    const out: File[] = [];
    for (const item of list ?? []) {
      if (item.kind !== "file") continue;
      const f = item.getAsFile();
      if (f) out.push(f);
    }
    if (!out.length) out.push(...(fallback ?? []));
    return out;
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    // A screenshot with no words is a whole message.
    if ((!text.trim() && !files.items.length) || files.busy > 0) return;
    setBusy(true);
    const body = text;
    const media = files.items.map((f) => f.path);
    setText("");
    await fetch(`/api/team/${id}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, media }),
    });
    // Cleared only once it has gone. Losing the picture along with the message
    // would mean finding it again.
    files.clear();
    setBusy(false);
    await load();
    refreshList();
  }

  if (!data) return <div className="chatcol"><p className="none">Opening…</p></div>;

  const me = data.members.find((m) => m.id === data.me)?.full_name;
  const others = data.members.filter((m) => m.id !== data.me);
  let lastDay = "";

  return (
    <div className="chatcol">
      <div className="chead">
        <button type="button" className="chevron" onClick={onBack}
                aria-label="Back to messages">&lsaquo;</button>
        <span className="cwho">
          <span className="nm">{others.map((o) => o.full_name).join(", ") || "Just you"}</span>
          <span className="sub">
            <span className="badge staffbadge">Staff</span>
            <span className="dim">Internal — never sent outside</span>
          </span>
        </span>
        {!data.viewingOnly && (
          <button type="button" className="mini" onClick={() => setEditing((v) => !v)}>
            {others.length > 1 ? "Who's in" : "Add someone"}
          </button>
        )}
      </div>

      {editing && !data.viewingOnly && (
        <div className="grouped">
          <p className="fieldlab">In this conversation</p>
          <ul className="memberlist">
            {data.members.map((m) => (
              <li key={m.id}>
                <span>{m.full_name}{m.id === data.me ? " (you)" : ""}</span>
                {data.members.length > 2 && (
                  <button className="mini" onClick={() => changeMembers({ remove: m.id })}>
                    {m.id === data.me ? "Leave" : "Remove"}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="fieldlab">Add</p>
          <div className="chipset">
            {roster.filter((c) => !data.members.some((m) => m.id === c.id)).map((c) => (
              <button key={c.id} className="chip"
                      onClick={() => changeMembers({ add: c.id })}>{c.full_name}</button>
            ))}
            {!roster.filter((c) => !data.members.some((m) => m.id === c.id)).length && (
              <span className="pinmuted">Everybody is already in.</span>
            )}
          </div>
          <p className="pinmuted" style={{ marginTop: ".5rem", fontSize: ".78rem" }}>
            Adding or removing somebody is written into the conversation, so
            nobody finds out later that someone has been reading along.
          </p>
        </div>
      )}

      {/* Worked out per message from each person's last-read time rather than
          stored per message: for five people and a hundred messages that would
          be five hundred rows saying what five timestamps already say. */}
      <div className="msgs">
        {data.messages.map((m, i) => {
          const day = dayLabel(m.at);
          const sep = day !== lastDay ? ((lastDay = day), day) : null;
          const mine = m.who === me;
          // Same person, still talking: drop the repeated name and let the
          // clock hide until the end of the run or a hover.
          const prev = data.messages[i - 1] ?? null;
          const next = data.messages[i + 1] ?? null;
          const run = continues(prev, m, Boolean(sep));
          const last = !next || !continues(m, next, false);
          const system = m.who === "Someone";
          if (system) {
            return (
              <div key={m.id} className="mrow">
                {sep && <div className="daysep">{sep}</div>}
                <div className="sys">{m.body} · {clockTime(m.at)}</div>
              </div>
            );
          }
          return (
            <div key={m.id} className="mrow">
              {sep && <div className="daysep">{sep}</div>}
              <div className={`${mine ? "out" : "in"}${run ? " run" : ""}${last ? " last" : ""}`}>
                {/* On your own messages too. In a group of four, "who said
                    that" is the question, and answering it for everyone except
                    the person reading is an odd place to stop -- the tenant
                    threads have always named the sender on both sides. */}
                <span className="attrib">{mine ? "You" : m.who}</span>
                {m.body && (
                  <div className="bwrap"><div className="b"><Body text={m.body} /></div></div>
                )}
                {(m.media ?? []).map((path) => (
                  <Attachment key={path} path={path} src={data.media?.[path]} />
                ))}
                <span className="delivered">
                  {clockTime(m.at)}
                  {/* Only on our own. Whether THEY have read what we sent is
                      the question; whether we read our own message is not. */}
                  {mine && <Seen readers={seenBy(m.at)} />}
                </span>
              </div>
            </div>
          );
        })}
        {!data.messages.length && <p className="none">Nothing yet. Say something.</p>}
        <div ref={bottom} />
      </div>

      {data.viewingOnly ? (
        <p className="viewonly">
          You can read this because you have oversight. You are not in it, so
          there is nothing to send.
        </p>
      ) : (
      <form
        className={`composer${dragging ? " dragging" : ""}`} onSubmit={send}
        // Dropped anywhere on the composer, not only on the paperclip:
        // dragging a file at a 2 cm target is a thing people miss.
        onDragOver={(e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); setDragging(true); } }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (!e.dataTransfer?.types?.includes("Files")) return;
          e.preventDefault(); setDragging(false);
          void files.take(fromTransfer(e.dataTransfer.items, e.dataTransfer.files));
        }}
      >
        {/* Nothing on this thread is ever texted to anybody, so there is no
            carrier to warn about and nothing to grey out. */}
        <AttachStrip items={files.items} busy={files.busy} problem={files.problem}
                     onRemove={files.remove} sendableOnly={false} />
        <div className="inputrow">
          <AttachButton onPick={(picked) => void files.take(picked)}
                        disabled={busy || files.busy > 0} />
          <textarea rows={1} value={text} placeholder="Message — stays inside the office"
                    onChange={(e) => setText(e.target.value)}
                    onPaste={(e) => {
                      const picked = fromTransfer(e.clipboardData?.items ?? null, e.clipboardData?.files ?? null);
                      if (picked.length) { e.preventDefault(); void files.take(picked); }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(e); }
                    }} />
          <button className="sendbtn"
                  disabled={busy || files.busy > 0 || (!text.trim() && !files.items.length)}>↑</button>
        </div>
      </form>
      )}
    </div>
  );
}


/**
 * A staff message, with its links made usable.
 *
 * A forward arrives carrying a link back to the conversation it came from, and
 * as raw text that is a forty-character UUID somebody has to select and paste.
 * Ours become a button that says where it goes; everything else becomes a
 * plain link, because a colleague pasting a URL means it to be clickable.
 */
function Body({ text }: { text: string }) {
  const parts = String(text).split(/(https?:\/\/\S+)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (!/^https?:\/\//.test(part)) return <span key={i}>{part}</span>;

        const convo = /\/c\/([0-9a-f-]{36})/i.exec(part);
        if (convo) {
          return (
            <a key={i} className="jumpto" href={`/c/${convo[1]}`}>
              Jump to the conversation <span aria-hidden="true">→</span>
            </a>
          );
        }
        const team = /\/team\?t=([0-9a-f-]{36})/i.exec(part);
        if (team) {
          return (
            <a key={i} className="jumpto" href={`/team?t=${team[1]}`}>
              Open that thread <span aria-hidden="true">→</span>
            </a>
          );
        }
        return (
          <a key={i} className="inlink" href={part} target="_blank" rel="noreferrer">
            {part}
          </a>
        );
      })}
    </>
  );
}
