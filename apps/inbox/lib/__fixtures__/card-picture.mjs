/**
 * The lot card, drawn and looked at.
 *
 * The owner card shipped with its fields running off the side of the page,
 * a tick box stretched to the width of the card, and a date field clipped
 * to `mm/dd/y`. Every one of those is invisible to a type checker and to
 * every test in this repo, and obvious in a picture.
 *
 * So: render the card against the real stylesheet at four widths and fail
 * on the things a picture answers -- anything sticking out of the card,
 * anything pushing the page sideways, a control squashed below the size
 * it can be used at, and a label sitting on top of its own field.
 *
 *     node lib/__fixtures__/card-picture.mjs
 *
 * It writes /tmp/lot-card-<width>.png either way. Look at them.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "../../app/globals.css"), "utf8");

// The card as LotCard.tsx builds it, with every section showing at once:
// a home that is sold, financed, let, has a shed in the yard and two
// meters. The widest the card is ever asked to be.
const card = `
<aside class="lotcard">
  <header><h2>Lot 3123 Lady Cheryl Dr</h2><button class="x">&times;</button></header>
  <section class="lotbit"><h3>The home</h3>
    <div class="chips"><button class="btn">Park owned</button><button class="btn">Tenant owned</button>
    <button class="btn">Investor owned</button><button class="btn pri">No home on it</button></div>
    <label class="check"><input type="checkbox"> We let it and look after it</label></section>
  <section class="lotbit"><h3>Owner</h3>
    <form class="saleform">
      <div class="recall">
        <p>Copy a sale you have already recorded here.</p>
        <ul class="recalls">
          <li><button><strong>3107 Lady Cheryl Dr</strong>
            <span class="dim"> Habberstad Norse Ventures LLC &middot; 2026-08-10
            &middot; $95,600.00 &middot; $341.22/mo</span></button></li>
          <li><button><strong>3105 Lady Cheryl Dr</strong>
            <span class="dim"> Jernigan Holdings LLC &middot; 2026-07-02
            &middot; $38,500.00 &middot; outright</span></button></li>
        </ul>
      </div>
      <div class="ownerpick">
        <label>Who bought it<input value="Habb" placeholder="Start typing their name or LLC"></label>
        <ul class="ownerhits">
          <li><button class="on">Habberstad Norse Ventures LLC</button></li>
          <li><button>Habberstad Property Group</button></li>
          <li><button class="make">Add &ldquo;Habb&rdquo;</button></li>
        </ul>
      </div>
      <div class="two"><input placeholder="Their name or LLC"><button class="btn">Add them</button></div>
      <p class="memory">Their last deal: $38,500, financed at $612 a month over 84 months.</p>
      <div class="three"><label>Sold on<input type="date"></label>
        <label>Price<input></label><label>Down<input></label></div>
      <label class="check"><input type="checkbox"> We hold the note</label>
      <div class="three"><label>Monthly<input></label><label>Rate %<input></label>
        <label>Months<input></label></div>
      <label>First payment due<input type="date"></label>
      <p class="memory">Every month, from the day it sells</p>
      <div class="three"><label>Lot fee<input></label><label>Consultancy<input></label>
        <label>Warranty<input></label></div>
      <div class="three"><label>Tenant rent<input></label><label>Pet fee<input></label>
        <label>Late fee<input></label></div>
      <div class="three"><label>Year<input></label><label>Make<input></label>
        <label>Serial<input></label></div>
      <label>Note<textarea rows="2"></textarea></label>
    </form></section>
  <section class="lotbit"><h3>Every month</h3>
    <form class="saleform">
      <p class="memory">The owner pays the park</p>
      <p class="dim">Mortgage $612.00 a month, from the note above.</p>
      <div class="three"><label>Lot fee<input></label><label>Consultancy<input></label>
        <label>Warranty<input></label></div>
      <label class="check"><input type="checkbox"> They carry their own insurance</label>
      <p class="memory">The tenant pays</p>
      <div class="three"><label>Rent<input></label><label>Pet fee<input></label>
        <label>Late fee<input></label></div></form></section>
  <section class="lotbit"><h3>What we have spent</h3>
    <ul class="lotlist">
      <li><strong>$485.00</strong> Water heater <span class="dim">&middot; 2026-09-14</span>
        <button class="aslink">remove</button></li>
      <li><strong>$120.00</strong> Damage we caused
        <span class="dim">&middot; ours, not deducted</span>
        <button class="aslink">remove</button></li>
    </ul>
    <form class="rowform"><div class="three">
      <label>What<input placeholder="Water heater"></label>
      <label>Cost<input placeholder="485"></label>
      <label>When<input type="date"></label></div>
      <label class="check"><input type="checkbox" checked> Take it off the owner</label>
      <button class="btn">Add expense</button></form></section>
  <section class="lotbit"><h3>What we send them</h3>
    <dl class="lotfacts">
      <dt>Rent in</dt><dd>$1,100.00</dd>
      <dt>They owe</dt><dd>$1,072.00 <span class="dim">mortgage + lot fee + consultancy + warranty</span></dd>
      <dt>We spent</dt><dd>$485.00</dd>
      <dt>Net to them</dt><dd><strong class="parkbad">-$457.00</strong></dd>
    </dl>
    <p class="dim">On the agreed charges, not on what has actually come in &mdash;
      nothing here knows yet whether the rent arrived.</p></section>
  <section class="lotbit"><h3>Storage in the yard</h3>
    <form class="rowform"><div class="three">
      <label>What<input placeholder="Shed"></label><label>Size<input placeholder="10x12"></label>
      <label>A month<input placeholder="45"></label></div>
      <button class="btn">Add storage</button></form></section>
  <section class="lotbit"><h3>Meters</h3>
    <form class="rowform"><div class="three">
      <label>Which<select><option>Water</option></select></label>
      <label>Number<input placeholder="81-440391"></label>
      <label>Provider<input placeholder="PWC"></label></div>
      <label>Account reference<input></label>
      <button class="btn">Add meter</button></form>
    <p class="dim">Recording one replaces the one in service and keeps the old number.</p></section>
</aside>`;

// And the same card for a home we still own, which is a different card:
// no buyer, no sale date, no price, no bill of sale -- nothing has been
// sold -- and three chips saying whether it is stock, a letting we mean
// to keep, or the laundry.
const owned = `
<aside class="lotcard">
  <header><h2>Lot 3100 Lady Viola Dr</h2><button class="x">&times;</button></header>
  <section class="lotbit"><h3>The home</h3>
    <div class="kindpick"><button class="chip on">Park owned</button>
      <button class="chip">Tenant owned</button><button class="chip">Investor owned</button>
      <button class="chip">No home on it</button></div>
    <p class="dim">We still own this one.</p>
    <div class="kindpick"><button class="chip on">Ours to sell</button>
      <button class="chip">We rent it out</button><button class="chip">Not a home</button></div>
    <p class="dim">Counted in what is left to sell. It can still be let in the meantime.</p>
  </section>
  <section class="lotbit"><h3>Every month</h3>
    <form class="saleform"><p class="memory">The tenant pays</p>
      <div class="three"><label>Rent<input></label><label>Pet fee<input></label>
        <label>Late fee<input></label></div>
      <div class="invacts"><button class="btn pri">Save the rent</button></div>
    </form></section>
  <section class="lotbit"><h3>Storage in the yard</h3>
    <form class="rowform"><div class="three">
      <label>What<input placeholder="Shed"></label><label>Size<input placeholder="10x12"></label>
      <label>A month<input placeholder="45"></label></div>
      <button class="btn">Add storage</button></form></section>
</aside>`;

// And the panel that takes the card's place while the homes are being
// moved: four arrows round a number, a tick, a box to retype the number
// in, and two buttons to step along the row. Three separate grids in a
// 23rem column, which is the exact shape of thing that has gone wrong
// here before -- a bare `1fr` that will not shrink, and a tick box
// stretched by a width of 100%.
const moving = `
<aside class="lotcard movecard">
  <header><h2>Lot 1140 Northside Rd Lot 17</h2><button class="x">&times;</button></header>
  <div class="movepad">
    <button class="up">&uarr;</button>
    <button class="left">&larr;</button>
    <span class="movenum">17</span>
    <button class="right">&rarr;</button>
    <button class="down">&darr;</button>
  </div>
  <label class="movewhole"><input type="checkbox"> <span>Move the whole row</span></label>
  <p class="movesay">Half a metre a press. The arrow keys do the same thing.</p>
  <form class="movenumber">
    <label for="lotno">Lot number</label>
    <input id="lotno" value="17">
    <button class="btn">Rename</button>
  </form>
  <div class="moveshape">
    <label for="lotangle">Angle</label>
    <div class="movebump">
      <button>&minus;</button><input id="lotangle" value="-38"><span class="movedeg">&deg;</span><button>+</button>
    </div>
    <div class="movetwo">
      <label>Wide (ft)<input value="16"></label>
      <label>Long (ft)<input value="60"></label>
    </div>
    <p class="movesay">This changes all 30 homes in the row, because they are
      one row of one model.</p>
    <button class="btn">Give this one its own shape</button>
  </div>
  <p class="movesay">1140 Northside Rd Lot 17 &mdash; what a sale or a lease is filed under.</p>
  <button class="moveoff">Take off the map</button>
  <div class="movestep">
    <button class="btn">&lsaquo; Previous</button>
    <button class="btn">Next &rsaquo;</button>
  </div>
</aside>`;

/* The lot list, with the vacancy clock and the blocker box on it.
 *
 * This row is a wrapping flex line that now carries a text field, which is
 * the exact shape that put the owner card's fields off the side of the page
 * the first time. A type checker cannot see it and neither can a test that
 * asks how long a lot has been empty. Four cases, because each fails
 * differently: a let lot (no clock at all), a short spell, a long one that
 * reads as the problem, and a database where 037 has not been run.
 */
const lots = `<div class="propcard"><div class="propbody">
<ul class="unitlist">
  <li><span class="ulabel">3124</span>
      <span class="uspec">3 bed &middot; 2 bath &middot; 1,064 sq ft</span>
      <span class="urent">$775/mo</span>
      <span class="whose ours">Our home<span class="serial">NCX1148821</span></span>
      <span class="ustate">Let</span>
      <button class="mini">Mark empty</button>
      <button class="mini">Details</button></li>
  <li class="vacant"><span class="ulabel">3114</span>
      <span class="uspec">3 bed &middot; 2 bath &middot; 1,064 sq ft</span>
      <span class="urent">$775/mo</span>
      <span class="whose ours">Our home<span class="serial">NCX1148822</span></span>
      <span class="ustate isvacant">Empty</span>
      <button class="mini">Mark let</button>
      <button class="mini">Details</button>
      <span class="uempty"><span>Empty 9 days</span>
        <span class="ublock"><input class="ublockin" value="Waiting on a showing"
          aria-label="What is stopping this lot being let"></span>
        <span class="ublocksay">Saved</span></span></li>
  <li class="vacant"><span class="ulabel">3120</span>
      <span class="uspec">2 bed &middot; 1 bath</span>
      <span class="urent">$650/mo</span>
      <span class="whose theirs">Their home</span>
      <span class="ustate isvacant">Empty</span>
      <button class="mini">Mark let</button>
      <button class="mini">Details</button>
      <span class="uempty"><span class="uslow">Empty about 3 months</span>
        <span class="ublock"><input class="ublockin"
          value="Flooring quote still not back from Carlos"
          aria-label="What is stopping this lot being let"></span>
        <button class="mini">Didn&rsquo;t save &mdash; try again</button></span></li>
  <li class="vacant"><span class="ulabel">3100</span>
      <span class="uspec">&mdash;</span>
      <span class="urent">&mdash;</span>
      <span class="whose none">Bare lot</span>
      <span class="ustate isvacant">Empty</span>
      <span class="uempty">
        <span class="unoclock">Run migration 037 for the clock</span></span></li>
</ul></div></div>`;

/* Looking for a home. A row of chips, a shortlist, and a row of outcome
 * buttons that wraps -- and the outcome row is the dangerous one, because
 * "Bought a house — never contact again" is a long label on a small button
 * and eight of them have to fit somewhere a thumb can reach.
 */
const lead = `<div class="leadlist"><div class="lead">
  <div class="leadhead">
    <span class="leadwho">Marcus Oyelaran</span>
    <a class="leadtel" href="#">+1 910 555 0147</a>
    <a class="mini" href="#">The conversation</a>
    <span class="leadwait">Asked 9 days ago &middot; sms</span>
  </div>
  <dl class="leadsaid">
    <div class="leadbit"><dt>Beds</dt><dd>3+<span class="leadfrom">read from &ldquo;3 bedroom&rdquo;</span></dd></div>
    <div class="leadbit"><dt>Up to</dt><dd>$900<span class="leadfrom">read from &ldquo;under $900&rdquo;</span></dd></div>
    <div class="leadbit"><dt>Area</dt><dd>Raeford<span class="leadfrom">read from &ldquo;Raeford&rdquo;</span></dd></div>
    <div class="leadbit"><dt>Pets</dt><dd>No<span class="leadfrom">read from &ldquo;no pets&rdquo;</span></dd></div>
    <div class="leadbit"><dt>From</dt><dd>2027-06-01</dd></div>
  </dl>
  <div class="leadfits"><h3>3 lots to ring them about</h3><ul>
    <li><span class="leadlot">1140 Northside Rd 51</span>
        <span class="leadspec">3 bed &middot; $725/mo</span>
        <span class="leadyes">fits what they asked for</span></li>
    <li class="leadnear"><span class="leadlot">The Retreat 3120</span>
        <span class="leadspec">3 bed &middot; $950/mo</span>
        <span class="leadbut">$950, a little over the $900 they said</span></li>
    <li class="leadnear"><span class="leadlot">The Retreat 3130</span>
        <span class="leadspec">3 bed</span>
        <span class="leadbut">no rent set, wanted up to $900</span></li>
  </ul></div>
  <div class="leadclose">
    <span class="leadask">How did it end?</span>
    <button class="leadout">Took one of ours</button>
    <button class="leadout">Rented somewhere else</button>
    <button class="leadout">Wrong area</button>
    <button class="leadout">Price did not work</button>
    <button class="leadout">Did not qualify</button>
    <button class="leadout forever">Bought a house &mdash; never contact again</button>
    <button class="leadout forever">Moved away &mdash; never contact again</button>
    <button class="leadout">Never found out</button>
    <button class="leadout">Not now</button>
  </div>
</div></div>
<ul class="leadempty">
  <li><span class="leadlot">The Retreat 3120</span>
      <span class="leadspec">2 bed &middot; $650/mo</span>
      <span class="leadslow">Empty about 3 months</span>
      <span class="leadblock">Flooring quote still not back from Carlos</span></li>
  <li><span class="leadlot">The Retreat 3114</span>
      <span class="leadspec">3 bed &middot; $775/mo</span>
      <span class="leadsince">Empty 9 days</span>
      <span class="leadnoblock">Nothing said about what is stopping it</span></li>
</ul>`;

/* Where the money is. One line per leak, the upside first, and a caveat
 * sentence that has to sit under its own figure rather than beside it. */
const where = `<section class="dashgroup"><h2>Where the money is</h2>
<ul class="leak">
  <li class="leakup"><span class="leaksays">3 people asked for something we have empty right now</span>
      <span class="leakfig">$2,175/mo if they let</span>
      <a class="leakgo" href="#">Ring them</a></li>
  <li><span class="leaksays">12 lots empty</span>
      <span class="leakfig">$7,425/mo</span>
      <span class="leakgone">$18,340 gone already</span>
      <span class="leakshort">4 of them have no rent on file, so the figure is low</span>
      <a class="leakgo" href="#">See them, longest empty first</a></li>
  <li><span class="leaksays">5 lots empty over 45 days with nothing said about what is stopping</span>
      <span class="leakfig">$3,100/mo</span>
      <a class="leakgo" href="#">Say what each one is waiting on</a></li>
  <li><span class="leaksays">9 finished jobs with no cost recorded, so that spend is not against any property</span>
      <span class="leaknofig">amount not known</span>
      <a class="leakgo" href="#">Put the costs on</a></li>
  <li><span class="leaksays">2 vendor invoices never sent to the bookkeeper</span>
      <span class="leakfig">$251</span>
      <a class="leakgo" href="#">Send them on</a></li>
</ul></section>`;

/* The top bar, with every destination an admin sees.
 *
 * `.topnav` carries min-width:0 and overflow-x:auto so it scrolls inside
 * itself rather than shoving the page sideways -- which is a comment in the
 * stylesheet and was not a check anywhere. A nav that pushes a phone screen
 * sideways is exactly what the picture pass already asks about, and the
 * account avatar going off the right edge takes the way to sign out with it.
 */
/* The header with the search bar open, which is the state that can go
 * wrong: a panel that overflows the page, a row whose label collides with
 * its title, a box squeezed to nothing between the brand and the nav. */
const header = `<header class="apphead">
  <a href="#" class="brandmark">
    <span class="brandlogo" style="width:32px;height:32px;display:inline-block;
      background:var(--sunk);border-radius:8px"></span>
    <span class="brandname">Larabee Homes</span></a>
  <div class="omni">
    <svg class="omniglass" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="2"></circle>
      <path d="M12.8 12.8 L17 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
    </svg>
    <input class="omnibox" type="search" value="cross crk" aria-label="Search everything">
    <div class="omnipanel" role="listbox">
      <div class="omnisum"><span class="omnisumq">775 * 12</span>
        <span class="omnisumv">9,300</span></div>
      <button class="omnirow on"><span class="omnit">Cross Creek Mobile Home Park</span>
        <span class="omnik">Property</span></button>
      <button class="omnirow"><span class="omnit">Rent roll</span>
        <span class="omnia">$42,310.00 a month from 54 let, $7,425.00 more if the 12 empty were let</span>
        <span class="omnik">Report</span></button>
      <button class="omnirow"><span class="omnit">1140 Northside Road 51</span>
        <span class="omnik">Lot</span></button>
    </div>
  </div>
  <nav class="topnav" aria-label="Main">
    <a href="#" class="on">Home</a><a href="#">Messages</a>
    <a href="#">Properties</a><a href="#">Leasing</a>
    <a href="#">On the clock</a><a href="#">Settings</a>
  </nav>
  <span class="av">AP</span>
</header>`;

/* The crew timesheet, in its busiest state: on the clock, on a break, a job
 * still to pick, two nudges, a week with hours in it and a correction
 * pending. The 420px pass is the real one -- this is read on a phone in a
 * work glove -- and the rest check it does not fall apart on a tablet.
 */
const clockin = `<main class="tsheet">
  <header class="tshead"><h1>Timesheet</h1><p class="tswho">Alex Prieto</p></header>
  <section class="tscard today onclock">
    <div class="tscardhead"><h2>Today</h2>
      <span class="tsbadge state">On the Clock</span></div>
    <p class="tsdate">Wednesday, 21 October</p>
    <div class="tsbig"><span class="tshours">7:12</span><span class="tsunit">hours</span></div>
    <p class="tsnote">30 minutes of breaks recorded</p>
    <button class="tsact stop">Clock Out</button>
    <button class="tsminor">Begin Break</button>
    <ul class="tsruns">
      <li><span class="tsspan">7:02 AM &ndash; 12:04 PM</span>
          <span class="tsplace">1140 Northside Road Mobile Home Community</span></li>
      <li><span class="tsspan">12:41 PM &ndash; now</span>
          <span class="tsplace">No job recorded</span></li>
    </ul>
    <div class="tsfield"><label for="job">Which job are you on?</label>
      <select id="job"><option>Select a property</option>
        <option>1140 Northside Road Mobile Home Community</option></select></div>
    <p class="tstrail">Your location is recorded every 10 minutes while you are
      on the clock, and stops when you clock out.</p>
  </section>
  <p class="tsnudge">Over 6 hours without a break on the clock. Take your lunch
    and tap Break so it is on the record.</p>
  <p class="tsnudge loud">That is 10.2 hours today, over the 10 hour day. Clock
    out, or tell your foreman why not.</p>
  <button class="tsminor wide">Submit 7:12 Hours for Approval</button>
  <section class="tscard">
    <div class="tscardhead"><h2>This Week</h2>
      <button class="tslink">Show Last Week</button></div>
    <table class="tsweek">
      <thead><tr><th scope="col">Day</th><th scope="col">Hours</th>
        <th scope="col">Status</th></tr></thead>
      <tbody>
        <tr><th scope="row">Mon 19 Oct</th><td class="tsnum">8:00</td>
            <td class="tsstate">Approved&nbsp;&#10003;</td></tr>
        <tr><th scope="row">Tue 20 Oct</th><td class="tsnum">7:30</td>
            <td class="tsstate">Awaiting approval</td></tr>
        <tr><th scope="row">Wed 21 Oct</th><td class="tsnum">7:12</td>
            <td class="tsstate">In progress</td></tr>
        <tr class="tsoff"><th scope="row">Thu 22 Oct</th><td class="tsnum">&mdash;</td>
            <td class="tsstate"></td></tr>
        <tr class="tsoff"><th scope="row">Fri 23 Oct</th><td class="tsnum">&mdash;</td>
            <td class="tsstate"></td></tr>
        <tr class="tsoff"><th scope="row">Sat 24 Oct</th><td class="tsnum">&mdash;</td>
            <td class="tsstate"></td></tr>
        <tr class="tsoff"><th scope="row">Sun 25 Oct</th><td class="tsnum">&mdash;</td>
            <td class="tsstate"></td></tr>
      </tbody>
      <tfoot><tr><th scope="row">Total</th><td class="tsnum">22:42</td>
        <td class="tsstate">2 to submit</td></tr></tfoot>
    </table>
    <p class="tsnote">30 minutes of breaks recorded this week.</p>
  </section>
  <section class="tscard">
    <div class="tscardhead"><h2>Corrections</h2>
      <button class="tslink">Request an Adjustment</button></div>
    <div class="tsform">
      <div class="tsfield"><label for="k">What happened?</label>
        <select id="k"><option>I started before I clocked in</option></select></div>
      <div class="tsfield"><label for="st">Actual start</label>
        <input id="st" type="datetime-local" value="2026-10-21T07:00"></div>
      <div class="tsfield"><label for="rs">Why</label>
        <textarea id="rs" rows="3">My phone was dead until half nine.</textarea></div>
      <div class="tsrow"><button class="tsact go">Send Request</button>
        <button class="tsminor">Cancel</button></div>
    </div>
    <ul class="tsasks">
      <li><span class="tsasksaid">I took a break and did not record it</span>
          <span class="tsbadge asked">Pending Review</span>
          <span class="tsaskwhy">Left the phone in the truck over lunch on Tuesday.</span></li>
      <li><span class="tsasksaid">I never clocked in that day</span>
          <span class="tsbadge approved">Approved</span>
          <span class="tsaskwhy">Started at Northside at seven, phone was dead.</span></li>
    </ul>
  </section>
</main>`;

/* Off the clock: the same card in red, with the action reversed. Checked as
 * well as the green one, because a colour that reads is the one you looked
 * at and the other is the one that ships wrong. */
const clockedout = `<main class="tsheet">
  <header class="tshead"><h1>Timesheet</h1><p class="tswho">Cade Barrow</p></header>
  <section class="tscard today offclock">
    <div class="tscardhead"><h2>Today</h2>
      <span class="tsbadge state">Off the Clock</span></div>
    <p class="tsdate">Wednesday, 21 October</p>
    <div class="tsbig"><span class="tshours">0:00</span><span class="tsunit">hours</span></div>
    <button class="tsact go">Clock In</button>
    <p class="tsnote">No hours recorded today.</p>
  </section>
</main>`;

/* The box as everybody sees it most of the time: empty, with the magnifier
 * and the placeholder. The header fixture above has text in it, so the
 * placeholder state was never drawn. */
const restingBar = `<header class="apphead">
  <a href="#" class="brandmark"><span class="brandname">Larabee Homes</span></a>
  <div class="omni">
    <svg class="omniglass" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="2"></circle>
      <path d="M12.8 12.8 L17 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
    </svg>
    <input class="omnibox" type="search" placeholder="Command Launch"
           aria-label="Search everything">
  </div>
  <nav class="topnav" aria-label="Main"><a href="#" class="on">Home</a></nav>
  <span class="av">AP</span>
</header>`;

const page = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${css}</style></head><body style="background:var(--page)">
${header}
<div style="margin-top:22rem">${restingBar}</div>
<div style="padding:1rem">
<div class="parkmain withcard">
  <div class="parkwrap"><div style="background:#e8eaee;aspect-ratio:16/10;border-radius:12px"></div></div>
  ${card}
</div>
<div class="parkmain withcard" style="margin-top:2rem">
  <div class="parkwrap"><div style="background:#e8eaee;aspect-ratio:16/10;border-radius:12px"></div></div>
  ${owned}
</div>
<div class="parkmain withcard" style="margin-top:2rem">
  <div class="parkwrap"><div style="background:#e8eaee;aspect-ratio:16/10;border-radius:12px"></div></div>
  ${moving}
</div>
<div style="margin-top:2rem;max-width:62rem">${lots}</div>
<main class="wrap" style="margin-top:2rem">${lead}</main>
<div class="dash" style="margin-top:2rem">${where}</div>
<div style="margin-top:2rem;background:var(--page)">${clockin}</div>
<div style="margin-top:2rem;background:var(--page)">${clockedout}</div></div></body></html>`;

const file = "/tmp/lot-card.html";
writeFileSync(file, page);

// Playwright is not a dependency of this app -- it is a few hundred
// megabytes to check a stylesheet, and the rest of the suite needs no
// browser. Where it is not installed this says so and stops, rather
// than failing in a way that reads like the card is broken.
let chromium;
for (const where of ["playwright", "/tmp/node_modules/playwright/index.js",
                     "playwright-core"]) {
  try {
    const m = await import(where);
    // Playwright is CommonJS, so a path import puts it under `default`
    // and a bare name does not. Both shapes, or neither works.
    chromium = m.chromium ?? m.default?.chromium;
    if (chromium) break;
  } catch { /* next */ }
}
if (!chromium) {
  console.log("skipped: no playwright here. npm i -g playwright, then run this again.");
  process.exit(0);
}

// The browser download is switched off in this container; one is already
// installed where PLAYWRIGHT_BROWSERS_PATH points, under a version that
// moves, so it is looked up rather than named.
const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
const { readdirSync } = await import("node:fs");
let exe = process.env.CHROMIUM_PATH;
if (!exe || !existsSync(exe)) {
  exe = (() => {
    try {
      for (const d of readdirSync(root)) {
        if (!d.startsWith("chromium-")) continue;
        const c = join(root, d, "chrome-linux", "chrome");
        if (existsSync(c)) return c;
      }
    } catch { /* fall through to playwright's own guess */ }
    return undefined;
  })();
}

const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const wrong = [];

for (const width of [1440, 1100, 900, 420]) {
  const p = await browser.newPage({ viewport: { width, height: 1200 } });
  await p.goto(`file://${file}`);
  await p.waitForTimeout(150);

  const said = await p.evaluate(() => {
    const out = [], thin = [], over = [], small = [], faint = [];
    // The point of the nudge buttons is that a pad can be moved without
    // hitting a twelve-pixel rectangle. A nudge button you have to aim
    // at is the same bug one step along, so they have a floor: 30px,
    // which is under Apple's 44 and over a fingertip's worth of slop.
    // Words you cannot read. `.btn.danger` is the filled destructive
    // button -- red ground, white text -- and a later rule that set only
    // the colour gave red on red: a solid block with the words invisible
    // inside it, which every other check in here was happy with.
    const seen = (el) => {
      let node = el;
      while (node && node !== document.documentElement) {
        const bg = getComputedStyle(node).backgroundColor;
        const m = bg.match(/[\d.]+/g);
        if (m && (m.length < 4 || Number(m[3]) > 0.5)) return m.slice(0, 3).map(Number);
        node = node.parentElement;
      }
      return [255, 255, 255];
    };
    const lum = ([r, g, b]) => {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const INK = [".lotcard", ".unitlist", ".lead", ".leadempty", ".leak", ".tsheet", ".omnipanel"]
      .flatMap((root) => ["button", "a", "label", "p", "h2", "h3", "span", "dt", "dd"]
      .map((el) => `${root} ${el}`)).join(", ");
    for (const el of document.querySelectorAll(INK)) {
      if (!el.textContent.trim()) continue;
      if (el.querySelector("*")) continue;
      const ink = (getComputedStyle(el).color.match(/[\d.]+/g) ?? [0, 0, 0])
        .slice(0, 3).map(Number);
      const a = lum(ink) + 0.05, b2 = lum(seen(el)) + 0.05;
      const ratio = a > b2 ? a / b2 : b2 / a;
      // Not a contrast audit -- this stylesheet uses a deliberately
      // quiet grey for its small uppercase labels and that is a choice,
      // not a bug. 1.6 is the floor for "these words are not there at
      // all", which is what red on red was.
      if (ratio < 1.6) {
        faint.push(`${el.tagName.toLowerCase()}.${el.className || "-"}`
          + ` ${ratio.toFixed(1)}:1`);
      }
    }
    // The account menu is how somebody signs out, and it sits after a nav
    // that scrolls. Two destinations were added to that nav; if the shrink
    // rule ever stops working the avatar leaves the screen and there is no
    // way back out of the application on a phone.
    for (const el of document.querySelectorAll(".apphead .av")) {
      const r = el.getBoundingClientRect();
      if (r.right > window.innerWidth + 1 || r.left < -1 || !r.width) {
        out.push(`.av off the screen at ${Math.round(r.left)}..${Math.round(r.right)}`);
      }
    }
    for (const b of document.querySelectorAll(".movepad button, .movestep .btn, .leadclose button, .tsheet button, .omnirow")) {
      const r = b.getBoundingClientRect();
      if (r.width < 30 || r.height < 30) {
        small.push(`${b.className} ${Math.round(r.width)}x${Math.round(r.height)}px`);
      }
    }
    for (const card of document.querySelectorAll(".lotcard, .unitlist, .lead, .leadempty, .leak, .tscard")) {
    const box = card.getBoundingClientRect();
    for (const el of card.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      const name = `${el.tagName.toLowerCase()}.${el.className || "-"}`;
      // Out of the card altogether.
      if (r.right > box.right + 1 || r.left < box.left - 1) out.push(name);
      // A field too narrow to type into, or a tick stretched into a box.
      if (/^(input|select|textarea)$/.test(el.tagName.toLowerCase())) {
        const tick = el.type === "checkbox" || el.type === "radio";
        if (tick && r.width > 40) over.push(`${name}[${el.type}] ${Math.round(r.width)}px`);
        if (!tick && r.width < 56) thin.push(`${name} ${Math.round(r.width)}px`);
        // A date field clips rather than shrinks, and its own text is the
        // only thing that says whether it fitted.
        if (el.type === "date" && r.width < 128) thin.push(`${name}[date] ${Math.round(r.width)}px`);
      }
    }
    }
    return {
      out: [...new Set(out)], thin: [...new Set(thin)], over: [...new Set(over)],
      small: [...new Set(small)], faint: [...new Set(faint)],
      sideways: document.documentElement.scrollWidth > window.innerWidth,
    };
  });

  await p.screenshot({ path: `/tmp/lot-card-${width}.png`, fullPage: true });
  await p.close();

  if (said.out.length) wrong.push(`${width}px: out of the card -- ${said.out.join(", ")}`);
  if (said.thin.length) wrong.push(`${width}px: too narrow to use -- ${said.thin.join(", ")}`);
  if (said.over.length) wrong.push(`${width}px: a tick box stretched -- ${said.over.join(", ")}`);
  if (said.small.length) wrong.push(`${width}px: too small to hit -- ${said.small.join(", ")}`);
  if (said.faint.length) wrong.push(`${width}px: words you cannot read -- ${said.faint.join(", ")}`);
  if (said.sideways) wrong.push(`${width}px: the page scrolls sideways`);
}

await browser.close();
console.log("wrote /tmp/lot-card-1440.png and three narrower");
if (wrong.length) { for (const w of wrong) console.error(" ✗ " + w); process.exit(1); }
console.log("nothing obviously wrong");
