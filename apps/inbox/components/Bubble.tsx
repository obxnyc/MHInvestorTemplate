"use client";
import { useState } from "react";
import { languageName } from "@/lib/translate";

/**
 * One message, in the language the reader needs, with the original one tap
 * away.
 *
 * English is shown first because the person reading the inbox works in
 * English, and a wall of Spanish they cannot check is not a record they can
 * act on. The original is never more than one tap away and is never discarded:
 * what a tenant typed is the evidence, and the English is our reading of it.
 * The day that distinction matters, it matters a great deal.
 */
export default function Bubble(
  { body, english, lang, outbound }:
  { body: string; english: string | null; lang: string | null; outbound: boolean },
) {
  const [original, setOriginal] = useState(false);
  const translated = Boolean(english && lang && lang !== "en");

  if (!translated) return <div className="b">{body}</div>;

  return (
    <div className="b">
      {original ? body : english}
      <button type="button" className="trbtn" onClick={() => setOriginal((v) => !v)}>
        {original
          ? (outbound ? "Show what you typed" : "Show the English")
          : (outbound
              // On our own message the wire text IS the translation, so the
              // honest label is "what they received", not "the original".
              ? `Sent in ${languageName(lang)} · show it`
              : `${languageName(lang)} · show original`)}
      </button>
    </div>
  );
}
