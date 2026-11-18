/** A stand-in Supabase, so the SIGNED-IN screens can be looked at.
 *
 *  phone-check.mjs loads the real pages, and until this existed it could only
 *  load the five public ones -- so the screen the owner actually complains
 *  about, the crew clock, was the one thing it could not see. Every finding
 *  about it came from a photograph of a phone.
 *
 *  Auth answers for whichever token asked; the REST side answers with just
 *  enough rows for a page to render, and honours `eq` filters. Everything it
 *  does not know about comes back as an empty list, which is what a real
 *  database with nothing in it would say.
 *
 *  Two identities, because one cannot tell the screens apart -- see STAFF.
 *
 *  Start it with `node lib/__fixtures__/stub-supabase.mjs`, point
 *  NEXT_PUBLIC_SUPABASE_URL at http://127.0.0.1:54321, build, and start the
 *  app. phone-check.mjs mints its own cookies against the ids below.
 */
import { createServer } from "node:http";

const WHO = "11111111-1111-1111-1111-111111111111";
const USER = { id: WHO, aud: "authenticated", role: "authenticated",
               email: "cade@larabeehomesllc.com", app_metadata: {},
               user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };

/* TWO identities, because one cannot tell the screens apart. `crew` is
   CLOCK_ONLY, so a crew cookie is redirected away from every office screen --
   which is correct, and means a single crew fixture silently checks nothing
   on /home, /jobs, /timesheets or the inbox. */
const DESK = "22222222-2222-2222-2222-222222222222";
const GUEST = "33333333-3333-3333-3333-333333333333";
const STAFF = [
  { id: WHO, full_name: "Cade Barrow", role: "crew",
    forward_to: null, client_identity: null, active: true,
    created_at: "2026-01-01T00:00:00Z", hidden_areas: [], reads_all_dms: false },
  { id: DESK, full_name: "Dana Reese", role: "admin",
    forward_to: null, client_identity: null, active: true,
    created_at: "2026-01-01T00:00:00Z", hidden_areas: [], reads_all_dms: true },
  // Somebody looking round and saying what they think. Reads everything,
  // changes nothing.
  // Two office people, as in the live data on 18 November 2026: one with
  // areas hidden (072), one without -- so "private to Natashia" and "hidden
  // from Hannah" are two different people, not the same one.
  { id: "44444444-4444-4444-4444-444444444444", full_name: "Natashia Heinrich", role: "office",
    forward_to: null, client_identity: null, active: true, created_at: "2026-01-01T00:00:00Z",
    hidden_areas: ["distributions", "pay", "trail", "investors"], reads_all_dms: false },
  { id: "55555555-5555-5555-5555-555555555555", full_name: "Hannah Pappas", role: "office",
    forward_to: null, client_identity: null, active: true, created_at: "2026-01-01T00:00:00Z",
    hidden_areas: [], reads_all_dms: false },
  { id: GUEST, full_name: "Robin Vale", role: "viewer",
    forward_to: null, client_identity: null, active: true,
    created_at: "2026-01-01T00:00:00Z", hidden_areas: [], reads_all_dms: false },
];

/* THE COLUMNS THE PROPERTIES SCREEN ASKS FOR, all of them. That screen
   selects color, code, owner_id, owners(name) and confirmed_at, and one
   unknown column fails the whole select -- so with these missing the
   page fell all the way through its three tiers and rendered as nobody
   owning anything. The stand-in could not show the screen it was being
   used to check. */
const PROPERTIES = [
  { id: "p1", name: "The Retreat", address: "3100 Lady Viola Dr, Fayetteville NC",
    kind: "mhp", lat: 35.1, lng: -78.96, fence_m: 250,
    color: "#405981", code: "RETR", owner_id: "ow4",
    confirmed_at: "2026-02-01T00:00:00Z" },
  { id: "p2", name: "1140 Northside Road Mobile Home Community",
    address: "1140 Northside Rd, Elizabeth City NC", kind: "mhp",
    lat: 36.3, lng: -76.2, fence_m: 250,
    color: "#2E8B68", code: "NRTH", owner_id: "ow4", confirmed_at: null },
  { id: "p3", name: "1012 Chason St", address: "1012 Chason St", kind: "sfh",
    lat: 35.11, lng: -78.97, fence_m: null,
    color: "#B0561F", code: "CHAS", owner_id: "ow1",
    confirmed_at: "2026-03-14T00:00:00Z" },
];

const now = Date.now();

/* A PACK WITH THE SHAPE PAPERS.TS WRITES, and more than one document in
   it. The first version here was two lines long, and with a two-line
   pack "reads as separate sheets" and "reads as one roll of white" are
   the same picture -- so the page that reads a signed pack back shipped
   looking like neither and the fixture could not have said so.
   h2, .witness, .fill, .sig/.line/.signslot, and .pagebreak between the
   documents, which is what the sheet separation keys on. */
const CLAUSE = '<p>That Purchaser has offered to purchase such mobile home'
  + ' and has tendered <span class="fill">$33,460.00</span> by certified'
  + ' funds payable to Seller as a down payment, the receipt of which is'
  + ' hereby acknowledged by Seller. The balance of the purchase price of'
  + ' <span class="fill">$62,140.00</span> shall be paid in three hundred'
  + ' sixty (360) consecutive monthly installments of'
  + ' <span class="fill">$341.22</span> each.</p>';
const sigFor = (who) => '<div class="sig"><div class="line"></div>'
  + `<span class="signslot" data-for="${who}"></span>`
  + ` Dated <span class="dateslot" data-for="${who}">__________</span></div>`;
const docFor = (heading, who) => `<h2>${heading}</h2>`
  + (who === "buyer" ? '<p class="witness">W I T N E S S E T H</p>' : "")
  + CLAUSE.repeat(6) + sigFor(who);
const BREAK = '<div class="pagebreak"></div>';
const TWO_DOCS = [docFor("PURCHASE AGREEMENT", "buyer"),
  docFor("MOBILE HOME PARK LAND LEASE AGREEMENT", "tenant")].join(BREAK);
const THREE_DOCS = [TWO_DOCS,
  docFor("PURCHASE AGREEMENT (LOT 3102)", "buyer")].join(BREAK);
const iso = (ms) => new Date(ms).toISOString();
const SHIFTS = [
  { id: "s1", staff_id: WHO, property_id: "p1", property_from: "fence",
    started_at: iso(now - 7 * 3600e3), ended_at: iso(now - 2 * 3600e3),
    signed_off_at: null, start_fence: "inside", end_fence: "inside",
    // The position columns 038 has. Without them every select that asks for
    // where somebody clocked in fails, and the office's live map reads empty.
    start_lat: 35.1, start_lng: -78.96, start_acc: 18,
    end_lat: 35.1001, end_lng: -78.9601, end_acc: 20,
    start_metres: 10, auto_clocked_out: false,
    shift_breaks: [{ started_at: iso(now - 5 * 3600e3),
                     ended_at: iso(now - 4.5 * 3600e3) }] },
  { id: "s2", staff_id: WHO, property_id: null, property_from: null,
    started_at: iso(now - 1.5 * 3600e3), ended_at: null, signed_off_at: null,
    start_fence: "unsure", end_fence: null, shift_breaks: [],
    start_lat: 35.104, start_lng: -78.955, start_acc: 140,
    end_lat: null, end_lng: null, end_acc: null, start_metres: null, auto_clocked_out: false },
];

/* A morning for the trail map: on site, a drive north, twenty-five minutes
   at a store, back. Without positions the trail page has nothing to draw,
   and "a map with no line" is not something a picture check can judge. */
const minsAfter = (t0, m) => iso(t0 + m * 60e3);
const T0 = now - 7 * 3600e3;
const SHIFT_PINGS = [
  ...[2, 6, 10, 14, 18, 22, 26, 30].map((m) => ({ shift_id: "s1", at: minsAfter(T0, m),
    lat: 35.1 + (m % 4) * 0.00002, lng: -78.96, accuracy: 15, fence: "inside", metres: 5 })),
  { shift_id: "s1", at: minsAfter(T0, 34), lat: 35.108, lng: -78.955, accuracy: 15, fence: "outside", metres: 900 },
  { shift_id: "s1", at: minsAfter(T0, 37), lat: 35.117, lng: -78.951, accuracy: 15, fence: "outside", metres: 1900 },
  ...[40, 45, 50, 55, 60, 65].map((m) => ({ shift_id: "s1", at: minsAfter(T0, m),
    lat: 35.125, lng: -78.948 + (m % 2) * 0.0001, accuracy: 12, fence: "outside", metres: 2800 })),
  { shift_id: "s1", at: minsAfter(T0, 70), lat: 35.112, lng: -78.957, accuracy: 15, fence: "outside", metres: 1400 },
  { shift_id: "s1", at: minsAfter(T0, 75), lat: 35.1002, lng: -78.96, accuracy: 15, fence: "inside", metres: 20 },
];

/* THE OFFICE LINE (069): one call on the line now, one missed after hours
   with a voicemail, one answered with a transcript -- so the Calls page is
   drawn with every state a card can be in, not with "No calls yet." The
   embeds are carried on the rows, which this stand-in keeps as given. */
const CALL = (o) => ({ direction: "inbound", missed: false, duration_seconds: null,
  voicemail_text: null, recording_sid: null, conversation_id: null, returns_call_id: null,
  category: null, route_key: null, after_hours: false, answered_at: null, ended_at: null,
  notes: null, summary: null, follow_up: null, suggested_category: null, texted: null, language: null,
  contacts: null, answered: null, person: null, call_recordings: [], ...o });
const CALLS = [
  CALL({ id: "call1", created_at: iso(now - 3 * 60e3), category: "Emergency",
    route_key: "emergency", answered_at: iso(now - 2 * 60e3),
    contacts: { phone: "+12525550144", full_name: "Marisol Ortega-Whitfield" },
    person: { full_name: "Hannah Pappas" } }),
  CALL({ id: "call2", created_at: iso(now - 14 * 3600e3), category: "Leasing · Rent",
    route_key: "rent", after_hours: true, missed: true, texted: "missed", language: "es",
    voicemail_text: "Hi, I'm calling about the three bedroom on Northside, is it still available?",
    summary: "Asked whether the three-bedroom at Northside is still available and what the deposit is.\nProperty: Northside, three-bedroom",
    follow_up: "Call back about the Northside three-bedroom",
    contacts: { phone: "+12525550199", full_name: null },
    call_recordings: [{ recording_sid: "RE" + "a".repeat(32), kind: "voicemail",
      duration_seconds: 24, transcript: null, transcript_status: null, created_at: iso(now - 14 * 3600e3) }] }),
  CALL({ id: "call3", created_at: iso(now - 26 * 3600e3), category: "Payments",
    route_key: "payments", answered_at: iso(now - 26 * 3600e3), ended_at: iso(now - 26 * 3600e3 + 240e3),
    duration_seconds: 240, suggested_category: "Maintenance",
    summary: "Paid lot rent late and asked to waive the fee. Also mentioned a soft spot in the bathroom floor.\nProperty: Lot 14, The Retreat\nWe said: we will look at the floor on Thursday",
    follow_up: "Repair request: soft spot in the bathroom floor, Lot 14",
    notes: "Fee waived once. Told him not again.",
    contacts: { phone: "+19105550123", full_name: "Darnell Hughes" },
    person: { full_name: "Samantha Graber" },
    call_recordings: [{ recording_sid: "RE" + "b".repeat(32), kind: "call", duration_seconds: 240,
      transcript_status: "completed", created_at: iso(now - 26 * 3600e3),
      transcript: [
        { who: "us", at: 0, text: "Larabee Homes, this is Samantha." },
        { who: "caller", at: 3, text: "Hi, it's Darnell on lot fourteen. I paid late this month and I wondered about the fee." },
        { who: "us", at: 11, text: "I can take it off this once. Anything else?" },
        { who: "caller", at: 15, text: "Yeah, there's a soft spot in the bathroom floor by the tub." }] }] }),
];

const TABLES = {
  calls: CALLS,
  phone_people: [
    { id: "pp1", full_name: "Hannah Pappas", active: true },
    { id: "pp2", full_name: "Samantha Graber", active: true },
  ],
  call_routes: [
    { key: "rent", category: "Leasing · Rent", day_group: "g1", night_group: null, sort: 10 },
    { key: "maintenance", category: "Maintenance", day_group: null, night_group: null, sort: 40 },
  ],
  staff: STAFF,
  properties: PROPERTIES,
  shifts: SHIFTS,
  shift_pings: SHIFT_PINGS,
  clock_rules: [{ id: true, daily_cap: 10, break_after: 6, break_minutes: 30,
                  abandoned_after: 14, ping_minutes: 10 }],
  shift_edits: [],
  /* THREE TICKETS AND A CONVERSATION THAT IS NOT ONE, which is the whole
     question the list has to answer at a glance. With a job on every
     thread, "a ticket says so" and "every row says so" look identical.

     Three different states too -- an emergency, something under way, and
     one nobody has picked up -- because a single state cannot show whether
     the row reports the job's state or just the fact of it. */
  work_orders: [
    { id: "w1", conversation_id: "cv1", unit_id: "u1", summary: "Pipes overflowing",
      urgency: 1, status: "new" },
    { id: "w2", conversation_id: "cv2", unit_id: "u2", summary: "Sink leaking",
      urgency: 3, status: "in_progress" },
    { id: "w3", conversation_id: "cv3", unit_id: "u1", summary: "Fridge is going out",
      urgency: 2, status: "needs_parts" },
  ],
  inquiries: [],

  /* Nobody has signed: the papers panel has to be right before anyone
     has, which is every account the first time. */
  /* DELIBERATELY ABSENT, both: signatures (047) and deal_drafts (046).
     This fixture is the live database before those were run, and the
     question it exists to answer is whether somebody can still sign and
     still get their files.

     signing_requests IS here now, because 048 has been run on the live
     database and because the investor's own signing page cannot be looked
     at without it -- and that page is the one nobody could see. The pack
     below carries THREE signature slots and three date slots, written the
     way papers.ts writes them. Three and not one: with a single slot,
     "walks you to each place" and "fills them all from the bottom" are
     the same run, and the fixture could not tell the two apart. */
  signing_requests: [{
    id: "sr1",
    token: "walkcheck",
    owner_id: "ow1",
    title: "Purchase Agreement and Park Land Lease",
    doc_count: 2,
    pack: '<h2>PURCHASE AGREEMENT</h2>'
      + '<p>That Seller has offered to sell certain personal property.</p>'
      + '<div class="sig"><div class="line"></div>'
      + '<span class="signslot" data-for="buyer"></span>'
      + ' Dated <span class="dateslot" data-for="buyer">__________</span></div>'
      + '<div class="sig"><div class="line"></div>'
      + '<span class="signslot" data-for="buyer"></span>'
      + ' Dated <span class="dateslot" data-for="buyer">__________</span></div>'
      + '<h2>PARK LAND LEASE</h2>'
      + '<p>The Park Owner leases the lot described above.</p>'
      + '<div class="sig"><div class="line"></div>'
      + '<span class="signslot" data-for="tenant"></span>'
      + ' Dated <span class="dateslot" data-for="tenant">__________</span></div>',
    to_name: "Oak Ridge Holdings LLC",
    to_email: "oak@example.com",
    to_phone: null,
    sent_by: DESK,
    sent_at: iso(now - 3600e3),
    expires_at: iso(now + 14 * 24 * 3600e3),
    opened_at: null,
    agreed: false,
    signed_at: null, signed_name: null, signed_png: null, signed_pack: null,
    signed_ip: null, signed_agent: null,
    voided_at: null, voided_by: null,
  },
  /* A WITHDRAWN PACK, NEWER THAN THE LIVE ONE. The investors list shows
     where the latest pack stands, and a withdrawn pack is not a state a
     deal is in -- it is a thing that was undone. With only the live row
     here, "newest" and "newest that still counts" are the same row and
     the fixture cannot tell a correct skip from no skip at all. This is
     the real case: the first ALDERCREST pack went to the wrong address
     and was withdrawn five minutes later. */
  {
    id: "sr0", token: "voided", owner_id: "ow1",
    title: "Purchase Agreement and Park Land Lease",
    doc_count: 2, pack: "<p>withdrawn</p>",
    to_name: "Oak Ridge Holdings LLC", to_email: "wrong@example.com",
    to_phone: null, sent_by: DESK,
    sent_at: iso(now - 600e3),
    expires_at: iso(now + 14 * 24 * 3600e3),
    opened_at: null, agreed: false,
    signed_at: null, signed_name: null, signed_png: null, signed_pack: null,
    signed_ip: null, signed_agent: null,
    voided_at: iso(now - 540e3), voided_by: DESK,
  },
  /* AND ONE THAT IS SIGNED, against the OTHER investor. "Signed" and
     "sent, not opened" must not render the same -- which they did,
     because `.pill` on its own has no ground and `.pill.ok` did not
     exist. With every pack in the fixture unsigned, nothing could have
     caught that.

     Its expiry is in the PAST on purpose: a signed pack never expires,
     and with the date in the future that rule has nothing to answer. */
  {
    id: "sr2", token: "signedpack", owner_id: "ow2",
    title: "Purchase Agreement and Park Land Lease",
    doc_count: 2,
    pack: TWO_DOCS,
    to_name: "Dale Prieto", to_email: "dale@example.com",
    to_phone: null, sent_by: DESK,
    sent_at: iso(now - 40 * 24 * 3600e3),
    expires_at: iso(now - 26 * 24 * 3600e3),
    opened_at: iso(now - 39 * 24 * 3600e3), agreed: true,
    signed_at: iso(now - 39 * 24 * 3600e3), signed_name: "Dale Prieto",
    signed_png: "data:image/png;base64,iVBORw0KGgo=",
    signed_pack: THREE_DOCS,
    signed_ip: "203.0.113.7", signed_agent: "fixture",
    voided_at: null, voided_by: null,
  }],

  /* TWO INVESTORS, NOT ONE, and the second holds nothing.
     The investors list tallies homes and money per owner, and with a
     single owner holding everything, "sum over this owner's sales" and
     "sum over every sale" are the same number -- a fixture that cannot
     say which one is running is not asking the question. The second one
     also stands for the case the papers were built for: somebody buying
     their first home, with no sale recorded to draw them from. */
  /* FOUR OWNERS AND THREE KINDS. Twenty of the fifty-nine real ones were
     never investors -- residents who own their own home on one of our
     lots, and our own companies -- and every one was listed as an
     investor. With every owner the same kind, "the Investors tab shows
     investors" and "the tab shows everybody" are the same list. */
  owners: [
    { id: "ow1", name: "Oak Ridge Holdings", legal_name: "Oak Ridge Holdings LLC",
      active: true, notes: null, kind: "investor" },
    { id: "ow2", name: "Dale Prieto", legal_name: null, active: true,
      notes: null, kind: "investor" },
    { id: "ow3", name: "Earl McGraw", legal_name: null, active: true,
      notes: null, kind: "resident" },
    { id: "ow4", name: "Hudson Yards LLC", legal_name: "Hudson Yards LLC",
      active: true, notes: null, kind: "ours" },
  ],
  /* Four units, and the four states the public listings page has to tell
     apart: advertised with a date, advertised with none, coming up, and
     not advertised at all. The last one is the point -- with every unit
     advertised, "shows what the office is renting" and "shows everything"
     are the same page and the fixture cannot tell them apart.

     `is_vacant` deliberately DISAGREES with `listing`, because that is the
     real state: on 17 November Rent Manager called one unit vacant while
     the office advertised six, and the vacant one was not among them. */
  units: [
    { id: "u1", label: "3124", property_id: "p1",
      listing: "for_rent", is_vacant: false, bedrooms: 3, bathrooms: 2,
      monthly_rent: 1150, available_on: "2026-12-01",
      properties: { id: "p1", name: "The Retreat",
                    address: "3100 Lady Viola Dr, Fayetteville NC" } },
    /* THE RETREAT HAS MORE THAN ONE LOT, which is the only way a park
       picking OPENS rather than files. With one lot each, "a park opens to
       its lots" and "a park files against its only unit" are the same
       answer and the picker cannot be told apart from the broken one. */
    { id: "u1b", label: "3126", property_id: "p1",
      listing: null, is_vacant: false, bedrooms: 3, bathrooms: 2,
      monthly_rent: 1100, available_on: null,
      properties: { id: "p1", name: "The Retreat",
                    address: "3100 Lady Viola Dr, Fayetteville NC" } },
    { id: "u1c", label: "3128", property_id: "p1",
      listing: null, is_vacant: false, bedrooms: 2, bathrooms: 1,
      monthly_rent: 950, available_on: null,
      properties: { id: "p1", name: "The Retreat",
                    address: "3100 Lady Viola Dr, Fayetteville NC" } },
    { id: "u2", label: "17", property_id: "p2",
      listing: "for_rent", is_vacant: false, bedrooms: 2, bathrooms: 1,
      monthly_rent: 875, available_on: null,
      properties: { id: "p2", name: "1140 Northside Road Mobile Home Community",
                    address: "1140 Northside Rd, Elizabeth City NC" } },
    { id: "u4", label: "211 Roscoe Dr", property_id: "p3",
      listing: "upcoming", is_vacant: false, bedrooms: 4, bathrooms: 2,
      monthly_rent: 1495, available_on: null,
      properties: { id: "p3", name: "211 Roscoe Dr",
                    address: "211 Roscoe Dr, Elizabeth City NC" } },
    /* A LONG NAME ON AN UPCOMING HOME, and that is the whole reason it is
       here. "211 Roscoe Dr" is short enough to clear the "Coming up" pill
       whether or not room is reserved for it, so with only that card the
       overlap check passes with the fix deleted. The two answers have to
       differ somewhere or the check is not asking the question. */
    { id: "u6", label: "Lot 14", property_id: "p5",
      listing: "upcoming", is_vacant: false, bedrooms: 3, bathrooms: 2,
      monthly_rent: 1025, available_on: null,
      properties: { id: "p5",
                    name: "1140 Northside Road Mobile Home Community",
                    address: "1140 Northside Rd, Elizabeth City NC" } },
    { id: "u5", label: "9 Nowhere Ln", property_id: "p4",
      listing: null, is_vacant: true, bedrooms: 2, bathrooms: 1,
      monthly_rent: 700, available_on: null,
      properties: { id: "p4", name: "9 Nowhere Ln",
                    address: "9 Nowhere Ln, Elizabeth City NC" } },
  ],
  /* Two homes, in two parks, to ow1 -- so "across N parks" has a number
     to get wrong, and ow2 has nothing.

     A THIRD with no first payment date, because the screen's job is to
     tell a complete sale from an incomplete one and a fixture where
     every sale is complete cannot tell those two answers apart. It is
     the real case: one of the live sales is exactly this -- terms, a
     payment, and no date to count them from. */
  home_sales: [
    { id: "hs3", owner_id: "ow1", unit_id: "u3", sold_on: "2026-08-10",
      price_cents: 9560000, down_cents: 3346000, financed: true,
      monthly_cents: 34122, rate_bps: 520, term_months: 360,
      first_due_on: null, home_year: 2026, home_make: "Champion",
      home_serial: "CHM3122NC", ended_on: null, ended_why: null, note: null,
      lot_rent_cents: 37500, management_cents: 4500, warranty_cents: 0,
      tenant_rent_cents: 0, pet_fee_cents: 0, late_fee_cents: 5000,
      owner_insures: true,
      units: { id: "u3", label: "3122", property_id: "p1",
               properties: { id: "p1", name: "The Retreat",
                             address: "3100 Lady Viola Dr, Fayetteville NC" } },
      owners: { id: "ow1", name: "Oak Ridge Holdings" } },
    { id: "hs1", owner_id: "ow1", unit_id: "u1", sold_on: "2025-06-14",
      price_cents: 4850000, down_cents: 970000, financed: true,
      monthly_cents: 42500, rate_bps: 750, term_months: 180,
      first_due_on: "2025-07-01", home_year: 2021, home_make: "Clayton",
      home_serial: "CLW0214NC", ended_on: null, ended_why: null, note: null,
      lot_rent_cents: 50000, management_cents: 5000, warranty_cents: 0,
      tenant_rent_cents: 95000, pet_fee_cents: 0, late_fee_cents: 5000,
      owner_insures: true,
      units: { id: "u1", label: "3124", property_id: "p1",
               properties: { id: "p1", name: "The Retreat",
                             address: "3100 Lady Viola Dr, Fayetteville NC" } },
      owners: { id: "ow1", name: "Oak Ridge Holdings" } },
    { id: "hs2", owner_id: "ow1", unit_id: "u2", sold_on: "2025-09-02",
      price_cents: 3900000, down_cents: 780000, financed: true,
      monthly_cents: 34000, rate_bps: 750, term_months: 180,
      first_due_on: "2025-10-01", home_year: 2019, home_make: "Fleetwood",
      home_serial: "FLE8891NC", ended_on: null, ended_why: null, note: null,
      lot_rent_cents: 45000, management_cents: 5000, warranty_cents: 0,
      tenant_rent_cents: 85000, pet_fee_cents: 0, late_fee_cents: 5000,
      owner_insures: true,
      units: { id: "u2", label: "17", property_id: "p2",
               properties: { id: "p2",
                 name: "1140 Northside Road Mobile Home Community",
                 address: "1140 Northside Rd, Elizabeth City NC" } },
      owners: { id: "ow1", name: "Oak Ridge Holdings" } },
  ],
  /* THE OWNER'S OWN SCREENSHOT, as rows: a colleague's thread from twenty
     hours ago, and a text that arrived just now. They were rendered as two
     stacked lists, so the twenty-hour-old one sat on top. A fixture where
     both are the same age cannot tell the merged order from the stacked one. */
  contacts: [
    { id: "ct1", phone: "+12526422995", full_name: null, party: "unknown",
      language: null, unit_id: null, units: null, email: null },
    /* A REQUEST FROM RENT MANAGER: no number, no email, and a stand-in in
       the phone column. There is nowhere for a reply to go, and the whole
       question is whether the screen says so before somebody types. */
    { id: "ct3", phone: "email:rm:issue:251", full_name: "Marie Dossantos",
      party: "current_tenant", language: null, unit_id: null, units: null,
      email: null },
    { id: "ct2", phone: "+19105550114", full_name: "Michelle Griffin",
      party: "tenant", language: null, unit_id: null, units: null },
  ],
  conversations: [
    { id: "cv1", category: "general", source: "sms", status: "open",
      assigned_to: null, closure_prompts: 0, category_confidence: 0.4,
      last_message_at: iso(now - 30e3),
      last_message_preview: "Hello my pipes are overflowing with water",
      subject: null, units: null, staff: null, team_id: null, unit_id: null, private_to: null,
      /* `place_hint` is DELIBERATELY ABSENT: it arrives with migration 045
         and this fixture is a database where 045 has not been run, which
         is the state the live site is in. A route that names it without a
         way back answers 404 for every conversation, and that is the thing
         this stub now exists to notice. */
      contacts: { id: "ct1", phone: "+12526422995", full_name: null,
        party: "unknown", language: null, unit_id: null, units: null } },
    { id: "cv2", category: "maintenance", source: "sms", status: "open",
      assigned_to: null, closure_prompts: 0, category_confidence: 0.95,
      last_message_at: iso(now - 20 * 24 * 3600e3),
      last_message_preview: "Hey Michelle, received your maintenance request.",
      subject: null, units: null, staff: null, team_id: null, unit_id: null, private_to: null,
      /* `place_hint` is DELIBERATELY ABSENT: it arrives with migration 045
         and this fixture is a database where 045 has not been run, which
         is the state the live site is in. A route that names it without a
         way back answers 404 for every conversation, and that is the thing
         this stub now exists to notice. */
      contacts: { id: "ct2", phone: "+19105550114", full_name: "Michelle Griffin",
        party: "tenant", language: null, unit_id: null, units: null,
        email: null } },
    { id: "cv3", category: "maintenance", source: "email", status: "open",
      assigned_to: null, closure_prompts: 0, category_confidence: 0.9,
      last_message_at: iso(now - 3 * 3600e3),
      last_message_preview: "Fridge is going out",
      subject: "Fridge is going out", units: null, staff: null, team_id: null,
      unit_id: null, private_to: null,
      contacts: { id: "ct3", phone: "email:rm:issue:251",
        full_name: "Marie Dossantos", party: "current_tenant", language: null,
        unit_id: null, units: null, email: null } },
  ],
  messages: [
    // cv1's newest is INBOUND: it is unread.
    { id: "m1", conversation_id: "cv1", direction: "inbound",
      body: "Hello my pipes are overflowing with water", created_at: iso(now - 30e3),
      body_en: null, lang: null, status: "received", channel: "sms", media_paths: [], sent_by: null, },
    // cv2's newest is OUTBOUND -- we answered. Not unread, however long ago
    // anyone last opened it.
    { id: "m2", conversation_id: "cv2", direction: "inbound",
      body: "My sink is leaking", created_at: iso(now - 21 * 24 * 3600e3),
      body_en: null, lang: null, status: "received", channel: "sms", media_paths: [], sent_by: null, },
  ],
  /* Michelle's thread, as the timings that tell the two rules apart:
       - her message came in      21 days ago
       - somebody read it         21 days ago
       - WE replied               20 days ago  (so last_message_at is ours)
     The naive rule, `last_message_at > last_read_at`, calls that unread. The
     right one, "is the newest message FROM OUTSIDE newer than my last read",
     does not. With the read time set to the REPLY the two agree, and the
     check cannot tell which one is running -- which is how it was written the
     first time. */
  conversation_reads: [
    { conversation_id: "cv2", staff_id: WHO, last_read_at: iso(now - 21 * 24 * 3600e3) },
    { conversation_id: "cv2", staff_id: DESK, last_read_at: iso(now - 21 * 24 * 3600e3) },
  ],
  open_category_counts: [
    { category: "general", total: 1, unclaimed: 1 },
    { category: "maintenance", total: 1, unclaimed: 1 },
  ],
  /* Alex Prieto, twenty hours ago -- the row that was sitting on top. */
  dm_members: [
    { staff_id: WHO, last_read_at: null, thread: { id: "dm1", title: "Alex Prieto",
      last_at: iso(now - 20 * 3600e3),
      dm_members: [{ staff: { id: "s9", full_name: "Alex Prieto" } }],
      dm_messages: [{ body: "Did the plumber ever call you back?",
                      created_at: iso(now - 20 * 3600e3), author_id: "s9" }] } },
    { staff_id: DESK, last_read_at: null, thread: { id: "dm1", title: "Alex Prieto",
      last_at: iso(now - 20 * 3600e3),
      dm_members: [{ staff: { id: "s9", full_name: "Alex Prieto" } }],
      dm_messages: [{ body: "Did the plumber ever call you back?",
                      created_at: iso(now - 20 * 3600e3), author_id: "s9" }] } },
  ],
  /* A setup link that has been used. The row survives; it is the LINK that
     is finished -- which is the whole reason the dead screen can still offer
     to ask for another on this person's behalf. */
  staff_invites: [
    // Live, for field staff: the setup screen should offer a PIN, not an email.
    { id: "iv0", token: "L".repeat(40), full_name: "Tomás Herrera",
      phone: "+19105550133", role: "crew",
      expires_at: iso(now + 5 * 24 * 3600e3), used_at: null, reasked_at: null },
    { id: "iv1", token: "s".repeat(40), full_name: "Abel Moreno",
      phone: "+19105550199", role: "crew",
      expires_at: iso(now + 7 * 24 * 3600e3), used_at: iso(now - 3600e3),
      reasked_at: null },
  ],
  notes: [], teams: [], markets: [],
  /* Owner distributions: one month, three groups, and one of each state the
     screen has to show -- a statement that needs a look (title and lines
     disagree), one with nothing to pay, one with no email, one paid, one
     planned, one ordinary. Made-up names; the real ones are not fixtures. */
  ...(() => {
    const month = `${new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }).slice(0, 7)}-01`;
    const L = (lot, rent, loan = -47449) => [
      { label: `Monthly Rent - Lot ${lot}`, cents: rent, date: "2026-11-01", merchant: "Zego", category: "Rent" },
      { label: `Mortgage - Lot ${lot}`, cents: loan, date: "2026-11-14", merchant: "LH LLC", category: "Mortgage" },
      { label: `Lot Rent - Lot ${lot}`, cents: -50000, date: "2026-11-14", merchant: "LH LLC", category: "Rent" },
    ];
    const payees = [
      ["dp1", "Harbor Point Holdings", "harbor@example.com"],
      ["dp2", "Wren Family Trust", "wren@example.com"],
      ["dp3", "Oakmont Ventures LLC — Cross Creek", null],
      ["dp4", "Juniper Lane Partners", "juniper@example.com"],
      ["dp5", "Tidewater Homes LLC", "tide@example.com"],
      ["dp6", "Bellamy & Sons — 12 Bay St", "bellamy@example.com"],
    ].map(([id, name, emails]) => ({ id, name, emails, entity: ["dp4", "dp6"].includes(id) ? "Juniper Lane Partners" : null, guaranteed_rent_cents: id === "dp3" ? 125000 : id === "dp4" ? 160000 : null, reserve_held_cents: id === "dp1" ? 200000 : null, starts_on: id === "dp3" ? (() => { const d = new Date(month); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 10); })() : null, reserve_required_cents: id === "dp6" ? 200000 : null, settle_days: 2, owner_id: null, pay_note: null, sheet_id: null, active: true, created_at: month }));
    const st = (id, payee, group, title, lines, prev, paid, extra = {}) => ({
      id, run_id: "dr1", payee_id: payee, owner_id: null, lines, note: null, hold: false,
      emailed_at: null, emailed_to: null, email_detail: null, updated_at: month, updated_by: null,
      title, previous_owed_cents: prev, prior_paid_cents: paid, prior_paid_on: "2026-10-14",
      deposits_cents: 310000, stated_net_cents: null, stated_owed_cents: null, owed_note: null,
      source: { group, blank: [], extra: [] }, ...extra,
    });
    return {
      distribution_runs: [{ id: "dr1", month, daily_cap_cents: 2500000, start_on: null, note: null, created_at: month, created_by: null }],
      distribution_payees: payees,
      distribution_statements: [
        st("ds1", "dp1", "Corporate", "Harbor Point Holdings - 1140 Northside Rd, Lots #2, #4", [...L(2, 155000), ...L(4, 156500)], 211051, 211051),
        st("ds2", "dp2", "Corporate", "Wren Family Trust - 1148 Northside Rd, Lots #10, #25", [...L(10, 155000), ...L(16, 155000),
          { label: "Supplies - Lot 10", cents: -417660, date: "2026-11-04", merchant: "BDC", category: "Maintenance" }], 270945, 270945),
        // Two homes with costs and no rent: the "pay as if rented" case.
        st("ds3", "dp3", "Cross Creek", "Oakmont Ventures LLC - The Retreat at Cross Creek, Lots #3117, #3119",
          [...L(3117, 125000, -34122), ...L(3119, 125000, -34122)].filter((l) => l.cents < 0), 0, 0),
        st("ds4", "dp4", "Individuals", "Juniper Lane Partners - 1142 Northside Rd, Lots #15", L(15, 155000), 52551, 52551),
        st("ds5", "dp5", "Individuals", "Tidewater Homes LLC - 1140 Northside Rd, Lots #20, #21, #28", [...L(20, 155000), ...L(21, 155000), ...L(28, 158000)], 281985, 242871),
        st("ds6", "dp6", "Individuals", "12 Bay St (Dutch doors)", [{ label: "Rent", cents: 169500, date: "46033", merchant: "Zego" },
          { label: "Supplies", cents: -2917, date: "September 28, 2026", merchant: "Lowes" },
          { label: "Quarterly Pest Control", cents: -8500, date: "09-11-2026", merchant: "Allegiant Pest Control" },
          { label: "Property Management Fees", cents: -16950, category: "Management" }], 152550, 152550),
      ],
      distribution_payments: [
        { id: "pm1", statement_id: "ds4", send_on: "2026-11-16", amount_cents: 52551, paid_at: "2026-11-16T15:00:00Z", paid_by: null, confirmation: "WF55120", created_at: month },
        { id: "pm2", statement_id: "ds1", send_on: "2026-11-17", amount_cents: 211051, paid_at: null, paid_by: null, confirmation: null, created_at: month },
      ],
      distribution_settings: [{ id: true, cc_all: "books@larabeehomesllc.com" }],
      distribution_recorded: [],
    };
  })(),
};

/* The seed, kept, so a run can put the tables back.
   Anything that WRITES changes what the next check reads: two end-to-end
   posts left an Office thread behind, a fourth row appeared in the inbox, and
   order-check.mjs failed on "three rows are listed" -- which is the check
   doing its job about the wrong thing. A harness that depends on accumulated
   state fails for reasons that have nothing to do with the code. */
const SEED = structuredClone(TABLES);

createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (code, body) => {
    res.writeHead(code, {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "*",
    });
    res.end(JSON.stringify(body));
  };
  if (req.method === "OPTIONS") return send(204, {});
  // Put the tables back the way they started. Checks call this first.
  if (url.pathname === "/__reset") {
    for (const k of Object.keys(TABLES)) delete TABLES[k];
    Object.assign(TABLES, structuredClone(SEED));
    return send(200, { reset: true });
  }

  /* Answer for WHICHEVER token asked. Returning the one user whatever the
     bearer said made the office cookie come back as the crew member, so every
     office screen redirected and the run looked like a pass. */
  if (url.pathname.startsWith("/auth/v1/user")) {
    const tok = (req.headers.authorization || "").replace(/^Bearer /i, "");
    let sub = WHO;
    try {
      sub = JSON.parse(Buffer.from(tok.split(".")[1], "base64url").toString()).sub || WHO;
    } catch { /* not a jwt: fall back to the crew member */ }
    const who = STAFF.find((m) => m.id === sub);
    return send(200, { ...USER, id: sub,
      email: who ? `${who.full_name.split(" ")[0].toLowerCase()}@larabeehomesllc.com`
                 : USER.email });
  }
  if (url.pathname.startsWith("/auth/v1/token")) {
    return send(200, { access_token: "stub", token_type: "bearer",
                       expires_in: 3600, refresh_token: "stub", user: USER });
  }

  /* INSERTS, so a feature that WRITES can be exercised end to end rather than
     only up to the point where it tries. Without this the crew's line to the
     office could only ever be checked as far as "could not open a thread",
     which is the stand-in's answer and not the code's. */
  /* RPC. Without this a call to `rpc("claim_issue_pull", …)` fell into the
     insert branch below and was answered with a created ROW -- truthy, not
     `true`, so the caller skipped every time and the feature looked like it
     was working by doing nothing. A stand-in that answers the wrong shape is
     as misleading as one that answers the wrong value. */
  if (req.method === "POST" && url.pathname.startsWith("/rest/v1/rpc/")) {
    const fn = url.pathname.slice("/rest/v1/rpc/".length);
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      let args = {};
      try { args = JSON.parse(raw || "{}"); } catch { args = {}; }
      if (fn === "claim_issue_pull") {
        // The real one is a single atomic statement; this is a stand-in for
        // the SHAPE of the answer, not for the locking.
        const row = (TABLES.rm_issue_pulls ??= [{ id: true, started_at: null,
          finished_at: null, ok: null, filed: 0, error: null }])[0];
        const stale = (args.p_stale ?? 5) * 60e3;
        const dead = (args.p_dead ?? 3) * 60e3;
        const t = (v) => (v ? Date.parse(v) : 0);
        const may = !row.started_at
          || (row.finished_at && Date.now() - t(row.finished_at) > stale)
          || (!row.finished_at && Date.now() - t(row.started_at) > dead);
        if (may) { row.started_at = new Date().toISOString(); row.finished_at = null; }
        return send(200, may);
      }
      if (fn === "finish_issue_pull") {
        const row = (TABLES.rm_issue_pulls ??= [{ id: true }])[0];
        row.finished_at = new Date().toISOString();
        row.ok = args.p_ok; row.filed = args.p_filed; row.error = args.p_error;
        return send(200, null);
      }
      /* 072: a lead's crew, so the clock screen's crew panel is drawn and
         measured -- one man on the clock and one off, with a long name,
         because the off one carries the job picker and that is the row
         that can overflow. */
      if (fn === "my_crew") {
        return send(200, [
          { staff_id: "cm1", full_name: "Guadalupe Hernández-Villanueva", open_shift: null, open_since: null },
          { staff_id: "cm2", full_name: "Pedro Gil", open_shift: "sh-cm2",
            open_since: new Date(Date.now() - 3 * 3600e3).toISOString() },
        ]);
      }
      if (fn === "my_auto_clock") return send(200, false);
      if (fn === "clock_window") {
        return send(200, { tz: "America/New_York", days: [1, 2, 3, 4, 5, 6], optional_days: [6], auto_out: "18:00" });
      }
      return send(200, null);
    });
    return;
  }

  if (req.method === "POST" && url.pathname.startsWith("/rest/v1/")) {
    const table = url.pathname.slice("/rest/v1/".length).split("?")[0];
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      let body = [];
      try { body = JSON.parse(raw || "[]"); } catch { body = []; }
      const list = Array.isArray(body) ? body : [body];
      /* `created_at` the way Postgres would, with its default.
         Without it an inserted row has none, and `row.created_at > seen` is
         `undefined > seen` -- false. So a crew member's own message was
         excluded from "has the office replied" by the DATE comparison before
         the author comparison could matter, and deleting the author filter
         altogether still passed. A guard standing behind a second guard is a
         guard nobody has tested. */
      const made = list.map((row, i) => ({
        id: row.id ?? `${table}-${(TABLES[table] ?? []).length + i + 1}`,
        created_at: new Date().toISOString(),
        ...row,
      }));
      if (!(table in TABLES)) {
        return send(404, { code: "42P01",
          message: `relation "public.${table}" does not exist`,
          hint: null, details: null });
      }
      /* An upsert replaces (or, with ignore-duplicates, skips) the row its
         on_conflict columns name -- appending it made a second settings row,
         and `maybeSingle` on two rows is an error the real database never gives. */
      const onc = url.searchParams.get("on_conflict");
      if (onc) {
        const cols = onc.split(",");
        const ignore = /ignore-duplicates/.test(req.headers.prefer ?? "");
        const same = (x, y) => cols.every((c) => String(x[c]) === String(y[c]));
        for (const row of made) {
          const at = TABLES[table].findIndex((x) => same(x, row));
          if (at < 0) TABLES[table].push(row);
          else if (!ignore) TABLES[table][at] = { ...TABLES[table][at], ...row };
        }
      } else TABLES[table] = TABLES[table].concat(made);
      const accept = req.headers.accept ?? "";
      return send(201, accept.includes("vnd.pgrst.object") ? made[0] : made);
    });
    return;
  }
  /* PATCH ACTUALLY WRITES.
     It used to answer 200 and change nothing, which made every check of a
     feature that UPDATES hollow: the screen said "the office has been told"
     and the row was untouched, and the check passed on both. A stand-in that
     accepts a write it does not perform tells you the thing you were trying
     to find out is fine. */
  /* DELETE, honouring the same filters. Without it a re-plan's "throw away
     the unpaid payments" did nothing here, and the old payment sat beside the
     new ones -- the stand-in answering a different question from the real
     database, and the check reading it as the app's. */
  if (req.method === "DELETE" && url.pathname.startsWith("/rest/v1/")) {
    const table = url.pathname.slice("/rest/v1/".length);
    const keep = (r) => {
      for (const [k, v] of url.searchParams) {
        if (["select", "order", "limit", "offset"].includes(k)) continue;
        const inList = /^in\.\((.*)\)$/.exec(v);
        if (inList) { if (!inList[1].split(",").map((x) => x.replace(/^"|"$/g, "")).includes(String(r[k]))) return true; continue; }
        const m = /^eq\.(.*)$/.exec(v);
        if (m && String(r[k]) !== m[1]) return true;
      }
      return false;
    };
    TABLES[table] = (TABLES[table] ?? []).filter(keep);
    return send(204, {});
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/rest/v1/")) {
    const table = url.pathname.slice("/rest/v1/".length).split("?")[0];
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      let patch = {};
      try { patch = JSON.parse(raw || "{}"); } catch { patch = {}; }
      const hit = [];
      for (const row of TABLES[table] ?? []) {
        let match = true;
        for (const [k, v] of url.searchParams) {
          if (["select", "order", "limit", "offset"].includes(k)) continue;
          const m = /^eq\.(.*)$/.exec(v);
          if (m && String(row[k]) !== m[1]) { match = false; break; }
          if (/^is\.null$/.test(v) && row[k] !== null && row[k] !== undefined) {
            match = false; break;
          }
        }
        if (match) { Object.assign(row, patch); hit.push(row); }
      }
      const accept = req.headers.accept ?? "";
      return send(200, accept.includes("vnd.pgrst.object") ? (hit[0] ?? null) : hit);
    });
    return;
  }

  if (url.pathname.startsWith("/rest/v1/")) {
    const table = url.pathname.slice("/rest/v1/".length).split("?")[0];
    /* A TABLE THAT IS NOT THERE IS AN ERROR, not an empty list. That is
       what Postgres says (42P01) and what every route here keys on to
       tell "nothing saved yet" apart from "the migration has not been
       run" -- which it cannot do if a missing table answers `[]`. */
    if (!(table in TABLES)) {
      return send(404, {
        code: "42P01",
        message: `relation "public.${table}" does not exist`,
        hint: null, details: null,
      });
    }
    let rows = TABLES[table] ?? [];
    /* HONOUR eq FILTERS. Returning every row whatever was asked made
       `staff?id=eq.<office uuid>` answer with the crew member -- so the office
       cookie was read as crew, every office screen redirected, and the run
       read as a pass. A stand-in that ignores the question answers the wrong
       one confidently. */
    for (const [k, v] of url.searchParams) {
      if (["select", "order", "limit", "offset"].includes(k)) continue;
      /* `is.null` as well as `eq.`. Without it, "the shift that has not ended"
         matched every shift, the first one came back -- a shift that ended
         hours ago -- and the context line the whole feature exists for was
         never exercised. */
      const isNull = /^is\.null$/.test(v);
      const isNotNull = /^not\.is\.null$/.test(v);
      if (isNull || isNotNull) {
        rows = rows.filter((r) => {
          const got = r[k];
          const empty = got === null || got === undefined;
          return isNull ? empty : !empty;
        });
        continue;
      }
      /* `in.(a,b)` as well, because an unknown filter here is SKIPPED -- and
         a skipped filter is not a neutral one. The public listings page asks
         `listing in (for_rent, upcoming)`, and without this the stand-in
         handed back every unit in the fixture, so the page rendered homes
         nobody is advertising and read as working. A stand-in that ignores
         the question answers the wrong one confidently, which is the note
         already written above about `eq` and about `is.null`. */
      const inList = /^in\.\((.*)\)$/.exec(v);
      if (inList) {
        const want = new Set(inList[1].split(",")
          .map((s) => s.trim().replace(/^"|"$/g, "")));
        rows = rows.filter((r) => want.has(String(r[k])));
        continue;
      }
      const m = /^eq\.(.*)$/.exec(v);
      if (!m) continue;
      const want = m[1] === "null" ? null : m[1];
      rows = rows.filter((r) => {
        const got = r[k];
        if (want === null) return got === null || got === undefined;
        return String(got) === want
          || (got === true && want === "true") || (got === false && want === "false");
      });
    }
    // PostgREST answers a `.single()` with an object; supabase-js asks for it
    // with this header, so honouring it is what stops pages throwing.
    /* EMBEDS. PostgREST returns a joined row under the alias asked for, and
       code reads `row.thread.title` or `row.properties.name`. A stand-in that
       returns the flat row leaves those undefined -- which does not throw, it
       just makes every lookup MISS. The crew's line to the office then made a
       fresh thread on every message, and the end-to-end check reported the
       stand-in's behaviour as the route's.

       Named explicitly rather than guessed from the column: `thread_id` does
       not spell `dm_threads`, and a stand-in that guesses wrong is a stand-in
       that lies in a new place. */
    const EMBEDS = {
      dm_members: { thread: ["thread_id", "dm_threads"] },
      shifts: { properties: ["property_id", "properties"] },
      properties: { owners: ["owner_id", "owners"] },
    };

    /* THE OTHER DIRECTION. A property carries its lots, and PostgREST
       returns them as an array under the alias. Without this the
       properties screen read every park as having no lots -- which is
       not a shape a list of lots can be checked against. */
    const HAS_MANY = {
      properties: { units: ["property_id", "units"] },
    };
    const want = url.searchParams.get("select") ?? "";

    /* A COLUMN THAT IS NOT THERE FAILS THE WHOLE SELECT, which is what
       PostgREST does and what this stub used to wave through -- so a
       route naming a column from a migration nobody had run looked
       perfectly healthy here and answered 404 for every conversation on
       the live site. A stand-in that ignores the question answers the
       wrong one confidently.

       Only the top-level names, and only when there is a row to learn
       the shape from: an embed carries its own columns and an empty
       table cannot say what it has. */
    const known = new Set(rows.flatMap((r) => Object.keys(r)));
    if (rows.length && want && want !== "*") {
      const named = [];
      let depth = 0, piece = "";
      for (const ch of want) {
        if (ch === "(") { depth++; piece += ch; }
        else if (ch === ")") { depth--; piece += ch; }
        else if (ch === "," && depth === 0) { named.push(piece); piece = ""; }
        else piece += ch;
      }
      named.push(piece);
      const missing = named
        .map((x) => x.trim())
        .filter((x) => x && !x.includes("("))
        .map((x) => (x.includes(":") ? x.split(":")[1] : x).trim())
        .filter((x) => x && x !== "*" && !known.has(x)
          && !(EMBEDS[table] ?? {})[x] && !(HAS_MANY[table] ?? {})[x]);
      if (missing.length) {
        return send(400, {
          code: "42703",
          message: `column ${table}.${missing[0]} does not exist`,
          hint: null, details: null,
        });
      }
    }
    for (const [alias, [fk, target]] of Object.entries(EMBEDS[table] ?? {})) {
      if (!new RegExp(`(^|,)\\s*${alias}\\s*[:(]`).test(want)) continue;
      rows = rows.map((r) => (alias in r ? r : {
        ...r, [alias]: (TABLES[target] ?? []).find((x) => x.id === r[fk]) ?? null,
      }));
    }
    for (const [alias, [fk, target]] of Object.entries(HAS_MANY[table] ?? {})) {
      if (!new RegExp(`(^|,)\\s*${alias}\\s*[:(]`).test(want)) continue;
      /* An ARRAY, and an empty one where there are none -- a property
         with no lots is a real answer and must not arrive as null. */
      rows = rows.map((r) => (alias in r ? r : {
        ...r, [alias]: (TABLES[target] ?? []).filter((x) => x[fk] === r.id),
      }));
    }

    const accept = req.headers.accept ?? "";
    if (accept.includes("vnd.pgrst.object")) {
      return rows.length ? send(200, rows[0])
        : send(406, { message: "no rows" });
    }
    return send(200, rows);
  }
  return send(200, []);
}).listen(54321, "127.0.0.1", () => console.log("stub supabase on 54321"));
