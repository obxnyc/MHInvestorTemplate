import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { signMedia } from "@/lib/media";
import { dueState, dueLabel } from "@/lib/dispatch";
import JobDone from "@/components/JobDone";

export const dynamic = "force-dynamic";

/**
 * A contractor's open jobs.
 *
 * No sign-in. The link is the credential, texted once when the first job is
 * dispatched. That is a deliberate trade: ask a plumber to create an account
 * and set a password and the completion photo never arrives, and then the
 * evidence rule the database enforces becomes a rule everyone routes around --
 * which is worse than not having the rule.
 *
 * What the token buys is narrow. It lists one vendor's jobs and accepts photos
 * against them. It reads no tenant history, no other vendor's work, and no
 * contact details beyond the address of the job itself.
 */
export default async function Jobs({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Length-checked before it reaches the database: a one-character token is
  // not a near miss, it is someone trying the door.
  if (!token || token.length < 32) notFound();

  const db = supabaseAdmin();
  const { data: vendor } = await db
    .from("contacts").select("id, full_name, phone").eq("jobs_token", token).maybeSingle();
  if (!vendor) notFound();

  const { data: jobs } = await db
    .from("work_orders")
    .select("id, summary, detail, status, due_at, created_at, reported_photos, completion_photos, units(label, properties(name))")
    .eq("assigned_vendor", vendor.id)
    .neq("status", "done")
    .order("due_at", { ascending: true, nullsFirst: false });

  const signed = await signMedia(
    db, (jobs ?? []).flatMap((j) => (j.reported_photos ?? []) as string[]), 900,
  );

  return (
    <main className="jobs">
      <p className="brand">Larabee Homes</p>
      <h1>Your open jobs</h1>
      <p className="lede">
        {vendor.full_name ? `${vendor.full_name} — ` : ""}
        {jobs?.length
          ? `${jobs.length} job${jobs.length === 1 ? "" : "s"} outstanding.`
          : "Nothing outstanding. Thanks."}
      </p>

      <ul className="joblist">
        {jobs?.map((j) => {
          const unit = j.units as unknown as
            { label: string | null; properties: { name: string } | null } | null;
          const where = unit
            ? [unit.properties?.name, unit.label].filter(Boolean).join(" · ")
            : null;
          const state = dueState(j.due_at);
          return (
            <li key={j.id} className={`job due-${state}`}>
              <div className="jobtop">
                {where && <span className="jobwhere">{where}</span>}
                <span className={`duepill due-${state}`}>{dueLabel(j.due_at)}</span>
              </div>
              <p className="jobsum">{j.summary}</p>
              {j.detail && <p className="jobdetail">{j.detail}</p>}

              {!!(j.reported_photos as string[])?.length && (
                <div className="jobshots">
                  {(j.reported_photos as string[]).map((path, i) => {
                    const src = signed.get(path);
                    return src ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={path} src={src} alt={`Reported ${i + 1}`} />
                    ) : null;
                  })}
                </div>
              )}

              <JobDone token={token} jobId={j.id} />
            </li>
          );
        })}
      </ul>

      <p className="fineprint">
        This link is personal to you. Anyone who has it can see these jobs, so
        please don&rsquo;t forward it on.
      </p>
    </main>
  );
}
