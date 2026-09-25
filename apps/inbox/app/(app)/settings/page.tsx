import Link from "next/link";
import { requireStaff } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import BackLink from "@/components/BackLink";

export const dynamic = "force-dynamic";

/** Everything that is not the inbox.
 *
 *  One page rather than a dropdown, because a dropdown of eight things is a
 *  list nobody reads and a page can say what each one is for. Filtered by role:
 *  a maintenance tech has no business being shown a link to court filings and
 *  then refused it. */
export default async function Settings() {
  const staff = await requireStaff();
  if (!staff) redirect("/login");
  const admin = staff.role === "admin";
  const office = admin || staff.role === "office";

  const groups: [string, [string, string, string, boolean][]][] = [
    ["Your account", [
      ["/account", "Your sign-in", "Set a password, see what access you have", true],
    ]],
    ["The business", [
      ["/people", "People", "Staff, field staff, the trade directory and who's asked for access", office],
      ["/jobs", "Jobs & costs", "What's outstanding, what it cost, what that work usually runs", office],
      ["/calls", "Calls", "Every call, with recordings and voicemail transcripts", true],
    ]],
    ["Records", [
      ["/legal", "Court filings", "Eviction filings, admin only", admin],
      ["/audit", "Audit trail", "Every change, written by the database itself", admin],
      ["/setup", "Setup check", "Whether everything is actually wired up", admin],
    ]],
  ];

  return (
    <main className="people">
      <BackLink />
      <h1 className="pagetitle">Settings</h1>
      <p className="muted">Signed in as {staff.full_name}.</p>

      {groups.map(([heading, items]) => {
        const shown = items.filter(([, , , allowed]) => allowed);
        if (!shown.length) return null;
        return (
          <section key={heading} className="setgroup">
            <h2>{heading}</h2>
            <ul className="setlist">
              {shown.map(([href, label, what]) => (
                <li key={href}>
                  <Link href={href}>
                    <span className="setname">{label}</span>
                    <span className="setwhat">{what}</span>
                    <span className="setgo" aria-hidden="true">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </main>
  );
}
