// src/shared/formula/formula.js
//
// Planyr formula engine — a small, dependency-free Excel-style expression
// evaluator. It is the calculation core behind the scheduler's user-defined
// "Formula" columns (and Cost Estimating's), and — as of A1 cell references,
// below — the Model module's development pro-forma spreadsheet. A structured
// formula is authored once per column and evaluated for every row, referencing
// that row's other columns by name — e.g.  [Finish] - [Start]  or
// IF([% Complete] >= 100, "Done", "Open"). Schedule rows are activities that
// reorder/insert/delete constantly, so structured [Column] refs (not A1
// addresses) are still the right model there and are untouched by A1 support.
//
// A1-style cell references (A1, $A$1, A1:B10, …) address a separate, optional
// 2D grid (ctx.grid — see the contract below) for a fixed-layout sheet like a
// pro-forma. The two reference systems are independent and can appear in the
// same formula; see the "A1 cell-address bounds" section and rewriteFormulaForCopy
// (the relative-reference copy/fill transform) further down for the grammar,
// bounds, and the one identifier/reference collision (LOG10) and how it's
// resolved. Row/column INSERT and DELETE ref-shifting (rewriteFormulaForStructuralShift,
// alongside rewriteFormulaForCopy) was built for the Model workspace's Stage 1 —
// a real underwriting model needs to insert/delete lines with its references intact.
//
// Pipeline:  tokenize → parse (precedence-climbing) → evaluate (tree walk).
// No `eval`, no `new Function`, no regex catastrophes — a hand-written tokenizer
// and parser, so a user's formula text can never execute arbitrary JS.
//
// ── The contract with the host ───────────────────────────────────────────────
// evaluateFormula(src, ctx) where ctx = {
//   columns: { <lowercased column name|alias>: <typed value> },   // this row's data
//   calendar: { isWorkingDay(serial) -> bool },                   // working-day calendar
//   today: <serial>,                                              // TODAY() (injected for determinism)
//   formatDate(serial) -> string,                                 // how dates stringify in & / CONCAT / TEXT default
//   grid: value[][],                                              // optional — A1 refs; grid[row-1][col-1] is that cell (grid[0][0] = A1)
// }
// Typed values handed in via ctx.columns / ctx.grid and returned out are:
//   number  | string | boolean | DATE {k:'date',s:serial} | BLANK | FormulaError(thrown)
// "serial" is an integer day count since 1970-01-01 UTC (clean, DST-free).
//
// ⚠ This file is the single source of truth. A byte-equivalent copy is inlined
// into public/sequence/index.html between the FORMULA-ENGINE markers by
// scripts/sync-sequence-formula.mjs, and test/formula-inline-sync.test.js fails
// CI if the two ever drift. Everything BETWEEN the markers must stay free of
// import/export (so it is valid inside the scheduler's <script type="text/babel">).

/* FORMULA-ENGINE:START */
// ── Error type ────────────────────────────────────────────────────────────────
// Excel-style error codes. These surface verbatim in a cell (never a silent blank).
const FORMULA_ERRORS = {
  REF: "#REF!",     // bad/unknown column name
  DIV0: "#DIV/0!",  // divide (or MOD) by zero
  VALUE: "#VALUE!", // type mismatch / bad argument count
  NAME: "#NAME?",   // unknown function name
  NUM: "#NUM!",     // numeric domain error (SQRT(-1), runaway iteration)
  NA: "#N/A",       // not available (SWITCH/IFS no match)
  CIRC: "#CIRC!",   // circular reference between formula columns
  ERR: "#ERROR!",   // parse/other
};
class FormulaError extends Error {
  constructor(code, detail) {
    super(detail || code);
    this.name = "FormulaError";
    this.code = code;           // one of FORMULA_ERRORS values, e.g. "#VALUE!"
    this.detail = detail || "";
  }
}
const isFormulaError = v => v instanceof FormulaError;
const ferr = (code, detail) => new FormulaError(code, detail);

// ── Value model ────────────────────────────────────────────────────────────────
const BLANK = Object.freeze({ k: "blank" });
const isBlank = v => v === BLANK || v === null || v === undefined;
// An ERROR VALUE: a cell holding an already-determined error code. The engine never
// produces one itself (it THROWS a FormulaError, surfaced as {ok:false}); the HOST writes
// errVal(code) into a formula column's errored cells so that — exactly like Excel — any
// aggregation or reference that CONSUMES that cell re-raises the error instead of silently
// skipping it. (A #DIV/0! row therefore makes SUM over the whole column #DIV/0!, not a
// quietly-smaller total.)
const isErrVal = v => v != null && typeof v === "object" && v.k === "error";
const errVal = code => ({ k: "error", code });
// Re-raise a stored error value at the point of consumption (scalar coercion, comparison,
// or a whole-column collector). A transparent no-op for every normal value.
const raiseIfErr = v => { if (isErrVal(v)) throw ferr(v.code, "propagated error"); return v; };
// JS Date is valid only within ±8.64e15 ms (≈ ±1e8 days from epoch); beyond that getUTC*() are NaN
// and a date would serialize to "0NaN-NaN-NaN". Surface an out-of-range date result as #NUM! instead.
const MAX_DATE_SERIAL = 100000000;
const makeDate = serial => {
  const s = Math.trunc(serial);
  if (!Number.isFinite(s) || Math.abs(s) > MAX_DATE_SERIAL) throw ferr(FORMULA_ERRORS.NUM, "date out of range");
  return { k: "date", s };
};
const isDate = v => !!v && typeof v === "object" && v.k === "date";

// ── A1 cell-address bounds & pure address helpers ────────────────────────────────
// Excel's own limits: 16,384 columns (A .. XFD), 1,048,576 rows. These gate what
// LEXICALLY counts as a reference at all — anything beyond either bound (too many
// column letters, row 0, a row past the max) is rejected as an unknown NAME, never
// accepted as a ref that then errors at eval time (see parseRefText below).
const MAX_COL = 16384;  // XFD
const MAX_ROW = 1048576;
function colLettersToNum(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
function colNumToLetters(num) {
  let n = num, s = "";
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
// $?LETTERS$?DIGITS — the one shape every A1 address (bare or absolute-anchored)
// takes. Returns { col, row, colAbs, rowAbs } or null when the text isn't shaped
// like an address, has a leading-zero row (not valid address syntax), or falls
// outside the bounds above. Case-insensitive. Shared by the parser (deciding
// whether a bare identifier is a name or a reference), the tokenizer's "$" path,
// and the rewrite transform below — ONE definition of "what is a valid address".
const REF_SHAPE = /^(\$?)([A-Za-z]+)(\$?)([0-9]+)$/;
function parseRefText(text) {
  const m = REF_SHAPE.exec(String(text));
  if (!m) return null;
  const [, dollarCol, letters, dollarRow, digits] = m;
  if (digits.length > 1 && digits[0] === "0") return null; // "A01" is not address syntax
  const col = colLettersToNum(letters);
  const row = parseInt(digits, 10);
  if (col < 1 || col > MAX_COL || row < 1 || row > MAX_ROW) return null;
  return { col, row, colAbs: dollarCol === "$", rowAbs: dollarRow === "$" };
}
function refToText(ref) {
  return (ref.colAbs ? "$" : "") + colNumToLetters(ref.col) + (ref.rowAbs ? "$" : "") + ref.row;
}

// ── Serial date helpers (epoch = 1970-01-01 UTC; integer days) ──────────────────
const MS_PER_DAY = 86400000;
const isoToSerial = iso => {
  if (typeof iso !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  if (Number.isNaN(ms)) return null;
  return Math.round(ms / MS_PER_DAY);
};
const ymdToSerial = (y, mo, d) => Math.round(Date.UTC(y, mo - 1, d) / MS_PER_DAY);
const serialToYMD = serial => {
  const dt = new Date(serial * MS_PER_DAY);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
};
const serialToISO = serial => {
  const { y, m, d } = serialToYMD(serial);
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};
// 0=Sun .. 6=Sat
const weekdayOf = serial => new Date(serial * MS_PER_DAY).getUTCDay();
// Parse a user-typed date literal in a function arg: ISO or M/D, M/D/YY, M/D/YYYY.
const parseLooseDate = str => {
  const s = String(str).trim();
  const iso = isoToSerial(s);
  if (iso !== null) return iso;
  const m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(s);
  if (!m) return null;
  let y = m[3] ? +m[3] : new Date().getUTCFullYear();
  if (m[3] && m[3].length === 2) y = 2000 + y;
  return ymdToSerial(y, +m[1], +m[2]);
};

// Default calendar when the host injects none: Mon–Fri, no holidays.
const DEFAULT_CALENDAR = { isWorkingDay: serial => { const w = weekdayOf(serial); return w !== 0 && w !== 6; } };
// Hard ceiling on per-day iteration (WORKDAY/NETWORKDAYS) so a fat-fingered span
// can never spin. ~2700 working years — beyond any real schedule.
const MAX_WD_STEPS = 1_000_000;

// ── Coercions ────────────────────────────────────────────────────────────────
const toNumber = v => {
  raiseIfErr(v);
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (isDate(v)) return v.s;
  if (isBlank(v)) return 0;                       // blank acts as 0 in arithmetic (Excel)
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") throw ferr(FORMULA_ERRORS.VALUE, "empty text is not a number");
    // accept "1,234.5", "$1,234", "50%", leading +/-
    let s = t.replace(/^\$/, "").replace(/,/g, "");
    let pct = false;
    if (/%$/.test(s)) { pct = true; s = s.replace(/%$/, ""); }
    if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) throw ferr(FORMULA_ERRORS.VALUE, `"${v}" is not a number`);
    const n = parseFloat(s);
    return pct ? n / 100 : n;
  }
  throw ferr(FORMULA_ERRORS.VALUE, "not a number");
};
const toStr = (v, ctx) => {
  raiseIfErr(v);
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return numToGeneralStr(v);
  if (isDate(v)) return (ctx && ctx.formatDate ? ctx.formatDate(v.s) : serialToISO(v.s));
  if (isBlank(v)) return "";
  return String(v);
};
const toBool = v => {
  raiseIfErr(v);
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (isDate(v)) return v.s !== 0;
  if (isBlank(v)) return false;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (t === "true") return true;
    if (t === "false") return false;
    throw ferr(FORMULA_ERRORS.VALUE, `"${v}" is not a logical value`);
  }
  throw ferr(FORMULA_ERRORS.VALUE, "not a logical value");
};
// A date arg: returns a serial, or null when the source is blank (callers then
// yield BLANK so an empty [Start] in a date function gives an empty cell, not a
// spurious 1900 date), or throws #VALUE! when it is genuinely non-date text.
const toDateSerial = v => {
  raiseIfErr(v);
  if (isDate(v)) return v.s;
  if (typeof v === "number") return Math.trunc(v);
  if (isBlank(v)) return null;
  if (typeof v === "string") {
    const s = parseLooseDate(v);
    if (s === null) throw ferr(FORMULA_ERRORS.VALUE, `"${v}" is not a date`);
    return s;
  }
  throw ferr(FORMULA_ERRORS.VALUE, "not a date");
};

// "General" number formatting (Excel-like): integers plain, otherwise the shortest
// round-trip at ~15 significant figures. Rounding to SIGNIFICANT figures (not a fixed
// number of decimal places) is what keeps exact decimals clean regardless of their
// integer magnitude — toFixed(10) reintroduced binary-float noise like
// "9999999.99" → "9999999.9900000002" — while still trimming arithmetic residue
// (0.1 + 0.2 → 0.3) and repeating decimals (1/3 → 0.333333333333333).
function numToGeneralStr(n) {
  if (!Number.isFinite(n)) throw ferr(FORMULA_ERRORS.NUM, "non-finite number");
  if (Number.isInteger(n)) return String(n);
  return String(parseFloat(n.toPrecision(15)));
}
function roundAwayFromZero(n, digits) {
  const d = Math.trunc(digits) || 0;
  const f = Math.pow(10, d);
  const r = Math.round(Math.abs(n) * f + 1e-9) / f; // +epsilon to defeat binary-float underbias (2.675→2.68)
  return n < 0 ? -r : r;
}

// Attempts a cell-address token at s[i..]: $?[A-Za-z]+$?[0-9]+, requiring a genuine
// token boundary right after (the next char, if any, must not continue an
// identifier or another "$") — so it never swallows part of a longer identifier.
// "A1.5" and "A1_x" still fall through to the plain identifier scan unchanged,
// because the boundary check rejects a match there. Letters are unbounded here
// (bounds like "too many letters"/"beyond XFD" are a SEMANTIC check — parseRefText
// — not a lexical one, so "ABCD1" still tokenizes; it just won't parse as a ref).
function matchRefToken(s, i) {
  const n = s.length;
  let j = i;
  let colAbs = false;
  if (s[j] === "$") { colAbs = true; j++; }
  const letStart = j;
  while (j < n && /[A-Za-z]/.test(s[j])) j++;
  if (j === letStart) return null;
  let rowAbs = false;
  if (s[j] === "$") { rowAbs = true; j++; }
  const digStart = j;
  while (j < n && s[j] >= "0" && s[j] <= "9") j++;
  if (j === digStart) return null;
  const after = s[j];
  if (after !== undefined && /[A-Za-z0-9_.$]/.test(after)) return null;
  return { text: s.slice(i, j), end: j, hasDollar: colAbs || rowAbs };
}

// ── Tokenizer ────────────────────────────────────────────────────────────────
// Token kinds: num, str, col (bracketed reference), id (function/keyword),
// ref ($A$1-shaped — only when a "$" is present; a plain "A1" stays an "id" so the
// existing function-call lookahead in the parser keeps disambiguating it from a
// call like LOG10( with no lexer-level special-casing), errlit (#REF!), op, eof
const tokenize = src => {
  const s = String(src == null ? "" : src);
  const toks = [];
  let i = 0;
  const n = s.length;
  const peek = () => s[i];
  while (i < n) {
    const c = s[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
    // String literal: "..."  with "" as an escaped quote
    if (c === '"') {
      let j = i + 1, out = "";
      while (j < n) {
        if (s[j] === '"') { if (s[j + 1] === '"') { out += '"'; j += 2; continue; } break; }
        out += s[j]; j++;
      }
      if (j >= n) throw ferr(FORMULA_ERRORS.ERR, "unterminated string");
      toks.push({ t: "str", v: out, pos: i }); i = j + 1; continue;
    }
    // Column reference: [Column Name]. Also the Excel current-row forms [@Column] and
    // [@[Column]] — the inner-bracketed form needs to scan to "]]" (the lone-"]" scan
    // would stop early and leave a stray "]").
    if (c === "[") {
      let j = i + 1, out = "";
      const bracketedInner = s[j] === "@" && s[j + 1] === "[";
      while (j < n) {
        if (s[j] === "]") {
          if (bracketedInner && s[j + 1] === "]") { out += "]"; j++; } // capture the inner "]", advance onto the outer one
          break;                                                        // j now sits ON the terminating "]"
        }
        out += s[j]; j++;
      }
      if (j >= n) throw ferr(FORMULA_ERRORS.ERR, "unterminated column reference");
      toks.push({ t: "col", v: out.trim(), pos: i }); i = j + 1; continue;
    }
    // Number: 123, 1.5, .5, 1e3
    if ((c >= "0" && c <= "9") || (c === "." && s[i + 1] >= "0" && s[i + 1] <= "9")) {
      let j = i, dot = false, exp = false;
      while (j < n) {
        const ch = s[j];
        if (ch >= "0" && ch <= "9") { j++; continue; }
        if (ch === "." && !dot && !exp) { dot = true; j++; continue; }
        if ((ch === "e" || ch === "E") && !exp) { exp = true; j++; if (s[j] === "+" || s[j] === "-") j++; continue; }
        break;
      }
      const numVal = parseFloat(s.slice(i, j));
      // A literal that overflows the float range (e.g. 1e309 → Infinity) is a #NUM! at the
      // source, so it can never slip into a comparison/label as a silent Infinity.
      if (!Number.isFinite(numVal)) throw ferr(FORMULA_ERRORS.NUM, "number literal out of range");
      toks.push({ t: "num", v: numVal, pos: i }); i = j; continue;
    }
    // "$"-anchored cell address: $A$1 / A$1 / $A1 (a bare "A1" with no "$" stays
    // an "id" token below — see matchRefToken's header comment). "$" has no other
    // meaning in this grammar, so a failed match here is always an error.
    if (c === "$") {
      const m = matchRefToken(s, i);
      if (!m) throw ferr(FORMULA_ERRORS.ERR, `unexpected character "$"`);
      toks.push({ t: "ref", v: m.text, pos: i }); i = m.end; continue;
    }
    // "#REF!" error literal — the one error code a formula can legally embed as
    // text (produced by rewriteFormulaForCopy when a fill/copy shifts a relative
    // reference off the sheet; also legal to type directly, matching Excel).
    if (c === "#") {
      if (s.slice(i, i + 5).toUpperCase() === "#REF!") { toks.push({ t: "errlit", v: "#REF!", pos: i }); i += 5; continue; }
      throw ferr(FORMULA_ERRORS.ERR, `unexpected character "#"`);
    }
    // Identifier: function name / TRUE / FALSE / bare cell address (A1, LOG10, …).
    // Letters, digits, _, ., and a trailing % only inside names like none — names
    // are [A-Za-z_][A-Za-z0-9_.]*. Tried first against the address shape so "A$1"
    // (a "$" embedded before the digits, with no leading "$") still lexes as ONE
    // ref token instead of splitting at the "$" — but only when a "$" is actually
    // present; a plain "A1"/"LOG10"/"ABCD1" always matches the SAME boundary either
    // way, so leaving it as "id" here is a no-op for every existing formula.
    if (/[A-Za-z_]/.test(c)) {
      if (c !== "_") {
        const m = matchRefToken(s, i);
        if (m && m.hasDollar) { toks.push({ t: "ref", v: m.text, pos: i }); i = m.end; continue; }
      }
      let j = i;
      while (j < n && /[A-Za-z0-9_.]/.test(s[j])) j++;
      toks.push({ t: "id", v: s.slice(i, j), pos: i }); i = j; continue;
    }
    // Multi-char operators first
    const two = s.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "<>") { toks.push({ t: "op", v: two, pos: i }); i += 2; continue; }
    if ("+-*/^&=<>(),%:".includes(c)) { toks.push({ t: "op", v: c, pos: i }); i++; continue; }
    throw ferr(FORMULA_ERRORS.ERR, `unexpected character "${c}"`);
  }
  toks.push({ t: "eof", v: null, pos: n });
  return toks;
};

// ── Parser (precedence climbing) ────────────────────────────────────────────────
// Operator precedence, low → high (Excel order):
//   comparison (= <> < > <= >=)  <  concat (&)  <  +-  <  * /  <  unary -  <  ^
// Note the Excel quirk: unary minus binds TIGHTER than ^, so -2^2 = (-2)^2 = 4.
const COMPARE = { "=": 1, "<>": 1, "<": 1, ">": 1, "<=": 1, ">=": 1 };
// Bound on nesting depth of parens/function calls. Far beyond any real formula; it
// exists only so a pathological input (e.g. thousands of "((((…") can't blow the
// recursive-descent parser's / evaluator's call stack with an uncatchable RangeError.
const MAX_PARSE_DEPTH = 200;
// Hard ceiling on total token count. The parser is iterative for operator chains (no
// recursion), but the tree-walk EVALUATOR recurses down a long left-leaning chain
// (a+b+c+…), so a multi-thousand-term formula could overflow the JS call stack — and
// WHETHER it does depends on the ambient stack depth at call time, making the result
// non-deterministic (#ERROR! vs a value for the very same input). Rejecting an
// over-large formula up front (well above any real formula, far below the overflow
// boundary) makes the verdict input-determined. ~1000 tokens ⇒ ≤~1000 eval frames.
const MAX_TOKENS = 1000;
const parse = toks => {
  if (toks.length > MAX_TOKENS) throw ferr(FORMULA_ERRORS.ERR, "formula too large");
  let p = 0;
  let depth = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const expect = v => {
    const t = toks[p];
    if (t.t === "op" && t.v === v) { p++; return; }
    throw ferr(FORMULA_ERRORS.ERR, `expected "${v}"`);
  };

  // level 0: comparison (left-assoc)
  const parseCompare = () => {
    let left = parseConcat();
    while (peek().t === "op" && COMPARE[peek().v]) { const op = next().v; left = { type: "binary", op, left, right: parseConcat() }; }
    return left;
  };
  // level 1: concat &
  const parseConcat = () => {
    let left = parseAdd();
    while (peek().t === "op" && peek().v === "&") { next(); left = { type: "binary", op: "&", left, right: parseAdd() }; }
    return left;
  };
  // level 2: + -
  const parseAdd = () => {
    let left = parseMul();
    while (peek().t === "op" && (peek().v === "+" || peek().v === "-")) { const op = next().v; left = { type: "binary", op, left, right: parseMul() }; }
    return left;
  };
  // level 3: * /
  const parseMul = () => {
    let left = parsePow();
    while (peek().t === "op" && (peek().v === "*" || peek().v === "/")) { const op = next().v; left = { type: "binary", op, left, right: parsePow() }; }
    return left;
  };
  // level 4: ^  (left-associative, matching Excel: 2^3^2 = (2^3)^2 = 64). Its
  // operands are parsed at the unary level, so a leading sign binds tighter than
  // the exponent — Excel's quirk where -2^2 = (-2)^2 = 4.
  const parsePow = () => {
    let base = parseUnary();
    while (peek().t === "op" && peek().v === "^") { next(); base = { type: "binary", op: "^", left: base, right: parseUnary() }; }
    return base;
  };
  // level 5: unary + -
  const parseUnary = () => {
    if (peek().t === "op" && (peek().v === "-" || peek().v === "+")) { const op = next().v; return { type: "unary", op, arg: parseUnary() }; }
    return parsePrimary();
  };
  // A primary, plus any trailing postfix "%" (Excel: 50% → 0.5, binds tightest).
  const parsePrimary = () => {
    let node = parseAtom();
    while (peek().t === "op" && peek().v === "%") { next(); node = { type: "percent", arg: node }; }
    return node;
  };
  // A ref/range atom, given the FIRST endpoint's already-validated {col,row,colAbs,
  // rowAbs}. Consumes a trailing ":" + second endpoint if present, producing a
  // "range" node; otherwise a scalar "ref" node. Shared by the "ref"-token path and
  // the "id"-token-that-turned-out-to-be-an-address path below, so A1:B10 parses
  // the same way regardless of which side(s) carry a "$".
  const finishRefOrRange = first => {
    if (peek().t === "op" && peek().v === ":") {
      next();
      const t2 = peek();
      if (t2.t !== "ref" && t2.t !== "id") throw ferr(FORMULA_ERRORS.ERR, 'expected a cell reference after ":"');
      const second = parseRefText(t2.v);
      if (!second) throw ferr(FORMULA_ERRORS.NAME, `unknown name "${t2.v}"`);
      next();
      return { type: "range", from: first, to: second };
    }
    return { type: "ref", ...first };
  };
  const parseAtom = () => {
    const t = peek();
    if (t.t === "num") { next(); return { type: "num", value: t.v }; }
    if (t.t === "str") { next(); return { type: "str", value: t.v }; }
    if (t.t === "errlit") { next(); return { type: "errLiteral", code: t.v }; }
    if (t.t === "ref") {
      const info = parseRefText(t.v);
      if (!info) throw ferr(FORMULA_ERRORS.NAME, `unknown name "${t.v}"`); // e.g. $ABCD$1 — too many letters
      next();
      return finishRefOrRange(info);
    }
    if (t.t === "col") {
      next();
      // Excel structured reference: [@Column] (or [@[Column]]) is the CURRENT row
      // explicitly; a bare [Column] is the whole column, implicitly intersected to the
      // current row in a scalar position (handled at eval time). atRow marks the @ form.
      let nm = t.v, atRow = false;
      if (nm[0] === "@") { atRow = true; nm = nm.slice(1).trim(); if (nm[0] === "[" && nm[nm.length - 1] === "]") nm = nm.slice(1, -1).trim(); }
      return { type: "col", name: nm, atRow };
    }
    if (t.t === "op" && t.v === "(") { next(); if (++depth > MAX_PARSE_DEPTH) throw ferr(FORMULA_ERRORS.ERR, "formula nesting too deep"); const e = parseCompare(); depth--; expect(")"); return e; }
    if (t.t === "id") {
      next();
      const up = t.v.toUpperCase();
      const callsNext = peek().t === "op" && peek().v === "(";
      // Bare TRUE / FALSE are boolean literals; TRUE() / FALSE() fall through to the
      // function call below (both are valid in Excel).
      if (up === "TRUE" && !callsNext) return { type: "bool", value: true };
      if (up === "FALSE" && !callsNext) return { type: "bool", value: false };
      // function call: NAME( args )
      if (peek().t === "op" && peek().v === "(") {
        next();
        if (++depth > MAX_PARSE_DEPTH) throw ferr(FORMULA_ERRORS.ERR, "formula nesting too deep");
        const args = [];
        if (!(peek().t === "op" && peek().v === ")")) {
          args.push(parseCompare());
          while (peek().t === "op" && peek().v === ",") { next(); args.push(parseCompare()); }
        }
        depth--;
        expect(")");
        return { type: "call", name: up, args };
      }
      // Not a call, not TRUE/FALSE — Excel's own disambiguation rule: an identifier
      // immediately followed by "(" is ALWAYS a function call (handled above, already
      // returned), never a reference; only past that point is it worth asking whether
      // the bare text also happens to be shaped like a cell address (LOG10 is the one
      // name in this registry where that's true — see formula.js header note).
      const info = parseRefText(t.v);
      if (info) return finishRefOrRange(info);
      // A bare identifier that is not TRUE/FALSE, not a call, and not a valid address
      // (out-of-bounds addresses like ABCD1/XFE1/A0/A1048577 land here too) is unknown.
      throw ferr(FORMULA_ERRORS.NAME, `unknown name "${t.v}" (use [${t.v}] for a column)`);
    }
    throw ferr(FORMULA_ERRORS.ERR, "unexpected end of formula");
  };

  const ast = parseCompare();
  if (peek().t !== "eof") throw ferr(FORMULA_ERRORS.ERR, "unexpected trailing input");
  return ast;
};

// parseFormulaUncached: lenient wrapper used by the UI for live validation. Returns
// { ast } or { error }. Empty/whitespace formula parses to a blank node.
const parseFormulaUncached = src => {
  const text = String(src == null ? "" : src).trim();
  if (text === "") return { ast: { type: "blankLiteral" } };
  try { return { ast: parse(tokenize(text)) }; }
  // Contract: never throw to the host. A FormulaError carries a code; anything else
  // (e.g. a RangeError from pathological depth that slipped the guard) is reported as
  // a generic parse error rather than crashing the caller's render.
  catch (e) { if (isFormulaError(e)) return { error: e.code, detail: e.detail }; return { error: FORMULA_ERRORS.ERR, detail: (e && e.message) || "parse error" }; }
};
// evaluateFormula is called once per ROW (a grid with N rows re-parses the SAME column
// formula N times per recalc), so re-tokenizing/re-parsing on every cell is pure waste —
// parseFormula is a pure function of its source text, so a small bounded LRU-ish cache
// (FIFO eviction via Map's insertion order) makes every row after the first a lookup.
// Sharing the returned AST object across calls is safe: every consumer (evaluateFormula,
// extractRefs) only ever reads it. It also means the SAME "col"/"call" node objects recur
// across a whole recalc pass for one formula column, which is what lets the row-invariant
// caches below (keyed on those node objects) actually hit.
const PARSE_CACHE_MAX = 500;
const parseCache = new Map();
const parseFormula = src => {
  const key = String(src == null ? "" : src);
  const hit = parseCache.get(key);
  if (hit) { parseCache.delete(key); parseCache.set(key, hit); return hit; } // refresh LRU order
  const result = parseFormulaUncached(key);
  parseCache.set(key, result);
  if (parseCache.size > PARSE_CACHE_MAX) parseCache.delete(parseCache.keys().next().value);
  return result;
};

// extractRefs: the set of column names a formula reads (case-preserving, deduped
// by lowercase). Powers the dependency graph (recalc order + circular detection)
// and the editor's "this column reads…" hinting.
const collectRefs = (node, acc) => {
  if (!node || typeof node !== "object") return;
  if (node.type === "col") { acc.set(node.name.toLowerCase(), node.name); return; }
  if (node.type === "binary") { collectRefs(node.left, acc); collectRefs(node.right, acc); return; }
  if (node.type === "unary") { collectRefs(node.arg, acc); return; }
  if (node.type === "call") { node.args.forEach(a => collectRefs(a, acc)); return; }
};
const extractRefs = src => {
  const { ast, error, detail } = parseFormula(src);
  if (error) return { error, detail, refs: [] };
  const acc = new Map();
  collectRefs(ast, acc);
  return { refs: [...acc.values()] };
};

// ── Comparison helper (Excel-ish cross-type ordering) ──────────────────────────
const TYPE_RANK = v => {
  if (typeof v === "number" || isDate(v) || isBlank(v)) return 0;  // numeric family
  if (typeof v === "string") return 1;
  if (typeof v === "boolean") return 2;
  return 3;
};
const compareValues = (a, b) => {
  // Returns -1/0/1, or throws on incomparable. Numbers/dates/blank compare numerically;
  // strings compare case-insensitively; otherwise rank by type (number<text<bool).
  raiseIfErr(a); raiseIfErr(b);   // comparing against an errored cell propagates the error
  // A blank cell equals the empty string "" (matches Excel + the engine's own ISBLANK("")→true), so the
  // everyday `[Date]=""` empty-test works; a blank sorts before any non-empty text.
  if (isBlank(a) && typeof b === "string") return b === "" ? 0 : -1;
  if (isBlank(b) && typeof a === "string") return a === "" ? 0 : 1;
  const ra = TYPE_RANK(a), rb = TYPE_RANK(b);
  if (ra === 0 && rb === 0) { const x = toNumber(a), y = toNumber(b); return x < y ? -1 : x > y ? 1 : 0; }
  if (ra === 1 && rb === 1) { const x = a.toLowerCase(), y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; }
  if (ra === 2 && rb === 2) { const x = a ? 1 : 0, y = b ? 1 : 0; return x - y; }
  return ra < rb ? -1 : ra > rb ? 1 : 0;
};

// ── Function library ────────────────────────────────────────────────────────────
// Eager functions receive (args[], ctx); special forms receive (argNodes[], ctx, ev)
// so they can short-circuit (IF) or trap errors (IFERROR) without evaluating
// branches that Excel would skip.
const need = (args, lo, hi, name) => {
  if (args.length < lo || (hi != null && args.length > hi)) throw ferr(FORMULA_ERRORS.VALUE, `${name} expects ${hi == null ? lo + "+" : lo === hi ? lo : lo + "–" + hi} argument(s)`);
};
const num1 = v => toNumber(v);

const FUNCTIONS = {
  // ── Aggregation (range-aware: a bare [Column] arg sums/counts the WHOLE column;
  //    scalars and [@Column] this-row refs contribute a single value — Excel semantics) ──
  SUM:     { rng: (an, ctx, ev) => { need(an, 1, null, "SUM"); return collectNums(an, ctx, ev).reduce((s, v) => s + v, 0); } },
  PRODUCT: { rng: (an, ctx, ev) => { need(an, 1, null, "PRODUCT"); const n = collectNums(an, ctx, ev); return n.length ? n.reduce((s, v) => s * v, 1) : 0; } },
  MIN:     { rng: (an, ctx, ev) => { need(an, 1, null, "MIN"); const k = collectNumsKind(an, ctx, ev); if (!k.nums.length) return 0; const m = Math.min(...k.nums); return k.allDates ? makeDate(m) : m; } },
  MAX:     { rng: (an, ctx, ev) => { need(an, 1, null, "MAX"); const k = collectNumsKind(an, ctx, ev); if (!k.nums.length) return 0; const m = Math.max(...k.nums); return k.allDates ? makeDate(m) : m; } },
  AVERAGE: { rng: (an, ctx, ev) => { need(an, 1, null, "AVERAGE"); const n = collectNums(an, ctx, ev); if (!n.length) throw ferr(FORMULA_ERRORS.DIV0, "AVERAGE of no numbers"); return n.reduce((s, v) => s + v, 0) / n.length; } },
  COUNT:   { rng: (an, ctx, ev) => { need(an, 1, null, "COUNT"); return collectCountable(an, ctx, ev); } },
  COUNTA:  { rng: (an, ctx, ev) => { need(an, 1, null, "COUNTA"); return collectNonBlank(an, ctx, ev); } },
  COUNTIF:   { rng: (an, ctx, ev) => { need(an, 2, 2, "COUNTIF"); const range = colArray(an[0], ctx), crit = ev(an[1], ctx); let c = 0; range.forEach(v => { raiseIfErr(v); if (matchesCriteria(v, crit)) c++; }); return c; } },
  SUMIF:     { rng: (an, ctx, ev) => { need(an, 2, 3, "SUMIF"); const range = colArray(an[0], ctx), crit = ev(an[1], ctx); const sumRange = an.length > 2 ? colArray(an[2], ctx) : range; let s = 0; range.forEach((v, i) => { raiseIfErr(v); if (matchesCriteria(v, crit)) { const x = sumRange[i]; raiseIfErr(x); if (typeof x === "number") s += x; else if (isDate(x)) s += x.s; } }); return s; } },
  AVERAGEIF: { rng: (an, ctx, ev) => { need(an, 2, 3, "AVERAGEIF"); const range = colArray(an[0], ctx), crit = ev(an[1], ctx); const avgRange = an.length > 2 ? colArray(an[2], ctx) : range; let s = 0, c = 0; range.forEach((v, i) => { raiseIfErr(v); if (matchesCriteria(v, crit)) { const x = avgRange[i]; raiseIfErr(x); if (typeof x === "number") { s += x; c++; } else if (isDate(x)) { s += x.s; c++; } } }); if (!c) throw ferr(FORMULA_ERRORS.DIV0, "AVERAGEIF: no matching numbers"); return s / c; } },

  // ── Lookup (column-based; the modern XLOOKUP / INDEX+MATCH set) ──
  MATCH:   { rng: (an, ctx, ev) => { need(an, 2, 3, "MATCH"); const target = ev(an[0], ctx); const arr = colArray(an[1], ctx); const type = an.length > 2 ? Math.trunc(toNumber(ev(an[2], ctx))) : 1; return matchIndex(target, arr, type); } },
  INDEX:   { rng: (an, ctx, ev) => { need(an, 2, 2, "INDEX"); const arr = colArray(an[0], ctx); const n = Math.trunc(toNumber(ev(an[1], ctx))); if (n < 1 || n > arr.length) throw ferr(FORMULA_ERRORS.REF, "INDEX out of range"); return arr[n - 1]; } },
  XLOOKUP: { rng: (an, ctx, ev) => { need(an, 3, 5, "XLOOKUP"); const target = ev(an[0], ctx); const look = colArray(an[1], ctx); const ret = colArray(an[2], ctx); for (let i = 0; i < look.length; i++) { if (compareValues(target, look[i]) === 0) return ret[i] === undefined ? BLANK : ret[i]; } if (an.length > 3) return ev(an[3], ctx); throw ferr(FORMULA_ERRORS.NA, "XLOOKUP: no match"); } },

  // ── Math ──
  ABS:   { fn: a => { need(a, 1, 1, "ABS"); return Math.abs(num1(a[0])); } },
  ROUND: { fn: a => { need(a, 1, 2, "ROUND"); return roundAwayFromZero(num1(a[0]), a.length > 1 ? num1(a[1]) : 0); } },
  ROUNDUP: { fn: a => { need(a, 1, 2, "ROUNDUP"); const d = a.length > 1 ? Math.trunc(num1(a[1])) : 0, f = Math.pow(10, d), n = num1(a[0]); return (n < 0 ? -Math.ceil(Math.abs(n) * f - 1e-9) : Math.ceil(n * f - 1e-9)) / f; } },
  ROUNDDOWN: { fn: a => { need(a, 1, 2, "ROUNDDOWN"); const d = a.length > 1 ? Math.trunc(num1(a[1])) : 0, f = Math.pow(10, d), n = num1(a[0]); return (n < 0 ? -Math.floor(Math.abs(n) * f + 1e-9) : Math.floor(n * f + 1e-9)) / f; } },
  INT:   { fn: a => { need(a, 1, 1, "INT"); return Math.floor(num1(a[0])); } },
  MOD:   { fn: a => { need(a, 2, 2, "MOD"); const n = num1(a[0]), d = num1(a[1]); if (d === 0) throw ferr(FORMULA_ERRORS.DIV0, "MOD by zero"); return n - d * Math.floor(n / d); } },
  // The ±1e-9 on the quotient defeats binary-float drift (n/sig comes out a hair under/over
  // the true integer multiple), so FLOOR(2.4,0.1)=2.4 not 2.3 and CEILING never over-steps.
  // Matches the same epsilon discipline used by ROUNDUP/ROUNDDOWN above. (n/sig ≥ 0: the
  // sign-mismatch case already threw, so the epsilon always nudges toward the true multiple.)
  CEILING: { fn: a => { need(a, 1, 2, "CEILING"); const n = num1(a[0]), sig = a.length > 1 ? num1(a[1]) : 1; if (sig === 0) return 0; if (n > 0 && sig < 0) throw ferr(FORMULA_ERRORS.NUM, "CEILING: number and significance must share a sign"); return Math.ceil(n / sig - 1e-9) * sig; } },
  FLOOR: { fn: a => { need(a, 1, 2, "FLOOR"); const n = num1(a[0]), sig = a.length > 1 ? num1(a[1]) : 1; if (sig === 0) throw ferr(FORMULA_ERRORS.DIV0, "FLOOR significance 0"); if (n > 0 && sig < 0) throw ferr(FORMULA_ERRORS.NUM, "FLOOR: number and significance must share a sign"); return Math.floor(n / sig + 1e-9) * sig; } },
  POWER: { fn: a => { need(a, 2, 2, "POWER"); const r = Math.pow(num1(a[0]), num1(a[1])); if (!Number.isFinite(r)) throw ferr(FORMULA_ERRORS.NUM, "POWER overflow/!domain"); return r; } },
  SQRT:  { fn: a => { need(a, 1, 1, "SQRT"); const n = num1(a[0]); if (n < 0) throw ferr(FORMULA_ERRORS.NUM, "SQRT of negative"); return Math.sqrt(n); } },

  // ── Logical (eager) ──
  AND:   { fn: a => { need(a, 1, null, "AND"); return a.every(v => toBool(v)); } },
  OR:    { fn: a => { need(a, 1, null, "OR"); return a.some(v => toBool(v)); } },
  NOT:   { fn: a => { need(a, 1, 1, "NOT"); return !toBool(a[0]); } },
  ISBLANK: { fn: a => { need(a, 1, 1, "ISBLANK"); return isBlank(a[0]) || a[0] === ""; } },

  // ── Logical (lazy / special forms) ──
  IF:    { lazy: (an, ctx, ev) => { need(an, 2, 3, "IF"); return toBool(ev(an[0], ctx)) ? ev(an[1], ctx) : (an.length > 2 ? ev(an[2], ctx) : false); } },
  IFS:   { lazy: (an, ctx, ev) => { if (an.length < 2 || an.length % 2 !== 0) throw ferr(FORMULA_ERRORS.VALUE, "IFS expects condition/value pairs"); for (let i = 0; i < an.length; i += 2) { if (toBool(ev(an[i], ctx))) return ev(an[i + 1], ctx); } throw ferr(FORMULA_ERRORS.NA, "IFS: no condition matched"); } },
  SWITCH: { lazy: (an, ctx, ev) => { need(an, 3, null, "SWITCH"); const subj = ev(an[0], ctx); let i = 1; for (; i + 1 < an.length; i += 2) { if (compareValues(subj, ev(an[i], ctx)) === 0) return ev(an[i + 1], ctx); } if (i < an.length) return ev(an[i], ctx); throw ferr(FORMULA_ERRORS.NA, "SWITCH: no case matched"); } },
  IFERROR: { lazy: (an, ctx, ev) => { need(an, 2, 2, "IFERROR"); try { return ev(an[0], ctx); } catch (e) { if (isFormulaError(e)) return ev(an[1], ctx); throw e; } } },

  // ── Date ──  (all working-day logic honors ctx.calendar)
  TODAY: { fn: (a, ctx) => makeDate(ctx.today) },
  DATE:  { fn: a => { need(a, 3, 3, "DATE"); return makeDate(ymdToSerial(Math.trunc(num1(a[0])), Math.trunc(num1(a[1])), Math.trunc(num1(a[2])))); } },
  YEAR:  { fn: a => { need(a, 1, 1, "YEAR"); const s = toDateSerial(a[0]); return s === null ? BLANK : serialToYMD(s).y; } },
  MONTH: { fn: a => { need(a, 1, 1, "MONTH"); const s = toDateSerial(a[0]); return s === null ? BLANK : serialToYMD(s).m; } },
  DAY:   { fn: a => { need(a, 1, 1, "DAY"); const s = toDateSerial(a[0]); return s === null ? BLANK : serialToYMD(s).d; } },
  WEEKDAY: { fn: a => { need(a, 1, 2, "WEEKDAY"); const s = toDateSerial(a[0]); if (s === null) return BLANK; const dow = weekdayOf(s); const type = a.length > 1 ? Math.trunc(num1(a[1])) : 1; if (type === 1) return dow + 1; if (type === 2) return ((dow + 6) % 7) + 1; if (type === 3) return (dow + 6) % 7; throw ferr(FORMULA_ERRORS.NUM, "WEEKDAY type must be 1, 2 or 3"); } },
  EDATE: { fn: a => { need(a, 2, 2, "EDATE"); const s = toDateSerial(a[0]); if (s === null) return BLANK; const { y, m, d } = serialToYMD(s); return makeDate(addMonths(y, m, d, Math.trunc(num1(a[1])))); } },
  EOMONTH: { fn: a => { need(a, 2, 2, "EOMONTH"); const s = toDateSerial(a[0]); if (s === null) return BLANK; const { y, m } = serialToYMD(s); const months = Math.trunc(num1(a[1])); const ty = y + Math.floor((m - 1 + months) / 12); const tm = ((m - 1 + months) % 12 + 12) % 12 + 1; return makeDate(ymdToSerial(ty, tm + 1, 0)); } },
  DAYS:  { fn: a => { need(a, 2, 2, "DAYS"); const e = toDateSerial(a[0]), s = toDateSerial(a[1]); if (e === null || s === null) return BLANK; return e - s; } },
  DATEDIF: { fn: a => { need(a, 3, 3, "DATEDIF"); const s = toDateSerial(a[0]), e = toDateSerial(a[1]); if (s === null || e === null) return BLANK; return datedif(s, e, toStr(a[2]).toUpperCase()); } },
  WORKDAY: { fn: (a, ctx) => { need(a, 2, null, "WORKDAY"); const s = toDateSerial(a[0]); if (s === null) return BLANK; const extra = extraHolidaySet(a.slice(2)); return makeDate(addWorkdays(s, Math.trunc(num1(a[1])), ctx.calendar || DEFAULT_CALENDAR, extra)); } },
  NETWORKDAYS: { fn: (a, ctx) => { need(a, 2, null, "NETWORKDAYS"); const s = toDateSerial(a[0]), e = toDateSerial(a[1]); if (s === null || e === null) return BLANK; const extra = extraHolidaySet(a.slice(2)); return networkDays(s, e, ctx.calendar || DEFAULT_CALENDAR, extra); } },

  // ── Text ──
  CONCAT: { fn: (a, ctx) => a.map(v => toStr(v, ctx)).join("") },
  LEFT:  { fn: a => { need(a, 1, 2, "LEFT"); const s = toStr(a[0]); const n = a.length > 1 ? Math.trunc(num1(a[1])) : 1; if (n < 0) throw ferr(FORMULA_ERRORS.VALUE, "LEFT count < 0"); return s.slice(0, n); } },
  RIGHT: { fn: a => { need(a, 1, 2, "RIGHT"); const s = toStr(a[0]); const n = a.length > 1 ? Math.trunc(num1(a[1])) : 1; if (n < 0) throw ferr(FORMULA_ERRORS.VALUE, "RIGHT count < 0"); return n === 0 ? "" : s.slice(Math.max(0, s.length - n)); } },
  MID:   { fn: a => { need(a, 3, 3, "MID"); const s = toStr(a[0]); const start = Math.trunc(num1(a[1])); const len = Math.trunc(num1(a[2])); if (start < 1 || len < 0) throw ferr(FORMULA_ERRORS.VALUE, "MID start/length out of range"); return s.slice(start - 1, start - 1 + len); } },
  LEN:   { fn: a => { need(a, 1, 1, "LEN"); return toStr(a[0]).length; } },
  TRIM:  { fn: a => { need(a, 1, 1, "TRIM"); return toStr(a[0]).replace(/\s+/g, " ").trim(); } },
  UPPER: { fn: a => { need(a, 1, 1, "UPPER"); return toStr(a[0]).toUpperCase(); } },
  LOWER: { fn: a => { need(a, 1, 1, "LOWER"); return toStr(a[0]).toLowerCase(); } },
  TEXT:  { fn: (a, ctx) => { need(a, 2, 2, "TEXT"); return textFormat(a[0], toStr(a[1]), ctx); } },
  SUBSTITUTE: { fn: a => { need(a, 3, 4, "SUBSTITUTE"); const s = toStr(a[0]), oldT = toStr(a[1]), newT = toStr(a[2]); if (oldT === "") return s; if (a.length > 3) { const inst = Math.trunc(num1(a[3])); if (inst < 1) throw ferr(FORMULA_ERRORS.VALUE, "SUBSTITUTE instance < 1"); let i = 0, from = 0, idx; while ((idx = s.indexOf(oldT, from)) !== -1) { i++; if (i === inst) return s.slice(0, idx) + newT + s.slice(idx + oldT.length); from = idx + oldT.length; } return s; } return s.split(oldT).join(newT); } },
  REPLACE: { fn: a => { need(a, 4, 4, "REPLACE"); const s = toStr(a[0]); const start = Math.trunc(num1(a[1])); const len = Math.trunc(num1(a[2])); const newT = toStr(a[3]); if (start < 1 || len < 0) throw ferr(FORMULA_ERRORS.VALUE, "REPLACE start/length"); return s.slice(0, start - 1) + newT + s.slice(start - 1 + len); } },
  FIND:   { fn: a => { need(a, 2, 3, "FIND"); const find = toStr(a[0]), within = toStr(a[1]); const start = a.length > 2 ? Math.trunc(num1(a[2])) : 1; if (start < 1) throw ferr(FORMULA_ERRORS.VALUE, "FIND start < 1"); const idx = within.indexOf(find, start - 1); if (idx === -1) throw ferr(FORMULA_ERRORS.VALUE, "FIND: text not found"); return idx + 1; } },
  SEARCH: { fn: a => { need(a, 2, 3, "SEARCH"); const find = toStr(a[0]).toLowerCase(), within = toStr(a[1]).toLowerCase(); const start = a.length > 2 ? Math.trunc(num1(a[2])) : 1; if (start < 1) throw ferr(FORMULA_ERRORS.VALUE, "SEARCH start < 1"); const hay = within.slice(start - 1); let idx; if (/[*?]/.test(find)) { const m = wildcardToRegExp(find, false).exec(hay); idx = m ? start - 1 + m.index : -1; } else idx = within.indexOf(find, start - 1); if (idx === -1) throw ferr(FORMULA_ERRORS.VALUE, "SEARCH: text not found"); return idx + 1; } },
  REPT:   { fn: a => { need(a, 2, 2, "REPT"); const s = toStr(a[0]); const n = Math.trunc(num1(a[1])); if (n < 0) throw ferr(FORMULA_ERRORS.VALUE, "REPT count < 0"); if (s.length * n > 32767) throw ferr(FORMULA_ERRORS.VALUE, "REPT result too long"); return s.repeat(n); } },
  PROPER: { fn: a => { need(a, 1, 1, "PROPER"); return toStr(a[0]).replace(/[A-Za-z]+/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase()); } },
  TEXTJOIN: { fn: (a, ctx) => { need(a, 3, null, "TEXTJOIN"); const delim = toStr(a[0], ctx); const ignoreEmpty = toBool(a[1]); const parts = a.slice(2).map(v => toStr(v, ctx)).filter(p => !ignoreEmpty || p !== ""); return parts.join(delim); } },
  VALUE:  { fn: a => { need(a, 1, 1, "VALUE"); return toNumber(toStr(a[0])); } },
  EXACT:  { fn: a => { need(a, 2, 2, "EXACT"); return toStr(a[0]) === toStr(a[1]); } },
  CHAR:   { fn: a => { need(a, 1, 1, "CHAR"); const n = Math.trunc(num1(a[0])); if (n < 1 || n > 0x10FFFF) throw ferr(FORMULA_ERRORS.VALUE, "CHAR out of range"); return String.fromCodePoint(n); } },
  CODE:   { fn: a => { need(a, 1, 1, "CODE"); const s = toStr(a[0]); if (!s.length) throw ferr(FORMULA_ERRORS.VALUE, "CODE of empty text"); return s.codePointAt(0); } },

  // ── Math (extras) ──
  AVERAGEA: { rng: (an, ctx, ev) => { need(an, 1, null, "AVERAGEA"); const n = collectNums(an, ctx, ev); if (!n.length) throw ferr(FORMULA_ERRORS.DIV0, "AVERAGEA of no numbers"); return n.reduce((s, v) => s + v, 0) / n.length; } },
  SIGN:   { fn: a => { need(a, 1, 1, "SIGN"); return Math.sign(num1(a[0])); } },
  TRUNC:  { fn: a => { need(a, 1, 2, "TRUNC"); const d = a.length > 1 ? Math.trunc(num1(a[1])) : 0, f = Math.pow(10, d), n = num1(a[0]); return Math.trunc(n * f) / f; } },
  EXP:    { fn: a => { need(a, 1, 1, "EXP"); const r = Math.exp(num1(a[0])); if (!Number.isFinite(r)) throw ferr(FORMULA_ERRORS.NUM, "EXP overflow"); return r; } },
  LN:     { fn: a => { need(a, 1, 1, "LN"); const n = num1(a[0]); if (n <= 0) throw ferr(FORMULA_ERRORS.NUM, "LN of non-positive"); return Math.log(n); } },
  LOG:    { fn: a => { need(a, 1, 2, "LOG"); const n = num1(a[0]); const base = a.length > 1 ? num1(a[1]) : 10; if (n <= 0 || base <= 0 || base === 1) throw ferr(FORMULA_ERRORS.NUM, "LOG domain"); return Math.log(n) / Math.log(base); } },
  LOG10:  { fn: a => { need(a, 1, 1, "LOG10"); const n = num1(a[0]); if (n <= 0) throw ferr(FORMULA_ERRORS.NUM, "LOG10 of non-positive"); return Math.log10(n); } },
  PI:     { fn: () => Math.PI },
  QUOTIENT: { fn: a => { need(a, 2, 2, "QUOTIENT"); const d = num1(a[1]); if (d === 0) throw ferr(FORMULA_ERRORS.DIV0, "QUOTIENT by zero"); return Math.trunc(num1(a[0]) / d); } },
  // n/m ≥ 0 (signs must match), so +1e-9 rounds the half AWAY from zero like Excel and
  // defeats float drift — MROUND(6.05,0.1)=6.1 not 6.0 (6.05/0.1 comes out as 60.4999…).
  MROUND: { fn: a => { need(a, 2, 2, "MROUND"); const n = num1(a[0]), m = num1(a[1]); if (m === 0) return 0; if ((n > 0) !== (m > 0)) throw ferr(FORMULA_ERRORS.NUM, "MROUND: number and multiple must share a sign"); return Math.round(n / m + 1e-9) * m; } },
  EVEN:   { fn: a => { need(a, 1, 1, "EVEN"); const n = num1(a[0]); const r = Math.ceil(Math.abs(n) / 2) * 2; return n < 0 ? -r : r; } },
  ODD:    { fn: a => { need(a, 1, 1, "ODD"); const n = num1(a[0]); let r = Math.ceil(Math.abs(n)); if (r % 2 === 0) r += 1; if (r === 0) r = 1; return n < 0 ? -r : r; } },
  FACT:   { fn: a => { need(a, 1, 1, "FACT"); let n = Math.trunc(num1(a[0])); if (n < 0) throw ferr(FORMULA_ERRORS.NUM, "FACT of negative"); if (n > 170) throw ferr(FORMULA_ERRORS.NUM, "FACT overflow"); let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; } },

  // ── Logical (extras) ──
  XOR:    { fn: a => { need(a, 1, null, "XOR"); return a.reduce((acc, v) => acc !== toBool(v), false); } },
  TRUE:   { fn: () => true },
  FALSE:  { fn: () => false },
  IFNA:   { lazy: (an, ctx, ev) => { need(an, 2, 2, "IFNA"); try { return ev(an[0], ctx); } catch (e) { if (isFormulaError(e) && e.code === FORMULA_ERRORS.NA) return ev(an[1], ctx); throw e; } } },
  ISERROR: { lazy: (an, ctx, ev) => { need(an, 1, 1, "ISERROR"); try { ev(an[0], ctx); return false; } catch (e) { if (isFormulaError(e)) return true; throw e; } } },
  ISERR:  { lazy: (an, ctx, ev) => { need(an, 1, 1, "ISERR"); try { ev(an[0], ctx); return false; } catch (e) { if (isFormulaError(e)) return e.code !== FORMULA_ERRORS.NA; throw e; } } },
  ISNA:   { lazy: (an, ctx, ev) => { need(an, 1, 1, "ISNA"); try { ev(an[0], ctx); return false; } catch (e) { if (isFormulaError(e)) return e.code === FORMULA_ERRORS.NA; throw e; } } },
  NA:     { fn: () => { throw ferr(FORMULA_ERRORS.NA, "NA()"); } },

  // ── Info ──
  ISNUMBER:  { fn: a => { need(a, 1, 1, "ISNUMBER"); return typeof a[0] === "number" || isDate(a[0]); } },
  ISTEXT:    { fn: a => { need(a, 1, 1, "ISTEXT"); return typeof a[0] === "string"; } },
  ISLOGICAL: { fn: a => { need(a, 1, 1, "ISLOGICAL"); return typeof a[0] === "boolean"; } },
  ISEVEN:    { fn: a => { need(a, 1, 1, "ISEVEN"); return Math.trunc(num1(a[0])) % 2 === 0; } },
  ISODD:     { fn: a => { need(a, 1, 1, "ISODD"); return Math.abs(Math.trunc(num1(a[0])) % 2) === 1; } },
  N:         { fn: a => { need(a, 1, 1, "N"); const v = a[0]; if (typeof v === "number") return v; if (isDate(v)) return v.s; if (typeof v === "boolean") return v ? 1 : 0; return 0; } },

  // ── Date (extras) ──
  NOW:    { fn: (a, ctx) => makeDate(ctx.today) },
  DATEVALUE: { fn: a => { need(a, 1, 1, "DATEVALUE"); const s = parseLooseDate(toStr(a[0])); if (s === null) throw ferr(FORMULA_ERRORS.VALUE, "DATEVALUE: not a date"); return makeDate(s); } },
  WEEKNUM: { fn: a => { need(a, 1, 2, "WEEKNUM"); const s = toDateSerial(a[0]); if (s === null) return BLANK; const type = a.length > 1 ? Math.trunc(num1(a[1])) : 1; return weekNum(s, type); } },
  ISOWEEKNUM: { fn: a => { need(a, 1, 1, "ISOWEEKNUM"); const s = toDateSerial(a[0]); if (s === null) return BLANK; return isoWeekNum(s); } },
  YEARFRAC: { fn: a => { need(a, 2, 3, "YEARFRAC"); const s = toDateSerial(a[0]), e = toDateSerial(a[1]); if (s === null || e === null) return BLANK; const basis = a.length > 2 ? Math.trunc(num1(a[2])) : 0; return yearFrac(s, e, basis); } },

  // ── Financial ── (ordinary eager functions — explicit scalar arguments, exactly like
  //    the 95 above; NONE of these are range-aware. A cost model feeds them per-period
  //    columns/cells directly, e.g. NPV([Rate],[Y1],[Y2],[Y3]).) See the block of pure
  //    helper functions right after this registry for the shared math (pmtOf/fvOf/pvOf/
  //    nperOf/ipmtOf/ppmtOf/solveRoot) — every formula here is derived from the ONE
  //    annuity identity documented there, never a remembered constant.
  NPV:  { fn: a => { need(a, 2, null, "NPV"); const r = num1(a[0]); return a.slice(1).reduce((s, v, i) => s + num1(v) / Math.pow(1 + r, i + 1), 0); } },
  XNPV: { fn: a => { need(a, 3, null, "XNPV"); const r = num1(a[0]); const pairs = xnpvPairs(a.slice(1), "XNPV"); const d0 = pairs[0].d; return pairs.reduce((s, { v, d }) => s + v / Math.pow(1 + r, (d - d0) / 365), 0); } },
  IRR:  { fn: a => { need(a, 2, null, "IRR"); const cfs = a.map(num1); return irrOf(cfs); } },
  XIRR: { fn: a => { need(a, 4, null, "XIRR"); const pairs = xnpvPairs(a, "XIRR"); return xirrOf(pairs); } },
  MIRR: { fn: a => { need(a, 4, null, "MIRR"); const financeRate = num1(a[0]), reinvestRate = num1(a[1]); const cfs = a.slice(2).map(num1); return mirrOf(cfs, financeRate, reinvestRate); } },
  PMT:  { fn: a => { need(a, 3, 5, "PMT"); const rate = num1(a[0]), nper = num1(a[1]), pv = num1(a[2]); const fv = a.length > 3 ? num1(a[3]) : 0; const type = a.length > 4 && toNumber(a[4]) ? 1 : 0; return pmtOf(rate, nper, pv, fv, type); } },
  IPMT: { fn: a => { need(a, 4, 6, "IPMT"); const rate = num1(a[0]), per = num1(a[1]), nper = num1(a[2]), pv = num1(a[3]); const fv = a.length > 4 ? num1(a[4]) : 0; const type = a.length > 5 && toNumber(a[5]) ? 1 : 0; if (per < 1 || per > nper) throw ferr(FORMULA_ERRORS.NUM, "IPMT: per out of range"); return ipmtOf(rate, per, nper, pv, fv, type); } },
  PPMT: { fn: a => { need(a, 4, 6, "PPMT"); const rate = num1(a[0]), per = num1(a[1]), nper = num1(a[2]), pv = num1(a[3]); const fv = a.length > 4 ? num1(a[4]) : 0; const type = a.length > 5 && toNumber(a[5]) ? 1 : 0; if (per < 1 || per > nper) throw ferr(FORMULA_ERRORS.NUM, "PPMT: per out of range"); return pmtOf(rate, nper, pv, fv, type) - ipmtOf(rate, per, nper, pv, fv, type); } },
  RATE: { fn: a => { need(a, 3, 6, "RATE"); const nper = num1(a[0]), pmt = num1(a[1]), pv = num1(a[2]); const fv = a.length > 3 ? num1(a[3]) : 0; const type = a.length > 4 && toNumber(a[4]) ? 1 : 0; const guess = a.length > 5 ? num1(a[5]) : 0.1; return rateOf(nper, pmt, pv, fv, type, guess); } },
  NPER: { fn: a => { need(a, 3, 5, "NPER"); const rate = num1(a[0]), pmt = num1(a[1]), pv = num1(a[2]); const fv = a.length > 3 ? num1(a[3]) : 0; const type = a.length > 4 && toNumber(a[4]) ? 1 : 0; return nperOf(rate, pmt, pv, fv, type); } },
  FV:   { fn: a => { need(a, 3, 5, "FV"); const rate = num1(a[0]), nper = num1(a[1]), pmt = num1(a[2]); const pv = a.length > 3 ? num1(a[3]) : 0; const type = a.length > 4 && toNumber(a[4]) ? 1 : 0; return fvOf(rate, nper, pmt, pv, type); } },
  PV:   { fn: a => { need(a, 3, 5, "PV"); const rate = num1(a[0]), nper = num1(a[1]), pmt = num1(a[2]); const fv = a.length > 3 ? num1(a[3]) : 0; const type = a.length > 4 && toNumber(a[4]) ? 1 : 0; return pvOf(rate, nper, pmt, fv, type); } },
  CUMIPMT: { fn: a => { need(a, 6, 6, "CUMIPMT"); const [rate, nper, pv, start, end, type] = cumArgs(a, "CUMIPMT"); let s = 0; for (let per = start; per <= end; per++) s += ipmtOf(rate, per, nper, pv, 0, type); return s; } },
  CUMPRINC: { fn: a => { need(a, 6, 6, "CUMPRINC"); const [rate, nper, pv, start, end, type] = cumArgs(a, "CUMPRINC"); const pmt = pmtOf(rate, nper, pv, 0, type); let s = 0; for (let per = start; per <= end; per++) s += pmt - ipmtOf(rate, per, nper, pv, 0, type); return s; } },
};

// ── Financial helpers ── (pure math; the FUNCTIONS entries above are thin arg-shaping
// wrappers around these). Every PMT/PV/FV/NPER formula is ONE rearrangement of the SAME
// identity — the textbook definition of an annuity, not a memorized numeric example:
//   rate != 0:  PV*(1+rate)^nper + PMT*(1+rate*type)*((1+rate)^nper - 1)/rate + FV = 0
//   rate == 0:  PV + PMT*nper + FV = 0
// type: 0 = payments at the END of each period (ordinary annuity), 1 = at the START
// (annuity due). Validated against structural invariants (IPMT+PPMT=PMT, sum of PPMT
// over the full term = -PV, NPER/RATE round-trip, FV=0 at full amortization, NPV∘IRR=0,
// XNPV∘XIRR=0) rather than recalled constants — see test/formula.test.js.
function pmtOf(rate, nper, pv, fv, type) {
  if (rate === 0) return -(pv + fv) / nper;
  const g = Math.pow(1 + rate, nper);
  return -(pv * g + fv) * rate / ((1 + rate * type) * (g - 1));
}
function fvOf(rate, nper, pmt, pv, type) {
  if (rate === 0) return -(pv + pmt * nper);
  const g = Math.pow(1 + rate, nper);
  return -(pv * g + pmt * (1 + rate * type) * (g - 1) / rate);
}
function pvOf(rate, nper, pmt, fv, type) {
  if (rate === 0) return -(fv + pmt * nper);
  const g = Math.pow(1 + rate, nper);
  return -(fv + pmt * (1 + rate * type) * (g - 1) / rate) / g;
}
function nperOf(rate, pmt, pv, fv, type) {
  if (rate === 0) { if (pmt === 0) throw ferr(FORMULA_ERRORS.DIV0, "NPER: rate and pmt both zero"); return -(pv + fv) / pmt; }
  const adj = pmt * (1 + rate * type) / rate;
  const x = (adj - fv) / (pv + adj);
  if (!(x > 0)) throw ferr(FORMULA_ERRORS.NUM, "NPER: no solution");
  return Math.log(x) / Math.log(1 + rate);
}
// The account balance at time k — after k payments AND k periods of interest have
// elapsed — i.e. the identity above evaluated at nper=k. balOf(rate,0,…)=pv;
// balOf(rate,nper,…) always equals -fv by construction (that IS the defining identity).
function balOf(rate, k, pmt, pv, type) {
  if (k <= 0) return pv;
  if (rate === 0) return pv + pmt * k;
  const g = Math.pow(1 + rate, k);
  return pv * g + pmt * (1 + rate * type) * (g - 1) / rate;
}
// Interest component of payment `per` (1-based) — derived from first principles, not
// recalled, because this is exactly the trap named above: a type=0 payment lands at the
// END of its period, so it settles interest that just accrued on the balance carried IN
// — the balance GREW by balOf(per-1)*rate (a positive charge against what's owed), and
// IPMT reports that as a CASH FLOW in the same sign convention as PMT/PPMT (an outflow is
// negative), hence the negation. A type=1 payment lands at the START of its period
// (before that period's own interest has happened), so it settles the PRIOR period's
// interest instead: per=1 has no prior period (0 interest); per>=2 works out to
// -balOf(per-1)*rate/(1+rate) by solving the recurrence bal(k)=(bal(k-1)+pmt)*(1+rate)
// backwards, rather than reusing the type=0 formula against a shifted index. Caught by
// the "sum of PPMT over the full term == -PV" and "CUMIPMT+CUMPRINC == nper*PMT"
// invariants — NOT by "IPMT+PPMT==PMT" alone, which stays true under a sign flip since
// PPMT is defined as PMT-IPMT (exactly the trap the brief warned this class of bug hides
// behind: a self-consistent identity that a one-sided sign error cannot break).
function ipmtOf(rate, per, nper, pv, fv, type) {
  if (rate === 0) return 0;
  const pmt = pmtOf(rate, nper, pv, fv, type);
  if (type === 1) { if (per === 1) return 0; return -balOf(rate, per - 1, pmt, pv, type) * rate / (1 + rate); }
  return -balOf(rate, per - 1, pmt, pv, type) * rate;
}
// Newton-Raphson with a bisection fallback: solves f(x)=0, starting from x0 and falling
// back to a bracketed bisection search over (lo,hi) when Newton fails to converge or
// wanders outside the domain — RATE's pathological-input case in particular. Shared by
// IRR/XIRR/RATE: the same root-finding problem each time (no closed form exists).
function solveRoot(f, x0, lo, hi) {
  let x = x0;
  for (let i = 0; i < 100; i++) {
    let fx; try { fx = f(x); } catch { break; }
    if (!Number.isFinite(fx)) break;
    if (Math.abs(fx) < 1e-10) return x;
    const h = Math.max(Math.abs(x) * 1e-6, 1e-8);
    let fph, fmh; try { fph = f(x + h); fmh = f(x - h); } catch { break; }
    const deriv = (fph - fmh) / (2 * h);
    if (!Number.isFinite(deriv) || Math.abs(deriv) < 1e-13) break;
    const next = x - fx / deriv;
    if (!Number.isFinite(next) || next <= lo || next >= hi) break; // left the domain — hand off to bisection
    if (Math.abs(next - x) < 1e-12) return next;
    x = next;
  }
  const bracket = findSignChange(f, lo, hi);
  if (!bracket) throw ferr(FORMULA_ERRORS.NUM, "no solution found");
  let [a, b] = bracket, fa = f(a);
  for (let i = 0; i < 200; i++) {
    const mid = (a + b) / 2, fm = f(mid);
    if (!Number.isFinite(fm)) throw ferr(FORMULA_ERRORS.NUM, "no solution found");
    if (Math.abs(fm) < 1e-10 || (b - a) / 2 < 1e-10) return mid;
    if ((fa < 0) === (fm < 0)) { a = mid; fa = fm; } else { b = mid; }
  }
  return (a + b) / 2;
}
// Scans (lo,hi) for a sub-interval where f changes sign, rather than assuming the outer
// bracket itself straddles the root — RATE's root can sit anywhere in (-1, ∞) depending
// on the inputs, so bisection needs a bracket search, not just an initial guess.
function findSignChange(f, lo, hi) {
  const STEPS = 200;
  let prevX = lo, prevY; try { prevY = f(lo); } catch { prevY = NaN; }
  for (let i = 1; i <= STEPS; i++) {
    const x = lo + (hi - lo) * (i / STEPS);
    let y; try { y = f(x); } catch { y = NaN; }
    if (Number.isFinite(prevY) && Number.isFinite(y) && (prevY < 0) !== (y < 0)) return [prevX, x];
    prevX = x; prevY = y;
  }
  return null;
}
function irrOf(cfs) {
  const f = r => cfs.reduce((s, cf, i) => s + cf / Math.pow(1 + r, i), 0);
  return solveRoot(f, 0.1, -0.999999, 100);
}
function xirrOf(pairs) {
  const d0 = pairs[0].d;
  const f = r => pairs.reduce((s, { v, d }) => s + v / Math.pow(1 + r, (d - d0) / 365), 0);
  return solveRoot(f, 0.1, -0.999999, 100);
}
function rateOf(nper, pmt, pv, fv, type, guess) {
  const f = r => (r === 0) ? (pv + pmt * nper + fv) : (pv * Math.pow(1 + r, nper) + pmt * (1 + r * type) * (Math.pow(1 + r, nper) - 1) / r + fv);
  return solveRoot(f, guess, -0.999999, 100);
}
// Excel's MIRR: outflows are discounted back to time 0 at the finance rate (the cost of
// borrowing them), inflows are compounded forward to the final period at the reinvest
// rate (what they earn once received), and the single per-period rate that bridges those
// two totals over the term is the answer. With exactly two flows there is nothing left
// to reinvest, so MIRR reduces to plain IRR for ANY finance/reinvest rate — the
// invariant this is checked against. Sign convention is the classic trap: outflows
// negative, inflows positive, exactly like every other function in this section.
function mirrOf(cfs, financeRate, reinvestRate) {
  const n = cfs.length - 1;
  if (n < 1) throw ferr(FORMULA_ERRORS.VALUE, "MIRR needs at least 2 cash flows");
  let pvNeg = 0, fvPos = 0;
  cfs.forEach((cf, i) => {
    if (cf < 0) pvNeg += cf / Math.pow(1 + financeRate, i);
    else if (cf > 0) fvPos += cf * Math.pow(1 + reinvestRate, n - i);
  });
  if (pvNeg === 0 || fvPos === 0) throw ferr(FORMULA_ERRORS.DIV0, "MIRR needs at least one negative and one positive cash flow");
  return Math.pow(fvPos / -pvNeg, 1 / n) - 1;
}
// XNPV/XIRR take interleaved (value, date) scalar arguments — this engine has no array
// type, so there is no parallel-arrays form to accept. Decodes + validates the pairing.
function xnpvPairs(args, name) {
  if (args.length % 2 !== 0) throw ferr(FORMULA_ERRORS.VALUE, `${name}: values and dates must pair up`);
  const pairs = [];
  for (let i = 0; i < args.length; i += 2) {
    const v = toNumber(args[i]);
    const d = toDateSerial(args[i + 1]);
    if (d === null) throw ferr(FORMULA_ERRORS.VALUE, `${name}: blank date`);
    pairs.push({ v, d });
  }
  return pairs;
}
// Matches Excel's own documented #NUM! domain for CUMIPMT/CUMPRINC exactly: rate, nper
// and pv must all be positive; start_period ≥ 1; end_period ≥ start_period; type ∈
// {0,1}. (Source: Microsoft's CUMIPMT function reference — support.microsoft.com.)
// Excel's own doc does not list end_period > nper as an error condition, so this
// deliberately does not add one either.
function cumArgs(a, name) {
  const rate = num1(a[0]), nper = Math.trunc(num1(a[1])), pv = num1(a[2]);
  const start = Math.trunc(num1(a[3])), end = Math.trunc(num1(a[4]));
  const type = Math.trunc(num1(a[5]));
  if (rate <= 0 || nper <= 0 || pv <= 0) throw ferr(FORMULA_ERRORS.NUM, `${name}: rate, nper and pv must be positive`);
  if (start < 1 || end < start) throw ferr(FORMULA_ERRORS.NUM, `${name}: invalid period range`);
  if (type !== 0 && type !== 1) throw ferr(FORMULA_ERRORS.NUM, `${name}: type must be 0 or 1`);
  return [rate, nper, pv, start, end, type];
}

// ── Range / criteria / lookup helpers (used by the range-aware functions above) ──
// ⚠ PERF (was the quadratic-aggregate defect): a host evaluates one formula column by
// calling evaluateFormula() once per ROW, always passing the SAME ctx.rows array
// reference for every row of that pass (see e.g. public/sequence/index.html's
// computeFormulaValues — aggRows is built ONCE, then reused across the whole
// work.forEach(row => …) loop). So rebuilding "the whole column as an array" from
// ctx.rows on every call — as this used to do unconditionally — redid identical
// O(rows) work on every one of the N row-evaluations: O(rows) work × O(rows) calls =
// O(rows²). Since ctx.rows for THIS pass never changes underneath us (raw columns are
// immutable input; any formula column this one depends on has already finished its
// OWN full pass over every row before this pass starts — planFormulaColumns' topo order
// guarantees that), the resulting array is safe to memoize per (rows array, column key)
// pair. Keying on the array's own identity via WeakMap means the cache needs no manual
// invalidation: a fresh recalc pass builds a fresh rows array, so it can never collide
// with an old one, and the old entry is simply garbage once nothing references it.
const colArrayCache = new WeakMap(); // rows[] -> Map<lowerColKey, value[]>
// grid[] -> Map<rangeKey, value[]>, the A1-range analogue of colArrayCache — same
// rationale: a Model sheet can have many DIFFERENT cells each summing an
// overlapping/identical range (e.g. several "Total" cells over the same column),
// and re-walking ctx.grid on every one of them per pass is exactly the O(n) rebuild
// colArrayCache already exists to avoid for [Column]. Keyed on ctx.grid's own
// identity, so a fresh recalc pass (a fresh grid array) can never read stale data.
const rangeArrayCache = new WeakMap();
function rangeArray(node, ctx) {
  const grid = ctx.grid;
  const key = `${node.from.row},${node.from.col},${node.to.row},${node.to.col}`;
  let byRange;
  if (grid) {
    byRange = rangeArrayCache.get(grid);
    if (byRange) { const hit = byRange.get(key); if (hit) return hit; }
  }
  const r1 = Math.min(node.from.row, node.to.row), r2 = Math.max(node.from.row, node.to.row);
  const c1 = Math.min(node.from.col, node.to.col), c2 = Math.max(node.from.col, node.to.col);
  const out = [];
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      const v = readGridCell(ctx, r, c);
      out.push(v === undefined ? BLANK : raiseIfErr(v));
    }
  }
  if (grid) {
    if (!byRange) { byRange = new Map(); rangeArrayCache.set(grid, byRange); }
    byRange.set(key, out);
  }
  return out;
}
// A [Column]-shaped range argument must be a bare [Column] reference; it expands to
// that column's values across every row in ctx.rows (the whole table, in display
// order). An A1-shaped range argument (A1:B10) is handled by rangeArray above.
function colArray(node, ctx) {
  if (node && node.type === "range") return rangeArray(node, ctx);
  if (!node || node.type !== "col") throw ferr(FORMULA_ERRORS.VALUE, "expected a [Column] or A1:B10 range reference");
  const key = node.name.toLowerCase();
  // [@Column] forces THIS row even inside a range function (consistent with how
  // SUM/AVERAGE treat a [@Column] arg), so it contributes a single cell. It is cheap
  // (one cell) by construction, so it is never cached — only the whole-column case below
  // does the O(rows) work worth memoizing.
  if (node.atRow) {
    const cols = ctx.columns || {};
    if (!Object.prototype.hasOwnProperty.call(cols, key)) throw ferr(FORMULA_ERRORS.REF, `unknown column "${node.name}"`);
    const v = cols[key];
    return [v === undefined ? BLANK : raiseIfErr(v)];   // [@ErrCol] this-row read propagates
  }
  const rows = (ctx.rows && ctx.rows.length) ? ctx.rows : [ctx.columns || {}];
  let byCol = colArrayCache.get(rows);
  if (byCol) { const hit = byCol.get(key); if (hit) return hit; }
  // Existence check across the union of rows (not just row 0) so a ragged table
  // doesn't make a genuine column read as #REF!.
  if (!rows.some(r => Object.prototype.hasOwnProperty.call(r, key))) throw ferr(FORMULA_ERRORS.REF, `unknown column "${node.name}"`);
  const arr = rows.map(r => { const v = r[key]; return v === undefined ? BLANK : v; });
  if (!byCol) { byCol = new Map(); colArrayCache.set(rows, byCol); }
  byCol.set(key, arr);
  return arr;
}
// A range-position argument: either a bare (non-"@") [Column] — the whole column —
// or an A1 "range" node (A1:B10). Shared by the four collectors below, so SUM/MIN/
// MAX/AVERAGE/COUNT/COUNTA treat "[Column]" and "A1:B10" identically wherever one
// of them is legal — anything else (a scalar, [@Column], an expression) is a
// per-row/per-cell scalar, handled by each collector's own `else` branch via `ev`.
const isRangeArg = n => (n.type === "col" && !n.atRow) || n.type === "range";
// Numbers for SUM/AVERAGE/MIN/MAX/PRODUCT: a bare [Column] arg contributes its numeric
// (and date→serial) cells, skipping blank/text/bool (Excel range behavior); a scalar or
// [@Column] arg is coerced via toNumber.
function collectNums(argNodes, ctx, ev) {
  const nums = [];
  argNodes.forEach(n => {
    if (isRangeArg(n)) colArray(n, ctx).forEach(v => { raiseIfErr(v); if (typeof v === "number") nums.push(v); else if (isDate(v)) nums.push(v.s); });
    else { const v = ev(n, ctx); if (isDate(v)) nums.push(v.s); else nums.push(toNumber(v)); }
  });
  return nums;
}
// Like collectNums but also reports whether EVERY contributing value was a date — so
// MIN/MAX over a date column return a date (e.g. MIN([Start]) = the earliest date), not
// a raw serial number. A mix of dates and plain numbers yields a number (ambiguous).
function collectNumsKind(argNodes, ctx, ev) {
  const nums = []; let any = false, allDates = true;
  const take = v => { raiseIfErr(v); if (isDate(v)) { nums.push(v.s); any = true; } else if (typeof v === "number") { nums.push(v); allDates = false; } };
  argNodes.forEach(n => {
    if (isRangeArg(n)) colArray(n, ctx).forEach(take);
    else { const v = ev(n, ctx); if (isDate(v)) { nums.push(v.s); any = true; } else { nums.push(toNumber(v)); allDates = false; } }
  });
  return { nums, allDates: any && allDates };
}
function collectCountable(argNodes, ctx, ev) { // COUNT — numbers only
  let c = 0;
  argNodes.forEach(n => {
    if (isRangeArg(n)) colArray(n, ctx).forEach(v => { raiseIfErr(v); if (typeof v === "number" || isDate(v)) c++; });
    else { const v = ev(n, ctx); if (typeof v === "number" || isDate(v)) c++; else if (typeof v === "string") { try { toNumber(v); c++; } catch { /* non-numeric text isn't counted */ } } }
  });
  return c;
}
function collectNonBlank(argNodes, ctx, ev) { // COUNTA — anything non-blank
  let c = 0;
  argNodes.forEach(n => {
    if (isRangeArg(n)) colArray(n, ctx).forEach(v => { raiseIfErr(v); if (!isBlank(v) && v !== "") c++; });
    else { const v = ev(n, ctx); if (!isBlank(v) && v !== "") c++; }
  });
  return c;
}
function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
// Excel wildcard text → RegExp. * = any run, ? = one char, ~ escapes the next * / ?.
function wildcardToRegExp(pat, anchored = true) {
  let re = "";
  for (let i = 0; i < pat.length; i++) {
    const ch = pat[i];
    if (ch === "~" && i + 1 < pat.length) re += escapeRegExp(pat[++i]);
    else if (ch === "*") re += ".*";
    else if (ch === "?") re += ".";
    else re += escapeRegExp(ch);
  }
  return new RegExp(anchored ? "^" + re + "$" : re);
}
function parseCriteriaOperand(text) {
  const t = String(text).trim();
  if (t === "") return "";
  if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return parseFloat(t);
  if (/^(true|false)$/i.test(t)) return t.toLowerCase() === "true";
  // A date literal (ISO or M/D[/YY]) becomes a date value, so a criterion like
  // ">=2026-03-01" or "2026-06-01" compares against a date column correctly.
  const ds = parseLooseDate(t);
  if (ds !== null) return makeDate(ds);
  return t;
}
function looseEqual(a, b) {
  if (isBlank(a)) a = "";
  if (isBlank(b)) b = "";
  if (typeof a === "string" && typeof b === "string") return a.toLowerCase() === b.toLowerCase();
  try { return compareValues(a, b) === 0; } catch { return false; }
}
// COUNTIF/SUMIF criteria: an optional leading comparison operator (">5", "<=0", "<>x"),
// else an equality test (text is case-insensitive + honors * / ? wildcards).
function matchesCriteria(value, criteria) {
  if (typeof criteria === "string") {
    const m = /^(<=|>=|<>|=|<|>)\s*([\s\S]*)$/.exec(criteria.trim());
    let op = "=", operand = criteria;
    if (m) { op = m[1]; operand = m[2]; }
    const operandVal = parseCriteriaOperand(operand);
    if (op === "=" || op === "<>") {
      // A TEXT cell is always matched against the raw criterion TEXT (with wildcards),
      // even when the operand text happens to look numeric or date-ish ("3/4", "100",
      // "2026-06-01"). parseCriteriaOperand turns those into a number/date for comparing
      // against numeric/date cells, but a string cell must compare as text — otherwise a
      // literal "3/4" code would never match its own "3/4" criterion.
      if (typeof value === "string") {
        const matched = wildcardToRegExp(String(operand).toLowerCase()).test(value.toLowerCase());
        return op === "=" ? matched : !matched;
      }
      const eq = looseEqual(value, operandVal);
      return op === "=" ? eq : !eq;
    }
    // Ordered comparison (>, <, …). Excel never matches a blank/empty cell here, and a
    // text cell never matches a NUMERIC criterion (and vice-versa) — only same-family
    // values compare. This stops an empty "" cell from reading as "> 100".
    if (isBlank(value) || value === "") return false;
    const numericCrit = typeof operandVal === "number" || isDate(operandVal);
    const numericVal = typeof value === "number" || isDate(value);
    if (numericCrit !== numericVal) return false;
    const c = compareValuesSafe(value, operandVal);
    if (c === null) return false;
    if (op === "<") return c < 0;
    if (op === "<=") return c <= 0;
    if (op === ">") return c > 0;
    return c >= 0;
  }
  return looseEqual(value, criteria);
}
function compareValuesSafe(a, b) { try { return compareValues(a, b); } catch { return null; } }
function matchIndex(target, arr, type) {
  if (type === 0) {
    for (let i = 0; i < arr.length; i++) {
      if (typeof target === "string" && typeof arr[i] === "string") { if (wildcardToRegExp(target.toLowerCase()).test(arr[i].toLowerCase())) return i + 1; }
      else if (compareValuesSafe(target, arr[i]) === 0) return i + 1;
    }
    throw ferr(FORMULA_ERRORS.NA, "MATCH: no exact match");
  }
  // Approximate match (type ±1) is only meaningful within the target's type family —
  // otherwise compareValues' cross-type rank (number < text) would make any numeric cell
  // count as "≤" a text target. Skip cells of a different family.
  if (type === 1) { // largest value ≤ target (array assumed ascending)
    let best = -1;
    for (let i = 0; i < arr.length; i++) { if (!sameFamily(arr[i], target)) continue; const c = compareValuesSafe(arr[i], target); if (c !== null && c <= 0) best = i; }
    if (best === -1) throw ferr(FORMULA_ERRORS.NA, "MATCH: no value ≤ lookup");
    return best + 1;
  }
  let best = -1; // type −1: smallest value ≥ target (array assumed descending)
  for (let i = 0; i < arr.length; i++) { if (!sameFamily(arr[i], target)) continue; const c = compareValuesSafe(arr[i], target); if (c !== null && c >= 0) best = i; }
  if (best === -1) throw ferr(FORMULA_ERRORS.NA, "MATCH: no value ≥ lookup");
  return best + 1;
}
// Type families for ordered comparison: numeric (number|date), text, boolean.
function valueFamily(v) { if (typeof v === "number" || isDate(v)) return "num"; if (typeof v === "string") return "txt"; if (typeof v === "boolean") return "bool"; return "other"; }
function sameFamily(a, b) { return valueFamily(a) === valueFamily(b); }
function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
// Excel WEEKNUM return types: 1=Sun, 2=Mon (the originals); 11–17 set the week-start day
// (Mon..Sun); 21 = ISO-8601. Week 1 is the week containing Jan 1 (except ISO). An
// unrecognized type is a #NUM! (matching Excel), not a silently-wrong Sunday default.
const WEEKNUM_START = { 1: 0, 2: 1, 11: 1, 12: 2, 13: 3, 14: 4, 15: 5, 16: 6, 17: 0 };
function weekNum(serial, type) {
  if (type === 21) return isoWeekNum(serial);
  const weekStart = WEEKNUM_START[type];
  if (weekStart === undefined) throw ferr(FORMULA_ERRORS.NUM, `WEEKNUM type ${type} not supported`);
  const jan1 = ymdToSerial(serialToYMD(serial).y, 1, 1);
  const offset = (weekdayOf(jan1) - weekStart + 7) % 7;
  return Math.floor((serial - jan1 + offset) / 7) + 1;
}
function isoWeekNum(serial) { // ISO-8601: weeks start Monday, week 1 holds the year's first Thursday
  const dow = (weekdayOf(serial) + 6) % 7; // 0=Mon..6=Sun
  const thursday = serial - dow + 3;
  const jan1 = ymdToSerial(serialToYMD(thursday).y, 1, 1);
  return Math.floor((thursday - jan1) / 7) + 1;
}
function yearFrac(s, e, basis) {
  if (s === e) return 0;
  // Excel's YEARFRAC ignores argument order and always returns a non-negative fraction.
  const a = Math.min(s, e), b = Math.max(s, e);
  if (basis === 1) { // actual/actual (approx: actual days over the average year length in the span)
    const A = serialToYMD(a), B = serialToYMD(b);
    let days = 0; for (let yy = A.y; yy <= B.y; yy++) days += isLeap(yy) ? 366 : 365;
    return (b - a) / (days / (B.y - A.y + 1));
  }
  if (basis === 2) return (b - a) / 360; // actual/360
  if (basis === 3) return (b - a) / 365; // actual/365
  const A = serialToYMD(a), B = serialToYMD(b);  // 30/360 (basis 0 US, 4 European)
  let d1 = A.d, d2 = B.d;
  if (d1 === 31) d1 = 30;
  if (d2 === 31 && (basis === 4 || d1 === 30)) d2 = 30;
  return ((B.y - A.y) * 360 + (B.m - A.m) * 30 + (d2 - d1)) / 360;
}

// addMonths with Excel month-end clamping (Jan31 +1 → Feb28/29).
function addMonths(y, m, d, months) {
  const total = (y * 12 + (m - 1)) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12 + 12) % 12 + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return ymdToSerial(ny, nm, Math.min(d, lastDay));
}
function datedif(s, e, unit) {
  if (e < s) throw ferr(FORMULA_ERRORS.NUM, "DATEDIF end before start");
  const A = serialToYMD(s), B = serialToYMD(e);
  switch (unit) {
    case "D": return e - s;
    case "Y": { let y = B.y - A.y; if (B.m < A.m || (B.m === A.m && B.d < A.d)) y--; return y; }
    case "M": { let m = (B.y - A.y) * 12 + (B.m - A.m); if (B.d < A.d) m--; return m; }
    case "MD": { let d = B.d - A.d; if (d < 0) { const pm = new Date(Date.UTC(B.y, B.m - 1, 0)).getUTCDate(); d = B.d + (pm - A.d); } return Math.max(0, d); }
    case "YM": { let m = (B.m - A.m + 12) % 12; if (B.d < A.d) m = (m - 1 + 12) % 12; return m; }
    case "YD": { let anchor = ymdToSerial(B.y, A.m, A.d); if (anchor > e) anchor = ymdToSerial(B.y - 1, A.m, A.d); return e - anchor; } // "days ignoring years": anchor on the END year so a multi-year span never inflates/negates
    default: throw ferr(FORMULA_ERRORS.NUM, `DATEDIF unit "${unit}" not supported`);
  }
}
function extraHolidaySet(args) {
  if (!args.length) return null;
  const set = new Set();
  args.forEach(v => { const s = toDateSerial(v); if (s !== null) set.add(s); });
  return set;
}
function isWorkingSerial(serial, calendar, extra) {
  if (extra && extra.has(serial)) return false;
  return calendar.isWorkingDay(serial);
}
function addWorkdays(start, days, calendar, extra) {
  if (days === 0) return start;
  let rem = Math.abs(days), cur = start; const dir = days > 0 ? 1 : -1; let steps = 0;
  while (rem > 0) { if (++steps > MAX_WD_STEPS) throw ferr(FORMULA_ERRORS.NUM, "WORKDAY range too large"); cur += dir; if (isWorkingSerial(cur, calendar, extra)) rem--; }
  return cur;
}
function networkDays(start, end, calendar, extra) {
  let a = start, b = end, sign = 1;
  if (a > b) { a = end; b = start; sign = -1; }
  let count = 0, steps = 0;
  for (let s = a; s <= b; s++) { if (++steps > MAX_WD_STEPS) throw ferr(FORMULA_ERRORS.NUM, "NETWORKDAYS range too large"); if (isWorkingSerial(s, calendar, extra)) count++; }
  return sign * count;
}

// ── TEXT() formatter — practical subset of Excel number & date codes ─────────────
function textFormat(value, fmt, ctx) {
  // Date if the value is a date OR the format string clearly uses date tokens.
  const looksDate = /[ymd]/i.test(fmt) && !/[#0]/.test(fmt);
  if (isDate(value) || (looksDate && (typeof value === "number" || typeof value === "string"))) {
    let serial;
    if (isDate(value)) serial = value.s;
    else if (typeof value === "number") serial = Math.trunc(value);
    else { const s = parseLooseDate(value); if (s === null) return toStr(value, ctx); serial = s; }
    return formatDateToken(serial, fmt);
  }
  // Number format
  if (/[#0]/.test(fmt)) return formatNumberToken(toNumber(value), fmt);
  // No recognizable tokens → return as-is text
  return toStr(value, ctx);
}
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function formatDateToken(serial, fmt) {
  const { y, m, d } = serialToYMD(serial);
  const dow = weekdayOf(serial);
  // Longest tokens first so "mmmm" isn't eaten by "mm".
  return fmt.replace(/yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d/gi, tok => {
    switch (tok.toLowerCase()) {
      case "yyyy": return String(y).padStart(4, "0");
      case "yy": return String(y % 100).padStart(2, "0");
      case "mmmm": return MONTHS_LONG[m - 1];
      case "mmm": return MONTHS_LONG[m - 1].slice(0, 3);
      case "mm": return String(m).padStart(2, "0");
      case "m": return String(m);
      case "dddd": return DAYS_LONG[dow];
      case "ddd": return DAYS_LONG[dow].slice(0, 3);
      case "dd": return String(d).padStart(2, "0");
      case "d": return String(d);
      default: return tok;
    }
  });
}
// Excel number formats carry up to four ';'-separated sections: positive;negative;zero;text.
// Pick the section by the value's sign. A dedicated negative/zero section owns its own sign
// through literal text (e.g. parentheses), so its magnitude is formatted with no auto "-".
function formatNumberToken(n, fmt) {
  const sections = splitFormatSections(fmt);
  if (sections.length <= 1) return formatNumberSection(n, fmt, true);
  if (n > 0) return formatNumberSection(n, sections[0], false);
  if (n < 0) return formatNumberSection(Math.abs(n), sections[1], false);
  return formatNumberSection(0, sections.length >= 3 ? sections[2] : sections[0], false);
}
// Split on top-level ';' only — a ';' inside a "quoted" run is a literal, not a separator.
function splitFormatSections(fmt) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < fmt.length; i++) {
    const c = fmt[i];
    if (c === '"') { q = !q; cur += c; continue; }
    if (c === ";" && !q) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}
// Excel marks literal text with surrounding quotes or a leading backslash; drop the markers.
function stripFormatLiterals(s) { return s.replace(/\\(.)/g, "$1").replace(/"/g, ""); }

// ⛔ Model workspace ribbon (B1007281) — a format section can lead with a bracketed colour tag
// ([Red], [Blue], … or an indexed [Color12]), Excel's own way of saying "render this section in
// this colour" — most commonly "#,##0;[Red]-#,##0" for negatives. Before this, that tag was
// invisible to the digit-placeholder search (`[` isn't `0`/`#`) so it fell into the LITERAL
// prefix and printed verbatim — "[Red]-1,234" on screen. Stripped here, at the one place every
// section passes through on its way to being rendered, so the fix applies uniformly regardless
// of caller. The 8 named colours map straight onto CSS colour keywords; an indexed [ColorNN] tag
// is stripped (never left as visible garbage) but not resolved to an actual colour — this repo's
// palette has no defined mapping for Excel's 56-colour legacy index.
const COLOR_TAG_RE = /^\[(black|blue|cyan|green|magenta|red|white|yellow|color\d{1,2})\]/i;
function extractColorTag(section) {
  const m = section.match(COLOR_TAG_RE);
  if (!m) return { color: null, rest: section };
  const name = m[1].toLowerCase();
  const color = /^color\d+$/.test(name) ? null : name;
  return { color, rest: section.slice(m[0].length) };
}
// Which section a value's SIGN selects — the same rule formatNumberToken applies, factored out
// so `numberFormatColorFor` below can find a section's colour tag without re-implementing (or
// drifting from) the sign-selection rule itself.
function sectionForSign(n, fmt) {
  const sections = splitFormatSections(fmt);
  if (sections.length <= 1) return fmt;
  if (n > 0) return sections[0];
  if (n < 0) return sections[1];
  return sections.length >= 3 ? sections[2] : sections[0];
}
/** The colour a number-format token names for `n`'s own sign section, or `null` — never throws
 *  (a malformed token or an untagged section both just mean "no colour"). Used by the Model
 *  workspace to render "negatives in red" (the other named ask, accounting parens, is already
 *  covered by an ordinary 2-section format — no colour tag needed for that). */
function numberFormatColorFor(n, fmt) {
  try { return extractColorTag(sectionForSign(n, fmt)).color; } catch { return null; }
}
// Format one section as a template: the run from the first to the last digit placeholder
// ([0#]) is the number; text before/after is emitted verbatim (so "$", "%", "(", ")" survive
// in place). Decimal/integer placeholders are counted WITHIN this section only — never across
// the ';' boundary, which is what made a 2-section format show 8 decimals. autoSign prefixes
// "-" for a negative value only in the single-section case.
function formatNumberSection(n, fmt, autoSign) {
  fmt = extractColorTag(fmt).rest;
  // Model workspace ribbon (B1007281) — a "bps" literal anywhere in the template scales the
  // value ×10,000 before formatting, the same way a literal '%' just below scales ×100. Excel
  // has no native basis-point format; this is the one small, additive extension to the shared
  // formatter the ribbon's Basis points preset needs, not a second formatter (the digit-run /
  // thousands / decimals machinery below is untouched and still the only place that runs).
  if (/bps/i.test(fmt)) n *= 10000;
  const first = fmt.search(/[0#]/);
  if (first < 0) return stripFormatLiterals(fmt);   // literal-only section
  let last = first;
  for (let i = first; i < fmt.length; i++) if (fmt[i] === "0" || fmt[i] === "#") last = i;
  const prefix = fmt.slice(0, first), placeholder = fmt.slice(first, last + 1), suffix = fmt.slice(last + 1);
  if (/%/.test(fmt)) n *= 100;                       // a '%' anywhere scales by 100 (the '%' glyph rides in the literals)
  const useThousands = /,/.test(placeholder);
  const dotIdx = placeholder.indexOf(".");
  const decimals = dotIdx >= 0 ? (placeholder.slice(dotIdx + 1).match(/[0#]/g) || []).length : 0;
  const intZeros = ((dotIdx >= 0 ? placeholder.slice(0, dotIdx) : placeholder).match(/0/g) || []).length;
  const neg = autoSign && n < 0;
  const parts = roundAwayFromZero(Math.abs(n), decimals).toFixed(decimals).split(".");
  if (intZeros > parts[0].length) parts[0] = parts[0].padStart(intZeros, "0");
  if (useThousands) parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-" : "") + stripFormatLiterals(prefix) + parts.join(".") + stripFormatLiterals(suffix);
}

// ── Evaluator ────────────────────────────────────────────────────────────────
// A1 grid access: ctx.grid is an optional 2D array, row-major, 0-indexed (grid[0][0]
// is A1). No grid at all (a host that hasn't wired one up, or a [Column]-only table
// context) reads every cell as blank — never a crash, and never #REF! by itself; a
// cell simply beyond what the host populated is exactly Excel's own "blank cell"
// case, not an error. See the "ref"/"errLiteral" cases below for where #REF! DOES
// come from in this engine (a rewritten reference that fell off the sheet).
function readGridCell(ctx, row, col) {
  const grid = ctx.grid;
  if (!grid) return undefined;
  const r = grid[row - 1];
  if (!r) return undefined;
  return r[col - 1];
}
const evalNode = (node, ctx) => {
  switch (node.type) {
    case "num": return node.value;
    case "str": return node.value;
    case "bool": return node.value;
    case "blankLiteral": return BLANK;
    case "col": {
      const key = node.name.toLowerCase();
      const cols = ctx.columns || {};
      if (!Object.prototype.hasOwnProperty.call(cols, key)) throw ferr(FORMULA_ERRORS.REF, `unknown column "${node.name}"`);
      const v = cols[key];
      return v === undefined ? BLANK : raiseIfErr(v);   // referencing an errored cell propagates its error
    }
    case "ref": {
      const v = readGridCell(ctx, node.row, node.col);
      return v === undefined ? BLANK : raiseIfErr(v);
    }
    // A range used where a single value is expected (INDEX/MATCH-free — e.g. a bare
    // "=A1:B10" or "A1:B10 + 5") is a genuine type error, not engine confusion — it
    // is valid ONLY in a range-position argument, resolved via colArray/rangeArray
    // below, which never routes through evalNode for the range node itself.
    case "range": throw ferr(FORMULA_ERRORS.VALUE, "a range reference cannot be used where a single value is expected");
    case "errLiteral": throw ferr(node.code, "literal error in formula");
    case "unary": {
      if (node.op === "+") return toNumber(evalNode(node.arg, ctx));
      return -toNumber(evalNode(node.arg, ctx));
    }
    case "percent": return toNumber(evalNode(node.arg, ctx)) / 100;
    case "binary": return evalBinary(node, ctx);
    case "call": return evalCall(node, ctx);
    default: throw ferr(FORMULA_ERRORS.ERR, "bad node");
  }
};
const evalBinary = (node, ctx) => {
  const { op } = node;
  if (op === "&") return toStr(evalNode(node.left, ctx), ctx) + toStr(evalNode(node.right, ctx), ctx);
  if (COMPARE[op]) {
    const c = compareValues(evalNode(node.left, ctx), evalNode(node.right, ctx));
    switch (op) {
      case "=": return c === 0;
      case "<>": return c !== 0;
      case "<": return c < 0;
      case ">": return c > 0;
      case "<=": return c <= 0;
      case ">=": return c >= 0;
    }
  }
  const L = evalNode(node.left, ctx), R = evalNode(node.right, ctx);
  // A numeric result that overflows to ±Infinity (or is NaN) is surfaced as #NUM!,
  // never returned silently — otherwise it would slip into a comparison (NaN compares
  // false both ways → a wrong TRUE/FALSE) or a label. This mirrors the ^ / POWER guard.
  const finite = r => { if (!Number.isFinite(r)) throw ferr(FORMULA_ERRORS.NUM, "result is not a finite number"); return r; };
  // Date-aware +/- : date±number → date ; date−date → days
  if (op === "+") {
    if (isDate(L) && isDate(R)) throw ferr(FORMULA_ERRORS.VALUE, "cannot add two dates");
    if (isDate(L)) return makeDate(L.s + toNumber(R));
    if (isDate(R)) return makeDate(R.s + toNumber(L));
    return finite(toNumber(L) + toNumber(R));
  }
  if (op === "-") {
    if (isDate(L) && isDate(R)) return L.s - R.s;            // days between
    if (isDate(L)) return makeDate(L.s - toNumber(R));
    if (isDate(R)) throw ferr(FORMULA_ERRORS.VALUE, "cannot subtract a date from a number");
    return finite(toNumber(L) - toNumber(R));
  }
  const a = toNumber(L), b = toNumber(R);
  switch (op) {
    case "*": return finite(a * b);
    case "/": if (b === 0) throw ferr(FORMULA_ERRORS.DIV0, "divide by zero"); return finite(a / b);
    case "^": { const r = Math.pow(a, b); if (!Number.isFinite(r)) throw ferr(FORMULA_ERRORS.NUM, "power domain/overflow"); return r; }
    default: throw ferr(FORMULA_ERRORS.ERR, `bad operator ${op}`);
  }
};
// ── PERF: whole-call memoization for ROW-INVARIANT range-aware calls ───────────────
// colArray's cache (above) kills the O(rows) array-REBUILD cost. It does NOT by itself
// help a call like COUNTIF([Cost],">50") or SUM([Cost]) finish in less than O(rows) work
// PER ROW — COUNTIF still has to scan the (now-cached) array and re-match the criteria
// against every element, once per row, which is still O(rows²) total. But a call like
// that gives the IDENTICAL answer on every row of a pass whenever none of its arguments
// read ctx.columns (i.e. "this row") — its only remaining input is ctx.rows, which is
// exactly what the cache below keys on. So the fix has two tiers: colArray removes the
// O(rows) rebuild for every range-aware call regardless of the args around it; this
// tier removes the O(rows) PER-ROW re-evaluation entirely, but only when the call is
// provably row-invariant.
//
// "Row-invariant" is decided PER ARGUMENT POSITION, PER FUNCTION — never by the shape of
// an argument alone (the trap: treating every bare [Col] as hoistable breaks XLOOKUP,
// whose first argument is a scalar this-row lookup value, not a range — hoisting it
// would freeze row 0's answer onto every row). RANGE_ARG_POSITIONS is the declared table
// of which argument slots each of the 13 range-aware functions actually reads as a
// RANGE (i.e. feeds to colArray) rather than a per-row scalar (fed to evalNode) — lifted
// directly from each function's own `rng` implementation above, not guessed from name:
//   SUM/PRODUCT/MIN/MAX/AVERAGE/AVERAGEA/COUNT/COUNTA — collectNums &c. treat EVERY
//     argument independently: whichever ones happen to be a bare, non-"@" [Column] are
//     ranges (colArray), everything else (a literal, an expression, an [@Column]) is a
//     per-row scalar — hence "ALL" (checked per-argument, not blanket-assumed).
//   COUNTIF([0]) · SUMIF([0,2]) · AVERAGEIF([0,2]) · MATCH([1]) · INDEX([0]) ·
//     XLOOKUP([1,2]) — colArray() itself enforces these are literal [Column] nodes; the
//     remaining positions (COUNTIF/SUMIF/AVERAGEIF's criteria, MATCH's target/type,
//     INDEX's index, XLOOKUP's target/fallback) are always scalar, this-row reads.
const RANGE_ARG_POSITIONS = {
  SUM: "ALL", PRODUCT: "ALL", MIN: "ALL", MAX: "ALL", AVERAGE: "ALL", AVERAGEA: "ALL",
  COUNT: "ALL", COUNTA: "ALL",
  COUNTIF: [0], SUMIF: [0, 2], AVERAGEIF: [0, 2],
  MATCH: [1], INDEX: [0], XLOOKUP: [1, 2],
};
// TODAY/NOW read ctx.today and WORKDAY/NETWORKDAYS read ctx.calendar — both are fixed
// for one evaluateFormula() CALL but are not part of the {node, ctx.rows} cache key
// below, so (conservatively, to rule out any staleness) a call touching one of these is
// never treated as row-invariant, even though in practice today/calendar don't vary
// row-to-row within a single pass either.
const CONTEXT_SENSITIVE_FUNCTIONS = new Set(["TODAY", "NOW", "WORKDAY", "NETWORKDAYS"]);
// Memoized structural analysis (pure function of the AST — computed once per node, ever,
// regardless of how many rows/passes reuse it — see the parseFormula cache above, which
// is what makes the SAME node objects recur across a pass's per-row calls).
const invariantCache = new WeakMap(); // AST node -> boolean
function isRowInvariant(node) {
  if (!node) return true;
  const cached = invariantCache.get(node);
  if (cached !== undefined) return cached;
  let result;
  switch (node.type) {
    case "num": case "str": case "bool": case "blankLiteral": result = true; break;
    case "col": result = false; break; // reached as a SCALAR here (see rangeArgInvariant below) — always THIS row
    case "unary": case "percent": result = isRowInvariant(node.arg); break;
    case "binary": result = isRowInvariant(node.left) && isRowInvariant(node.right); break;
    case "call": result = isCallInvariant(node); break;
    default: result = false;
  }
  invariantCache.set(node, result);
  return result;
}
function isCallInvariant(node) {
  const def = FUNCTIONS[node.name];
  if (!def || CONTEXT_SENSITIVE_FUNCTIONS.has(node.name)) return false;
  if (def.rng) {
    const positions = RANGE_ARG_POSITIONS[node.name];
    return node.args.every((a, i) => {
      const isRangePos = positions === "ALL" || (Array.isArray(positions) && positions.includes(i));
      // A bare, non-"@" [Column] in a declared range position reads ctx.rows (the whole
      // table) — identical on every row of this pass, regardless of the current row.
      // Anything else in that position (a scalar, an [@Column], an expression — colArray
      // will reject anything but a plain "col" node here, an existing #VALUE! this
      // analysis doesn't need to duplicate) falls through to the ordinary scalar check.
      if (isRangePos && a.type === "col" && !a.atRow) return true;
      return isRowInvariant(a);
    });
  }
  // Eager `fn` / lazy special forms (IF, IFERROR, …): invariant iff every argument
  // subtree is — conservative for short-circuiting forms (a branch that's never taken
  // could in principle vary by row without changing the OUTCOME), but never unsound,
  // since a call whose every input is identical every row can only ever compute the
  // same result every row regardless of which internal branch runs.
  return node.args.every(isRowInvariant);
}
// rows[] -> WeakMap<callNode, {ok:true,value} | {ok:false,err}>. Keyed on the AST node
// object (unique per distinct formula text, shared across a pass via the parseFormula
// cache) so two different formulas can never collide, and on ctx.rows so a fresh recalc
// pass (a fresh rows array) can never read a stale answer from a prior one.
const rngResultCache = new WeakMap();
const evalCall = (node, ctx) => {
  const def = FUNCTIONS[node.name];
  if (!def) throw ferr(FORMULA_ERRORS.NAME, `unknown function ${node.name}`);
  if (def.rng && isRowInvariant(node)) {
    let byRows = rngResultCache.get(node);
    if (!byRows) { byRows = new WeakMap(); rngResultCache.set(node, byRows); }
    const cached = byRows.get(ctx.rows);
    if (cached) { if (cached.ok) return cached.value; throw cached.err; }
    try {
      const value = finishCallResult(node, def.rng(node.args, ctx, evalNode));
      byRows.set(ctx.rows, { ok: true, value });
      return value;
    } catch (e) {
      byRows.set(ctx.rows, { ok: false, err: e });
      throw e;
    }
  }
  let r;
  if (def.rng) r = def.rng(node.args, ctx, evalNode);          // range/lookup: needs the arg NODES (to read whole columns)
  else if (def.lazy) r = def.lazy(node.args, ctx, evalNode);   // short-circuit / error-trapping forms
  else r = def.fn(node.args.map(a => evalNode(a, ctx)), ctx);
  return finishCallResult(node, r);
};
// A function must never hand back a non-finite number (overflow → ±Infinity, or 0×Infinity →
// NaN from e.g. TRUNC(0, huge)) as a "value" — it would slip into a comparison or label.
// Surface it as #NUM!, mirroring the arithmetic-operator guard. (POWER/EXP/FACT/SQRT throw
// their own domain errors earlier, so they never reach here non-finite.)
function finishCallResult(node, r) {
  if (typeof r === "number" && !Number.isFinite(r)) throw ferr(FORMULA_ERRORS.NUM, `${node.name} produced a non-finite number`);
  return r;
}

// ── Public entry points ────────────────────────────────────────────────────────
// evaluateFormula: parse + evaluate one formula against one row's context.
// Returns { ok:true, value } or { ok:false, error:"#…", detail }.
const evaluateFormula = (src, ctx) => {
  const parsed = parseFormula(src);
  if (parsed.error) return { ok: false, error: parsed.error, detail: parsed.detail };
  if (parsed.ast.type === "blankLiteral") return { ok: true, value: BLANK };
  const columns = (ctx && ctx.columns) || {};
  const fullCtx = {
    columns,
    // rows/rowIndex power whole-column aggregation + lookups (SUM/COUNTIF/XLOOKUP/…).
    // Default to a single-row view (this row) so those functions still work when a host
    // evaluates one row in isolation (e.g. the editor preview, or a unit test).
    rows: (ctx && ctx.rows) || [columns],
    rowIndex: (ctx && ctx.rowIndex) || 0,
    // grid powers A1-style cell/range references (a Model/pro-forma sheet). Optional
    // 2D array, row-major, 0-indexed: grid[0][0] is A1. A host that never wires one up
    // (or the Schedule module's structured-only [Column] use) reads every A1 ref as
    // blank — see readGridCell's header note for why that's never a crash or a #REF!.
    grid: (ctx && ctx.grid) || null,
    calendar: (ctx && ctx.calendar) || DEFAULT_CALENDAR,
    today: (ctx && ctx.today != null) ? ctx.today : Math.round(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) / MS_PER_DAY),
    formatDate: (ctx && ctx.formatDate) || serialToISO,
  };
  try {
    const value = evalNode(parsed.ast, fullCtx);
    // A formula whose final value IS an error cell (e.g. a bare INDEX/XLOOKUP that returned
    // one) surfaces as {ok:false} with that code — never a "successful" error object.
    if (isErrVal(value)) return { ok: false, error: value.code, detail: "propagated error" };
    // Backstop the "never return a non-finite number" contract (the call-boundary and
    // operator guards already cover the known paths; this catches any future one).
    if (typeof value === "number" && !Number.isFinite(value)) return { ok: false, error: FORMULA_ERRORS.NUM, detail: "result is not a finite number" };
    return { ok: true, value };
  }
  // Contract: never throw to the host (this runs per-row during a React render — an
  // uncaught throw would blank the grid). FormulaError → its code; anything else →
  // a generic #ERROR! cell.
  catch (e) { if (isFormulaError(e)) return { ok: false, error: e.code, detail: e.detail }; return { ok: false, error: FORMULA_ERRORS.ERR, detail: (e && e.message) || "evaluation error" }; }
};

// A numberFormat token that means "format this as a date" (mm/dd/yyyy, mmm d\, yyyy, …) — the
// same heuristic textFormat() already uses for TEXT(): date-letter tokens present, no digit
// placeholder. Shared here so formatValue's own date-routing agrees with TEXT()'s.
const looksLikeDateFormat = (fmt) => /[ymd]/i.test(fmt) && !/[#0]/.test(fmt);

// formatValue: turn a typed result into the string shown in a cell.
const formatValue = (value, opts) => {
  const o = opts || {};
  if (isFormulaError(value)) return value.code;
  if (isErrVal(value)) return value.code;             // a stored error cell renders as its code
  if (isBlank(value)) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  // ⛔ Model workspace ribbon (B1007281) — a numberFormat naming a DATE token used to be ignored
  // for both branches below: an actual Date value always rendered through formatDate/ISO no
  // matter what numberFormat asked for, and a plain number paired with a date-shaped numberFormat
  // (no [0#] placeholder for formatNumberToken to find) fell through to formatNumberSection's
  // literal-only branch, which just printed the format STRING itself back verbatim — a cell
  // formatted "mm/dd/yyyy" showed the literal text "mm/dd/yyyy". formatDateToken already existed
  // and did the real work; it was simply never reached from here.
  if (isDate(value)) {
    if (o.numberFormat && looksLikeDateFormat(o.numberFormat)) { try { return formatDateToken(value.s, o.numberFormat); } catch { /* fall through */ } }
    return (o.formatDate ? o.formatDate(value.s) : serialToISO(value.s));
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return FORMULA_ERRORS.NUM;
    if (o.numberFormat) {
      if (looksLikeDateFormat(o.numberFormat)) { try { return formatDateToken(Math.trunc(value), o.numberFormat); } catch { /* fall through */ } }
      try { return formatNumberToken(value, o.numberFormat); } catch { /* fall through */ }
    }
    return numToGeneralStr(value);
  }
  return String(value);
};

/** The colour a numberFormat's own colour tag ([Red], …) names for this VALUE — `null` when the
 *  value isn't a plain finite number, there's no numberFormat, or its chosen section carries no
 *  tag. A second, narrow query beside formatValue rather than a change to its return shape: every
 *  existing caller (the Schedule module included — see public/sequence/index.html) expects a
 *  plain string back, so this stays additive. */
const formatValueColor = (value, opts) => {
  const o = opts || {};
  if (typeof value !== "number" || !Number.isFinite(value) || !o.numberFormat) return null;
  try { return numberFormatColorFor(value, o.numberFormat); } catch { return null; }
};

// rewriteFormulaForCopy: the relative-reference rewrite for copy/fill. Pure, and
// deliberately separate from evaluateFormula's own parse/eval pipeline — given a
// formula's source text and the cell it's being copied FROM and TO, returns the
// rewritten formula text with every relative A1 reference shifted by the same
// (row, column) delta an absolute ($-anchored) axis of a reference never moves.
// A shift that would land off the sheet (column < A, row < 1, or past XFD/1048576)
// collapses that WHOLE reference (or, for a range, the whole A1:B10 span) to the
// literal text "#REF!" — exactly what Excel itself writes into the formula, and
// exactly why the tokenizer above accepts "#REF!" as valid input: the very next
// evaluateFormula() call on this rewritten text must surface it as a #REF! error,
// per the engine's own never-crash/never-silent-zero contract, not choke on it.
//
// This is a TOKEN-level rewrite, not a re-serialized AST: it walks tokenize()'s
// output and splices only the span of each reference/range, leaving every other
// character (operators, spacing, string literals, [Column] refs, function names)
// byte-identical. That also means it reuses the tokenizer's own — and only the
// tokenizer's own — notion of "is this a reference": a bare identifier immediately
// followed by "(" is a function call (LOG10(...) is never touched), exactly the
// same rule the parser applies, so the two can never disagree about what a
// reference is. Deliberately does NOT require the formula to fully PARSE (a
// formula that merely tokenizes is enough to find and shift its references) —
// but ANY malformed formula, and one with no references at all, is unaffected
// and returned unchanged, since the loop below simply finds nothing to splice.
//
// Row/column INSERT and DELETE (shifting every reference on a sheet edit) is a
// DIFFERENT transform — rewriteFormulaForStructuralShift, below — because it must
// shift $-anchored references too (see that function's own header for why).
const rewriteFormulaForCopy = (formulaSrc, sourceAddr, targetAddr) => {
  const src = parseRefText(sourceAddr);
  const tgt = parseRefText(targetAddr);
  if (!src || !tgt) throw new Error(`rewriteFormulaForCopy: invalid cell address ("${sourceAddr}" / "${targetAddr}")`);
  const text = String(formulaSrc == null ? "" : formulaSrc);
  const deltaRow = tgt.row - src.row, deltaCol = tgt.col - src.col;
  if (deltaRow === 0 && deltaCol === 0) return text; // copying onto itself — nothing moves
  let toks;
  try { toks = tokenize(text); }
  catch { return text; } // doesn't even lex — nothing this transform can safely touch
  // Shifts one address's non-absolute axis/axes by the delta; null means it fell
  // off the sheet on at least one axis (the caller emits "#REF!" for that span).
  const shift = ref => {
    const info = parseRefText(ref);
    if (!info) return null;
    const col = info.colAbs ? info.col : info.col + deltaCol;
    const row = info.rowAbs ? info.row : info.row + deltaRow;
    if (col < 1 || col > MAX_COL || row < 1 || row > MAX_ROW) return null;
    return refToText({ col, row, colAbs: info.colAbs, rowAbs: info.rowAbs });
  };
  // A token is reference-eligible under the exact same rule the parser uses: a
  // "ref" token always is; a plain "id" token is UNLESS it's immediately called
  // (LOG10(...)) or is the TRUE/FALSE literal, and only if its text is itself a
  // valid address (rules out ordinary function names and out-of-bounds text like
  // ABCD1, which the parser treats as an unknown name rather than a reference).
  const isRefEligible = (t, idx) => {
    if (t.t === "ref") return true;
    if (t.t !== "id") return false;
    const nextTok = toks[idx + 1];
    if (nextTok && nextTok.t === "op" && nextTok.v === "(") return false;
    const up = t.v.toUpperCase();
    if (up === "TRUE" || up === "FALSE") return false;
    return parseRefText(t.v) !== null;
  };
  let out = "", cursor = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t === "eof" || !isRefEligible(t, i)) continue;
    const isRange = toks[i + 1] && toks[i + 1].t === "op" && toks[i + 1].v === ":" &&
      toks[i + 2] && isRefEligible(toks[i + 2], i + 2);
    const endTok = isRange ? toks[i + 2] : t;
    const spanStart = t.pos, spanEnd = endTok.pos + String(endTok.v).length;
    let replacement;
    if (isRange) {
      const from = shift(t.v), to = shift(endTok.v);
      replacement = (from && to) ? `${from}:${to}` : "#REF!";
    } else {
      replacement = shift(t.v) || "#REF!";
    }
    out += text.slice(cursor, spanStart) + replacement;
    cursor = spanEnd;
    if (isRange) i += 2;
  }
  out += text.slice(cursor);
  return out;
};

// rewriteFormulaForStructuralShift: shift every reference in a formula's source
// text when a row or column is INSERTED or DELETED elsewhere in the sheet
// (Model workspace Stage 1 — this is the piece the header comment above used to
// say was "deliberately not built" for a fixed-layout pro-forma; a real
// underwriting model needs it).
//
// ⛔ THIS IS NOT rewriteFormulaForCopy WEARING A DIFFERENT NAME — it must shift
// EVERY reference regardless of $ anchoring. "$" means "don't move this axis
// when the FORMULA is copied/filled elsewhere" (rewriteFormulaForCopy's job); it
// has nothing to do with the GRID's own structure changing. Inserting a row above
// $A$1 must still turn it into $A$2, or every absolute reference in the sheet
// would silently start pointing at the wrong cell the moment anyone inserted a
// row above it — exactly the "wrong number that looks right" class this whole
// engine exists to prevent.
//
//   axis:  "row" | "col" — which axis the structural change is on
//   at:    1-based index of the insertion point (insert) or the deleted line (delete)
//   delta: +1 (insert a blank line BEFORE `at`) or -1 (delete the line AT `at`)
//
// The interval model: treat a reference — scalar OR range — as an inclusive
// [min,max] span on the changed axis (a scalar is the degenerate span min===max).
// Insert: any bound >= `at` shifts +1 (a bound sitting exactly at the insertion
// point is pushed down WITH whatever was already there, matching Excel — insert
// never grows a range to swallow the new blank line at its own top edge, but a
// bound strictly INSIDE the span does end up growing the range, since only that
// bound is >= at while the other stays put). Delete: a bound > `at` shifts -1; a
// bound === `at` collapses toward its partner (stays if it's the min, drops by 1
// if it's the max) — after which, if min > max, the ENTIRE reference collapsed
// (every original address on the changed axis was inside the deleted line) and
// becomes the literal text "#REF!", same convention rewriteFormulaForCopy uses.
// Hand-verified against real Excel's own documented insert/delete semantics for
// every edge shape (delete a range's top/bottom edge shrinks it; delete a range
// that IS one line collapses it; insert inside a range grows it; insert exactly
// at a range's own top edge pushes the whole range down rather than growing it).
//
// Same token-level technique as rewriteFormulaForCopy (see its header) — walks
// tokenize()'s own output and splices only each reference/range's span, so every
// other character is untouched and the two functions can never disagree about
// what counts as a reference.
const rewriteFormulaForStructuralShift = (formulaSrc, axis, at, delta) => {
  const text = String(formulaSrc == null ? "" : formulaSrc);
  let toks;
  try { toks = tokenize(text); }
  catch { return text; } // doesn't even lex — nothing this transform can safely touch
  const MAX = axis === "row" ? MAX_ROW : MAX_COL;
  // Shift one [min,max] interval on the changed axis. null = collapsed (#REF!).
  const shiftInterval = (min, max) => {
    let minN, maxN;
    if (delta > 0) {
      minN = min >= at ? min + 1 : min;
      maxN = max >= at ? max + 1 : max;
    } else {
      minN = min > at ? min - 1 : min;
      maxN = max >= at ? max - 1 : max;
    }
    if (minN > maxN || minN < 1 || maxN > MAX) return null;
    return { min: minN, max: maxN };
  };
  const isRefEligible = (t, idx) => {
    if (t.t === "ref") return true;
    if (t.t !== "id") return false;
    const nextTok = toks[idx + 1];
    if (nextTok && nextTok.t === "op" && nextTok.v === "(") return false;
    const up = t.v.toUpperCase();
    if (up === "TRUE" || up === "FALSE") return false;
    return parseRefText(t.v) !== null;
  };
  // One endpoint's ref text, with its value on the CHANGED axis replaced by
  // `axisVal`; the other axis and the $-anchoring of BOTH axes ride through
  // completely untouched — a column insert/delete never touches row anchoring
  // or vice versa.
  const shiftRef = (refText, axisVal) => {
    const info = parseRefText(refText);
    const col = axis === "col" ? axisVal : info.col;
    const row = axis === "row" ? axisVal : info.row;
    return refToText({ col, row, colAbs: info.colAbs, rowAbs: info.rowAbs });
  };
  let out = "", cursor = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t === "eof" || !isRefEligible(t, i)) continue;
    const isRange = toks[i + 1] && toks[i + 1].t === "op" && toks[i + 1].v === ":" &&
      toks[i + 2] && isRefEligible(toks[i + 2], i + 2);
    const endTok = isRange ? toks[i + 2] : t;
    const spanStart = t.pos, spanEnd = endTok.pos + String(endTok.v).length;
    const info1 = parseRefText(t.v);
    const info2 = isRange ? parseRefText(endTok.v) : info1;
    const v1 = axis === "row" ? info1.row : info1.col;
    const v2 = axis === "row" ? info2.row : info2.col;
    const iv = shiftInterval(Math.min(v1, v2), Math.max(v1, v2));
    let replacement;
    if (!iv) {
      replacement = "#REF!";
    } else if (!isRange) {
      replacement = shiftRef(t.v, iv.min);
    } else {
      // Preserve which endpoint held the min vs the max — a range can be
      // written ascending (A1:A5) or descending (A5:A1) on this axis.
      const fromVal = v1 <= v2 ? iv.min : iv.max;
      const toVal = v1 <= v2 ? iv.max : iv.min;
      replacement = `${shiftRef(t.v, fromVal)}:${shiftRef(endTok.v, toVal)}`;
    }
    out += text.slice(cursor, spanStart) + replacement;
    cursor = spanEnd;
    if (isRange) i += 2;
  }
  out += text.slice(cursor);
  return out;
};

// planFormulaColumns: order user formula columns so a formula that reads another
// formula column is computed AFTER it, and flag any caught in a reference cycle.
//   columns: [{ key, formula }]            (key = the column's internal id)
//   nameToKey(refName) -> key|null         (maps a [Name] in a formula to a column key)
// Returns { order: [key…], cyclic: Set<key>, refKeysByKey: Map, parseError: Map }.
// Only references to OTHER formula columns create graph edges (a ref to a built-in
// column is a leaf input, never part of a formula-vs-formula cycle).
const planFormulaColumns = (columns, nameToKey) => {
  const keys = columns.map(c => c.key);
  const keySet = new Set(keys);
  const deps = new Map();          // key -> Set of formula-column keys it depends on
  const refKeysByKey = new Map();
  const parseError = new Map();
  columns.forEach(c => {
    const { refs, error } = extractRefs(c.formula);
    if (error) parseError.set(c.key, error);
    const dk = new Set();
    // A self-reference (k === c.key) is kept — it is a one-node cycle and must be flagged.
    refs.forEach(name => { const k = nameToKey ? nameToKey(name) : null; if (k && keySet.has(k)) dk.add(k); });
    deps.set(c.key, dk);
    refKeysByKey.set(c.key, dk);
  });
  // Tarjan-free cycle detect via DFS colouring; topo order via post-order.
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map(keys.map(k => [k, WHITE]));
  const cyclic = new Set();
  const order = [];
  const stack = [];
  const visit = k => {
    color.set(k, GRAY); stack.push(k);
    for (const d of deps.get(k) || []) {
      if (color.get(d) === GRAY) { // back-edge → every node currently on the stack from d is in a cycle
        for (let i = stack.length - 1; i >= 0; i--) { cyclic.add(stack[i]); if (stack[i] === d) break; }
        cyclic.add(d);
      } else if (color.get(d) === WHITE) { visit(d); }
    }
    stack.pop(); color.set(k, BLACK); order.push(k);
  };
  keys.forEach(k => { if (color.get(k) === WHITE) visit(k); });
  return { order, cyclic, refKeysByKey, parseError };
};

// Function names + a short signature/help string, for the editor's autocomplete.
const FUNCTION_HELP = {
  SUM: "SUM([Column] or n1, n2, …) — add a whole column or numbers",
  PRODUCT: "PRODUCT(n1, n2, …) — multiply numbers",
  MIN: "MIN([Column] or n1, …) — smallest", MAX: "MAX([Column] or n1, …) — largest",
  AVERAGE: "AVERAGE([Column] or n1, …) — mean", COUNT: "COUNT([Column]) — count of numbers",
  COUNTA: "COUNTA([Column]) — count of non-empty cells",
  COUNTIF: 'COUNTIF([Column], ">5" | "Done" | …) — count matching',
  SUMIF: 'SUMIF([Column], criteria, [SumColumn]) — sum matching',
  AVERAGEIF: 'AVERAGEIF([Column], criteria, [AvgColumn]) — mean of matching',
  MATCH: "MATCH(value, [Column], [type]) — 1-based position",
  INDEX: "INDEX([Column], n) — the n-th value",
  XLOOKUP: "XLOOKUP(value, [LookupColumn], [ReturnColumn], [ifNotFound]) — find across rows",
  ABS: "ABS(n) — absolute value", ROUND: "ROUND(n, digits) — round half away from 0",
  ROUNDUP: "ROUNDUP(n, digits) — round away from 0", ROUNDDOWN: "ROUNDDOWN(n, digits) — round toward 0",
  INT: "INT(n) — round down to integer", MOD: "MOD(n, divisor) — remainder",
  CEILING: "CEILING(n, significance) — round up to multiple", FLOOR: "FLOOR(n, significance) — round down to multiple",
  POWER: "POWER(base, exp)", SQRT: "SQRT(n)",
  IF: "IF(test, then, else) — branch", IFS: "IFS(test1, val1, test2, val2, …)",
  AND: "AND(a, b, …) — all true", OR: "OR(a, b, …) — any true", NOT: "NOT(x)",
  SWITCH: "SWITCH(expr, case1, val1, …, default)", IFERROR: "IFERROR(value, valueIfError)",
  ISBLANK: "ISBLANK(x) — is the value empty",
  TODAY: "TODAY() — today's date", DATE: "DATE(year, month, day)",
  YEAR: "YEAR(date)", MONTH: "MONTH(date)", DAY: "DAY(date)", WEEKDAY: "WEEKDAY(date, [type])",
  EDATE: "EDATE(date, months) — same day, n months out", EOMONTH: "EOMONTH(date, months) — month end",
  DATEDIF: 'DATEDIF(start, end, "Y"|"M"|"D"|"MD"|"YM"|"YD")', DAYS: "DAYS(end, start) — calendar days between",
  WORKDAY: "WORKDAY(start, days) — date N working days out (project calendar)",
  NETWORKDAYS: "NETWORKDAYS(start, end) — working days between (project calendar)",
  CONCAT: "CONCAT(a, b, …) — join text", TEXT: 'TEXT(value, "m/d/yyyy" | "#,##0.00" | …)',
  LEFT: "LEFT(text, n)", RIGHT: "RIGHT(text, n)", MID: "MID(text, start, length)",
  LEN: "LEN(text)", TRIM: "TRIM(text)", UPPER: "UPPER(text)", LOWER: "LOWER(text)",
  SUBSTITUTE: "SUBSTITUTE(text, old, new, [which])", REPLACE: "REPLACE(text, start, len, new)",
  FIND: "FIND(find, within, [start]) — case-sensitive", SEARCH: "SEARCH(find, within, [start]) — case-insensitive, wildcards",
  REPT: "REPT(text, count)", PROPER: "PROPER(text) — Capitalize Each Word", TEXTJOIN: "TEXTJOIN(delim, ignoreEmpty, a, b, …)",
  VALUE: "VALUE(text) — text to number", EXACT: "EXACT(a, b) — case-sensitive equal", CHAR: "CHAR(code)", CODE: "CODE(text)",
  SIGN: "SIGN(n)", TRUNC: "TRUNC(n, [digits])", EXP: "EXP(n)", LN: "LN(n)", LOG: "LOG(n, [base])", LOG10: "LOG10(n)", PI: "PI()",
  QUOTIENT: "QUOTIENT(a, b) — integer divide", MROUND: "MROUND(n, multiple)", EVEN: "EVEN(n)", ODD: "ODD(n)", FACT: "FACT(n) — factorial",
  XOR: "XOR(a, b, …)", IFNA: "IFNA(value, valueIfNA)", TRUE: "TRUE()", FALSE: "FALSE()", NA: "NA() — the #N/A value",
  ISERROR: "ISERROR(value)", ISERR: "ISERR(value) — error except #N/A", ISNA: "ISNA(value)",
  ISNUMBER: "ISNUMBER(value)", ISTEXT: "ISTEXT(value)", ISLOGICAL: "ISLOGICAL(value)",
  ISEVEN: "ISEVEN(n)", ISODD: "ISODD(n)", N: "N(value) — coerce to number",
  NOW: "NOW() — today's date", DATEVALUE: "DATEVALUE(text)", WEEKNUM: "WEEKNUM(date, [type])",
  ISOWEEKNUM: "ISOWEEKNUM(date)", YEARFRAC: "YEARFRAC(start, end, [basis])",
  NPV: "NPV(rate, cf1, cf2, …) — net present value of future cash flows (period 1, 2, …)",
  XNPV: "XNPV(rate, cf1, date1, cf2, date2, …) — NPV with actual dates",
  IRR: "IRR(cf0, cf1, …) — internal rate of return (cf0 is time 0)",
  XIRR: "XIRR(cf1, date1, cf2, date2, …) — IRR with actual dates",
  MIRR: "MIRR(financeRate, reinvestRate, cf0, cf1, …) — modified IRR",
  PMT: "PMT(rate, nper, pv, [fv], [type]) — payment per period",
  IPMT: "IPMT(rate, per, nper, pv, [fv], [type]) — interest portion of payment `per`",
  PPMT: "PPMT(rate, per, nper, pv, [fv], [type]) — principal portion of payment `per`",
  RATE: "RATE(nper, pmt, pv, [fv], [type], [guess]) — interest rate per period",
  NPER: "NPER(rate, pmt, pv, [fv], [type]) — number of periods",
  FV: "FV(rate, nper, pmt, [pv], [type]) — future value",
  PV: "PV(rate, nper, pmt, [fv], [type]) — present value",
  CUMIPMT: "CUMIPMT(rate, nper, pv, start, end, type) — cumulative interest between two periods",
  CUMPRINC: "CUMPRINC(rate, nper, pv, start, end, type) — cumulative principal between two periods",
};
const FUNCTION_NAMES = Object.keys(FUNCTIONS).sort();
/* FORMULA-ENGINE:END */

export {
  FORMULA_ERRORS, FormulaError, isFormulaError,
  BLANK, isBlank, errVal, isErrVal, makeDate, isDate,
  isoToSerial, serialToISO, serialToYMD, ymdToSerial, weekdayOf, parseLooseDate,
  DEFAULT_CALENDAR,
  tokenize, parse, parseFormula, extractRefs,
  evaluateFormula, formatValue, formatValueColor, planFormulaColumns,
  FUNCTIONS, FUNCTION_NAMES, FUNCTION_HELP,
  toNumber, toStr, toBool, toDateSerial, compareValues, numToGeneralStr,
  MAX_COL, MAX_ROW, parseRefText, colLettersToNum, colNumToLetters, rewriteFormulaForCopy,
  rewriteFormulaForStructuralShift,
};
