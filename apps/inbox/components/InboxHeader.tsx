"use client";
import { useState } from "react";
import Compose from "./Compose";
import NewGroup from "./NewGroup";

/** The actions that belong to this screen, on this screen. A nav bar that
 *  carries "New Message" has to explain itself on the page about invoices. */
export default function InboxHeader({ canBroadcast }: { canBroadcast: boolean }) {
  const [compose, setCompose] = useState<"new" | "broadcast" | null>(null);
  const [group, setGroup] = useState(false);
  return (
    <>
      <div className="pagebar">
        <h1>Messages</h1>
        <span className="sp" />
        <button className="btn" onClick={() => setCompose("new")}>New Message</button>
        <button className="btn" onClick={() => setGroup(true)}>New Group</button>
        {canBroadcast && (
          <button className="btn pri" onClick={() => setCompose("broadcast")}>
            Staff Broadcast
          </button>
        )}
      </div>
      {group && <NewGroup onClose={() => setGroup(false)} />}
      {compose && (
        <Compose mode={compose} onClose={() => setCompose(null)}
                 onSent={(id) => {
                   setCompose(null);
                   if (id) location.assign(`/c/${id}`);
                 }} />
      )}
    </>
  );
}
