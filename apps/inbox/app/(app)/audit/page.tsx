import { supabaseServer, requireStaff } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

/** The audit log is written by database triggers, not by this application, so
 *  a missed call site in the code cannot leave a hole in it. This page only
 *  reads. */
export default async function Audit() {
  const staff = await requireStaff();
  if (staff?.role !== "admin") redirect("/");

  const supabase = await supabaseServer();
  const { data: rows } = await supabase
    .from("audit_log")
    .select("id, entity, action, changed, occurred_at, staff:actor_id(full_name)")
    .order("occurred_at", { ascending: false })
    .limit(200);

  return (
    <main className="audit">
      <h1>Audit trail</h1>
      <p className="muted">
        Every change, written by database trigger. Last 200 events.
      </p>
      <div className="scroller">
        <table>
          <thead>
            <tr><th>When</th><th>Who</th><th>What</th><th>Change</th></tr>
          </thead>
          <tbody>
            {rows?.map((r) => {
              const who = r.staff as unknown as { full_name: string } | null;
              return (
                <tr key={r.id}>
                  <td className="num">{timeAgo(r.occurred_at)}</td>
                  <td>{who?.full_name ?? <em className="muted">system</em>}</td>
                  <td><code>{r.action}</code> {r.entity}</td>
                  <td className="change">{summarize(r.changed)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}

/** Updates store {column: [before, after]}; inserts store the whole row. Show
 *  the fields a person would actually ask about. */
function summarize(changed: unknown): string {
  if (!changed || typeof changed !== "object") return "";
  const interesting = ["assigned_to", "status", "category", "team_id", "party", "outcome", "granted"];
  const out: string[] = [];
  for (const [k, v] of Object.entries(changed as Record<string, unknown>)) {
    if (!interesting.includes(k)) continue;
    if (Array.isArray(v) && v.length === 2) out.push(`${k}: ${fmt(v[0])} → ${fmt(v[1])}`);
    else out.push(`${k}: ${fmt(v)}`);
  }
  return out.join(" · ") || "—";
}
const fmt = (v: unknown) => (v === null || v === undefined ? "none" : String(v).slice(0, 24));
