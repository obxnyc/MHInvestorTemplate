"use client";
import { useCallback, useEffect, useState } from "react";
import { pickLang, type Lang } from "@/lib/say";

/**
 * Which language this person reads.
 *
 * Starts as English and corrects itself after mount rather than reading the
 * handset during render: the server has no `navigator`, so a language chosen
 * during render is a hydration mismatch, which React resolves by throwing the
 * client's version away -- leaving a Spanish reader looking at English and no
 * error anywhere to say why.
 *
 * The flash is one frame and the alternative is a screen that is sometimes
 * silently wrong.
 */
export function useLang(): [Lang, (next: Lang) => void] {
  const [lang, setLang] = useState<Lang>("en");

  useEffect(() => {
    let stored: string | null = null;
    // Private windows and blocked site data throw rather than returning null.
    try { stored = localStorage.getItem("lang"); } catch { stored = null; }
    setLang(pickLang(stored, navigator.language));
  }, []);

  const choose = useCallback((next: Lang) => {
    try { localStorage.setItem("lang", next); } catch { /* remembered for this visit only */ }
    setLang(next);
  }, []);

  return [lang, choose];
}
