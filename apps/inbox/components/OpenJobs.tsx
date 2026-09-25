"use client";
import { useState } from "react";
import { dueState, dueLabel } from "@/lib/dispatch";

export type Job = { id: string; summary: string; status: string; dueAt: string | null };

/**
 * What this person already has outstanding, above the conversation.
 *
 * Whoever picks up a thread should know "three open jobs, one of them late"
 * before they type a word. Without it you answer a tenant as though nothing
 * else is going on, which is how the same repair gets reported three times and
 * how someone promises Tuesday to a person who was already promised Monday.
 *
 * The colour is the worst state among them, because that is the one that
 * changes what you say. A strip that averaged them would be calm while
 * something was two days late.
 */
export default function OpenJobs({ jobs }: { jobs: Job[] }) {
  const [open, setOpen] = useState(false);
  if (!jobs.length) return null;

  const worst = jobs.some((j) => dueState(j.dueAt) === "late") ? "late"
    : jobs.some((j) => dueState(j.dueAt) === "soon") ? "soon" : "later";
  const late = jobs.filter((j) => dueState(j.dueAt) === "late").length;

  return (
    <div className={`openjobs due-${worst}`}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <strong>{jobs.length} open {jobs.length === 1 ? "job" : "jobs"}</strong>
        {late > 0 && <span className="latecount">{late} late</span>}
        <span className="chev" aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <ul>
          {jobs.map((j) => (
            <li key={j.id} className={`due-${dueState(j.dueAt)}`}>
              <span className="js">{j.summary}</span>
              <span className="jd">{dueLabel(j.dueAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
