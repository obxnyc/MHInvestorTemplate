"use client";
import { useRouter, useSearchParams } from "next/navigation";

/** The two dropdowns are plain links under the hood, so filtering survives a
 *  refresh and can be shared as a URL.
 *
 *  Maintenance and Leasing used to live in this select and are now tabs. They
 *  are the two piles anyone looks at twenty times a day, and a filter you have
 *  to open a menu to reach is a filter nobody uses. What is left here is the
 *  exception handling — threads nobody claimed, threads waiting on a closure
 *  answer, threads the classifier was not sure about. */
export default function QueueSelects(
  { who, show, unclaimed, closing }:
  { who: string; show: string; unclaimed: number; closing: number },
) {
  const router = useRouter();
  const params = useSearchParams();

  const go = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value && value !== "everyone" && value !== "open") next.set(key, value);
    else next.delete(key);
    const s = next.toString();
    router.replace(s ? `/?${s}` : "/");
  };

  return (
    <div className="tabsrow selrow">
      <select value={who} onChange={(e) => go("who", e.target.value)} aria-label="Assignee">
        <option value="everyone">Everyone</option>
        <option value="unclaimed">Unclaimed{unclaimed ? ` (${unclaimed})` : ""}</option>
        <option value="mine">Mine</option>
      </select>
      <select value={show} onChange={(e) => go("show", e.target.value)} aria-label="Queue">
        <option value="open">Everything open</option>
        <option value="closing">Needs closing{closing ? ` (${closing})` : ""}</option>
        <option value="review">Needs review</option>
      </select>
    </div>
  );
}
