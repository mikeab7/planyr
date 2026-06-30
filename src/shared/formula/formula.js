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
const makeDate = serial => ({ k: "date", s: Math.trunc(serial) });
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
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return numToGeneralStr(v);
  if (isDate(v)) return (ctx && ctx.formatDate ? ctx.formatDate(v.s) : serialToISO(v.s));
  if (isBlank(v)) return "";
  return String(v);
};
const toBool = v => {
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
    // Column reference: [Column Name]
    if (c === "[") {
      let j = i + 1, out = "";
      while (j < n && s[j] !== "]") { out += s[j]; j++; }
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
      toks.push({ t: "num", v: parseFloat(s.slice(i, j)), pos: i }); i = j; continue;
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
    if ("+-*/^&=<>(),".includes(c)) { toks.push({ t: "op", v: c, pos: i }); i++; continue; }
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
const parse = toks => {
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
  const parsePrimary = () => {
    const t = peek();
    if (t.t === "num") { next(); return { type: "num", value: t.v }; }
    if (t.t === "str") { next(); return { type: "str", value: t.v }; }
    if (t.t === "col") { next(); return { type: "col", name: t.v }; }
    if (t.t === "op" && t.v === "(") { next(); if (++depth > MAX_PARSE_DEPTH) throw ferr(FORMULA_ERRORS.ERR, "formula nesting too deep"); const e = parseCompare(); depth--; expect(")"); return e; }
    if (t.t === "id") {
      next();
      const up = t.v.toUpperCase();
      if (up === "TRUE") return { type: "bool", value: true };
      if (up === "FALSE") return { type: "bool", value: false };
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
  // ── Math ──
  SUM:   { fn: a => a.reduce((s, v) => s + toNumber(v), 0) },
  PRODUCT: { fn: a => { need(a, 1, null, "PRODUCT"); return a.reduce((s, v) => s * toNumber(v), 1); } },
  MIN:   { fn: a => { need(a, 1, null, "MIN"); return Math.min(...a.map(num1)); } },
  MAX:   { fn: a => { need(a, 1, null, "MAX"); return Math.max(...a.map(num1)); } },
  ABS:   { fn: a => { need(a, 1, 1, "ABS"); return Math.abs(num1(a[0])); } },
  ROUND: { fn: a => { need(a, 1, 2, "ROUND"); return roundAwayFromZero(num1(a[0]), a.length > 1 ? num1(a[1]) : 0); } },
  ROUNDUP: { fn: a => { need(a, 1, 2, "ROUNDUP"); const d = a.length > 1 ? Math.trunc(num1(a[1])) : 0, f = Math.pow(10, d), n = num1(a[0]); return (n < 0 ? -Math.ceil(Math.abs(n) * f - 1e-9) : Math.ceil(n * f - 1e-9)) / f; } },
  ROUNDDOWN: { fn: a => { need(a, 1, 2, "ROUNDDOWN"); const d = a.length > 1 ? Math.trunc(num1(a[1])) : 0, f = Math.pow(10, d), n = num1(a[0]); return (n < 0 ? -Math.floor(Math.abs(n) * f + 1e-9) : Math.floor(n * f + 1e-9)) / f; } },
  INT:   { fn: a => { need(a, 1, 1, "INT"); return Math.floor(num1(a[0])); } },
  MOD:   { fn: a => { need(a, 2, 2, "MOD"); const n = num1(a[0]), d = num1(a[1]); if (d === 0) throw ferr(FORMULA_ERRORS.DIV0, "MOD by zero"); return n - d * Math.floor(n / d); } },
  CEILING: { fn: a => { need(a, 1, 2, "CEILING"); const n = num1(a[0]), sig = a.length > 1 ? num1(a[1]) : 1; if (sig === 0) return 0; if (n > 0 && sig < 0) throw ferr(FORMULA_ERRORS.NUM, "CEILING: number and significance must share a sign"); return Math.ceil(n / sig) * sig; } },
  FLOOR: { fn: a => { need(a, 1, 2, "FLOOR"); const n = num1(a[0]), sig = a.length > 1 ? num1(a[1]) : 1; if (sig === 0) throw ferr(FORMULA_ERRORS.DIV0, "FLOOR significance 0"); if (n > 0 && sig < 0) throw ferr(FORMULA_ERRORS.NUM, "FLOOR: number and significance must share a sign"); return Math.floor(n / sig) * sig; } },
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
};

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
function formatNumberToken(n, fmt) {
  let pct = false;
  if (/%/.test(fmt)) { pct = true; n *= 100; }
  const useThousands = /#,##0|0,000|,/.test(fmt);
  const dollar = /^\s*\$/.test(fmt) || /\$/.test(fmt);
  const dotIdx = fmt.indexOf(".");
  let decimals = 0;
  if (dotIdx >= 0) { const after = fmt.slice(dotIdx + 1).match(/[0#]/g); decimals = after ? after.length : 0; }
  // Count integer-side '0' placeholders to left-pad the integer part (Excel "00" → 7 = "07").
  const intZeros = ((dotIdx >= 0 ? fmt.slice(0, dotIdx) : fmt).match(/0/g) || []).length;
  const neg = n < 0;
  const parts = roundAwayFromZero(Math.abs(n), decimals).toFixed(decimals).split(".");
  if (intZeros > parts[0].length) parts[0] = parts[0].padStart(intZeros, "0");
  if (useThousands) parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-" : "") + (dollar ? "$" : "") + parts.join(".") + (pct ? "%" : "");
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
      return v === undefined ? BLANK : v;
    }
    case "unary": {
      if (node.op === "+") return toNumber(evalNode(node.arg, ctx));
      return -toNumber(evalNode(node.arg, ctx));
    }
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
  if (def.lazy) return def.lazy(node.args, ctx, evalNode);
  const args = node.args.map(a => evalNode(a, ctx));
  return def.fn(args, ctx);
};

// ── Public entry points ────────────────────────────────────────────────────────
// evaluateFormula: parse + evaluate one formula against one row's context.
// Returns { ok:true, value } or { ok:false, error:"#…", detail }.
const evaluateFormula = (src, ctx) => {
  const parsed = parseFormula(src);
  if (parsed.error) return { ok: false, error: parsed.error, detail: parsed.detail };
  if (parsed.ast.type === "blankLiteral") return { ok: true, value: BLANK };
  const fullCtx = {
    columns: (ctx && ctx.columns) || {},
    calendar: (ctx && ctx.calendar) || DEFAULT_CALENDAR,
    today: (ctx && ctx.today != null) ? ctx.today : Math.round(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) / MS_PER_DAY),
    formatDate: (ctx && ctx.formatDate) || serialToISO,
  };
  try { return { ok: true, value: evalNode(parsed.ast, fullCtx) }; }
  // Contract: never throw to the host (this runs per-row during a React render — an
  // uncaught throw would blank the grid). FormulaError → its code; anything else →
  // a generic #ERROR! cell.
  catch (e) { if (isFormulaError(e)) return { ok: false, error: e.code, detail: e.detail }; return { ok: false, error: FORMULA_ERRORS.ERR, detail: (e && e.message) || "evaluation error" }; }
};

// formatValue: turn a typed result into the string shown in a cell.
const formatValue = (value, opts) => {
  const o = opts || {};
  if (isFormulaError(value)) return value.code;
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
  SUM: "SUM(n1, n2, …) — add numbers",
  PRODUCT: "PRODUCT(n1, n2, …) — multiply numbers",
  MIN: "MIN(n1, n2, …) — smallest", MAX: "MAX(n1, n2, …) — largest",
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
};
const FUNCTION_NAMES = Object.keys(FUNCTIONS).sort();
/* FORMULA-ENGINE:END */

export {
  FORMULA_ERRORS, FormulaError, isFormulaError,
  BLANK, isBlank, makeDate, isDate,
  isoToSerial, serialToISO, serialToYMD, ymdToSerial, weekdayOf, parseLooseDate,
  DEFAULT_CALENDAR,
  tokenize, parse, parseFormula, extractRefs,
  evaluateFormula, formatValue, planFormulaColumns,
  FUNCTIONS, FUNCTION_NAMES, FUNCTION_HELP,
  toNumber, toStr, toBool, toDateSerial, compareValues, numToGeneralStr,
};
