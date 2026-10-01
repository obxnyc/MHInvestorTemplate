import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { BUCKET, MAX_KEEP_BYTES, keepableExtension, safeName } from "@/lib/media";
import { parseMoney, money, recipients } from "@/lib/invoices";
import { sendEmail } from "@/lib/notify";

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

  const to = recipients(process.env.BOOKKEEPER_EMAIL);
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
    await sendEmail(to.join(", "),
      `${replaces ? "Corrected invoice" : "Invoice"} — ${money(amount)} — ${where}`,
      lines.join("\n"));
    await db.from("vendor_invoices")
      .update({ emailed_at: new Date().toISOString() }).eq("id", row.id);
  } else {
    console.warn("invoice submitted but BOOKKEEPER_EMAIL is not set", { id: row.id });
  }

  return NextResponse.json({ ok: true, id: row.id, amount: money(amount), emailed: to.length });
}
