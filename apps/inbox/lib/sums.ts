/**
 * Arithmetic typed into the search bar.
 *
 * "775 * 12", "24500 - 15%", "20% of 1200", "8 * 24500". A property business
 * does the same half-dozen sums all day and none of them is worth opening a
 * calculator for.
 *
 * NO `eval`, AND NO `new Function`. This runs on whatever anybody types, in a
 * page that is holding their session, on every keystroke. There is no amount
 * of input-cleaning that makes handing a string to the JavaScript engine a
 * reasonable thing to do here, and the parser below is forty lines. A
 * cleverer version of this file that reached for `eval` would be the single
 * worst line in the application.
 *
 * PER CENT MEANS WHAT A CALCULATOR MEANS BY IT. "1200 - 15%" is fifteen per
 * cent OF THE TWELVE HUNDRED, not fifteen hundredths: 1020, not 1199.85.
 * Every pocket calculator since the seventies works this way and so does
 * every person who types it. On its own, with nothing to be a percentage of,
 * "15%" is 0.15.
 */

export type Sum = {
  value: number;
  /** Rendered the way the question was asked: money in, money out. */
  pretty: string;
  /** True when the question mentioned money. */
  money: boolean;
};

type Tok =
  | { k: "n"; v: number }
  | { k: "op"; v: "+" | "-" | "*" | "/" }
  | { k: "("; } | { k: ")" }
  | { k: "%" }
  | { k: "of" };

/** Does this look like a sum at all, or is it a search for "3114"? */
const HAS_MATHS = /[+\-*/×÷%()]|\bof\b/i;

/**
 * A date is not a division.
 *
 * "10/21/2026" parses perfectly well as ten over twenty-one over two
 * thousand and twenty-six, and answering a search for a date with
 * 0.000176 is the calculator taking a question that was not addressed to
 * it. Only the three-part form is refused: "10/21" on its own is a
 * division somebody might genuinely mean.
 */
const LOOKS_LIKE_A_DATE = /^\s*\d{1,2}\s*[/-]\s*\d{1,2}\s*[/-]\s*\d{2,4}\s*$/;

function lex(src: string): Tok[] | null {
  // Thousands separators come out BEFORE anything is read, and only where
  // they are really separators: a comma between a digit and three more.
  // Skipping every comma in the lexer turned "1,200 * 2" into two numbers
  // side by side, which then failed to parse at all.
  const s = src.replace(/[×]/g, "*").replace(/[÷]/g, "/")
    .replace(/(\d),(?=\d{3}(\D|$))/g, "$1")
    .toLowerCase();
  const out: Tok[] = [];
  let i = 0;

  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "," || c === "$") { i++; continue; }

    if (/[0-9.]/.test(c)) {
      const m = /^[0-9]*\.?[0-9]+/.exec(s.slice(i));
      if (!m) return null;
      let v = Number(m[0]);
      i += m[0].length;
      // "24.5k" is how people write twenty-four and a half thousand.
      if (s[i] === "k") { v *= 1000; i++; }
      if (!Number.isFinite(v)) return null;
      out.push({ k: "n", v });
      continue;
    }
    if (c === "+" || c === "-" || c === "*" || c === "/") {
      out.push({ k: "op", v: c }); i++; continue;
    }
    if (c === "(") { out.push({ k: "(" }); i++; continue; }
    if (c === ")") { out.push({ k: ")" }); i++; continue; }
    if (c === "%") { out.push({ k: "%" }); i++; continue; }
    if (s.startsWith("of", i) && !/[a-z]/.test(s[i + 2] ?? "")) {
      out.push({ k: "of" }); i += 2; continue;
    }
    // A letter anywhere else means this was never a sum. Refusing is the
    // right answer: "3114" is a lot number and "cross creek" is a park, and
    // a calculator that answers those has stolen the search bar.
    return null;
  }
  return out;
}

/**
 * Recursive descent, because precedence written as code is readable and
 * precedence written as a table is not.
 *
 *   expr   := term (('+' | '-') term)*
 *   term   := unary (('*' | '/') unary)*
 *   unary  := '-'? atom
 *   atom   := number '%'? | '(' expr ')' | percent 'of' expr
 */
function parse(toks: Tok[]): number | null {
  let at = 0;
  const peek = () => toks[at];
  const eat = () => toks[at++];

  function atom(): number | null {
    const t = peek();
    if (!t) return null;
    if (t.k === "(") {
      eat();
      const v = expr();
      if (v === null || peek()?.k !== ")") return null;
      eat();
      return v;
    }
    if (t.k === "n") {
      eat();
      if (peek()?.k === "%") {
        eat();
        // "20% of 1200" -- the per cent binds to what follows.
        if (peek()?.k === "of") {
          eat();
          const whole = expr();
          return whole === null ? null : (t.v / 100) * whole;
        }
        return t.v / 100;
      }
      return t.v;
    }
    return null;
  }

  function unary(): number | null {
    const t = peek();
    if (t?.k === "op" && t.v === "-") { eat(); const v = unary(); return v === null ? null : -v; }
    if (t?.k === "op" && t.v === "+") { eat(); return unary(); }
    return atom();
  }

  function term(): number | null {
    let left = unary();
    if (left === null) return null;
    for (;;) {
      const t = peek();
      if (t?.k !== "op" || (t.v !== "*" && t.v !== "/")) return left;
      eat();
      const right = unary();
      if (right === null) return null;
      // Belt and braces: the Number.isFinite at the bottom already turns
      // Infinity into no-answer, and no fixture can tell this line's
      // presence from its absence. It stays because returning early here
      // says what is meant -- a half-typed "12 /" is a sum somebody is
      // still writing, not a sum with an infinite answer.
      if (t.v === "/" && right === 0) return null;
      left = t.v === "*" ? left * right : left / right;
    }
  }

  function expr(): number | null {
    let left: number | null = term();
    if (left === null) return null;
    for (;;) {
      const t = peek();
      if (t?.k !== "op" || (t.v !== "+" && t.v !== "-")) return left;
      const was: number = left;
      eat();

      // The calculator convention: a bare per cent on the right of a plus or
      // a minus is a percentage OF THE LEFT. "1200 - 15%" is 1020.
      const n = toks[at], pc = toks[at + 1];
      if (n?.k === "n" && pc?.k === "%" && toks[at + 2]?.k !== "of") {
        at += 2;
        const base: number = left;
        const part = base * (n.v / 100);
        left = t.v === "+" ? base + part : base - part;
        continue;
      }

      const right = term();
      if (right === null) return null;
      left = t.v === "+" ? was + right : was - right;
    }
  }

  const v = expr();
  // Trailing rubbish means it did not parse, whatever the first half said.
  return v !== null && at === toks.length && Number.isFinite(v) ? v : null;
}

const money = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const plain = (n: number) => {
  const r = Math.round(n * 1e6) / 1e6;
  return r.toLocaleString("en-US", { maximumFractionDigits: 6 });
};

/** Work out what was typed, or null when it was not a sum. */
export function sum(input: string): Sum | null {
  const src = (input ?? "").trim();
  // A fast path rather than a rule: everything it rejects is rejected again
  // below, by the lexer refusing letters and the parser refusing a lone
  // number. It is here so a search for "cross creek" does not lex itself
  // character by character on every keystroke.
  if (!src || !HAS_MATHS.test(src)) return null;
  if (LOOKS_LIKE_A_DATE.test(src)) return null;

  const toks = lex(src);
  if (!toks || toks.length < 2) return null;
  // A single number with a per cent sign is a sum. A lone number is not, and
  // neither is a lone NEGATIVE number -- "-5" is two tokens and would
  // otherwise answer itself, which is the calculator stealing a search for
  // a lot numbered -5 or, far more likely, a half-typed something else.
  if (toks.length === 2 && !(toks[0].k === "n" && toks[1].k === "%")) return null;

  const v = parse(toks);
  if (v === null) return null;

  const isMoney = /\$/.test(src);
  return { value: v, pretty: isMoney ? money(v) : plain(v), money: isMoney };
}
