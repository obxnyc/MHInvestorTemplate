# Owner distributions: the monthly read-in

Run by a scheduled task each month, or by hand. The owner (Cade) should not
have to do any of this.

## What arrives

Around the 13th, Alex Prieto (alex@larabeehomesllc.com) emails
cade@larabeehomesllc.com and sam@larabeehomesllc.com with the subject
"Owner Distributions <Mon YYYY>" (e.g. "Owner Distributions Nov 2026"). The
body is a list of Google Sheets links, one per payee, grouped Corporate /
Individuals / New owners Cross Creek, sometimes with a "Coming owners" list
at the end (not statements yet).

Each sheet has one tab per month, normally "Nov 2026"; the Dutch-doors sheet
has one tab per property per month ("223 Cisco Nov 26"), and each of those is
its own statement.

The tab's layout, column B onward:

- row 1: title, e.g. "Conor Dolan - 1140 Northside Rd, Lots #13, #32, #33, #36"
- "Monthly Net Cashflow" and its amount
- Expenses: Account | Date | Merchant | Description | Amount | Category
- Revenue: same columns
- NOTES: Previous Distribution Owed, Security Deposits ON FILE,
  Distributions Paid (date, amount), then "Owed to <name>" with the amount and
  sometimes a note beside it ("No funds to distributed")
- occasionally a second block below (RNMK has "Pines MHP") -- do not merge it
  into the first; record it and flag it

Owed this month = this month's net + (previous owed - what was paid).

## Our names for things, which the sheets do not use

Find last month's payee for each sheet (and, for the Dutch-doors workbook,
each tab) and reuse it -- name, entity, email, group -- before falling back to
the sheet's own wording. Settled with the owner on 16 November 2026:

- "Shannon Dist" is **Shannon Costello**; "Jack Curran Lot" is **Jack Curran**.
- Beaga LLC (513 Madrin, 412 Bank), 105 Twiddy LLC and Elizabeth City
  Property LLC (125 Franklin, and Gabe Moskow's Lot 1) are **Corporate**,
  though Alex lists them under Individuals.
- The RNMK sheet has a second block, **Pines MHP** (30 homes), below the
  Northside one. It is its own statement, "RNMK Homes — Pines MHP", with
  entity RNMK Homes so both go in one email.
- A rent agreement is a floor (see `withGuarantee`): actual rents unless the
  owner has an agreement; with one, every home is paid at least the agreed
  rent. Benjamin Jackson (Cross Creek) has one at $1,250; nobody else yet.

## Read-in

Gmail, Google Sheets and Supabase connectors. Supabase project
`tubrcwtfuqvgdkklbtyl`. Read-only on Gmail and Sheets.

1. Find Alex's email for the month. If there is none yet, stop.
2. If `distribution_runs` already has the month and any statement in it has
   lines, stop: it has been read in. Never overwrite a statement that has
   `emailed_at` set or a paid payment.
3. Create the run: `insert into distribution_runs (month) values ('YYYY-MM-01')
   on conflict (month) do nothing`.
4. For each sheet (and each Dutch-doors "<property> <Mon> <YY>" tab):
   - the payee is the sheet's own name for itself -- the "Owed to <name>" label,
     else the row-1 title before " - ". Upsert `distribution_payees(name)`; set
     `sheet_id` if empty. Keep `emails` and `settle_days` already there.
   - the statement's `title` is the PLACE, never the workbook: a Dutch-doors
     tab is titled by its address ("223 Cisco"). Dutch Doors is the
     management company's workbook, not a property.
   - upsert `distribution_statements` on (run_id, payee_id) with
     `lines` = expenses and revenue as `[{label: Description, cents, date,
     merchant, category}]` (expenses negative, revenue positive, skip blank
     amounts but say so), `title` = row 1, `previous_owed_cents`,
     `prior_paid_cents`, `prior_paid_on`, `deposits_cents`,
     `stated_net_cents` (Monthly Net Cashflow), `stated_owed_cents` (Owed to),
     `owed_note`, `source` = `{"sheet": id, "tab": name, "group": ...,
     "extra_blocks": [...], "blank_lines": [...]}`.
5. Payees with `guaranteed_rent_cents` set are paid for an empty home as if
   it were let: for every lot with costs and no rent, add a line
   `Guaranteed rent - Lot N (vacant)` at that amount, category
   "Guaranteed rent" (the screen's "Pay N empty homes as rented" does the
   same). The screen checks Alex's figures without those lines and says how
   much was added.
6. Payees with no email: take the To/Cc of the most recent sent
   "<Month> Owner Distribution" email whose body starts with that title.
7. Do not email anyone, Cade included, until he says the system can send on
   his behalf (16 November 2026: "until we have a bullet proof system i dont
   want you sending emails on my behalf yet"). The summary lives on
   https://app.larabeehomesllc.com/distributions -- the checks and the
   against-last-month line are on every statement there.

Nothing is emailed to an owner and nothing is paid by the read-in. Sending is
a button on the screen, pressed by a person.
