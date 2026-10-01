import Link from "next/link";
import { timeAgo } from "@/lib/format";
import { jobStatus, jobTone, urgencyLabel, byWorst, type JobRow } from "@/lib/jobs";

/**
 * Every repair that is still open, on the screen people actually start their
 * day on.
 *
 * The count was already on the dashboard and a count is not an answer: "11
 * open" tells you there is work and nothing about which work. This says the
 * three things somebody asks next -- where it is, what is wrong, and what is
 * happening about it -- and puts the worst at the top.
 *
 * Where a job came from a text, the row opens that thread rather than a job
 * record, because the thread is where the tenant's photograph and their words
 * are, and that is what you need before you ring anybody.
 */
export default function MaintenanceBox({ jobs }: { jobs: JobRow[] }) {
  const sorted = [...jobs].sort(byWorst());
  const shown = sorted.slice(0, 12);
  const now = Date.now();

  return (
    <section className="dashgroup">
      <h2>
        Maintenance <span className="cnt">{jobs.length}</span>
        {jobs.length > shown.length && (
          <Link href="/jobs" className="allof">See all {jobs.length}</Link>
        )}
      </h2>

      {shown.length === 0 ? (
        <p className="dashnone">
          Nothing open. Anything reported by text, by email or from the tenant
          portal lands here.
        </p>
      ) : (
        <ul className="joblist">
          {shown.map((j) => {
            const late = j.scheduledFor !== null
              && new Date(j.scheduledFor).getTime() < now;
            const flag = urgencyLabel(j.urgency);
            const row = (
              <>
                {/* Where, first and in bold. A repair is a place before it is
                    anything else -- you cannot act on "no hot water" until you
                    know whose. */}
                <span className="jwhere">{j.where ?? "Address not set"}</span>
                <span className="jwhat">{j.summary}</span>
                <span className="jtags">
                  {flag && <span className="badge jurgent">{flag}</span>}
                  {late && <span className="badge jlate">Past due</span>}
                  <span className={`badge j-${jobTone(j.status)}`}>
                    {jobStatus(j.status)}
                  </span>
                </span>
                <span className="jwhen">{timeAgo(j.createdAt)}</span>
              </>
            );
            return (
              <li key={j.id} className={late || j.urgency === 1 ? "hot" : ""}>
                {j.conversationId
                  ? <Link href={`/c/${j.conversationId}`}>{row}</Link>
                  : <span className="nolink">{row}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
