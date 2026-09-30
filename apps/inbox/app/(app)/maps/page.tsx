import { requireStaff } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import BackLink from "@/components/BackLink";
import GisProbe from "@/components/GisProbe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Where the pictures behind the maps come from. */
export default async function Maps() {
  const me = await requireStaff();
  if (me?.role !== "admin") redirect("/");

  const key = Boolean(process.env.GOOGLE_MAPS_API_KEY);

  return (
    <main className="audit">
      <BackLink fallback="/settings" />
      <h1>Map sources</h1>
      <p className="muted">
        What sits behind the lots on a property map.
      </p>

      <ol className="rmsteps">
        <li className={key ? "done" : ""}>
          <h2>Aerial photography, everywhere</h2>
          <p>
            The default, and the one that needs no work per property: every
            property with a confirmed pin gets an aerial automatically. It is
            also what switches on the address suggestions when adding a
            property, and the &ldquo;is this the right spot?&rdquo; check —
            both of which are built and idle without it.
          </p>
          <p className="hint">
            {key
              ? "A Google Maps key is set on this deployment."
              : "No GOOGLE_MAPS_API_KEY on this deployment yet."}
          </p>
        </li>

        <li>
          <h2>Your county, which may be better</h2>
          <p>
            County flights are often more current than Google&rsquo;s, which
            matters most where the ground is changing month to month. And the
            county has the thing Google does not: the parcel boundaries — the
            actual legal edge of what you own, which is what makes a map
            clickable the way a listing site is.
          </p>
          <p>
            This asks the county&rsquo;s map site what it publishes. It reads
            public metadata and nothing else.
          </p>
          <GisProbe />
        </li>

        <li>
          <h2>Your own picture, where neither will do</h2>
          <p>
            1140 and 1800 Pamalee are being built, so every aerial of them
            shows dirt where the lots are going. For those, a plan or a drone
            photograph beats any flight. Not needed anywhere else — there is
            no expectation of a site plan per property.
          </p>
        </li>
      </ol>
    </main>
  );
}
