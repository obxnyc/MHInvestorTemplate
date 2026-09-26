import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/supabase-server";
import { rmAuthorize, rmGet, rmDelete, rmPost, type RmCall, type RmWrite }
  from "@/lib/rentmanager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

/**
 * Can we create a property group, and what does it want?
 *
 * Two stages, and the first one touches nothing.
 *
 * "look" reads: does a groups endpoint exist, what shape is a group, and how
 * is membership represented. That alone usually answers most of it.
 *
 * "try" writes exactly one record -- a group named so obviously disposable
 * that nobody could mistake it for real -- reports what came back, and then
 * deletes it again. If the delete fails, it says so loudly, because a test
 * record left behind in somebody's live system is litter in the one place
 * you promised not to touch.
 *
 * Nothing here attaches properties to anything. Learning whether a create
 * works is a separate question from moving real records around, and mixing
 * them would mean the first write to a book of record is also the largest.
 */

const TEST_NAME = "ZZ DELETE ME — connection test";

export async function POST(req: Request) {
  const me = await requireStaff();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }

  const { stage } = await req.json().catch(() => ({}));
  const auth = await rmAuthorize();
  if (!auth.ok) {
    return NextResponse.json({ signedIn: false });
  }
  const session = auth.session;

  // ------------------------------------------------------------- looking
  const looked: RmCall[] = [];
  for (const path of [
    "/PropertyGroups?pagesize=2",
    "/PropertyGroups?pagesize=1&embeds=Properties",
    "/PropertyGroups?pagesize=1&embeds=PropertyGroupProperties",
    "/PropertyGroupProperties?pagesize=1",
  ]) {
    looked.push(await rmGet(path, session));
  }

  if (stage !== "try") {
    return NextResponse.json({ signedIn: true, stage: "look", looked });
  }

  // -------------------------------------------------------------- trying
  const tried: RmWrite[] = [];

  // Refused first, on purpose. A create with nothing in it usually comes
  // back naming the fields it actually wanted, which is the documentation
  // that could not be reached -- and it cannot succeed, so it cannot leave
  // anything behind.
  tried.push(await rmPost("/PropertyGroups", session, {}));

  // Then one real one, named so nobody could mistake it for a park.
  const made = await rmPost("/PropertyGroups", session, { Name: TEST_NAME });
  tried.push(made);

  let cleanedUp: RmWrite | null = null;
  let litter: string | null = null;
  if (made.ok) {
    if (made.id !== null) {
      cleanedUp = await rmDelete(`/PropertyGroups/${made.id}`, session);
      if (!cleanedUp.ok) {
        litter = `A group called "${TEST_NAME}" was created and could NOT be`
          + ` deleted (HTTP ${cleanedUp.status}). Delete it by hand in Rent`
          + ` Manager — Property Groups.`;
      }
    } else {
      litter = `A group called "${TEST_NAME}" was created but Rent Manager did`
        + ` not return its id, so it could not be deleted. Remove it by hand in`
        + ` Rent Manager — Property Groups.`;
    }
  }

  return NextResponse.json({
    signedIn: true, stage: "try", looked, tried, cleanedUp, litter,
    // Said plainly either way, because "did that leave something behind" is
    // the only question worth asking after a write probe.
    clean: made.ok ? (cleanedUp?.ok ?? false) : true,
  });
}
