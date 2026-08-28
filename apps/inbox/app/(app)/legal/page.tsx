import { requireStaff, supabaseServer } from "@/lib/supabase-server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Admin only, enforced twice: here, and by row-level security on the table. */
export default async function Legal() {
  const staff = await requireStaff();
  if (staff?.role !== "admin") redirect("/");

  const supabase = await supabaseServer();
  const { data: filings } = await supabase.from("court_filings")
    .select("*").order("created_at", { ascending: false }).limit(100);

  const today = new Date();
  return (
    <main className="audit">
      <h1>Court filings</h1>
      <p className="muted">
        eFiling notices from the NC courts. Admins only, and kept out of the
        shared inbox on purpose.
      </p>
      <div className="scroller">
        <table>
          <thead>
            <tr><th>Case</th><th>Filing</th><th>Status</th><th>Defendant</th><th>Document</th></tr>
          </thead>
          <tbody>
            {filings?.map((f) => {
              const expires = f.document_expires_on ? new Date(f.document_expires_on) : null;
              const daysLeft = expires
                ? Math.round((expires.getTime() - today.getTime()) / 864e5) : null;
              return (
                <tr key={f.id}>
                  <td><code>{f.case_number}</code><br /><span className="muted">{f.plaintiff}</span></td>
                  <td>{f.filing_type}</td>
                  <td>{f.status}</td>
                  <td>{f.defendant}</td>
                  <td>
                    {f.document_url
                      ? <a href={f.document_url} target="_blank" rel="noreferrer">{f.lead_file ?? "Stamped copy"}</a>
                      : <span className="muted">&mdash;</span>}
                    {daysLeft !== null && (
                      <div className={daysLeft < 14 ? "unclaimed" : "muted"} style={{ fontSize: ".72rem" }}>
                        {daysLeft > 0 ? `link expires in ${daysLeft}d` : "link expired"}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {!filings?.length && <tr><td colSpan={5} className="muted">No filings recorded.</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
