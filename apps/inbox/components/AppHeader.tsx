"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Compose from "./Compose";

type Role = "admin" | "office" | "tech";

/** Title, an overflow for the secondary views, and the two actions people
 *  actually reach for. Everything else lives behind the ⋯ so the header stays
 *  legible on a phone. */
export default function AppHeader(
  { name, role }: { name: string; role: Role },
) {
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const [compose, setCompose] = useState<"new" | "broadcast" | null>(null);
  const initials = name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menu]);

  return (
    <>
      <header className="apphead">
        <h1>Messages</h1>
        <span className="sp" />

        <div className="ovwrap">
          <button className="iconbtn" aria-label="More" aria-expanded={menu}
                  onClick={(e) => { e.stopPropagation(); setMenu(!menu); }}>⋯</button>
          {menu && (
            <div className="ovmenu" onClick={(e) => e.stopPropagation()}>
              <Link className="ovitem" href="/">Messages</Link>
              <Link className="ovitem" href="/calls">Calls</Link>
              {role === "admin" && <Link className="ovitem" href="/legal">Court filings</Link>}
              {role === "admin" && <Link className="ovitem" href="/audit">Audit trail</Link>}
              <div className="ovsep" />
              <span className="ovlabel">{name}</span>
            </div>
          )}
        </div>

        <button className="btn" onClick={() => setCompose("new")}>New Message</button>
        {(role === "admin" || role === "office") && (
          <button className="btn pri" onClick={() => setCompose("broadcast")}>
            Staff Broadcast
          </button>
        )}
        <span className="av" title={name}>{initials}</span>
      </header>

      {compose && (
        <Compose
          mode={compose}
          onClose={() => setCompose(null)}
          onSent={(id) => { setCompose(null); if (id) router.push(`/c/${id}`); else router.refresh(); }}
        />
      )}
    </>
  );
}
