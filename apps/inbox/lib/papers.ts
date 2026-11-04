/**
 * The sale papers: a Purchase Agreement and a Park Land Lease, per home.
 *
 * The wording is lifted verbatim from `mobilehomedocumentgenerator.html`,
 * which is the generator already in use and already read by somebody who
 * knows what it has to say. Nothing here rewrites a sentence of it. What
 * this adds is where the numbers come from: the owner, the lot, the sale
 * and the park's terms, rather than twenty-four boxes typed again for
 * every home.
 *
 * Eight homes to one investor is sixteen documents, and the only thing
 * that differs between them is the lot number, the home's description
 * and the price. Everything else is the deal.
 *
 * `lib/__fixtures__/papers-check.mjs` holds the arithmetic AND compares
 * every fixed sentence here against the generator's own, so the two
 * cannot drift apart without something failing.
 */

/** The terms of the deal, which are the same for every home in it. */
export type Terms = {
  /** Sells and finances the home. */
  seller: string;
  /** Leases the land. Often a person where the seller is a company. */
  parkOwner: string;
  /** The investor buying. */
  buyer: string;
  parkName: string;
  state: string;
  /** Dates as yyyy-mm-dd, the way an <input type=date> gives them. */
  agreedOn: string;
  leaseFrom: string;
  financed: boolean;
  /** Per cent a year, as typed: 4.9 rather than 490 basis points. */
  ratePct: number;
  termYears: number;
  perYear: number;
  payMethod: string;
  lotRent: number;
  consulting: number;
  reserve: number;
  /** The most the reserve can total across every lot, which only the
      investor lease speaks of. */
  reserveCap: number;
  /**
   * WHICH LEASE. The purchase agreement is one body of prose for
   * everybody, differing only by the switches; the lease is not. The
   * owner's clean lease gives away things his own does not -- a ceiling
   * on rent, 180 days if the park is sold, the right to sublet -- and
   * those are terms, not drafting. So it is a choice, and the default is
   * the one he has always used.
   */
  leaseForm: "house" | "investor";
  noticeDays: number;
  rofrDays: number;
  escalate: boolean;
  escalatePct: number;
  /** "lot rent" or "lot rent and consulting fee", as the clause reads. */
  escalateApplies: string;
  late: boolean;
  graceDays: number;
  lateFee: number;
  security: boolean;
  insure: boolean;
  notary: boolean;
  amortize: boolean;
  /** "annual" for one row a year, "monthly" for one a payment. */
  amortDetail: "annual" | "monthly";

  /**
   * OUR SIDE, SIGNED BEFORE IT GOES OUT.
   *
   * A PNG as a data URL, drawn on the signature line of the Seller and
   * the Park Owner blocks -- never on the Purchaser's or the
   * Homeowner's, who sign for themselves wherever they sign.
   *
   * Absent means an unsigned document with a line to sign on, which is
   * what this has always produced and remains the default.
   */
  signedPng?: string;
  /** The day it was signed, as yyyy-mm-dd. Blank leaves the line. */
  signedOn?: string;

  /**
   * THEIR SIDE, LEFT OPEN FOR THEM TO SIGN.
   *
   * When a pack is being sent out for the investor to sign, their two
   * blocks carry a marked slot instead of a bare rule. It draws as the
   * rule it has always drawn as -- the document they read before signing
   * is the document -- and it gives the one place their mark goes, so
   * countersigning is a substitution rather than a guess at where in the
   * markup a signature belongs.
   */
  counterSign?: boolean;

  /**
   * The day the OTHER side signed, where that is not the day they press
   * the button.
   *
   * Some of these deals are written up after the fact. Set, it is printed
   * on their line and the slot is not left for signing to fill, so
   * countersigning cannot overwrite it. Blank, their line is dated the day
   * they actually sign, which is the ordinary case.
   */
  counterOn?: string;
};

/** One home in the deal. Dollars, not cents: these go on paper. */
export type Home = {
  /** The lot as the park files it: "17", "3124". */
  lot: string;
  /**
   * The park this one stands in, where it is not the deal's.
   *
   * Everything else on a deal is genuinely per-deal -- one rate, one lot
   * rent, one set of dates. The park is not: an investor taking four
   * homes at the Retreat and one at Northside would otherwise get five
   * leases all naming whichever park happened to be first, and a lease
   * naming the wrong park is a lease about land we did not let them.
   */
  parkName?: string;
  /** Make, model, beds/baths, serial -- the paragraph that identifies it. */
  describedAs: string;
  price: number;
  down: number;
};

export const DEFAULTS: Terms = {
  seller: "Larabee Homes LLC",
  /* The park owner is the company on every deal. It was a person here,
     which put "Benjamin Cade Larabee" on the Park Owner line of every
     lease until somebody noticed and retyped it. */
  parkOwner: "Larabee Homes LLC",
  buyer: "",
  parkName: "the Retreat",
  state: "North Carolina",
  agreedOn: "",
  leaseFrom: "",
  financed: true,
  ratePct: 0,
  termYears: 20,
  perYear: 12,
  payMethod: "wire transfer or in certified funds payable to Seller or designee",
  lotRent: 500,
  consulting: 50,
  /* $500 A LOT, UP TO $2,500. Both figures are the attorney's draft,
     word for word: "a reserve fund in the amount of $500.00 (Five
     Hundred Dollars) for each Lot leased by Homeowner in the Park (up to
     a maximum of $2,500.00 in the aggregate)". This said 750, which came
     from nowhere -- the old generator says $500 as well, and the only
     papers that ever carried $750 are the ALDERCREST pack. */
  reserve: 500,
  reserveCap: 2500,
  leaseForm: "house",
  noticeDays: 60,
  rofrDays: 30,
  escalate: true,
  escalatePct: 3,
  escalateApplies: "lot rent and consulting fee",
  late: true,
  graceDays: 10,
  /* $100 on every template. The attorney's draft says $100 and a late
     charge that differs by which chip is selected is a term nobody
     chose. */
  lateFee: 100,
  security: true,
  insure: true,
  notary: false,
  amortize: true,
  amortDetail: "annual",
};

/**
 * The three templates.
 *
 * Only the switches and the notice periods: the money on a deal is typed
 * in every time and a template that silently changed a rate or a lot rent
 * would be a template that changed the price of the home.
 *
 * `changes` is applied over whatever is on screen, so picking a template
 * after filling the figures in keeps the figures.
 */
export type Template = {
  key: string;
  name: string;
  /** What it switches, in the words the screen shows beside it. */
  blurb: string;
  changes: Partial<Terms>;
};

export const TEMPLATES: Template[] = [
  {
    key: "house",
    name: "Larabee Homes",
    blurb: "Our lease: annual escalation, 60 days' notice, 30 days to match"
      + " an offer.",
    changes: {
      escalate: true, escalatePct: 3,
      escalateApplies: "lot rent and consulting fee",
      late: true, graceDays: 10, lateFee: 100,
      security: true, insure: true, amortize: true,
      noticeDays: 60, rofrDays: 30, leaseForm: "house",
    },
  },
  {
    key: "investor",
    name: "Investor-friendly",
    blurb: "Their lease: a 33% ceiling on rent rises, 180 days if the park"
      + " is sold, subletting allowed. No escalation, 60 days' notice,"
      + " 15 days to match an offer.",
    changes: {
      escalate: false,
      /* THE LIEN AND THE LATE FEE STAY ON HERE TOO.
         They used to be what made this template "investor-friendly", and
         that was decided before the attorney's draft existed. That draft
         carries both -- a $100 late charge with thirty days to cure, and
         a purchase-money lien with title retained until paid. Dropping
         them gave away the security on a $62,140 note, silently, because
         a chip was selected. What makes this template investor-friendly
         now is the LEASE: the 33% ceiling on rent, 180 days if the park
         is sold, the right to sublet. */
      /* 60 days and 10 days, as the attorney's draft has them. These were
         90 and 15 -- numbers chosen before that draft existed, quietly
         overriding two terms somebody negotiated. Same fault as the lien:
         a chip changing a term nobody chose. */
      late: true, graceDays: 10, lateFee: 100,
      security: true, insure: true, amortize: true,
      noticeDays: 60, rofrDays: 15, leaseForm: "investor",
    },
  },
  {
    key: "custom",
    name: "Custom",
    blurb: "Every switch below is yours. Changing any of them puts the"
      + " papers here.",
    changes: {},
  },
];

/** Which template the terms on screen match, or "custom". */
export function templateOf(t: Terms): string {
  for (const tpl of TEMPLATES) {
    if (tpl.key === "custom") continue;
    const keys = Object.keys(tpl.changes) as (keyof Terms)[];
    if (keys.every((k) => t[k] === tpl.changes[k])) return tpl.key;
  }
  return "custom";
}

// ---- the generator's own helpers, unchanged ---------------------------

export const money = (n: number) =>
  (isFinite(n) ? n : 0).toLocaleString("en-US",
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money0 = (n: number) =>
  Math.round(isFinite(n) ? n : 0).toLocaleString("en-US");

/** HTML, because the documents are printed and carry bold runs. */
export const esc = (s: string) =>
  (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function longDate(v: string): string {
  if (!v) return "________________";
  const [y, m, d] = v.split("-").map(Number);
  const months = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];
  const ord = d % 10 === 1 && d !== 11 ? "st"
    : d % 10 === 2 && d !== 12 ? "nd"
    : d % 10 === 3 && d !== 13 ? "rd" : "th";
  return `${d}${ord} day of ${months[m - 1]}, ${y}`;
}

export function shortDate(v: string): string {
  if (!v) return "____/____/______";
  const [y, m, d] = v.split("-");
  return `${m}/${d}/${y}`;
}

/** Whole dollars in words, the way a contract says an amount twice. */
export function words(n: number): string {
  n = Math.round(n);
  const a = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight",
    "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen",
    "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy",
    "Eighty", "Ninety"];
  function under1000(x: number): string {
    let s = "";
    if (x >= 100) { s += a[Math.floor(x / 100)] + " Hundred"; x %= 100; if (x) s += " "; }
    if (x >= 20) { s += b[Math.floor(x / 10)]; x %= 10; if (x) s += "-" + a[x]; }
    else if (x) s += a[x];
    return s;
  }
  if (n === 0) return "Zero";
  let s = "";
  for (const [name, val] of [["Million", 1e6], ["Thousand", 1e3]] as const) {
    if (n >= val) { s += under1000(Math.floor(n / val)) + " " + name + " "; n %= val; }
  }
  s += under1000(n);
  return s.trim();
}

export const dollarsWords = (n: number) =>
  words(n) + (Math.round(n) === 1 ? " Dollar" : " Dollars");

/** The level payment that clears a balance over a term. */
export function payment(P: number, apr: number, yrs: number, freq: number): number {
  const r = apr / 100 / freq, n = yrs * freq;
  if (r === 0) return P / n;
  return P * r / (1 - Math.pow(1 + r, -n));
}

// ---- the documents ----------------------------------------------------

export function amortization(t: Terms, home: Home): string {
  const balance = home.price - home.down;
  const rate = t.ratePct, term = t.termYears || 20, freq = t.perYear || 12;
  const pay = payment(balance, rate, term, freq);
  if (!(t.financed && t.amortize && balance > 0 && pay > 0)) return "";

  const r = rate / 100 / freq;
  let bal = balance, rows = "", totI = 0, totP = 0;
  if (t.amortDetail === "monthly") {
    const n = Math.round(term * freq);
    for (let k = 1; k <= n; k++) {
      const i = bal * r;
      let pr = pay - i;
      if (k === n || pr > bal) pr = bal;
      bal -= pr; totI += i; totP += pr;
      rows += `<tr><td>${k}</td><td>$${money(pay)}</td><td>$${money(pr)}</td>`
        + `<td>$${money(i)}</td><td>$${money(Math.max(bal, 0))}</td></tr>`;
      if (bal <= 0.005) break;
    }
    return `<h3>Schedule A — Amortization Schedule</h3>
        <p class="hint" style="text-align:left">Balance $${money0(balance)} · ${rate}% per annum · ${freq} payments/yr · payment $${money(pay)}. Illustrative; assumes no prepayment.</p>
        <table class="amort-tbl"><thead><tr><th>#</th><th>Payment</th><th>Principal</th><th>Interest</th><th>Balance</th></tr></thead><tbody>${rows}
        <tr><td><b>Tot</b></td><td></td><td><b>$${money0(totP)}</b></td><td><b>$${money0(totI)}</b></td><td></td></tr></tbody></table>`;
  }
  for (let y = 1; y <= term; y++) {
    let iY = 0, pY = 0;
    for (let m = 0; m < freq && bal > 0.005; m++) {
      const i = bal * r;
      let pr = pay - i;
      if (pr > bal) pr = bal;
      iY += i; pY += pr; bal -= pr;
    }
    totI += iY; totP += pY;
    rows += `<tr><td>${y}</td><td>$${money0(pY)}</td><td>$${money0(iY)}</td>`
      + `<td>$${money0(Math.max(bal, 0))}</td></tr>`;
  }
  return `<h3>Schedule A — Amortization Summary (annual)</h3>
        <p class="hint" style="text-align:left">Balance $${money0(balance)} · ${rate}% per annum · ${freq} payments of $${money(pay)}/yr. Illustrative; assumes no prepayment.</p>
        <table class="amort-tbl"><thead><tr><th>Year</th><th>Principal paid</th><th>Interest paid</th><th>Balance</th></tr></thead><tbody>${rows}
        <tr><td><b>Total</b></td><td><b>$${money0(totP)}</b></td><td><b>$${money0(totI)}</b></td><td></td></tr></tbody></table>`;
}

/**
 * What sits on our side of a signature line.
 *
 * The image goes ABOVE the rule rather than on it, because a signature
 * written through a printed line is what a photocopy looks like and this
 * is the original. Nothing is drawn at all without a signature to draw,
 * so an unsigned pack is exactly the document it was before.
 */
export function signedBy(t: Terms, on = true): string {
  if (!on || !t.signedPng) return "";
  return `<img class="sigink" src="${t.signedPng}" alt="Signature">`;
}

/**
 * The rule under a signature.
 *
 * A line is there to be signed ON. Once somebody has signed, it is a line
 * ruled through their name for no reason -- so a signed block has the
 * mark and no rule, and an unsigned one has the rule and no mark.
 */
export function signLine(t: Terms, on = true): string {
  return (on && t.signedPng) ? "" : `<div class="line"></div>`;
}

/** The date beside a signature: the day it was signed, or a line. */
export function signedDate(t: Terms, on = true): string {
  return (on && t.signedOn) ? shortDate(t.signedOn) : "__________________";
}

/**
 * The other side's signature line, named so it can be filled in later.
 *
 * Identical on the page to the rule it replaces. The name is in the
 * markup rather than in a position, because "the second rule in the
 * block" is the sort of thing that silently becomes the wrong rule.
 */
export function counterSlot(t: Terms, who: string): string {
  const line = `<div class="line"></div>`;
  return t.counterSign
    ? `<span class="signslot" data-for="${who}">${line}</span>`
    : line;
}

export function counterDate(t: Terms, who: string): string {
  /* A date somebody set wins, and carries no slot -- so signing fills
     nothing in over it. That is the whole of what "retroactive" means
     here. */
  if (t.counterOn) return shortDate(t.counterOn);
  const blank = "__________________";
  return t.counterSign
    ? `<span class="dateslot" data-for="${who}">${blank}</span>`
    : blank;
}

export function notaryBlock(what: string): string {
  return `<div class="sig" style="margin-top:30px;font-size:11pt">
    <p><b>ACKNOWLEDGMENT</b></p>
    <p>State of ____________________ &nbsp;&nbsp; County of ____________________</p>
    <p>On this ______ day of ____________, 20____, before me personally appeared the above‑named party(ies), known to me (or satisfactorily proven) to be the person(s) whose name(s) is/are subscribed to ${what}, and acknowledged that they executed the same for the purposes therein contained.</p>
    <div class="sig-block"><div class="line"></div>Notary Public &nbsp;&nbsp; My commission expires: __________</div>
  </div>`;
}

/**
 * The first of the month after this date.
 *
 * THE LEASE AND THE PAYMENTS START ON A FIRST. A sale closes on whatever
 * day it closes -- the 21st, the 27th -- and nothing good comes of a park
 * collecting rent on fifty-nine different days of the month. So the lease
 * runs from the first, the first payment falls on the first, and every
 * payment after it lands on the first too.
 *
 * The month after, not the month of: a sale closed on the 21st does not
 * owe a full month's rent ten days later.
 */
export function firstOfMonthAfter(iso: string): string {
  if (!iso) return "";
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** "August 27, 2026". The `longDate` form reads "the 27th day of August"
    and belongs after "made this the"; a payment that commences on one
    reads "commencing on 27th day of August", which is not English. The
    blanks in the agreement expect a plain date, so this fills them. */
export function plainDate(v: string): string {
  if (!v) return "________________";
  const [y, m, d] = v.split("-").map(Number);
  const months = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  return `${months[m - 1]} ${d}, ${y}`;
}

/** A count in words, lower case, the way a contract says a number twice:
    "three hundred sixty (360) consecutive monthly installments". `words`
    is Title Case because it writes dollars at the start of a clause. */
export const countWords = (n: number) => words(n).toLowerCase();

/** The same day of a later month, clamped where that month is shorter --
    the 31st plus one month is the 28th of February and not the 3rd of
    March, which is what a payment schedule means by "the same day". */
export function plusMonths(iso: string, n: number): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(),
    first.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(d, last);
  return `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1)
    .padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** "27th", for the day of each succeeding month. */
export function ordinalDay(iso: string): string {
  if (!iso) return "______";
  const d = Number(iso.split("-")[2]);
  const ord = d % 10 === 1 && d !== 11 ? "st"
    : d % 10 === 2 && d !== 12 ? "nd"
    : d % 10 === 3 && d !== 13 ? "rd" : "th";
  return `${d}${ord}`;
}

/**
 * THE DATES THE AGREEMENT LEAVES BLANK, worked out rather than left for
 * somebody to write in.
 *
 * The clean document has `commencing on _________, 2026`, `the _____ day
 * of each succeeding month` and a Maturity Date of `_________, 20____`.
 * Every one of them follows from the figures already on the deal: the
 * first payment is a month after the agreement, it recurs on that day,
 * and the last of n payments lands n-1 months after the first. A blank on
 * a contract is a thing somebody fills in wrong at the kitchen table.
 */
export function schedule(t: Terms) {
  const n = Math.max(1, Math.round((t.termYears || 20) * (t.perYear || 12)));
  /* The first of the month after the agreement, not one month to the day
     after it. Every instalment then falls on a first, and so does the
     maturity date, because plusMonths off a first stays on a first. */
  const first = firstOfMonthAfter(t.agreedOn);
  return { count: n, first, day: ordinalDay(first),
           maturity: plusMonths(first, n - 1) };
}

export function purchaseAgreement(t: Terms, home: Home, sign = true): string {
  const seller = esc(t.seller) || "____________";
  const buyer = esc(t.buyer) || "____________________";
  const price = home.price, down = home.down, balance = price - down;
  const rate = t.ratePct, term = t.termYears || 20, freq = t.perYear || 12;
  const pay = payment(balance, rate, term, freq);
  const s = schedule(t);

  /* The money, lettered (a) and (b) as the agreement has it. The cash
     case keeps its own sentence: a payment schedule with no balance to
     schedule reads as an oversight rather than as a cash sale. */
  const payPara = t.financed
    ? `<p>The total purchase price for the mobile home is <span class="fill">$${money(price)}</span> (the &ldquo;Purchase Price&rdquo;), payable as follows:</p>
    <p>(a) <span class="fill">$${money(down)}</span> upon execution of this Agreement as a down payment, receipt of which is acknowledged by Seller; and</p>
    <p>(b) the balance of <span class="fill">$${money(balance)}</span>, together with interest at the rate of <span class="fill">${rate ? rate.toFixed(2) : "____"}%</span> per annum, shall be paid in ${countWords(s.count)} (${s.count}) consecutive monthly installments of <span class="fill">$${money(pay)}</span> each, commencing on <span class="fill">${plainDate(s.first)}</span> and continuing on the <span class="fill">${s.day}</span> day of each succeeding month until paid in full. The entire unpaid principal balance, together with all accrued and unpaid interest and other sums due hereunder, shall in all events be due and payable on <span class="fill">${plainDate(s.maturity)}</span> (the &ldquo;Maturity Date&rdquo;). This loan is amortized over a ${countWords(term)} (${term}) year term in accordance with the amortization schedule attached hereto as Schedule A. All payments shall first be applied to accrued interest, then to principal, and thereafter to any other amounts properly due hereunder. Seller shall provide Purchaser, upon reasonable request, with a written statement showing the outstanding principal balance and the application of payments previously made. Payments shall be made to Seller at the address set forth above, or at such other place as Seller may designate in writing. Purchaser shall have the absolute right to prepay all or any portion of the outstanding balance at any time without premium, penalty or other charge. Any partial prepayment shall be applied to reduce principal.</p>`
    : `<p>The total purchase price for the mobile home is <span class="fill">$${money(price)}</span> (the &ldquo;Purchase Price&rdquo;), payable in full upon execution of this Agreement by certified funds payable to Seller, the receipt of which is acknowledged by Seller. No balance remains owing and no financing is extended by Seller in connection with this purchase.</p>`;

  const lateClause = (t.financed && t.late)
    ? `<p><span class="fill">Late Payment &amp; Default.</span> Any installment not received within ${t.graceDays || 10} days of its due date is subject to a late charge of $${money0(t.lateFee)}. If Purchaser shall default in the payment of any installment and such default shall continue for a period of thirty (30) days after delivery of written notice from Seller, then Seller may, declare the entire unpaid balance immediately due and payable, and Seller shall be entitled to pursue all remedies available at law, including repossession of the mobile home described above.</p>`
    : "";

  const securityClause = (t.financed && t.security)
    ? `<p><span class="fill">Security Interest.</span> Until the purchase price is paid in full, Seller retains a purchase-money security interest in and lien upon the mobile home described above. Title and/or the certificate of title shall remain with Seller and shall not pass to Purchaser until all sums due hereunder are paid in full. Purchaser shall not sell, transfer, remove, or further encumber the mobile home without Seller's prior written consent, which consent shall not be unreasonably withheld, conditioned or delayed.</p>`
    : "";

  const insureClause = t.insure
    ? `<p><span class="fill">Insurance &amp; Taxes.</span> Purchaser shall keep the mobile home insured against fire and casualty in an amount equal to the unpaid balance due Seller or the full insurable value of the mobile home, whichever is less, naming Seller as loss payee, and shall provide proof upon request. Purchaser shall be responsible for all personal-property taxes assessed on the Mobile home commencing on delivery of the mobile home and thereafter during the term of this Agreement.</p>`
    : "";

  /* Only where Seller is holding a lien in the first place: a clause
     promising to release one that was never taken reads as though there
     is something outstanding. */
  const releaseClause = (t.financed && t.security)
    ? `<p>Upon payment in full of all amounts due hereunder, Seller shall execute and deliver such documents as are reasonably necessary to release Seller's lien and transfer or confirm clear title to Purchaser, including a fully executed and notarized bill of sale completely detailing the mobile home being purchased, free and clear of all encumbrances, debts, liens, claims.</p>`
    : `<p>Seller shall deliver to Purchaser a fully executed and notarized bill of sale completely detailing the mobile home being purchased, free and clear of all encumbrances, debts, liens, claims.</p>`;

  return `
    <h2>PURCHASE AGREEMENT</h2>
    <p>THIS PURCHASE AGREEMENT (&ldquo;Agreement&rdquo;), made this the <span class="fill">${longDate(t.agreedOn)}</span>, by and between <span class="fill">${buyer}</span>, as Purchaser, and <span class="fill">${seller}</span>, as Seller.</p>
    <p class="witness">W I T N E S S E T H</p>
    <p>That Seller has offered to sell that certain mobile home to wit:</p>
    <p class="fill" style="text-align:left">${esc(home.describedAs) || "________________________________________________________________"}</p>
    ${payPara}
    ${lateClause}
    ${securityClause}
    ${insureClause}
    <p>That the parties agree that if this purchase shall not be completed as contracted due to breach by the Seller, then all funds previously paid hereunder by Purchaser shall be refunded to Purchaser. The parties further agree that if this purchase shall not be completed as contracted due to breach by Purchaser, then all funds previously paid hereunder by Purchaser shall be forfeited to Seller as liquidated damages resulting from such breach.</p>
    ${releaseClause}
    <p>Seller represents that Seller is the lawful owner of the mobile home and has authority to sell it. At the time required for transfer of title, Seller shall convey title free of liens created by Seller, other than Seller's lien securing Purchaser's obligations under this Agreement. Seller further represents to Purchaser that Seller has no knowledge of any legal impediment to the sale of the mobile home described above. If ownership of the mobile home is transferred by Certificate of Title, then the transfer of the same to Purchaser, or as directed by Purchaser, shall serve the same purpose as the Bill of Sale and shall be accepted by Purchaser in lieu thereof.</p>
    <p><span class="fill">Notices.</span> Any notice required under this Agreement shall be in writing and delivered personally, by nationally recognized overnight courier, or by certified mail, return receipt requested, to the addresses stated above, or to such other address as a party may designate by written notice. Any additional method or period of notice required by applicable law shall control.</p>
    <h3>Counterparts; Electronic Signatures</h3>
    <p>This Agreement may be executed in counterparts, each of which shall constitute an original and all of which together shall constitute one agreement. Electronic and PDF signatures shall be deemed originals and shall be binding upon the parties to the fullest extent permitted by law.</p>
    <p>IN WITNESS WHEREOF, the parties hereto have executed this instrument effective the day and year first above written.</p>
    <div class="sig">
      <div class="sig-block"><b>SELLER:</b>${signedBy(t, sign)}${signLine(t, sign)}${seller}<br>Date: ${signedDate(t, sign)}</div>
      <div class="sig-block"><b>BUYER:</b>${counterSlot(t, "buyer")}${buyer}<br>Date: ${counterDate(t, "buyer")}</div>
    </div>
    ${amortization(t, home)}
    ${t.notary ? notaryBlock("this Purchase Agreement") : ""}
  `;
}

/**
 * THE INVESTOR LEASE, from the owner's clean document.
 *
 * Not a reworded version of the one below: it gives away things that one
 * does not, and every one of them is a term somebody negotiated rather
 * than a sentence somebody tidied.
 *
 *   - lot rent and the consulting fee cannot rise above what a third of
 *     the park already pays
 *   - the park may not be terminated while the homeowner is current on
 *     what they owe, except for cause
 *   - 180 days and a penalty-free payoff if the park is sold or closed
 *   - the home may be sublet, on uniform screening, without it being an
 *     assignment of the lease
 *   - indemnity runs both ways, each side paying its own defence
 *
 * That is why it is a choice and not a replacement. Larabee Homes draws
 * the lease below, as it always has.
 */
export function investorLease(t: Terms, home: Home, sign = true): string {
  const parkOwner = esc(t.parkOwner) || "____________";
  const buyer = esc(t.buyer) || "____________________";
  const parkName = esc(home.parkName ?? "") || esc(t.parkName) || "the Park";
  const state = esc(t.state) || "[State]";
  const notice = t.noticeDays || 60;
  const rofr = t.rofrDays || 15;
  const lot = esc(home.lot);

  return `
    <h2>MOBILE HOME PARK LAND LEASE AGREEMENT</h2>
    <p>This Mobile Home Park Land Lease Agreement (&ldquo;Agreement&rdquo;) is made and entered into as of the <span class="fill">${longDate(t.leaseFrom)}</span>, by and between: Park Owner: <span class="fill">${parkOwner}</span> (&ldquo;Park Owner&rdquo;); Mobile Home Owner: <span class="fill">${buyer}</span> (&ldquo;Homeowner&rdquo;); Lot Number: <span class="fill">${lot || "____________"}</span> (&ldquo;Lot&rdquo;).</p>

    <h3>1. Premises</h3>
    <p>Park Owner agrees to lease to Homeowner, and Homeowner agrees to lease from Park Owner, the parcel of land identified as Lot <span class="fill">${lot || "________"}</span> in ${parkName} (the &ldquo;Park&rdquo;). This lease entitles the Homeowner to place and maintain a mobile home on the designated Lot within the Park. The Lot consists solely of the land comprising the designated home site, together with Homeowner&rsquo;s right to use such common areas, roads and facilities of the Park as Park Owner may from time to time designate for the common use of Park residents, subject to this Lease and the rules and regulations of the Park.</p>

    <h3>2. Term</h3>
    <p>This Agreement shall be effective as of the date above and shall continue in effect on a month-to-month basis, unless terminated by either party in accordance with the terms herein. Notwithstanding the month-to-month nature of this Agreement, Park Owner shall not voluntarily terminate this Agreement while Homeowner is current on any existing debt owed on the mobile home, except for cause and upon not less than sixty (60) days&rsquo; prior written notice to Homeowner, or such longer period as may be required by applicable law. Notwithstanding the foregoing, in the event Park Owner sells, transfers, or otherwise disposes of the Park, or ceases to operate the Park as a mobile home community, Park Owner or its successor may terminate this Agreement upon not less than one hundred eighty (180) days&rsquo; prior written notice to Homeowner, whether or not Homeowner is then current on any debt owed on the mobile home. If such termination occurs while Homeowner still owes a balance to Park Owner or its affiliates, Homeowner may, at its option, prepay the remaining balance without penalty or relocate the mobile home, and Park Owner shall cooperate reasonably in any such relocation or payoff.</p>

    <h3>3. Lot Rent</h3>
    <p>Homeowner agrees to pay to Park Owner monthly rent in the amount of <span class="fill">$${money(t.lotRent)}</span> (${dollarsWords(t.lotRent)}) for the use of the Lot. This amount is subject to change as specified below.</p>

    <h3>4. Rent Adjustment</h3>
    <p>The monthly lot rent is <span class="fill">$${money(t.lotRent)}</span>. Any increase in rent shall be effective ${notice} days following written notice from Park Owner to Homeowner; provided, however, in no event shall the lot rent increase to an amount greater than the lot rent then being paid by at least thirty-three percent (33%) of the homeowners in the Park.</p>

    <h3>5. Monthly Consulting Fee</h3>
    <p>In addition to the Lot Rent specified in Section 3, the Homeowner agrees to pay a monthly consulting fee of <span class="fill">$${money(t.consulting)}</span> (${dollarsWords(t.consulting)}) to Park Owner (or an affiliate thereof) for ongoing consulting services. This fee will remain in effect for the duration of this Agreement, provided that the Homeowner or its affiliates maintains an interest in the mobile home park land owned by ${parkOwner} or any of its affiliates. The Park Owner may adjust or terminate the consulting fee upon ${notice} days&rsquo; written notice to the Homeowner; provided, however, in no event shall the consulting fee increase to an amount greater than the consulting fee then being paid by at least thirty-three percent (33%) of the homeowners in the Park.</p>

    <h3>6. Park Rules and Regulations</h3>
    <p>Both the Homeowner and the Park Owner agree to comply with all rules and regulations of the Park, as they may be amended from time to time. These rules and regulations will be provided to the Homeowner upon execution of this Agreement and may be updated with reasonable notice. Homeowner is responsible for ensuring that their guests, tenants, and any other occupants of the mobile home also comply with these rules.</p>

    <h3>7. Use of Premises</h3>
    <p>The Homeowner agrees to use the leased Lot exclusively for the placement and maintenance of a mobile home and related uses consistent with the Park&rsquo;s rules and regulations. The Homeowner shall not use the Lot for any unlawful or hazardous activities.</p>

    <h3>8. Maintenance and Repairs</h3>
    <p>The Homeowner is responsible for maintaining the mobile home in a safe and sanitary condition, including all plumbing, electrical, and mechanical systems within the mobile home. The Park Owner shall maintain the common areas of the Park, including roads, utilities, and any shared amenities, unless otherwise agreed.</p>

    <h3>9. Termination</h3>
    <p>Subject to the terms set forth in Section 2 hereof, either party may terminate this Agreement by providing ${notice} days&rsquo; written notice to the other party. If the Homeowner wishes to vacate the premises or terminate the lease, the Homeowner must give written notice to the Park Owner at least ${notice} days prior to vacating. The Park Owner may terminate this Agreement for cause in accordance with applicable laws. Homeowner shall not remove the mobile home from the Lot while any amount is owed to Park Owner or its affiliates without Park Owner&rsquo;s consent, which consent shall not be unreasonably withheld.</p>

    <h3>10. Indemnification</h3>
    <p>Homeowner agrees to indemnify and hold harmless the Park Owner from any loss, damage, or liability arising out of Homeowner&rsquo;s use of the Lot or any violation of this Agreement or Park rules and regulations. Park Owner shall indemnify and hold harmless Homeowner and Homeowner&rsquo;s subtenants from any loss, damage, or liability arising out of the negligence or willful misconduct of Park Owner or Park Owner&rsquo;s agents, employees, contractors or representatives. Each party shall bear its own costs of defense.</p>

    <h3>11. Governing Law</h3>
    <p>This Agreement shall be governed by and construed in accordance with the laws of the state of <span class="fill">${state}</span>, without regard to its conflict of laws principles.</p>

    <h3>12. Entire Agreement</h3>
    <p>This Agreement constitutes the entire understanding between the parties and supersedes any prior negotiations, understandings, or agreements, whether written or oral, between the parties regarding the subject matter hereof.</p>

    <h3>13. Right of First Refusal, Sale of Mobile Home, and Renter Approval</h3>
    <p>(a) <b>Right of First Refusal:</b> In the event the Homeowner wishes to sell the mobile home, the Park Owner shall have the first right of refusal to purchase the mobile home. The Homeowner must provide written notice to the Park Owner of the intent to sell, including the terms of the sale, and the Park Owner shall have ${countWords(rofr)} (${rofr}) days to respond with an offer to purchase the mobile home on the same terms, and must close within thirty (30) days of such notice by Homeowner. If the Park Owner does not exercise the right of first refusal, or fails to close within said thirty (30) days, then the Homeowner may proceed with the sale to a third party.</p>
    <p>(b) <b>Park Owner&rsquo;s Consent to Sale:</b> Where the mobile home will remain on the Lot, the Park Owner&rsquo;s consent is required for the sale of the mobile home, which consent shall not be unreasonably withheld provided the proposed purchaser meets the qualifications for residency in the Park, including but not limited to the buyer&rsquo;s ability to comply with the Park&rsquo;s rules and regulations.</p>
    <p>(c) <b>Outstanding Debt on Home:</b> Any sale of the mobile home by the Homeowner is contingent upon the payment in full of any existing debt or financial obligations owed on the mobile home. The Homeowner must ensure that all such debts are satisfied prior to completing the sale.</p>
    <p>(d) <b>Renter and Subtenant Approval:</b> Homeowner shall have the right to lease, sublease, license or otherwise permit the occupancy of Homeowner&rsquo;s mobile home to or by any third party (a &ldquo;Subtenant&rdquo;), with Park Owner&rsquo;s consent, which consent shall not be unreasonably withheld, provided that (i) the proposed Subtenant first satisfies the Park Owner&rsquo;s standard screening criteria, including background, credit and income verification applied on a uniform and non-discriminatory basis, (ii) the Subtenant uses the home for lawful residential purposes, and (iii) the Subtenant agrees in writing to comply with the reasonable and uniformly enforced rules and regulations of the Park. Any sublease of the home shall not constitute an assignment or transfer of this Agreement, and Homeowner shall retain all rights under this Lease, including Homeowner&rsquo;s rights with respect to the Lot and Homeowner&rsquo;s ownership of the home.</p>
    <p>(e) <b>Reserve Fund:</b> The Homeowner agrees to maintain a reserve fund in the amount of <span class="fill">$${money(t.reserve)}</span> (${dollarsWords(t.reserve)}) for each Lot leased by Homeowner in the Park (up to a maximum of <span class="fill">$${money(t.reserveCap)}</span> in the aggregate) to cover any potential expenses that may arise during the term of this Agreement. This reserve must be kept in an accessible account, and the Park Owner may require proof of the reserve fund&rsquo;s availability upon request.</p>

    <h3>14. Notices</h3>
    <p>Any notices required to be given under this Agreement shall be delivered in writing. Notices to the Park Owner must be delivered in writing at least ${notice} days prior to any proposed action, such as termination, rent adjustment, or other significant changes. Notices to the Homeowner may be delivered by mail, in person, overnight courier, or by electronic means if agreed upon by both parties.</p>

    <h3>15. Counterparts and Electronic Signatures</h3>
    <p>This Agreement may be executed in counterparts, each of which shall constitute an original and all of which together shall constitute one agreement. Electronic and PDF signatures shall be deemed originals and shall be binding upon the parties to the fullest extent permitted by law.</p>

    <p>IN WITNESS WHEREOF, the parties hereto have executed this Mobile Home Park Land Lease Agreement as of the day and year first above written.</p>
    <div class="sig">
      <div class="sig-block"><b>Park Owner:</b>${signedBy(t, sign)}${signLine(t, sign)}Name: ${parkOwner}<br>Date: ${signedDate(t, sign)}</div>
      <div class="sig-block"><b>Home Owner:</b>${counterSlot(t, "homeowner")}Name: ${buyer}<br>Date: ${counterDate(t, "homeowner")}</div>
    </div>
    ${t.notary ? notaryBlock("this Lease Agreement") : ""}
  `;
}

/**
 * The lease, whichever one this deal is on.
 *
 * Everything that draws a pack calls this and never asks which: the pack,
 * the Word and PDF files, the signing slots and the countersigning all
 * work on the html that comes back. One place decides, so a screen cannot
 * show one lease and a download hand over the other.
 */
export function landLease(t: Terms, home: Home, sign = true): string {
  if (t.leaseForm === "investor") return investorLease(t, home, sign);
  return houseLease(t, home, sign);
}

function houseLease(t: Terms, home: Home, sign = true): string {
  const parkOwner = esc(t.parkOwner) || "____________";
  const buyer = esc(t.buyer) || "____________________";
  const parkName = esc(home.parkName ?? "") || esc(t.parkName) || "the Park";
  const state = esc(t.state) || "[State]";
  const notice = t.noticeDays || 60;
  const rofr = t.rofrDays || 30;
  const lot = esc(home.lot);

  const escClause = t.escalate
    ? `<h3>4A. Annual Rent Escalation</h3>
    <p>Beginning on the first anniversary of the effective date and on each anniversary thereafter, the ${t.escalateApplies} shall automatically increase by <span class="fill">${t.escalatePct}%</span> over the amount in effect during the preceding year, to account for inflation and rising operating costs. This automatic adjustment is in addition to, and does not limit, the Park Owner's right to adjust rent under Section 4 upon ${notice} days' written notice.</p>`
    : "";

  return `
    <h2>MOBILE HOME PARK LAND LEASE AGREEMENT</h2>
    <p>This Mobile Home Park Land Lease Agreement (“Agreement”) is made and entered into as of the <span class="fill">${longDate(t.leaseFrom)}</span>, by and between:</p>
    <p><b>Park Owner:</b> ${parkOwner} (hereinafter referred to as “Park Owner”)<br>
       <b>Mobile Home Owner:</b> ${buyer} (hereinafter referred to as “Homeowner”)<br>
       <b>Lot Number:</b> <span class="fill">${lot || "____________"}</span> (hereinafter referred to as “Lot”)</p>

    <h3>1. Premises</h3>
    <p>Park Owner agrees to lease to Homeowner, and Homeowner agrees to lease from Park Owner, the parcel of land identified as Lot <span class="fill">${lot || "________"}</span> in ${parkName} (the “Park”). This lease entitles the Homeowner to place and maintain a mobile home on the designated Lot within the Park.</p>

    <h3>2. Term</h3>
    <p>This Agreement shall be effective as of the date above and shall continue in effect on a month‑to‑month basis, unless terminated by either party in accordance with the terms herein.</p>

    <h3>3. Lot Rent</h3>
    <p>Homeowner agrees to pay to Park Owner monthly rent in the amount of <span class="fill">$${money(t.lotRent)}</span> (${dollarsWords(t.lotRent)}) for the use of the Lot. This amount is subject to change as specified below.</p>

    <h3>4. Rent Adjustment</h3>
    <p>The monthly lot rent is <span class="fill">$${money(t.lotRent)}</span>. Any increase in rent shall be effective ${notice} days following written notice from Park Owner to Homeowner.</p>
    ${escClause}

    <h3>5. Monthly Consulting Fee</h3>
    <p>In addition to the Lot Rent specified in Section 3, the Homeowner agrees to pay a monthly consulting fee of <span class="fill">$${money(t.consulting)}</span> (${dollarsWords(t.consulting)}) to Park Owner (or an affiliate thereof) for ongoing consulting services. This fee will remain in effect for the duration of this Agreement, provided that the Homeowner or its affiliates maintain an interest in the mobile home park land owned by ${parkOwner} or any of its affiliates. The Park Owner may adjust or terminate the consulting fee upon ${notice} days' written notice to the Homeowner.</p>

    <h3>6. Park Rules and Regulations</h3>
    <p>Both the Homeowner and the Park Owner agree to comply with all rules and regulations of the Park, as they may be amended from time to time. These rules and regulations will be provided to the Homeowner upon execution of this Agreement and may be updated with reasonable notice. Homeowner is responsible for ensuring that their guests, tenants, and any other occupants of the mobile home also comply with these rules.</p>

    <h3>7. Use of Premises</h3>
    <p>The Homeowner agrees to use the leased Lot exclusively for the placement and maintenance of a mobile home and related uses consistent with the Park’s rules and regulations. The Homeowner shall not use the Lot for any unlawful or hazardous activities.</p>

    <h3>8. Maintenance and Repairs</h3>
    <p>The Homeowner is responsible for maintaining the mobile home in a safe and sanitary condition, including all plumbing, electrical, and mechanical systems within the mobile home. The Park Owner shall maintain the common areas of the Park, including roads, utilities, and any shared amenities, unless otherwise agreed.</p>

    <h3>9. Termination</h3>
    <p>Either party may terminate this Agreement by providing ${notice} days' written notice to the other party. If the Homeowner wishes to vacate the premises or terminate the lease, the Homeowner must give written notice to the Park Owner at least ${notice} days prior to vacating. The Park Owner may terminate this Agreement for cause in accordance with applicable laws.</p>

    <h3>10. Indemnification</h3>
    <p>Homeowner agrees to indemnify and hold harmless the Park Owner from any loss, damage, or liability arising from Homeowner's use of the Lot or any violation of this Agreement or Park rules and regulations.</p>

    <h3>11. Governing Law</h3>
    <p>This Agreement shall be governed by and construed in accordance with the laws of the state of <span class="fill">${state}</span>, without regard to its conflict of laws principles.</p>

    <h3>12. Entire Agreement</h3>
    <p>This Agreement constitutes the entire understanding between the parties and supersedes any prior negotiations, understandings, or agreements, whether written or oral, between the parties regarding the subject matter hereof.</p>

    <h3>13. Right of First Refusal, Sale of Mobile Home, and Renter Approval</h3>
    <p>(a) <b>Right of First Refusal:</b> In the event the Homeowner wishes to sell the mobile home, the Park Owner shall have the first right of refusal to purchase the mobile home. The Homeowner must provide written notice to the Park Owner of the intent to sell, including the terms of the sale, and the Park Owner shall have ${rofr} days to respond with an offer to purchase the mobile home on the same terms. If the Park Owner does not exercise the right of first refusal, the Homeowner may proceed with the sale to a third party.</p>
    <p>(b) <b>Park Owner’s Right to Block Sale:</b> The Park Owner may block the sale of the mobile home if the potential buyer is deemed unfit to purchase the home or fails to meet the qualifications for residency in the Park, including but not limited to the buyer’s ability to comply with the Park’s rules and regulations. The Park Owner’s decision shall be final and binding.</p>
    <p>(c) <b>Outstanding Debt on Home:</b> Any sale of the mobile home by the Homeowner is contingent upon the payment in full of any existing debt or financial obligations owed on the mobile home. The Homeowner must ensure that all such debts are satisfied prior to completing the sale.</p>
    <p>(d) <b>Renter Approval:</b> Any new renter or tenant selected by the Homeowner to occupy the mobile home must be approved by the Park Owner. The Park Owner may approve or reject any potential tenant at their sole discretion unless the Park Owner has expressly granted written consent for an exception.</p>

    <h3>14. Notices</h3>
    <p>Any notices required to be given under this Agreement shall be delivered in writing. Notices to the Park Owner must be delivered in writing at least ${notice} days prior to any proposed action, such as termination, rent adjustment, or other significant changes. Notices to the Homeowner may be delivered by mail, in person, or by electronic means if agreed upon by both parties.</p>


    <h3>15. Reserve Fund</h3>
    <p>The Homeowner agrees to maintain a reserve fund in the amount of <span class="fill">$${money(t.reserve)}</span> (${dollarsWords(t.reserve)}) to cover any potential expenses that may arise during the term of this Agreement. This reserve must be kept in an accessible account, and the Park Owner may require proof of the reserve fund’s availability upon request.</p>

    <p>IN WITNESS WHEREOF, the parties hereto have executed this Mobile Home Park Land Lease Agreement as of the day and year first above written.</p>
    <div class="sig">
      <div class="sig-block"><b>Park Owner:</b>${signedBy(t, sign)}${signLine(t, sign)}Name: ${parkOwner}<br>Date: ${signedDate(t, sign)}</div>
      <div class="sig-block"><b>Homeowner:</b>${counterSlot(t, "homeowner")}Name: ${buyer}<br>Date: ${counterDate(t, "homeowner")}</div>
    </div>
    ${t.notary ? notaryBlock("this Lease Agreement") : ""}
  `;
}

/**
 * The whole pack: a purchase agreement and a lease for every home, each
 * starting on its own page.
 *
 * Eight homes is sixteen documents and one trip to the printer.
 */
/** Which document in a pack, as the screen and the papers both name it. */
export const docKey = (i: number, kind: "purchase" | "lease") => `${i}:${kind}`;

export function pack(
  t: Terms, homes: Home[], which: "both" | "purchase" | "lease" = "both",
  /**
   * Which documents carry our signature.
   *
   * Absent means all of them, which is what "sign this pack" means and
   * is what the screen asks for unless somebody says otherwise. Eight
   * homes is sixteen documents and there are real reasons to sign some
   * and not others -- a lease held back while a lot is surveyed, an
   * agreement going out for the buyer to counter.
   */
  signs?: (key: string) => boolean,
): string {
  const parts: string[] = [];
  homes.forEach((home, i) => {
    const on = (kind: "purchase" | "lease") =>
      signs ? signs(docKey(i, kind)) : true;
    if (which !== "lease") parts.push(purchaseAgreement(t, home, on("purchase")));
    if (which !== "purchase") parts.push(landLease(t, home, on("lease")));
  });
  return parts
    .map((html, i) => (i ? `<div class="pagebreak"></div>` : "")
      + `<div class="doc-sec">${html}</div>`)
    .join("\n");
}
