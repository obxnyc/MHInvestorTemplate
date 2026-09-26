import { requireStaff } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import BackLink from "@/components/BackLink";
import RentManagerProbe from "@/components/RentManagerProbe";
import RmGroups from "@/components/RmGroups";
import RmWriteProbe from "@/components/RmWriteProbe";
import { rmSettings, candidateBases } from "@/lib/rentmanager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Getting Rent Manager connected, and finding out what it will give us. */
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
            Three settings in Vercel, on the project, then a redeploy —{" "}
            <code>RENTMANAGER_COMPANY</code>,{" "}
            <code>RENTMANAGER_USERNAME</code> and{" "}
            <code>RENTMANAGER_PASSWORD</code>. The company code is the word in
            front of <code>.rmx.rentmanager.com</code> when you are logged in.
          </p>
          <p className="hint">
            {s
              ? `Present, for company "${s.company}".`
              : "Not set yet. Nothing below will run until they are."}
          </p>
        </li>

        <li>
          <h2>Find the door</h2>
          <p>
            Express serves its web app and its API from different places, and
            which is which is not something that can be looked up from here.
            So this tries each likely address in turn, and each way the token
            header is spelled, and reports which combination answered.
            {s && " No need to guess it by hand:"}
          </p>
          {s && (
            <ul className="rmtry">
              {candidateBases(s.company).map((b) => <li key={b}><code>{b}</code></li>)}
            </ul>
          )}
          <p className="hint">
            Override it with <code>RENTMANAGER_BASE_URL</code> if the real one
            turns out to be somewhere else entirely.
          </p>
        </li>

        <li>
          <h2>See what answers</h2>
          <p>
            Once signed in it knocks on every endpoint an import would need,
            fetching a single record from each and showing only the field
            names — which is what tells us how their data maps onto ours. No
            resident information is pulled.
          </p>
          <RentManagerProbe />
        </li>

        <li>
          <h2>Say what each group is</h2>
          <p>
            A lot in a park is its own property in Rent Manager, because the
            home standing on it has an owner and distributions run per owner.
            The park itself is a <em>group</em>. But so is a company, so is
            the management book, and so is a filter like
            &ldquo;Non-Musgrove&rdquo; — they are the same kind of record over
            there, and only you can tell them apart.
          </p>
          <RmGroups />
        </li>

        <li>
          <h2>Could we create a group ourselves?</h2>
          <p>
            A park being redeveloped has no group yet, and making one by hand
            is a job that will recur. Before writing anything real to Rent
            Manager — which nothing here has ever done — this finds out
            whether their groups endpoint accepts a create, and what it wants.
          </p>
          <RmWriteProbe />
        </li>

        <li>
          <h2>Then the import</h2>
          <p>
            Built against what step three actually finds rather than against
            the documentation. Properties and units first — keeping Rent
            Manager&rsquo;s own codes, since those are already on the leases
            and the invoices — then the people, then balances. Read-only.
            Nothing is written back to Rent Manager.
          </p>
        </li>
      </ol>
    </main>
  );
}
