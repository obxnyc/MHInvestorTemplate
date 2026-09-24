"use client";
import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/** Debounced so a query goes out when someone stops typing, not on every
 *  keystroke — this hits the database. */
export default function Search({ initial }: { initial: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(initial);

  useEffect(() => {
    const t = setTimeout(() => {
      if (q === initial) return;
      const next = new URLSearchParams(params.toString());
      if (q) next.set("q", q); else next.delete("q");
      const s = next.toString();
      router.replace(s ? `/?${s}` : "/");
    }, 300);
    return () => clearTimeout(t);
  }, [q, initial, params, router]);

  return (
    <div className="search">
      <svg viewBox="0 0 24 24">
        <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
      </svg>
      <input value={q} onChange={(e) => setQ(e.target.value)}
             placeholder="Search staff, tenants, contacts, or a number…" />
    </div>
  );
}
