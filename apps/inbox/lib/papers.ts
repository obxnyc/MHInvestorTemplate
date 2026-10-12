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
  amortise: boolean;
  /** "annual" for one row a year, "monthly" for one a payment. */
  amortDetail: "annual" | "monthly";
};

/** One home in the deal. Dollars, not cents: these go on paper. */
export type Home = {
  /** The lot as the park files it: "17", "3124". */
  lot: string;
  /** Make, model, beds/baths, serial -- the paragraph that identifies it. */
  describedAs: string;
  price: number;
  down: number;
};

export const DEFAULTS: Terms = {
  seller: "Larabee Homes LLC",
  parkOwner: "Benjamin Cade Larabee",
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
  reserve: 750,
  noticeDays: 60,
  rofrDays: 30,
  escalate: true,
  escalatePct: 3,
  escalateApplies: "lot rent and consulting fee",
  late: true,
  graceDays: 10,
  lateFee: 50,
  security: true,
  insure: true,
  notary: false,
  amortise: true,
  amortDetail: "annual",
};

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

export function amortisation(t: Terms, home: Home): string {
  const balance = home.price - home.down;
  const rate = t.ratePct, term = t.termYears || 20, freq = t.perYear || 12;
  const pay = payment(balance, rate, term, freq);
  if (!(t.financed && t.amortise && balance > 0 && pay > 0)) return "";

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

export function notaryBlock(what: string): string {
  return `<div class="sig" style="margin-top:30px;font-size:11pt">
    <p><b>ACKNOWLEDGMENT</b></p>
    <p>State of ____________________ &nbsp;&nbsp; County of ____________________</p>
    <p>On this ______ day of ____________, 20____, before me personally appeared the above‑named party(ies), known to me (or satisfactorily proven) to be the person(s) whose name(s) is/are subscribed to ${what}, and acknowledged that they executed the same for the purposes therein contained.</p>
    <div class="sig-block"><div class="line"></div>Notary Public &nbsp;&nbsp; My commission expires: __________</div>
  </div>`;
}

export function purchaseAgreement(t: Terms, home: Home): string {
  const seller = esc(t.seller) || "____________";
  const buyer = esc(t.buyer) || "____________________";
  const price = home.price, down = home.down, balance = price - down;
  const rate = t.ratePct, term = t.termYears || 20, freq = t.perYear || 12;
  const pay = payment(balance, rate, term, freq);

  const payPara = t.financed
    ? `<p>That Purchaser has offered to purchase such personal property and has tendered <span class="fill">$${money(down)}</span> by certified funds payable to Seller as a down payment on such purchase, the receipt of which is hereby acknowledged by Seller. The balance of the purchase price or <span class="fill">$${money0(balance)}</span> shall be paid in installments of <span class="fill">$${money(pay)}</span> by ${esc(t.payMethod)}, with interest accruing on the remaining unpaid balance at the rate of <span class="fill">${rate || "____"}</span> per cent per annum. This loan is a <span class="fill">${term}-year</span> note. There is no penalty for prepayment to the Seller of the balance remaining due.</p>`
    : `<p>That Purchaser has offered to purchase such personal property and has tendered the full purchase price of <span class="fill">$${money(price)}</span> by certified funds payable to Seller as payment in full, the receipt of which is hereby acknowledged by Seller. No balance remains owing and no financing is extended by Seller in connection with this purchase.</p>`;

  const lateClause = (t.financed && t.late)
    ? `<p><span class="fill">Late Payment &amp; Default.</span> Any installment not received within ${t.graceDays || 10} days of its due date is subject to a late charge of $${money0(t.lateFee)}. If any installment remains unpaid for thirty (30) days, Seller may, after written notice, declare the entire unpaid balance immediately due and payable, and Seller shall be entitled to pursue all remedies available at law, including repossession of the personal property described above.</p>`
    : "";

  const securityClause = (t.financed && t.security)
    ? `<p><span class="fill">Security Interest.</span> Until the purchase price is paid in full, Seller retains a purchase‑money security interest in and lien upon the personal property described above. Title and/or the certificate of title shall remain with Seller and shall not pass to Purchaser until all sums due hereunder are paid in full. Purchaser shall not sell, transfer, remove, or further encumber the property without Seller's prior written consent.</p>`
    : "";

  const insureClause = t.insure
    ? `<p><span class="fill">Insurance &amp; Taxes.</span> Purchaser shall keep the property insured against fire and casualty for its full value, naming Seller as loss payee, and shall provide proof upon request. Purchaser shall be responsible for all personal‑property taxes assessed on the home during the term of this Agreement.</p>`
    : "";

  return `
    <h2>PURCHASE AGREEMENT</h2>
    <p>THIS PURCHASE AGREEMENT, made this the <span class="fill">${longDate(t.agreedOn)}</span>, by <span class="fill">${buyer}</span>, Purchaser, and <span class="fill">${seller}</span>, Seller.</p>
    <p class="witness">W I T N E S S E T H</p>
    <p>That Seller has offered to sell certain personal property to wit:</p>
    <p class="fill" style="text-align:left">${esc(home.describedAs) || "________________________________________________________________"}</p>
    ${payPara}
    ${lateClause}
    ${securityClause}
    ${insureClause}
    <p>That the parties agree that if this purchase shall not be completed as contracted due to breach by the Seller, then all funds previously paid hereunder by Purchaser shall be refunded to Purchaser. The parties further agree that if this purchase shall not be completed as contracted due to breach by Purchaser, then all funds previously paid hereunder by Purchaser shall be forfeited to Seller as liquidated damages resulting from such breach.</p>
    <p>Seller shall provide to Purchaser a fully executed and notarized bill of sale completely detailing the personal property being purchased which shall be delivered upon final payment to Seller, free and clear of all encumbrances, debts, liens, claims, and Seller has no knowledge of any legal impediment to sale of the personal property described above. If ownership of the personal property is transferred by Certificate of Title, then the transfer of the same to Purchaser, or as directed by Purchaser, shall serve the same purpose as the Bill of Sale and shall be accepted by Purchaser in lieu thereof.</p>
    <p>IN WITNESS WHEREOF, the parties hereto have executed this instrument effective the day and year first above written.</p>
    <div class="sig">
      <div class="sig-block"><b>SELLER:</b><div class="line"></div>${seller}</div>
      <div class="sig-block"><b>BUYER:</b><div class="line"></div>${buyer}</div>
    </div>
    ${amortisation(t, home)}
    ${t.notary ? notaryBlock("this Purchase Agreement") : ""}
  `;
}

export function landLease(t: Terms, home: Home): string {
  const parkOwner = esc(t.parkOwner) || "____________";
  const buyer = esc(t.buyer) || "____________________";
  const parkName = esc(t.parkName) || "the Park";
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
    <p><b>Park Owner:</b> ${parkOwner} (hereinafter referred to as "Park Owner")<br>
       <b>Mobile Home Owner:</b> ${buyer} (hereinafter referred to as "Homeowner")<br>
       <b>Lot Number:</b> <span class="fill">${lot || "____________"}</span> (hereinafter referred to as "Lot")</p>

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
    <p>In addition to the Lot Rent specified in Section 3, the Homeowner agrees to pay a monthly consulting fee of <span class="fill">$${money(t.consulting)}</span> (${dollarsWords(t.consulting)}) to Park Owner (or an affiliate thereof) for ongoing consulting services. This fee will remain in effect for the duration of this Agreement, provided that the Homeowner or its affiliates maintains an interest in the mobile home park land owned by ${parkOwner} or any of his affiliates. The Park Owner may adjust or terminate the consulting fee upon ${notice} days' written notice to the Homeowner.</p>

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
    <p>(e) <b>Reserve Fund:</b> The Homeowner agrees to maintain a reserve fund in the amount of <span class="fill">$${money(t.reserve)}</span> (${dollarsWords(t.reserve)}) to cover any potential expenses that may arise during the term of this Agreement. This reserve must be kept in an accessible account, and the Park Owner may require proof of the reserve fund’s availability upon request.</p>

    <h3>14. Notices</h3>
    <p>Any notices required to be given under this Agreement shall be delivered in writing. Notices to the Park Owner must be delivered in writing at least ${notice} days prior to any proposed action, such as termination, rent adjustment, or other significant changes. Notices to the Homeowner may be delivered by mail, in person, or by electronic means if agreed upon by both parties.</p>

    <p>IN WITNESS WHEREOF, the parties hereto have executed this Mobile Home Park Land Lease Agreement as of the day and year first above written.</p>
    <div class="sig">
      <div class="sig-block"><b>Park Owner:</b><div class="line"></div>Name: ${parkOwner}<br>Date: ${shortDate(t.leaseFrom)}</div>
      <div class="sig-block"><b>Homeowner:</b><div class="line"></div>Name: ${buyer}<br>Date: ${shortDate(t.leaseFrom)}</div>
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
export function pack(
  t: Terms, homes: Home[], which: "both" | "purchase" | "lease" = "both",
): string {
  const parts: string[] = [];
  for (const home of homes) {
    if (which !== "lease") parts.push(purchaseAgreement(t, home));
    if (which !== "purchase") parts.push(landLease(t, home));
  }
  return parts
    .map((html, i) => (i ? `<div class="pagebreak"></div>` : "")
      + `<div class="doc-sec">${html}</div>`)
    .join("\n");
}
