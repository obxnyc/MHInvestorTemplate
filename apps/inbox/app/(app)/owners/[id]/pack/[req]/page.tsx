import Link from "next/link";
import PrintThis from "@/components/PrintThis";
import { notFound, redirect } from "next/navigation";
import { canSeeOffice } from "@/lib/roles";
import { requireStaff, supabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/**
 * A pack that has already gone out, read back as it stands.
 *
 * A PAGE AND NOT A FILE. The first version handed the frozen HTML over
 * as a blob and opened it in a tab -- which arrives with no stylesheet
 * and no charset, so sixteen contracts rendered as
 * "SELLER:SignatureLarabee Homes LLC" with every curly quote turned into
 * `â€œ`. The pack is a fragment of a document, not a document: it has
 * always depended on `.paper` in globals.css for its margins, its page
 * breaks and its signature lines, exactly as the preview and the
 * investor's own signing page do.
 *
 * So it is rendered here, inside the app, where that stylesheet is --
 * and the charset is the framework's problem rather than mine.
 *
 * The signed copy where there is one, because once signed that IS the
 * document; the unsigned one before that, so "what did we actually send
 * them" stays answerable. Nothing on this page can change either: it is
 * read out of the frozen column and written back nowhere.
 */
export default async function PackPage(
  { params }: { params: Promise<{ id: string; req: string }> },
) {
  const staff = await requireStaff();
  if (!staff || !canSeeOffice(staff.role)) redirect("/");

  const { id, req } = await params;
  const supabase = await supabaseServer();

  /* Scoped to this owner AND this request. An id lifted from another
     investor's deal reads back nothing rather than their contract. */
  const { data, error } = await supabase
    .from("signing_requests")
    /* ONE STRING LITERAL. The client infers the row type from the text
       of the select, so a joined string turns every field on the result
       into an error rather than a column -- which typechecks as far as
       the query and then fails on every read. It is in CLAUDE.md and I
       did it again. */
    .select("title, pack, signed_pack, signed_at, signed_name, sent_at, to_name, voided_at")
    .eq("owner_id", id).eq("id", req).maybeSingle();

  if (error || !data) notFound();

  const signed = !!data.signed_at;
  const body = (data.signed_pack ?? data.pack) as string;
  const when = (d: string) => new Date(d).toLocaleString("en-US",
    { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="parkpage">
      <header className="parkhead noprint">
        <h1>{data.title}</h1>
        <span className="parkkept">
          {signed
            ? `Signed by ${data.signed_name ?? data.to_name}, `
              + `${when(data.signed_at as string)}`
            : data.voided_at
              ? `Withdrawn ${when(data.voided_at as string)} — this is what `
                + "had been sent"
              : `Sent to ${data.to_name}, ${when(data.sent_at as string)}, `
                + "not signed yet"}
        </span>
        <div className="parkacts">
          <PrintThis name={`${data.title} — ${data.to_name}`} />
          <Link className="btn" href={`/owners/${id}`}>Back to the investor</Link>
        </div>
      </header>

      {/* WHAT IS ON SCREEN IS THE FROZEN FILE. Not rebuilt from the terms
          and not re-rendered from `papers.ts`: this is the text that was
          sent, or the text that was signed, byte for byte. */}
      <p className="dim noprint">
        {signed
          ? "This is the signed copy, exactly as it was signed. Nothing in"
            + " the app can change it, and the link it went out on opens"
            + " this same copy for them, for good."
          : "This is the copy that was sent, frozen at the moment it went."
            + " Changing the terms on the investor's page does not change"
            + " it."}
        {" "}<strong>Save as PDF</strong> opens the print dialog; choose
        {" "}Save as PDF as the destination. Clear
        {" "}<strong>Headers and footers</strong> in that dialog once and the
        {" "}browser remembers it — otherwise it writes the date and the web
        {" "}address into the margin of a contract.
      </p>

      {/* `sheets` draws the separators papers.ts already puts between
          the documents as the edges of a page, so sixteen contracts read
          as sixteen sheets rather than one continuous roll of white. */}
      <div className="paper sheets"
           dangerouslySetInnerHTML={{ __html: body }} />
    </div>
  );
}
