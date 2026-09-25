"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-client";
import { initials } from "@/lib/format";

const ROLE: Record<string, string> = {
  admin: "Admin", office: "Office", tech: "Field staff", shower: "Showings",
};

/**
 * Your initials, and what is behind them.
 *
 * There was no way to sign out. Not a hidden one -- none, anywhere in the
 * application. On a shared office computer that is the whole of the security
 * model failing quietly: everything else here is careful about who can read
 * what, and none of it means anything if the last person to use the machine
 * is still signed in.
 *
 * Sign-out clears the session and then does a full page load rather than a
 * client-side route, because the router would keep the pages already rendered
 * for the person who just left in memory, and a back button would show them.
 */
export default function AccountMenu({ name, role }: { name: string; role: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  async function signOut() {
    setBusy(true);
    try {
      await supabaseBrowser().auth.signOut();
    } finally {
      // Even if that failed, leave. A sign-out that silently does nothing is
      // worse than one that is merely slow.
      window.location.assign("/login");
    }
  }

  return (
    <div className="ovwrap acctwrap" ref={wrap}>
      <button className="av" aria-haspopup="menu" aria-expanded={open}
              title={name} onClick={() => setOpen((o) => !o)}>
        {initials(name)}
      </button>
      {open && (
        <div className="ovmenu" role="menu">
          <span className="ovlabel">{name}{ROLE[role] ? ` · ${ROLE[role]}` : ""}</span>
          <Link className="ovitem" role="menuitem" href="/account"
                onClick={() => setOpen(false)}>
            Your sign-in
          </Link>
          <Link className="ovitem" role="menuitem" href="/settings"
                onClick={() => setOpen(false)}>
            Settings
          </Link>
          <div className="ovsep" />
          <button className="ovitem danger" role="menuitem" disabled={busy}
                  onClick={signOut}>
            {busy ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}
