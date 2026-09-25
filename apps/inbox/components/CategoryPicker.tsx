"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CATEGORIES, CAT_LABEL } from "@/lib/category";
import { threadChanged } from "@/lib/refresh";

/** The category, as a control rather than a label.
 *
 *  It sat here as a badge while a banner underneath said "recategorise it if
 *  that's wrong" -- an instruction with nothing to click. */
export default function CategoryPicker(
  { conversationId, category }: { conversationId: string; category: string },
) {
  const router = useRouter();
  const [, start] = useTransition();
  const [busy, setBusy] = useState(false);

  async function change(next: string) {
    if (next === category) return;
    setBusy(true);
    await fetch(`/api/conversations/${conversationId}/category`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: next }),
    });
    setBusy(false);
    threadChanged();
    start(() => router.refresh());
  }

  return (
    <span className={`catpick cat-${category}`}>
      <select value={category} disabled={busy} aria-label="What this conversation is about"
              onChange={(e) => change(e.target.value)}>
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>{CAT_LABEL[c]}</option>
        ))}
      </select>
    </span>
  );
}
