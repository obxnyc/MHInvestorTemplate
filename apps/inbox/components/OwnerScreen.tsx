"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import SignaturePad from "@/components/SignaturePad";
import { describe, homeSentence } from "@/lib/describe";
import { DEFAULTS, TEMPLATES, templateOf, pack, docKey, money0,
         type Terms, type Home } from "@/lib/papers";

type Held = {
  saleId: string; unitId: string | null; lot: string;
  parkId: string | null; parkName: string; parkAddress: string | null;
  soldOn: string | null;
  priceCents: number; downCents: number; financed: boolean;
  monthlyCents: number | null; rateBps: number | null; termMonths: number | null;
  firstDueOn: string | null;
  homeYear: number | null; homeMake: string | null; homeSerial: string | null;
  lotRentCents: number | null; consultingCents: number | null;
  warrantyCents: number | null; tenantRentCents: number | null;
  lateFeeCents: number | null; ownerInsures: boolean | null;
  note: string | null;
};

/**
 * A home on the deal that is not a recorded sale.
 *
 * The purchase agreement is the paper that MAKES the sale, so requiring
 * the sale to be in the database before it can be drawn is asking for the
 * outcome before the cause. Price and down stay as typed rather than as
 * numbers: a field cleared on the way to a new figure is momentarily
 * empty, and an empty number field read as zero is a contract that sells
 * a home for nothing.
 */
/** Only what this screen touches: pdfmake has no types of its own here. */
type PdfMake = {
  fonts: unknown; vfs: unknown;
  createPdf: (def: unknown) => { download: (name: string, cb: () => void) => void };
};

type ByHand = { key: string; lot: string; describedAs: string; price: string; down: string };

const blank = (): ByHand => ({
  key: Math.random().toString(36).slice(2), lot: "", describedAs: "",
  price: "", down: "",
});

const asNum = (v: string) => {
  const n = Number(v.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const dollars = (cents: number | null | undefined) => (cents ?? 0) / 100;
const asMoney = (cents: number | null | undefined) =>
  cents == null ? "—" : `$${money0(cents / 100)}`;

/**
 * One investor's page.
 *
 * Everything about a relationship rather than about a lot: what they
 * own across every park, what they are charged every month, and the
 * papers for a sale. Eight homes to one trust is one conversation and
 * sixteen documents, and until now it was eight trips through a
 * standalone generator with twenty-four boxes typed again each time.
 */
export default function OwnerScreen({ ownerId }: { ownerId: string }) {
  const [owner, setOwner] = useState<{ name: string; legal_name: string | null } | null>(null);
  const [homes, setHomes] = useState<Held[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(true);

  /** Which homes the papers are being drawn for. */
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [papers, setPapers] = useState(false);
  const [which, setWhich] = useState<"both" | "purchase" | "lease">("both");
  const [terms, setTerms] = useState<Terms>(DEFAULTS);
  /** Homes typed in for this deal, which no sale has been recorded for. */
  const [byHand, setByHand] = useState<ByHand[]>([]);
  /** What the papers call each recorded home, where somebody has said. */
  const [saidAs, setSaidAs] = useState<Record<string, string>>({});
  /** Making a file, and anything that went wrong doing it. */
  const [writing, setWriting] = useState(false);
  const [wordSaid, setWordSaid] = useState<string | null>(null);

  /* KEEPING THE DEAL. Eight homes' worth of figures and descriptions is an
     afternoon, and until now a reload took it with no warning that it
     would. `kept` is the deal as the server last confirmed it, so the
     screen can say whether what is on it has been saved -- "saved" worked
     out from the last press is a claim, not an answer. */
  const [baseline, setBaseline] = useState<string | null>(null);
  /** Whether a draft was read back, as opposed to one never being saved. */
  const [drafted, setDrafted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSaid, setSaveSaid] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  /** False when migration 046 has not been run. Not the same as no draft. */
  const [canKeep, setCanKeep] = useState(true);

  /* OUR SIDE, SIGNED BEFORE IT GOES OUT. Kept once and read back here, so
     it never travels in the deal draft: it is the same mark on every
     document and there is no reason for a copy of it per investor. */
  const [ink, setInk] = useState<string | null>(null);
  const [canSign, setCanSign] = useState(true);
  const [inkBusy, setInkBusy] = useState(false);
  const [inkSaid, setInkSaid] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [showPad, setShowPad] = useState(false);
  const [signedOn, setSignedOn] = useState(
    () => new Date().toISOString().slice(0, 10));
  /* WHICH DOCUMENTS CARRY IT. Null is "all of them", which is what
     signing a pack means and what almost every deal wants. A set is
     somebody having said otherwise -- an agreement going out for the
     buyer to counter, a lease held while a lot is surveyed. */
  const [signOnly, setSignOnly] = useState<Set<string> | null>(null);
  /** The buyer's date, where the deal was done before today. */
  const [counterOn, setCounterOn] = useState("");

  /* SENDING IT FOR THEM TO SIGN. The pack is frozen at the moment it goes
     and the link is what they open; nothing here is regenerated after. */
  const [sending, setSending] = useState(false);
  const [sendTo, setSendTo] = useState({ name: "", email: "", phone: "" });
  const [sendBusy, setSendBusy] = useState(false);
  const [sendSaid, setSendSaid] = useState<string | null>(null);
  const [sentLink, setSentLink] = useState<string | null>(null);
  const [sentHow, setSentHow] = useState<string[]>([]);
  /** What has already gone out to this investor. */
  type Sent = {
    id: string; title: string; doc_count: number; to_name: string;
    to_email: string | null; to_phone: string | null;
    sent_at: string; expires_at: string; opened_at: string | null;
    signed_at: string | null; signed_name: string | null;
    voided_at: string | null;
  };
  const [sent, setSent] = useState<Sent[]>([]);
  const [canList, setCanList] = useState(true);
  const [pulling, setPulling] = useState<string | null>(null);
  /** Set once from the first sale, so re-rendering does not overwrite
   *  what somebody has typed. */
  const [seeded, setSeeded] = useState(false);

  const load = useCallback(async () => {
    setAsking(true);
    const res = await fetch(`/api/owners/${ownerId}`, { cache: "no-store" });
    const out = await res.json().catch(() => ({}));
    setAsking(false);
    if (!res.ok) { setError(out.error ?? "Could not load this owner."); return; }
    setOwner(out.owner ?? null);
    setHomes(out.homes ?? []);
  }, [ownerId]);
  useEffect(() => { void load(); }, [load]);

  /* WHERE A SIGNATURE IS KEPT WHEN THE DATABASE CANNOT KEEP IT.
   *
   * Migrations are run by hand and the schema can be behind the code for
   * days. Signing is not a database feature -- it is a picture drawn onto
   * a document -- so it must not wait on one. The signature lives in this
   * browser until the table exists, and the screen says which of the two
   * it is rather than letting somebody find out when they change machine.
   *
   * try/catch around both: a private window, or site data blocked, makes
   * every one of these throw. */
  const REMEMBERED = "larabee.signature";
  const rememberHere = (png: string | null) => {
    try {
      if (png) localStorage.setItem(REMEMBERED, png);
      else localStorage.removeItem(REMEMBERED);
    } catch { /* it simply is not remembered */ }
  };
  const readInk = useCallback(async () => {
    let here: string | null = null;
    try { here = localStorage.getItem("larabee.signature"); } catch { /* fine */ }
    try {
      const res = await fetch("/api/me/signature", { cache: "no-store" });
      const out = await res.json().catch(() => ({}));
      if (out.keeping === false) setCanSign(false);
      /* The server's copy wins when there is one: it is the one that
         follows this person to another machine. */
      setInk(typeof out.png === "string" && out.png ? out.png : here);
    } catch {
      setCanSign(false);
      setInk(here);
    }
  }, []);
  useEffect(() => { void readInk(); }, [readInk]);

  const keepInk = async (png: string) => {
    setInkBusy(true); setInkSaid(null);
    /* THE SIGNATURE IS USABLE IMMEDIATELY, whatever the server says. It
       is a picture on a document, not a row -- refusing to let somebody
       sign because a table is missing is the feature waiting on the
       plumbing. Kept here first, offered to the server second. */
    rememberHere(png);
    setInk(png);
    setShowPad(false);
    setSigning(true);
    try {
      const res = await fetch("/api/me/signature", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ png }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) {
        /* A real refusal -- too large, not a PNG, not allowed. The
           signature is already on screen and already usable, so this
           says what happened rather than taking it away. */
        setInkSaid(out.error ?? "That could not be kept for next time.");
        setCanSign(false);
        return;
      }
      /* `kept: false` is the schema being behind, which is not a failure
         and does not get an error line. */
      setCanSign(out.kept !== false);
    } catch {
      setCanSign(false);
    } finally { setInkBusy(false); }
  };

  const dropInk = async () => {
    setInkBusy(true); setInkSaid(null);
    rememberHere(null);
    setInk(null); setSigning(false); setShowPad(true);
    try { await fetch("/api/me/signature", { method: "DELETE" }); }
    catch { /* it is gone from here either way */ }
    finally { setInkBusy(false); }
  };

  /* THE DRAFT COMES FIRST. Seeding from the recorded sales and then
     laying the draft over it would flash the wrong figures and, worse,
     race it. So nothing is seeded until this has answered. */
  const [draftRead, setDraftRead] = useState(false);
  useEffect(() => {
    let gone = false;
    (async () => {
      try {
        const res = await fetch(`/api/owners/${ownerId}/deal`, { cache: "no-store" });
        const out = await res.json().catch(() => ({}));
        if (gone) return;
        if (out.saving === false) setCanKeep(false);
        const d = out.deal as null | {
          terms?: Terms; which?: "both" | "purchase" | "lease";
          picked?: Record<string, boolean>; byHand?: ByHand[];
          saidAs?: Record<string, string>;
        };
        if (d && d.terms) {
          setTerms(d.terms);
          if (d.which) setWhich(d.which);
          setPicked(d.picked ?? {});
          setByHand(d.byHand ?? []);
          setSaidAs(d.saidAs ?? {});
          setSavedAt(out.savedAt ?? null);
          setDrafted(true);
          setSeeded(true);
        }
      } catch { /* the screen still works; it simply has nothing kept */ }
      if (!gone) setDraftRead(true);
    })();
    return () => { gone = true; };
  }, [ownerId]);

  // The deal's own terms, taken from the homes themselves. A rate typed
  // once and read back from eight sales is a rate nobody re-keys.
  useEffect(() => {
    // Seeded as soon as the investor is known, not when a sale is. An
    // investor with nothing recorded yet is the one buying their first
    // home, and the buyer's name and today's date are the two things the
    // papers need most.
    if (seeded || !owner || asking || !draftRead) return;
    const first: Held | undefined = homes[0];
    const today = new Date().toISOString().slice(0, 10);
    setTerms((was) => ({
      ...was,
      buyer: owner.legal_name?.trim() || owner.name,
      parkName: first?.parkName || was.parkName,
      agreedOn: first?.soldOn ?? today,
      leaseFrom: first?.soldOn ?? today,
      financed: first ? first.financed : was.financed,
      ratePct: first?.rateBps != null ? first.rateBps / 100 : was.ratePct,
      termYears: first?.termMonths ? Math.round(first.termMonths / 12) : was.termYears,
      lotRent: first?.lotRentCents != null ? dollars(first.lotRentCents) : was.lotRent,
      consulting: first?.consultingCents != null
        ? dollars(first.consultingCents) : was.consulting,
      lateFee: first?.lateFeeCents != null ? dollars(first.lateFeeCents) : was.lateFee,
    }));
    setPicked(Object.fromEntries(homes.map((h) => [h.saleId, true])));
    setSeeded(true);
  }, [seeded, owner, asking, draftRead, homes]);

  const chosen = useMemo(
    () => homes.filter((h) => picked[h.saleId]), [homes, picked]);

  /** Every month, what this investor is charged and what their homes let for. */
  const monthly = useMemo(() => {
    let owes = 0, rent = 0;
    for (const h of homes) {
      owes += (h.monthlyCents ?? 0) + (h.lotRentCents ?? 0)
        + (h.consultingCents ?? 0) + (h.warrantyCents ?? 0);
      rent += h.tenantRentCents ?? 0;
    }
    return { owes, rent, net: rent - owes };
  }, [homes]);

  /** The homes typed in that are worth drawing: a row with nothing in it
   *  is a row somebody has not filled in yet, not a home for nothing. */
  const handed = useMemo(
    () => byHand.filter((h) => h.lot.trim() || h.describedAs.trim() || asNum(h.price)),
    [byHand]);

  const forPapers = useMemo<Home[]>(() => [
    ...chosen.map((h) => ({
      lot: h.lot,
      parkName: h.parkName || undefined,
      describedAs: saidAs[h.saleId] ?? homeSentence(h),
      price: dollars(h.priceCents),
      down: dollars(h.downCents),
    })),
    ...handed.map((h) => ({
      lot: h.lot.trim(),
      describedAs: h.describedAs.trim(),
      price: asNum(h.price),
      down: asNum(h.down),
    })),
  ], [chosen, handed, saidAs]);

  /**
   * Typed-in homes that are not ready to print.
   *
   * A price of nothing renders as $0.00 on the agreement -- a contract
   * selling a home for zero dollars, which reads exactly like a contract
   * and is not one. So printing is refused rather than producing it, the
   * same way a send that cannot keep its attachment refuses rather than
   * inserting a message nobody can see.
   */
  const notReady = useMemo(
    () => handed.filter((h) => !asNum(h.price)), [handed]);

  /**
   * The parks the ticked homes stand in.
   *
   * The terms below are the DEAL's: one rate, one lot rent, one park
   * owner. Homes in two parks at the same lot rent is a coincidence, not
   * a deal, and the screen has no way to know which of the two the typed
   * figures belong to -- so it says so rather than printing both.
   */
  const spread = useMemo(() => {
    const seen = new Set(chosen.map((h) => h.parkName).filter(Boolean));
    return [...seen].sort();
  }, [chosen]);

  /**
   * The terms as they go onto paper.
   *
   * The signature is not part of the deal and is not kept with it -- it
   * is the same mark on every document this person sends -- so it is put
   * on here rather than carried in `terms` all the way through the
   * screen. Nothing is signed unless somebody has asked for it to be.
   */
  const onPaper = useMemo<Terms>(() => (
    {
      ...terms,
      ...(signing && ink ? { signedPng: ink, signedOn } : {}),
      ...(counterOn ? { counterOn } : {}),
    }
  ), [terms, signing, ink, signedOn, counterOn]);

  /** Which documents in the pack carry the mark. */
  const signs = useMemo(
    () => (signOnly ? (key: string) => signOnly.has(key) : undefined),
    [signOnly]);

  /** Every document the pack will contain, in the order it contains them. */
  const inPack = useMemo(() => {
    const out: { key: string; lot: string; what: string }[] = [];
    forPapers.forEach((h, i) => {
      const lot = h.lot || `home ${i + 1}`;
      if (which !== "lease") {
        out.push({ key: docKey(i, "purchase"), lot, what: "Purchase agreement" });
      }
      if (which !== "purchase") {
        out.push({ key: docKey(i, "lease"), lot, what: "Park land lease" });
      }
    });
    return out;
  }, [forPapers, which]);

  const built = useMemo(() => {
    if (!forPapers.length) return "";
    return pack(onPaper, forPapers, which, signs);
  }, [forPapers, onPaper, which, signs]);

  /**
   * The same pack, with the investor's lines marked so they can be filled.
   *
   * Built separately rather than by signing what is on screen: what gets
   * sent has to carry the slots, and what is printed here must not --
   * a printed contract with an empty marked span in it is a contract
   * waiting for a web page.
   */
  const toSend = useMemo(() => {
    if (!forPapers.length) return "";
    return pack({ ...onPaper, counterSign: true }, forPapers, which, signs);
  }, [forPapers, onPaper, which, signs]);

  const readSent = useCallback(async () => {
    try {
      const res = await fetch(`/api/owners/${ownerId}/sent`, { cache: "no-store" });
      const out = await res.json().catch(() => ({}));
      if (out.listing === false) setCanList(false);
      setSent(Array.isArray(out.sent) ? out.sent : []);
    } catch { /* the rest of the screen still works */ }
  }, [ownerId]);
  useEffect(() => { void readSent(); }, [readSent]);

  /** Stop a link working. Only while nobody has signed it. */
  const pullBack = async (id: string) => {
    setPulling(id); setSendSaid(null);
    try {
      const res = await fetch(`/api/owners/${ownerId}/sent`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) {
        setSendSaid(out.error ?? "That could not be withdrawn."); return;
      }
      await readSent();
    } catch (e) {
      setSendSaid(e instanceof Error ? e.message : "That could not be withdrawn.");
    } finally { setPulling(null); }
  };

  const sendIt = async () => {
    setSendBusy(true); setSendSaid(null); setSentLink(null);
    try {
      const res = await fetch(`/api/owners/${ownerId}/send`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pack: toSend,
          title: which === "purchase" ? "Purchase Agreement"
            : which === "lease" ? "Park Land Lease"
            : "Purchase Agreement and Park Land Lease",
          docCount: inPack.length,
          toName: sendTo.name.trim() || terms.buyer,
          toEmail: sendTo.email.trim(),
          toPhone: sendTo.phone.trim(),
        }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) {
        setSendSaid(out.error ?? "That did not send."); return;
      }
      setSentLink(out.link ?? null);
      setSentHow(Array.isArray(out.went) ? out.went : []);
      await readSent();
      /* WHAT WENT AND WHAT DID NOT, both. A link that exists and was not
         delivered is one copy-and-paste from fixed; a link reported as
         sent and never delivered is a deal sitting still for a week. */
      if (Array.isArray(out.failed) && out.failed.length) {
        setSendSaid(`The link was made but not delivered — ${out.failed.join("; ")}.`
          + " Send them the link below yourself.");
      }
    } catch (e) {
      setSendSaid(e instanceof Error ? e.message : "That did not send.");
    } finally { setSendBusy(false); }
  };

  /**
   * What the browser calls this page while the papers are up.
   *
   * Chrome and Safari print the page's title and its URL into the page
   * margin unless the tick box is cleared, and a contract headed
   * `file:///Users/.../Downloads/mobilehomedocumentgenerator (4).html`
   * does not look like a contract. The tick box is the real answer --
   * there is no CSS for it, and the one trick that works, a zero page
   * margin, takes the top and bottom margin off every continuation page
   * with it. But a title that reads as the document costs nothing and
   * is the difference between an odd header and an embarrassing one.
   */
  useEffect(() => {
    if (!papers || !owner) return;
    const was = document.title;
    const what = which === "purchase" ? "Purchase Agreement"
      : which === "lease" ? "Park Land Lease"
      : "Purchase Agreement and Park Land Lease";
    document.title = `${what} — ${terms.buyer || owner.name}`;
    return () => { document.title = was; };
  }, [papers, owner, which, terms.buyer]);

  /**
   * Nothing is claimed until the file exists.
   *
   * The whole module is loaded on the press rather than with the page --
   * it is a few hundred kilobytes of Word writer that most visits to this
   * screen never need.
   */
  const saveWord = async () => {
    setWriting(true); setWordSaid(null);
    try {
      const { packDocx, docxName } = await import("@/lib/worddoc");
      const blob = await packDocx(onPaper, forPapers, which, signs);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = docxName(terms.buyer || owner?.name || "", which);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      setWordSaid(`The Word file could not be made: ${
        e instanceof Error ? e.message : String(e)}`);
    } finally {
      setWriting(false);
    }
  };

  /**
   * The PDF, made here rather than by the print dialog.
   *
   * Printing put the date and this page's address in the margin of every
   * page, which a recorded document cannot carry, and no stylesheet can
   * reach that margin. So the button that made a bad file is gone and
   * this one makes the file itself.
   */
  const savePdf = async () => {
    setWriting(true); setWordSaid(null);
    try {
      const [{ buildPdfDef, FONTS, pdfName, serifFiles }, mod] = await Promise.all([
        import("@/lib/pdfdoc"),
        import("pdfmake/build/pdfmake"),
      ]);
      const pdfMake = (mod as unknown as { default?: PdfMake } & PdfMake).default
        ?? (mod as unknown as PdfMake);
      pdfMake.fonts = FONTS;
      /* Without these the file never appears and nothing on screen says
         why: pdfkit throws inside its own worker looking for metrics
         that are not in the browser's virtual file system. */
      pdfMake.vfs = await serifFiles();
      const def = buildPdfDef(onPaper, forPapers, which, signs);
      await new Promise<void>((done, fail) => {
        try {
          pdfMake.createPdf(def).download(
            pdfName(terms.buyer || owner?.name || "", which), () => done());
        } catch (e) { fail(e); }
      });
    } catch (e) {
      setWordSaid(`The PDF could not be made: ${
        e instanceof Error ? e.message : String(e)}`);
    } finally {
      setWriting(false);
    }
  };

  /** Everything typed on this screen, as one value. */
  const deal = useMemo(() => ({
    v: 1 as const, terms, which, picked, byHand, saidAs,
  }), [terms, which, picked, byHand, saidAs]);
  const dealText = useMemo(() => JSON.stringify(deal), [deal]);
  const unsaved = baseline !== null && baseline !== dealText;

  /* The mark against which "unsaved" is measured, taken once the screen
     has settled -- from the draft if there was one, from the sales if
     there was not. Before it is set, nothing is reported either way,
     because a screen that is still loading has not been changed. */
  useEffect(() => {
    if (baseline !== null || !seeded || !draftRead) return;
    setBaseline(dealText);
  }, [baseline, seeded, draftRead, dealText]);

  const keepDeal = async () => {
    setSaving(true); setSaveSaid(null);
    const body = dealText;
    try {
      const res = await fetch(`/api/owners/${ownerId}/deal`, {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ deal }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) {
        setSaveSaid(out.error ?? "That did not save.");
        return;
      }
      /* Marked as kept only once the server says so, and against the text
         that was SENT rather than whatever is on screen by the time the
         answer comes back -- otherwise a keystroke during the round trip
         is quietly reported as saved. */
      setBaseline(body);
      setDrafted(true);
      setSavedAt(out.savedAt ?? new Date().toISOString());
    } catch (e) {
      setSaveSaid(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setSaving(false);
    }
  };

  const set = (change: Partial<Terms>) => setTerms((was) => ({ ...was, ...change }));
  const num = (v: string) => (v === "" ? 0 : Number(v));

  if (asking && !owner) return <p className="parkhint">Reading…</p>;
  if (error) return <p className="err">{error}</p>;
  if (!owner) return <p className="parkhint">No such owner.</p>;

  return (
    <div className="parkpage ownerpage">
      <header className="parkhead noprint">
        <h1>{owner.name}</h1>
        {owner.legal_name && owner.legal_name !== owner.name && (
          <span className="parkkept">{owner.legal_name}</span>
        )}
        <div className="parkacts">
          {papers && canKeep && (
            <button type="button" className={unsaved ? "btn pri" : "btn"}
                    disabled={saving || !unsaved}
                    onClick={() => void keepDeal()}>
              {saving ? "Saving…" : unsaved ? "Save" : "Saved"}
            </button>
          )}
          {/* Not disabled on an empty investor. The papers for their first
              home are the papers most worth drawing, and the home can be
              typed in below. */}
          <button type="button" className={papers ? "btn pri" : "btn"}
                  onClick={() => {
                    setPapers((v) => !v);
                    if (!papers && !homes.length && !byHand.length) {
                      setByHand([blank()]);
                    }
                  }}>
            {papers ? "Done" : "Sale papers"}
          </button>
        </div>
      </header>

      {!homes.length ? (
        <p className="parkhint noprint">
          Nothing is recorded against this owner yet. A home becomes theirs
          when a sale is recorded on its lot card — but the papers do not
          wait on that:{" "}
          {papers
            ? <>type the home in below.</>
            : <>press <strong>Sale papers</strong> and type the home in.</>}
        </p>
      ) : (
        <p className="parktally noprint">
          <strong>{homes.length} home{homes.length === 1 ? "" : "s"}</strong>{" "}
          across {new Set(homes.map((h) => h.parkName)).size} park
          {new Set(homes.map((h) => h.parkName)).size === 1 ? "" : "s"}. They
          are charged <strong>{asMoney(monthly.owes)}</strong> a month;
          the homes let for {asMoney(monthly.rent)}, so net to them is{" "}
          <strong className={monthly.net < 0 ? "parkbad" : "parkok"}>
            {asMoney(monthly.net)}
          </strong>{" "}
          before anything we spend on their behalf.
        </p>
      )}

      {homes.length > 0 && (
        <div className="ownerlist noprint">
          <table className="ownertbl">
            <thead>
              <tr>
                {papers && <th aria-label="Include" />}
                <th>Park</th><th>Lot</th><th>Home</th><th>Sold</th>
                <th>Price</th><th>Mortgage</th><th>Lot fee</th>
                <th>Consultancy</th><th>Rent in</th>
              </tr>
            </thead>
            <tbody>
              {homes.map((h) => (
                <tr key={h.saleId}>
                  {papers && (
                    <td>
                      <input type="checkbox" checked={Boolean(picked[h.saleId])}
                             onChange={(e) => setPicked((was) => (
                               { ...was, [h.saleId]: e.target.checked }))} />
                    </td>
                  )}
                  <td>
                    {h.parkId
                      ? <a href={`/properties/${h.parkId}/plan`}>{h.parkName}</a>
                      : h.parkName}
                  </td>
                  <td><strong>{h.lot}</strong></td>
                  <td>{describe(h) || <span className="dim">not recorded</span>}</td>
                  <td>{h.soldOn ?? "—"}</td>
                  <td>{asMoney(h.priceCents)}</td>
                  <td>{h.financed ? asMoney(h.monthlyCents) : <span className="dim">paid</span>}</td>
                  <td>{asMoney(h.lotRentCents)}</td>
                  <td>{asMoney(h.consultingCents)}</td>
                  <td>{asMoney(h.tenantRentCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {papers && (
        <>
          <div className="papersetup noprint">
            <p className="parkhint">
              {forPapers.length === 0 && <>Nothing on the deal yet — </>}
              {homes.length > 0 && <>{chosen.length} of {homes.length} ticked</>}
              {homes.length > 0 && handed.length > 0 && ", "}
              {handed.length > 0 && (
                <>{handed.length} typed in by hand</>
              )}
              {(homes.length > 0 || handed.length > 0) && " — "}
              <strong>
                {which === "both" ? forPapers.length * 2 : forPapers.length} document
                {(which === "both" ? forPapers.length * 2 : forPapers.length) === 1 ? "" : "s"}
              </strong>.{" "}
              {homes.length > 0
                ? <>Everything below is filled from the sales already
                    recorded; change it here and the papers change with it.</>
                : <>Type the home into <strong>Homes on this deal</strong> and
                    set the terms below.</>}{" "}
              Nothing typed here is written back to a lot.
            </p>

            {spread.length > 1 && (
              <p className="err">
                The ticked homes are in {spread.length} parks —{" "}
                {spread.join(" and ")}. Each lease names its own park, but the
                lot rent, the consulting fee and the rest below are one set of
                figures across all of them. If the parks are on different
                terms, draw them as separate deals.
              </p>
            )}

            <div className="handhomes">
              <h2>Homes on this deal</h2>
              <p className="dim">
                The second column is the line that comes after
                “certain personal property, to wit:”. The sale records only
                the year, the make and the serial number, so finish it here
                with the size, the bedrooms and anything else the home is
                identified by. Nothing typed here is written back to a lot.
              </p>
              <table className="ownertbl">
                <thead>
                  <tr><th>Lot</th><th>Home, as it is described</th>
                      <th>Price $</th><th>Down $</th><th /></tr>
                </thead>
                <tbody>
                  {/* The ticked sales, with their description open to be
                      finished. It is the line after "certain personal
                      property, to wit:" and the database holds only three
                      words of it. */}
                  {chosen.map((h) => (
                    <tr key={h.saleId}>
                      <td><strong>{h.lot}</strong></td>
                      <td><input value={saidAs[h.saleId] ?? homeSentence(h)}
                                 aria-label={`Home on lot ${h.lot}`}
                                 onChange={(e) => setSaidAs((was) => (
                                   { ...was, [h.saleId]: e.target.value }))} /></td>
                      <td>{asMoney(h.priceCents)}</td>
                      <td>{asMoney(h.downCents)}</td>
                      <td>
                        {saidAs[h.saleId] != null && (
                          <button type="button" className="btn"
                                  onClick={() => setSaidAs((was) => {
                                    const next = { ...was };
                                    delete next[h.saleId];
                                    return next;
                                  })}>
                            Put back
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {byHand.map((h, i) => (
                    <tr key={h.key}>
                      <td><input value={h.lot} aria-label={`Lot, home ${i + 1}`}
                                 onChange={(e) => setByHand((was) => was.map((r) =>
                                   r.key === h.key ? { ...r, lot: e.target.value } : r))} /></td>
                      <td><input value={h.describedAs} aria-label={`Home ${i + 1}`}
                                 placeholder="2021 Clayton 16x76, 3/2, Serial# ..."
                                 onChange={(e) => setByHand((was) => was.map((r) =>
                                   r.key === h.key ? { ...r, describedAs: e.target.value } : r))} /></td>
                      <td><input value={h.price} inputMode="decimal" aria-label={`Price, home ${i + 1}`}
                                 onChange={(e) => setByHand((was) => was.map((r) =>
                                   r.key === h.key ? { ...r, price: e.target.value } : r))} /></td>
                      <td><input value={h.down} inputMode="decimal" aria-label={`Down payment, home ${i + 1}`}
                                 onChange={(e) => setByHand((was) => was.map((r) =>
                                   r.key === h.key ? { ...r, down: e.target.value } : r))} /></td>
                      <td><button type="button" className="btn"
                                  onClick={() => setByHand((was) =>
                                    was.filter((r) => r.key !== h.key))}>
                        Take off
                      </button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button type="button" className="btn"
                      onClick={() => setByHand((was) => [...was, blank()])}>
                Add a home
              </button>
              {handed.some((h) => !h.describedAs.trim()) && (
                <p className="err">
                  A home with no description leaves the line that identifies
                  it blank. Year, make, size and serial number.
                </p>
              )}
            </div>

            {/* WHERE THINGS STAND, said rather than left to be inferred.
                A screen that only shows a Save button leaves "has this
                been kept" to memory, and the one time memory is wrong is
                the afternoon that goes. */}
            <p className={saveSaid ? "err" : "dim tplsays"}>
              {saveSaid ? (
                <>
                  {saveSaid}{" "}
                  <button type="button" className="btn"
                          onClick={() => void keepDeal()}>Try again</button>
                </>
              ) : !canKeep ? (
                "Nothing here is being kept: saving a deal needs migration"
                + " 046 run on the database. Everything still works; it will"
                + " be gone when this page reloads."
              ) : saving ? "Saving…"
                : unsaved ? "Unsaved changes on this deal."
                : drafted && savedAt
                  ? `Saved ${new Date(savedAt).toLocaleString("en-US",
                      { dateStyle: "medium", timeStyle: "short" })}.`
                  : "Nothing saved for this investor yet — press Save and it"
                    + " will be here next time."}
            </p>

            {/* SIGNING OUR OWN LINE. Both of our blocks on every document
                in the pack -- Seller on the agreement, Park Owner on the
                lease. The buyer's line is never touched: they sign
                wherever they sign. */}
            <div className="signrow">
                {ink && !showPad ? (
                  <>
                    <label className="papertickone">
                      <input type="checkbox" checked={signing}
                             onChange={(e) => setSigning(e.target.checked)} />
                      <span>Sign these as Seller and Park Owner</span>
                    </label>
                    {signing && (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img className="signtiny" src={ink} alt="Your signature" />
                        <label className="signdate">Signed on
                          <input type="date" value={signedOn}
                                 onChange={(e) => setSignedOn(e.target.value)} />
                        </label>
                        {/* SOME OF THESE ARE RETROACTIVE. Left blank, the
                            buyer's line is dated the day they actually
                            sign; set, it is the date the deal was done
                            and signing does not overwrite it. */}
                        <label className="signdate">Buyer&rsquo;s date, if not the day they sign
                          <input type="date" value={counterOn}
                                 onChange={(e) => setCounterOn(e.target.value)} />
                        </label>
                      </>
                    )}
                    {signing && inPack.length > 1 && (
                      <div className="signwhere">
                        {/* WHERE IT GOES, said rather than left to be
                            discovered: the Seller line of an agreement
                            and the Park Owner line of a lease, never the
                            buyer's. */}
                        <p className="dim">
                          On the <strong>Seller</strong> line of each purchase
                          agreement and the <strong>Park Owner</strong> line of
                          each lease. The buyer signs their own.
                        </p>
                        <div className="tabsrow">
                          <button type="button"
                                  className={signOnly === null ? "chip on" : "chip"}
                                  onClick={() => setSignOnly(null)}>
                            All {inPack.length} documents
                          </button>
                          <button type="button"
                                  className={signOnly !== null ? "chip on" : "chip"}
                                  onClick={() => setSignOnly(
                                    (was) => was ?? new Set(inPack.map((d) => d.key)))}>
                            Choose
                          </button>
                        </div>
                        {signOnly !== null && (
                          <>
                            <div className="signpick">
                              {inPack.map((d) => (
                                <label key={d.key} className="papertickone">
                                  <input type="checkbox"
                                         checked={signOnly.has(d.key)}
                                         onChange={(e) => setSignOnly((was) => {
                                           const next = new Set(was ?? []);
                                           if (e.target.checked) next.add(d.key);
                                           else next.delete(d.key);
                                           return next;
                                         })} />
                                  <span>Lot {d.lot} — {d.what}</span>
                                </label>
                              ))}
                            </div>
                            {/* Silence and success look alike: a pack with
                                nothing ticked is an unsigned pack, and
                                there is no reason to find that out from
                                the file. */}
                            {signOnly.size === 0 && (
                              <p className="err">
                                Nothing is ticked, so nothing will be signed.
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    )}
                    <button type="button" className="btn"
                            onClick={() => setShowPad(true)}>
                      Change signature
                    </button>
                  </>
                ) : (
                  <SignaturePad png={null} busy={inkBusy} said={inkSaid}
                                defaultName={terms.parkOwner}
                                onSave={(v) => void keepInk(v)}
                                onClear={() => void dropInk()} />
                )}
            </div>
            {ink && !canSign && (
              <p className="dim tplsays">
                This signature is remembered on this computer. It will
                follow you to another one once migration 047 is run —
                everything else about signing works now.
              </p>
            )}

            <div className="tplrow">
              <span className="tpllabel">Template</span>
              {TEMPLATES.map((tpl) => (
                <button key={tpl.key} type="button"
                        className={templateOf(terms) === tpl.key ? "chip on" : "chip"}
                        onClick={() => tpl.key !== "custom" && set(tpl.changes)}>
                  {tpl.name}
                </button>
              ))}
            </div>
            <p className="dim tplsays">
              {TEMPLATES.find((x) => x.key === templateOf(terms))?.blurb}
            </p>

            <div className="tabsrow">
              {(["both", "purchase", "lease"] as const).map((k) => (
                <button key={k} type="button"
                        className={which === k ? "chip on" : "chip"}
                        onClick={() => setWhich(k)}>
                  {k === "both" ? "Both documents"
                    : k === "purchase" ? "Purchase only" : "Lease only"}
                </button>
              ))}
            </div>

            <div className="papergrid">
              <label>Seller entity
                <input value={terms.seller}
                       onChange={(e) => set({ seller: e.target.value })} /></label>
              <label>Park owner
                <input value={terms.parkOwner}
                       onChange={(e) => set({ parkOwner: e.target.value })} /></label>
              <label>Purchaser
                <input value={terms.buyer}
                       onChange={(e) => set({ buyer: e.target.value })} /></label>
              <label>Park name
                <input value={terms.parkName}
                       onChange={(e) => set({ parkName: e.target.value })} /></label>
              <label>Governing law
                <input value={terms.state}
                       onChange={(e) => set({ state: e.target.value })} /></label>
              <label>Agreement date
                <input type="date" value={terms.agreedOn}
                       onChange={(e) => set({ agreedOn: e.target.value })} /></label>
              <label>Lease from
                <input type="date" value={terms.leaseFrom}
                       onChange={(e) => set({ leaseFrom: e.target.value })} /></label>
              <label>Rate %/yr
                <input inputMode="decimal" value={terms.ratePct}
                       onChange={(e) => set({ ratePct: num(e.target.value) })} /></label>
              <label>Term (yrs)
                <input inputMode="numeric" value={terms.termYears}
                       onChange={(e) => set({ termYears: num(e.target.value) })} /></label>
              <label>Lot rent $/mo
                <input inputMode="numeric" value={terms.lotRent}
                       onChange={(e) => set({ lotRent: num(e.target.value) })} /></label>
              <label>Consulting $/mo
                <input inputMode="numeric" value={terms.consulting}
                       onChange={(e) => set({ consulting: num(e.target.value) })} /></label>
              <label>Reserve $
                <input inputMode="numeric" value={terms.reserve}
                       onChange={(e) => set({ reserve: num(e.target.value) })} /></label>
              <label>Notice (days)
                <input inputMode="numeric" value={terms.noticeDays}
                       onChange={(e) => set({ noticeDays: num(e.target.value) })} /></label>
              <label>First refusal (days)
                <input inputMode="numeric" value={terms.rofrDays}
                       onChange={(e) => set({ rofrDays: num(e.target.value) })} /></label>
              <label>Escalation %/yr
                <input inputMode="decimal" value={terms.escalatePct}
                       onChange={(e) => set({ escalatePct: num(e.target.value) })} /></label>
              <label>Grace (days)
                <input inputMode="numeric" value={terms.graceDays}
                       onChange={(e) => set({ graceDays: num(e.target.value) })} /></label>
              <label>Late fee $
                <input inputMode="numeric" value={terms.lateFee}
                       onChange={(e) => set({ lateFee: num(e.target.value) })} /></label>
            </div>

            <div className="papertick">
              {([
                ["financed", "Seller-financed"],
                ["amortize", "Attach amortization schedule"],
                ["escalate", "Annual rent escalation"],
                ["late", "Late fee and default"],
                ["security", "Seller keeps a lien until paid"],
                ["insure", "Homeowner insures, Seller loss payee"],
                ["notary", "Notary block"],
              ] as const).map(([key, say]) => (
                <label key={key} className="papertickone">
                  <input type="checkbox" checked={Boolean(terms[key])}
                         onChange={(e) => set({ [key]: e.target.checked } as Partial<Terms>)} />
                  <span>{say}</span>
                </label>
              ))}
            </div>

            <div className="paperacts">
              {/* THE FILE THE OWNER ACTUALLY SENDS. The browser's print
                  dialog writes the date and the page's address into the
                  margin of every page unless somebody clears a tick box,
                  and no stylesheet can reach it -- so for anything that
                  gets recorded or signed, the file has to be one we make
                  rather than one the browser makes. */}
              <button type="button" className="btn pri"
                      disabled={!forPapers.length || notReady.length > 0 || writing}
                      onClick={() => void saveWord()}>
                {writing ? "Making it…" : "Download Word (.docx)"}
              </button>
              <button type="button" className="btn"
                      disabled={!forPapers.length || notReady.length > 0 || writing}
                      onClick={() => void savePdf()}>
                Download PDF
              </button>
              <button type="button" className="btn"
                      disabled={!forPapers.length || notReady.length > 0}
                      onClick={() => {
                        setSending((v) => !v);
                        setSendSaid(null);
                        setSendTo((was) => ({ ...was,
                          name: was.name || terms.buyer }));
                      }}>
                {sending ? "Never mind" : "Send to the investor to sign"}
              </button>
              {notReady.length > 0 ? (
                <span className="err">
                  {notReady.length} typed-in home
                  {notReady.length === 1 ? " has" : "s have"} no price. The
                  agreement would sell {notReady.length === 1 ? "it" : "them"}{" "}
                  for nothing.
                </span>
              ) : wordSaid ? (
                <span className="err">{wordSaid}</span>
              ) : (
                <span className="dim">
                  Both files carry nothing but the documents — no date, no
                  web address, nothing in the margin. Send either one for
                  signing.
                </span>
              )}
            </div>
          </div>

          {sending && (
            <div className="sendbox noprint">
              <h2>Send to the investor to sign</h2>
              <p className="dim">
                They get a link, read these {inPack.length} document
                {inPack.length === 1 ? "" : "s"}, and sign the same way you
                do — no account and no DocuSign. The documents are frozen as
                they are now: changing anything here afterwards does not
                change what they were sent.
              </p>
              <div className="papergrid">
                <label>Who is signing
                  <input value={sendTo.name}
                         onChange={(e) => setSendTo((w) => ({ ...w, name: e.target.value }))} /></label>
                <label>Email
                  <input type="email" inputMode="email" value={sendTo.email}
                         onChange={(e) => setSendTo((w) => ({ ...w, email: e.target.value }))} /></label>
                <label>Mobile
                  <input type="tel" inputMode="tel" value={sendTo.phone}
                         onChange={(e) => setSendTo((w) => ({ ...w, phone: e.target.value }))} /></label>
              </div>
              <div className="paperacts">
                <button type="button" className="btn pri"
                        disabled={sendBusy
                          || (!sendTo.email.trim() && !sendTo.phone.trim())}
                        onClick={() => void sendIt()}>
                  {sendBusy ? "Sending…" : "Send it"}
                </button>
                {sendSaid && <span className="err">{sendSaid}</span>}
                {!sendSaid && sentHow.length > 0 && (
                  <span className="dim">Sent to {sentHow.join(" and ")}.</span>
                )}
              </div>
              {/* WHAT HAS ALREADY GONE OUT, and a way to stop it. Without
                  this a link lives for a fortnight with nothing on screen
                  saying it exists -- which makes sending one to try it
                  out a thing nobody dares do twice. */}
              {sent.length > 0 && (
                <div className="sentlist">
                  <h3>Already sent</h3>
                  <table className="ownertbl">
                    <thead>
                      <tr><th>To</th><th>Sent</th><th>Where it stands</th><th /></tr>
                    </thead>
                    <tbody>
                      {sent.map((r) => {
                        const expired = Date.parse(r.expires_at) < Date.now();
                        const where = r.signed_at
                          ? `Signed by ${r.signed_name ?? r.to_name}`
                          : r.voided_at ? "Withdrawn — the link no longer works"
                          : expired ? "Expired"
                          : r.opened_at ? "Opened, not signed yet"
                          : "Sent, not opened yet";
                        const open = !r.signed_at && !r.voided_at && !expired;
                        return (
                          <tr key={r.id}>
                            <td>
                              <strong>{r.to_name}</strong><br />
                              <span className="dim">
                                {r.to_email || r.to_phone}
                                {" · "}{r.doc_count} document
                                {r.doc_count === 1 ? "" : "s"}
                              </span>
                            </td>
                            <td>{new Date(r.sent_at).toLocaleDateString("en-US",
                              { dateStyle: "medium" })}</td>
                            <td className={r.signed_at ? "parkok"
                              : r.voided_at || expired ? "dim" : ""}>{where}</td>
                            <td>
                              {open && (
                                <button type="button" className="btn"
                                        disabled={pulling === r.id}
                                        onClick={() => void pullBack(r.id)}>
                                  {pulling === r.id ? "Withdrawing…" : "Withdraw"}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="dim">
                    Withdrawing stops the link working. A set somebody has
                    already signed cannot be withdrawn here — they are
                    holding a copy of it.
                  </p>
                </div>
              )}
              {!canList && (
                <p className="dim">
                  What has been sent cannot be listed until migration 048 is
                  run on the database.
                </p>
              )}

              {sentLink && (
                <label className="signname">The link, if you would rather send it yourself
                  <input readOnly value={sentLink}
                         onFocus={(e) => e.currentTarget.select()} />
                </label>
              )}
            </div>
          )}

          {forPapers.length > 0 && (
            <div className="paper" dangerouslySetInnerHTML={{ __html: built }} />
          )}
        </>
      )}
    </div>
  );
}
