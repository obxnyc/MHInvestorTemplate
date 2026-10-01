"use client";
import Link from "next/link";
import { dueState, dueLabel } from "@/lib/dispatch";

export type VendorJob = {
  id: string; summary: string; status: string; dueAt: string | null;
  conversationId: string | null;
  /** Where the work is. A plumber's thread is about four bathrooms in three
   *  parks, and "the toilet one" is not an address. */
  where: string | null;
};

/**
 * What this person is doing for us, in their own thread.
 *
 * The strip above a tenant's conversation answers "what is outstanding at
 * this address". For a vendor that question has no answer -- he has no unit,
 * and the job belongs to the tenant's conversation -- so his thread showed
 * nothing at all about the work he was standing in front of.
 *
 * Each row goes back to the tenant's thread, which is where the photograph of
 * the leak and the tenant's own words are. That is the loop the job and the
 * conversation were missing: from the job to what the plumber said, and from
 * what the plumber said back to what the tenant reported.
 */
export default function VendorJobs({ jobs }: { jobs: VendorJob[] }) {
  if (!jobs.length) return null;
  const late = jobs.filter((j) => dueState(j.dueAt) === "late").length;
  const worst = late ? "late"
    : jobs.some((j) => dueState(j.dueAt) === "soon") ? "soon" : "later";

  return (
    <div className={`openjobs due-${worst} vendorjobs`}>
      <button type="button" aria-expanded="true" disabled>
        <strong>
          Doing {jobs.length} {jobs.length === 1 ? "job" : "jobs"} for us
        </strong>
        {late > 0 && <span className="latecount">{late} late</span>}
      </button>
      <ul>
        {jobs.map((j) => (
          <li key={j.id} className={`due-${dueState(j.dueAt)}`}>
            <span className="js">
              {j.where && <strong>{j.where} — </strong>}
              {j.summary}
            </span>
            <span className="jd">{dueLabel(j.dueAt)}</span>
            {j.conversationId && (
              <span className="jv">
                <Link href={`/c/${j.conversationId}`}>Who reported it</Link>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
