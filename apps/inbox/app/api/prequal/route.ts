import { NextResponse } from "next/server";
import { randomBytes, randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { toE164 } from "@/lib/twilio";
import { evaluate, declineMessage, type Answers, type RuleSet } from "@/lib/prequal";
import { pushToTeam } from "@/lib/push";
import { sendSms, sendEmail } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors() });
}

/**
 * Public prequalification submission.
 *
 * Three outcomes, decided by the ruleset and nothing else:
 *   auto_approve  -> booking link, no human involved
 *   manual_review -> leasing queue with reason codes attached
 *   declined      -> criteria-based explanation
 *
 * The applicant's raw answers are stored untouched so any decision can be
 * replayed against the ruleset version that produced it.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "bad request" }, { status: 400, headers: cors() });
  if (body.company) return NextResponse.json({ ok: true }, { headers: cors() }); // honeypot

  const db = supabaseAdmin();
  const phone = body.phone ? toE164(String(body.phone)) : null;
  const email = body.email ? String(body.email).trim() : null;
  const name = String(body.name ?? "").trim() || null;
  if (!phone && !email) {
    return NextResponse.json({ error: "phone or email required" }, { status: 400, headers: cors() });
  }

  const { data: unit } = await db.from("units")
    .select("id, label, monthly_rent, properties(name, address)")
    .eq("id", body.unit_id).maybeSingle();
  if (!unit?.monthly_rent) {
    return NextResponse.json({ error: "choose a home" }, { status: 400, headers: cors() });
  }
  const prop = unit.properties as unknown as { name: string; address: string | null };
  const address = `${prop.name}${unit.label ? ` — ${unit.label}` : ""}`;

  const { data: rs } = await db.from("prequal_rule_sets")
    .select("id, version, criteria").is("effective_to", null)
    .order("version", { ascending: false }).limit(1).maybeSingle();
  if (!rs) return NextResponse.json({ error: "no active ruleset" }, { status: 503, headers: cors() });

  const answers: Answers = {
    monthly_income: num(body.monthly_income),
    other_monthly_income: num(body.other_monthly_income),
    household_income: num(body.household_income),
    monthly_assistance: num(body.monthly_assistance),
    rent: Number(unit.monthly_rent),
    credit_score: body.credit_score === "" || body.credit_score == null ? null : num(body.credit_score),
    rental_history_months: num(body.rental_history_months),
    years_since_eviction: body.eviction === "never" || body.years_since_eviction == null
      || body.years_since_eviction === "" ? null : num(body.years_since_eviction),
    has_cosigner: !!body.has_cosigner,
  };

  const result = evaluate(answers, rs.criteria as unknown as RuleSet);

  // Contact, keyed on phone so this merges with any text thread they start.
  let contact: { id: string } | null = null;
  if (phone) {
    const { data } = await db.from("contacts").select("id").eq("phone", phone).maybeSingle();
    contact = data;
  }
  if (!contact && email) {
    const { data } = await db.from("contacts").select("id").eq("email", email).maybeSingle();
    contact = data;
  }
  if (!contact) {
    const { data } = await db.from("contacts").insert({
      phone: phone ?? `email:${email}`, email, full_name: name, party: "prospect",
    }).select("id").single();
    contact = data!;
  } else {
    await db.from("contacts").update({
      full_name: name ?? undefined, email: email ?? undefined, party: "prospect",
    }).eq("id", contact.id);
  }

  const token = result.outcome === "auto_approve" ? randomBytes(24).toString("base64url") : null;

  const { data: sub } = await db.from("prequal_submissions").insert({
    contact_id: contact.id,
    unit_id: unit.id,
    answers: body,
    gross_monthly_income: result.countedIncome,
    assistance_monthly: answers.monthly_assistance,
    tenant_share_rent: result.tenantShareRent,
    rule_set_id: rs.id,
    outcome: result.outcome,
    criterion_results: result.results,
    reason_codes: result.reasonCodes,
    booking_token: token,
  }).select("id").single();

  const criteriaUrl = `${process.env.PUBLIC_BASE_URL}/criteria`;

  if (result.outcome === "auto_approve") {
    const link = `${process.env.PUBLIC_BASE_URL}/book/${token}`;
    const text = `Larabee Homes: you're prequalified for ${address}. `
      + `Pick a showing time here: ${link}`;
    if (phone) await sendSms(phone, text);
    if (email) await sendEmail(email, `Book a showing — ${address}`, text);
    return NextResponse.json({ outcome: result.outcome, bookingUrl: link }, { headers: cors() });
  }

  if (result.outcome === "declined") {
    const text = declineMessage(result, address, criteriaUrl);
    if (email) await sendEmail(email, `Your interest in ${address}`, text);
    else if (phone) await sendSms(phone, text.split("\n").filter(Boolean).slice(0, 4).join(" "));
    return NextResponse.json({ outcome: result.outcome, message: text }, { headers: cors() });
  }

  // manual_review: open a thread so the leasing team sees it with the reasons.
  const { data: team } = await db.from("teams").select("id").eq("category", "prospect").maybeSingle();
  const short = result.results.filter((r) => r.verdict !== "pass")
    .map((r) => `${r.label}: ${r.value ?? "not provided"}`).join("; ");
  const { data: convo } = await db.from("conversations").insert({
    contact_id: contact.id, category: "prospect", team_id: team?.id ?? null,
    source: "website", subject: `Review — ${name ?? phone ?? email} for ${address}`,
  }).select("id").single();
  await db.from("messages").insert({
    conversation_id: convo!.id, direction: "inbound", channel: "website",
    external_id: `prequal:${sub!.id ?? randomUUID()}`,
    body: `Prequalification needs review for ${address}.\n\nShort on: ${short}\n\n`
        + `Income counted $${result.countedIncome}/mo against a tenant share of `
        + `$${result.tenantShareRent} (${result.incomeRatio}x).`
        + (answers.has_cosigner ? `\nApplicant says a co-signer is available.` : ""),
    status: "received",
  });
  await pushToTeam(team?.id ?? null, {
    title: `Review needed — ${name ?? "applicant"}`,
    body: short.slice(0, 140),
    url: `/c/${convo!.id}`,
    tag: `prequal:${sub!.id}`,
  });

  return NextResponse.json({ outcome: result.outcome }, { headers: cors() });
}

function cors(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": process.env.WEBSITE_ORIGIN ?? "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
