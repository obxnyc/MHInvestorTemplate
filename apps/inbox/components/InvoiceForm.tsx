"use client";
import { useState } from "react";

export type PriorInvoice = {
  id: string; amount: string; invoiceNo: string | null; submitted: string;
};

/**
 * A vendor billing for a job, from their own jobs page.
 *
 * Opens closed. Most visits to this page are to look at a photograph or mark
 * something done, and a form sitting open under every job turns the page into
 * paperwork.
 *
 * Submitting is final, and the form says so before it is pressed rather than
 * after. Nothing is hidden about that: once an amount is in, a change is a
 * correction that names what it replaced and why, and both are kept. The
 * honest version of this is more likely to get a correct number first time
 * than a form that implies it can be quietly fixed later.
 */
export default function InvoiceForm(
  { token, jobId, prior }:
  { token: string; jobId: string; prior: PriorInvoice | null },
) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const correcting = Boolean(prior);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null);
    const form = new FormData(e.currentTarget);
    form.set("jobId", jobId);
    if (prior) form.set("replaces", prior.id);

    const res = await fetch(`/api/jobs/${token}/invoice`, { method: "POST", body: form });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(out.error ?? "That didn't send. Try again."); return; }
    setDone(out.amount ?? "Sent");
  }

  if (done) {
    return (
      <p className="invdone">
        Invoice for <strong>{done}</strong> received. The office has it.
      </p>
    );
  }

  if (!open) {
    return (
      <div className="invrow">
        {prior && (
          <span className="invprior">
            Billed {prior.amount}
            {prior.invoiceNo ? ` · ${prior.invoiceNo}` : ""} on {prior.submitted}
          </span>
        )}
        <button type="button" className="invopen" onClick={() => setOpen(true)}>
          {correcting ? "Correct this invoice" : "Send an invoice"}
        </button>
      </div>
    );
  }

  return (
    <form className="invform" onSubmit={submit}>
      {correcting && (
        <p className="invwarn">
          This replaces your invoice for <strong>{prior!.amount}</strong>. The
          original stays on the record next to this one.
        </p>
      )}

      <label>
        Amount
        <input name="amount" inputMode="decimal" placeholder="380.00" required
               autoFocus autoComplete="off" />
      </label>

      <label>
        Invoice number <span className="opt">optional</span>
        <input name="invoiceNo" autoComplete="off" />
      </label>

      <label>
        What it was for <span className="opt">optional</span>
        <textarea name="description" rows={2}
                  placeholder="Reseated the toilet, new wax ring and flange" />
      </label>

      {correcting && (
        <label>
          What changed, and why
          <textarea name="reason" rows={2} required minLength={10}
                    placeholder="Quoted before the flange was found broken" />
        </label>
      )}

      <label>
        The invoice itself <span className="opt">a PDF or a photo</span>
        <input type="file" name="file" accept="application/pdf,image/*" />
      </label>

      <p className="invfinal">
        Once this is sent it cannot be edited. If something needs changing,
        send a correction and both are kept.
      </p>

      {error && <p className="err">{error}</p>}

      <div className="invacts">
        <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
        <button type="submit" className="btn pri" disabled={busy}>
          {busy ? "Sending…" : correcting ? "Send correction" : "Send invoice"}
        </button>
      </div>
    </form>
  );
}
