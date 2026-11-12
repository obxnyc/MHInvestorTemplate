import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { BUCKET, MAX_KEEP_BYTES, keepableExtension, safeName } from "@/lib/media";
import { parseMoney, money } from "@/lib/invoices";
import { mailList } from "@/lib/mail-list";
import { sendEmailChecked } from "@/lib/notify";

export const runtime = "nodejs";

/**
 * A vendor's invoice, submitted from their own jobs page.
 *
 * No account, same as everything else on that page: the link is the
 * credential. What it buys stays narrow -- this accepts an invoice against a
 * job that is already assigned to the holder of the token, and nothing else.
 * A token for one vendor cannot invoice another vendor's work.
 *
 * Submitting is final. A correction is a new row naming the one it replaces
 * and saying why, which the database enforces; there is no edit here because
 * there is no edit anywhere.
 */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  // Length-checked before it reaches the database: a one-character token is
  // not a near miss, it is somebody trying the door.
  if (!token || token.length < 32) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const db = supabaseAdmin();
  const { data: vendor } = await db
    .from("contacts").select("id, full_name").eq("jobs_token", token).maybeSingle();
  if (!vendor) return NextResponse.json({ error: "not found" }, { status: 404 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected a form" }, { status: 400 });
  }

  const jobId = String(form.get("jobId") ?? "");
  const amount = parseMoney(String(form.get("amount") ?? ""));
  const invoiceNo = String(form.get("invoiceNo") ?? "").trim() || null;
  const description = String(form.get("description") ?? "").trim() || null;
  const replaces = String(form.get("replaces") ?? "").trim() || null;
  const reason = String(form.get("reason") ?? "").trim() || null;

  if (amount === null) {
    return NextResponse.json({
      error: "That doesn't look like an amount. Try something like 380 or 380.50.",
    }, { status: 400 });
  }

  // The job has to be theirs. Checked against assigned_vendor rather than
  // merely existing, or a token would be a licence to invoice any job in the
  // system by guessing its id.
  const { data: job } = await db.from("work_orders")
    .select("id, summary, unit_id, units(label, properties(name))")
    .eq("id", jobId).eq("assigned_vendor", vendor.id).maybeSingle();
  if (!job) return NextResponse.json({ error: "that job isn't yours" }, { status: 404 });

  // A correction must name a row on this same job, and the database will
  // refuse it without a reason. Checked here too so the vendor gets a
  // sentence rather than a constraint violation.
  if (replaces) {
    if (!reason || reason.trim().length < 10) {
      return NextResponse.json({
        error: "Say what changed and why — a sentence is enough.",
      }, { status: 400 });
    }
    const { data: prior } = await db.from("vendor_invoices")
      .select("id").eq("id", replaces).eq("work_order_id", jobId).maybeSingle();
    if (!prior) {
      return NextResponse.json({ error: "that invoice isn't on this job" }, { status: 400 });
    }
  }

  // The file is optional. A number with no paperwork is still a number, and
  // refusing it would mean the amount never gets recorded at all.
  let filePath: string | null = null;
  const file = form.get("file");
  if (file instanceof File && file.size > 0) {
    const ext = keepableExtension(file.type || "");
    if (!ext) {
      return NextResponse.json({
        error: "We can take a PDF or a photo of the invoice.",
      }, { status: 400 });
    }
    if (file.size > MAX_KEEP_BYTES) {
      return NextResponse.json({ error: "That file is over 25 MB." }, { status: 400 });
    }
    filePath = `invoices/${jobId}/${randomUUID()}-${safeName(file.name || "invoice", ext)}`;
    const { error } = await db.storage.from(BUCKET)
      .upload(filePath, new Uint8Array(await file.arrayBuffer()),
              { contentType: file.type.split(";")[0].trim(), upsert: false });
    if (error) {
      console.error("invoice upload failed", { jobId, error });
      return NextResponse.json({ error: "The file didn't upload. Try again." }, { status: 500 });
    }
  }

  const { data: row, error } = await db.from("vendor_invoices").insert({
    work_order_id: jobId,
    vendor_id: vendor.id,
    amount_cents: amount,
    invoice_no: invoiceNo,
    description,
    file_path: filePath,
    replaces, reason,
    by_vendor: true,
  }).select("id").single();
  if (error) {
    console.error("invoice insert failed", { jobId, error });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Emailed on arrival, and the send is not allowed to fail the submission.
  // A bookkeeper who did not get the email can be sent it again; an invoice
  // the vendor was told did not save is one they stop bothering to submit.
  const unit = job.units as unknown as
    { label: string; properties: { name: string } | null } | null;
  const where = unit
    ? [unit.properties?.name, unit.label].filter(Boolean).join(" · ")
    : "address not set";

  /* A list that could not be read must not look like a list of nobody: the
     invoice is already saved and the vendor is already told it was, so a
     failure here is logged and the send is skipped rather than the row being
     reported as emailed. */
  let to: string[] = [];
  let emailed = true;
  try {
    ({ to } = await mailList(db, "invoices", process.env.BOOKKEEPER_EMAIL));
  } catch (e) {
    console.error("invoice saved but the recipient list could not be read",
      { id: row.id, detail: (e as Error).message });
  }
  if (to.length) {
    const lines = [
      `${vendor.full_name ?? "A vendor"} submitted an invoice.`,
      "",
      `Amount:   ${money(amount)}`,
      invoiceNo ? `Invoice:  ${invoiceNo}` : null,
      `Job:      ${job.summary}`,
      `Where:    ${where}`,
      description ? `For:      ${description}` : null,
      filePath ? "A file was attached; it is on the job in Larabee Inbox." : "No file attached.",
      "",
      replaces
        ? `This REPLACES an earlier invoice on the same job. Reason given: ${reason}`
        : "This is the first invoice on this job.",
      "",
      "Invoices cannot be edited. Any change arrives as another email like this"
      + " one, naming what it replaced and why.",
    ].filter((l) => l !== null);

    // One call with every recipient on it, so they can see each other and
    // reply to each other rather than three people each assuming one of the
    // others has dealt with it.
    /* `sendEmail` swallows everything, so `emailed_at` was stamped whether
       or not an email went -- and with POSTMARK_SERVER_TOKEN unset it went
       for eleven days without one ever being sent. The row then says the
       bookkeeper was told, which is the one claim that must be true.

       `sendEmailChecked` says what happened. The stamp follows the answer,
       and a refusal is logged with Postmark's own words rather than being
       re-derived later from a guess. Same rule as the composer that cleared
       itself before reading the reply: a send that failed must not look like
       a send that worked. */
    const sent = await sendEmailChecked(to,
      `${replaces ? "Corrected invoice" : "Invoice"} — ${money(amount)} — ${where}`,
      lines.join("\n"));
    if (sent.ok) {
      await db.from("vendor_invoices")
        .update({ emailed_at: new Date().toISOString() }).eq("id", row.id);
    } else {
      emailed = false;
      console.error("invoice saved but not emailed",
        { id: row.id, to, detail: sent.detail });
    }
  } else {
    emailed = false;
    console.warn("invoice submitted but nobody is on the invoices list",
      { id: row.id });
  }

  /* What the vendor is told is what actually happened. The invoice is saved
     either way and that is what matters to them, but reporting a send that
     did not happen is how a bookkeeper is believed to have been told. */
  return NextResponse.json({ ok: true, id: row.id, amount: money(amount), emailed });
}
