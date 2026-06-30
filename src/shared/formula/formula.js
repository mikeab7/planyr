// src/shared/formula/formula.js
//
// Planyr formula engine — a small, dependency-free Excel-style expression
// evaluator. It is the calculation core behind the scheduler's user-defined
// "Formula" columns (and, later, Cost Estimating's). A formula is authored once
// per column and evaluated for every row, referencing that row's other columns
// by name with structured references — e.g.  [Finish] - [Start]  or
// IF([% Complete] >= 100, "Done", "Open"). There are NO A1-style cell addresses:
// schedule rows are activities that reorder/insert/delete constantly, so a
// per-row calculated column (like an Excel table column) is the right model.
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
// }
// Typed values handed in via ctx.columns and returned out are:
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

// ── Tokenizer ────────────────────────────────────────────────────────────────
// Token kinds: num, str, col (bracketed reference), id (function/keyword), op, eof
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
    // Identifier: function name / TRUE / FALSE. Letters, digits, _, ., and a
    // trailing % only inside names like none — names are [A-Za-z_][A-Za-z0-9_.]*
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_.]/.test(s[j])) j++;
      toks.push({ t: "id", v: s.slice(i, j), pos: i }); i = j; continue;
    }
    // Multi-char operators first
    const two = s.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "<>") { toks.push({ t: "op", v: two, pos: i }); i += 2; continue; }
    if ("+-*/^&=<>(),%".includes(c)) { toks.push({ t: "op", v: c, pos: i }); i++; continue; }
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
  const parseAtom = () => {
    const t = peek();
    if (t.t === "num") { next(); return { type: "num", value: t.v }; }
    if (t.t === "str") { next(); return { type: "str", value: t.v }; }
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
      // A bare identifier that is not TRUE/FALSE and not followed by "(" is unknown.
      throw ferr(FORMULA_ERRORS.NAME, `unknown name "${t.v}" (use [${t.v}] for a column)`);
    }
    throw ferr(FORMULA_ERRORS.ERR, "unexpected end of formula");
  };

  const ast = parseCompare();
  if (peek().t !== "eof") throw ferr(FORMULA_ERRORS.ERR, "unexpected trailing input");
  return ast;
};

// parseFormula: lenient wrapper used by the UI for live validation. Returns
// { ast } or { error }. Empty/whitespace formula parses to a blank node.
const parseFormula = src => {
  const text = String(src == null ? "" : src).trim();
  if (text === "") return { ast: { type: "blankLiteral" } };
  try { return { ast: parse(tokenize(text)) }; }
  // Contract: never throw to the host. A FormulaError carries a code; anything else
  // (e.g. a RangeError from pathological depth that slipped the guard) is reported as
  // a generic parse error rather than crashing the caller's render.
  catch (e) { if (isFormulaError(e)) return { error: e.code, detail: e.detail }; return { error: FORMULA_ERRORS.ERR, detail: (e && e.message) || "parse error" }; }
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
};

// ── Range / criteria / lookup helpers (used by the range-aware functions above) ──
// A range argument must be a bare [Column] reference; it expands to that column's values
// across every row in ctx.rows (the whole table, in display order).
function colArray(node, ctx) {
  if (!node || node.type !== "col") throw ferr(FORMULA_ERRORS.VALUE, "expected a [Column] reference");
  const key = node.name.toLowerCase();
  // [@Column] forces THIS row even inside a range function (consistent with how
  // SUM/AVERAGE treat a [@Column] arg), so it contributes a single cell.
  if (node.atRow) {
    const cols = ctx.columns || {};
    if (!Object.prototype.hasOwnProperty.call(cols, key)) throw ferr(FORMULA_ERRORS.REF, `unknown column "${node.name}"`);
    const v = cols[key];
    return [v === undefined ? BLANK : raiseIfErr(v)];   // [@ErrCol] this-row read propagates
  }
  const rows = (ctx.rows && ctx.rows.length) ? ctx.rows : [ctx.columns || {}];
  // Existence check across the union of rows (not just row 0) so a ragged table
  // doesn't make a genuine column read as #REF!.
  if (!rows.some(r => Object.prototype.hasOwnProperty.call(r, key))) throw ferr(FORMULA_ERRORS.REF, `unknown column "${node.name}"`);
  return rows.map(r => { const v = r[key]; return v === undefined ? BLANK : v; });
}
// Numbers for SUM/AVERAGE/MIN/MAX/PRODUCT: a bare [Column] arg contributes its numeric
// (and date→serial) cells, skipping blank/text/bool (Excel range behavior); a scalar or
// [@Column] arg is coerced via toNumber.
function collectNums(argNodes, ctx, ev) {
  const nums = [];
  argNodes.forEach(n => {
    if (n.type === "col" && !n.atRow) colArray(n, ctx).forEach(v => { raiseIfErr(v); if (typeof v === "number") nums.push(v); else if (isDate(v)) nums.push(v.s); });
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
    if (n.type === "col" && !n.atRow) colArray(n, ctx).forEach(take);
    else { const v = ev(n, ctx); if (isDate(v)) { nums.push(v.s); any = true; } else { nums.push(toNumber(v)); allDates = false; } }
  });
  return { nums, allDates: any && allDates };
}
function collectCountable(argNodes, ctx, ev) { // COUNT — numbers only
  let c = 0;
  argNodes.forEach(n => {
    if (n.type === "col" && !n.atRow) colArray(n, ctx).forEach(v => { raiseIfErr(v); if (typeof v === "number" || isDate(v)) c++; });
    else { const v = ev(n, ctx); if (typeof v === "number" || isDate(v)) c++; else if (typeof v === "string") { try { toNumber(v); c++; } catch { /* non-numeric text isn't counted */ } } }
  });
  return c;
}
function collectNonBlank(argNodes, ctx, ev) { // COUNTA — anything non-blank
  let c = 0;
  argNodes.forEach(n => {
    if (n.type === "col" && !n.atRow) colArray(n, ctx).forEach(v => { raiseIfErr(v); if (!isBlank(v) && v !== "") c++; });
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
// Format one section as a template: the run from the first to the last digit placeholder
// ([0#]) is the number; text before/after is emitted verbatim (so "$", "%", "(", ")" survive
// in place). Decimal/integer placeholders are counted WITHIN this section only — never across
// the ';' boundary, which is what made a 2-section format show 8 decimals. autoSign prefixes
// "-" for a negative value only in the single-section case.
function formatNumberSection(n, fmt, autoSign) {
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
const evalCall = (node, ctx) => {
  const def = FUNCTIONS[node.name];
  if (!def) throw ferr(FORMULA_ERRORS.NAME, `unknown function ${node.name}`);
  let r;
  if (def.rng) r = def.rng(node.args, ctx, evalNode);          // range/lookup: needs the arg NODES (to read whole columns)
  else if (def.lazy) r = def.lazy(node.args, ctx, evalNode);   // short-circuit / error-trapping forms
  else r = def.fn(node.args.map(a => evalNode(a, ctx)), ctx);
  // A function must never hand back a non-finite number (overflow → ±Infinity, or 0×Infinity →
  // NaN from e.g. TRUNC(0, huge)) as a "value" — it would slip into a comparison or label.
  // Surface it as #NUM!, mirroring the arithmetic-operator guard. (POWER/EXP/FACT/SQRT throw
  // their own domain errors earlier, so they never reach here non-finite.)
  if (typeof r === "number" && !Number.isFinite(r)) throw ferr(FORMULA_ERRORS.NUM, `${node.name} produced a non-finite number`);
  return r;
};

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

// formatValue: turn a typed result into the string shown in a cell.
const formatValue = (value, opts) => {
  const o = opts || {};
  if (isFormulaError(value)) return value.code;
  if (isErrVal(value)) return value.code;             // a stored error cell renders as its code
  if (isBlank(value)) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (isDate(value)) return (o.formatDate ? o.formatDate(value.s) : serialToISO(value.s));
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return FORMULA_ERRORS.NUM;
    if (o.numberFormat) { try { return formatNumberToken(value, o.numberFormat); } catch { /* fall through */ } }
    return numToGeneralStr(value);
  }
  return String(value);
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
};
const FUNCTION_NAMES = Object.keys(FUNCTIONS).sort();
/* FORMULA-ENGINE:END */

export {
  FORMULA_ERRORS, FormulaError, isFormulaError,
  BLANK, isBlank, errVal, isErrVal, makeDate, isDate,
  isoToSerial, serialToISO, serialToYMD, ymdToSerial, weekdayOf, parseLooseDate,
  DEFAULT_CALENDAR,
  tokenize, parse, parseFormula, extractRefs,
  evaluateFormula, formatValue, planFormulaColumns,
  FUNCTIONS, FUNCTION_NAMES, FUNCTION_HELP,
  toNumber, toStr, toBool, toDateSerial, compareValues, numToGeneralStr,
};
