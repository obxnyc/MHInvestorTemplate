import { requireStaff } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import BackLink from "@/components/BackLink";
import RentManagerProbe from "@/components/RentManagerProbe";
import { rmSettings } from "@/lib/rentmanager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Getting Rent Manager connected, and seeing what it will give us. */
export default async function RentManager() {
  const me = await requireStaff();
  if (me?.role !== "admin") redirect("/");

  const s = rmSettings();

  return (
    <main className="audit">
      <BackLink fallback="/settings" />
      <h1>Rent Manager</h1>
      <p className="muted">
        Leases, rent, balances and invoices live over there. This is the
        connection to them.
      </p>

      <ol className="rmsteps">
        <li className={s ? "done" : ""}>
          <h2>Credentials on the deployment</h2>
          <p>
            Three settings in Vercel, on the project, then a redeploy:
            {" "}<code>RENTMANAGER_BASE_URL</code>,{" "}
            <code>RENTMANAGER_USERNAME</code> and{" "}
            <code>RENTMANAGER_PASSWORD</code>. Add{" "}
            <code>RENTMANAGER_LOCATION_ID</code> only if 1 turns out to be wrong.
          </p>
          <p className="hint">
            {s
              ? `Present. Pointing at ${s.base}.`
              : "Not set yet. Nothing below will run until they are."}
          </p>
        </li>

        <li>
          <h2>Find out what answers</h2>
          <p>
            This signs in and knocks on every endpoint an import would need.
            It fetches a single record from each and shows only the field
            names — which is what tells us how their data maps onto ours.
            No resident information is pulled.
          </p>
          <RentManagerProbe />
        </li>

        <li>
          <h2>Then the import</h2>
          <p>
            Built against whatever step two finds, rather than against the
            documentation: properties and units first, then leases and the
            people on them, then balances. Read-only to begin with. Nothing
            is written back to Rent Manager until you say so.
          </p>
        </li>
      </ol>
    </main>
  );
}
