import { NextResponse } from "next/server";
import { requireStaff, supabaseServer } from "@/lib/supabase-server";
import { rank, didYouMean, type Candidate } from "@/lib/fuzzy";
import { money } from "@/lib/prices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the search bar finds in the database.
 *
 * The pages and the arithmetic are answered on the handset without asking
 * anybody, because they are instant and this runs on every keystroke. What
 * needs a round trip is the things: parks, lots, owners, people, jobs.
 *
 * And the reports. "Rent roll" is not a page anybody can click to -- it is a
 * question with a number for an answer, and typing it is how most people
 * would ask. So a handful of the questions this business asks every day are
 * answered inline, with a link to the screen that shows the working.
 */

export type Found = {
  kind: "place" | "lot" | "owner" | "person" | "job" | "report";
  id: string;
  title: string;
  sub?: string;
  href: string;
  /** For a report: the answer itself, already in words. */
  answer?: string;
};

export async function GET(req: Request) {
  const me = await requireStaff();
  if (!me) return NextResponse.json({ error: "sign in" }, { status: 401 });

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ results: [], meant: null });

  const db = await supabaseServer();

  const [props, units, owners, people, jobs] = await Promise.all([
    db.from("properties").select("id, name, address"),
    db.from("units").select("id, label, is_vacant, monthly_rent, properties(id, name)"),
    db.from("owners").select("id, name"),
    db.from("contacts").select("id, full_name, phone, party").limit(500),
    db.from("work_orders").select("id, summary, status, units(label, properties(name))")
      .not("status", "in", "(done,cancelled)"),
  ]);

  const cands: Candidate<Found>[] = [];

  for (const p of props.data ?? []) {
    cands.push({
      item: { kind: "place", id: String(p.id), title: String(p.name),
              sub: (p.address as string | null) ?? "Property",
              href: `/properties` },
      text: String(p.name),
      also: [(p.address as string | null) ?? ""].filter(Boolean),
    });
  }

  for (const u of units.data ?? []) {
    const park = (u.properties as unknown as { name: string } | null)?.name ?? "";
    cands.push({
      item: {
        kind: "lot", id: String(u.id),
        title: `${park} ${u.label}`.trim(),
        sub: u.is_vacant ? "Empty" : "Let",
        href: `/properties`,
      },
      // The lot NUMBER is its own name; the park is a way of finding it.
      // Scored as an alias so a lot called 12 beats a park called 12th
      // Street when somebody types 12.
      text: String(u.label),
      also: [park, `${park} ${u.label}`.trim()].filter(Boolean),
    });
  }

  for (const o of owners.data ?? []) {
    cands.push({
      item: { kind: "owner", id: String(o.id), title: String(o.name),
              sub: "Owner", href: `/owners/${o.id}` },
      text: String(o.name),
    });
  }

  for (const c of people.data ?? []) {
    const nm = (c.full_name as string | null) ?? (c.phone as string);
    cands.push({
      item: { kind: "person", id: String(c.id), title: String(nm),
              sub: String(c.party ?? "").replace("_", " ") || "Contact",
              href: `/people` },
      text: String(nm),
      also: [String(c.phone ?? "")].filter(Boolean),
    });
  }

  for (const j of jobs.data ?? []) {
    const unit = j.units as unknown as
      { label: string; properties: { name: string } | null } | null;
    cands.push({
      item: {
        kind: "job", id: String(j.id), title: String(j.summary),
        sub: [unit?.properties?.name, unit?.label].filter(Boolean).join(" ") || "No address",
        href: `/jobs`,
      },
      text: String(j.summary),
      also: [unit?.label, unit?.properties?.name].filter(Boolean) as string[],
    });
  }

  // ---------------------------------------------------------- the reports
  //
  // Questions with a number for an answer. Not pages, so nobody can click to
  // them, and typing the question is how a person would actually ask it.
  const all = units.data ?? [];
  const vacant = all.filter((u) => u.is_vacant);
  const rent = (rows: typeof all) =>
    rows.reduce((a, u) => a + Number(u.monthly_rent ?? 0), 0);
  const let_ = all.filter((u) => !u.is_vacant);
  const occupancy = all.length
    ? Math.round(((all.length - vacant.length) / all.length) * 100) : null;
  const open = (jobs.data ?? []).length;

  const reports: Candidate<Found>[] = [
    {
      item: { kind: "report", id: "rentroll", title: "Rent roll",
              answer: all.length
                ? `${money(rent(let_) * 100)} a month from ${let_.length} let`
                  + `${vacant.length ? `, ${money(rent(vacant) * 100)} more if the `
                      + `${vacant.length} empty were let` : ""}`
                : "No units on file yet",
              href: "/properties" },
      text: "Rent roll",
      also: ["rent", "income", "monthly rent", "gross rent", "roll"],
    },
    {
      item: { kind: "report", id: "vacancy", title: "Vacancy",
              answer: all.length
                ? `${vacant.length} of ${all.length} empty`
                  + `${occupancy === null ? "" : ` · ${occupancy}% occupied`}`
                  + ` · ${money(rent(vacant) * 100)} a month not coming in`
                : "No units on file yet",
              href: "/leasing" },
      text: "Vacancy",
      also: ["vacant", "empty", "occupancy", "occupied", "voids"],
    },
    {
      item: { kind: "report", id: "jobs", title: "Open jobs",
              answer: `${open} open`, href: "/jobs" },
      text: "Open jobs",
      also: ["jobs", "work orders", "maintenance", "repairs", "tickets"],
    },
    {
      item: { kind: "report", id: "clock", title: "On the clock",
              answer: "Who is working right now", href: "/timesheets" },
      text: "On the clock",
      also: ["timesheet", "timesheets", "hours", "payroll", "clocked in", "crew"],
    },
  ];
  cands.push(...reports);

  const results = rank(q, cands, 10).map((h) => h.item);
  // Nothing matched is a sentence, not an empty box. An empty box is the
  // screen telling somebody their park does not exist.
  const meant = results.length ? null : didYouMean(q, cands.map((c) => ({ text: c.text })));

  return NextResponse.json({ results, meant });
}
