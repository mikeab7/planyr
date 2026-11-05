/* Model workspace — Planyr-only formula SYNTAX → Excel syntax Univer understands (NEW-1, cutover step 7).
 * Two spellings only the older engine (src/shared/formula/formula.js) read are rewritten, in memory and on load, NEVER silently
 * (the grid says how many; the export writes the rewritten, Excel-valid text):
 *   1. `[Column]` / `[@Column]` → plain cell references (below);
 *   2. `XIRR(v1,d1,v2,d2,…)` / `XNPV(rate,v1,d1,v2,d2,…)` (interleaved value/date pairs) → Excel's two-array shape,
 *      `XIRR(CHOOSE({1,2,…},v1,v2,…),CHOOSE({1,2,…},d1,d2,…))` — an array constant cannot hold DATE(…) calls in Excel, CHOOSE with an
 *      index array can, and Univer and Excel both evaluate it (measured).
 *   3. a minus sign straight before a NAME or TRUE/FALSE — `=-Rate`, `=2*-Site.Acres`, `=-TRUE` — is written `-(Rate)`: Univer's parser
 *      (1.3.1) reads the sign and the name as one unknown token and answers #NAME?. Same meaning, same answer; `=-B9` and `=-Sheet!B9`
 *      already work and are left alone. (Measured; the grid applies the same rewrite to a formula as it is typed.)
 * Every Planyr-only FUNCTION: none — all 115 functions of the older engine exist in Univer (measured, docs/SPREADSHEET-UNIVER-SPIKE.md).
 *
 * Planyr's older formula engine understood a same-row column NAME in square brackets: `=[Price]*[Qty]` meant "this row's
 * Price times this row's Qty", and `=SUM([Price])` meant "the whole Price column". Univer's engine (now the one evaluator
 * for everything — lib/univerEval.js) and Excel itself have no such syntax. Rather than leave those cells as a confident
 * #NAME?, they are REWRITTEN to ordinary references, and the person is told how many were:
 *
 *   `[Price]`   in a scalar position           → `D5`   (the cell in the formula's own row)   — the same cell it always meant
 *   `[@Price]`  (the explicit this-row form)    → `D5`
 *   `[Price]`   as a whole argument of SUM / PRODUCT / MIN / MAX / AVERAGE(A) / COUNT(A) / COUNTIF(S) range slot, SUMIF
 *               range slots, MATCH lookup array, INDEX array, XLOOKUP / VLOOKUP / HLOOKUP table → `D:D`  (the whole column,
 *               which is what the older engine's "all rows of that column" meant)
 *
 * The rewrite is textual and scoped: string literals and quoted sheet names are never touched, an unknown column name is
 * left exactly as typed (it was a #REF! before and is reported in `unresolved`), and nothing is rewritten that does not
 * contain a bracket. Pure and dependency-light on purpose — loaded by the grid, the export and the unit tests alike. */
import { colLetterName } from "./sheetModel.js";

/** Where a bare `[Column]` argument means the WHOLE column. Mirrors formula.js `RANGE_ARG_POSITIONS` (the older engine's
 *  range-slot table); the differential suite (test/modelFormulaEnginesAgree.test.js) fails if the two ever disagree. */
export const RANGE_ARG_POSITIONS = {
  SUM: "ALL", PRODUCT: "ALL", MIN: "ALL", MAX: "ALL", AVERAGE: "ALL", AVERAGEA: "ALL",
  COUNT: "ALL", COUNTA: "ALL",
  COUNTIF: [0], SUMIF: [0, 2], AVERAGEIF: [0, 2],
  MATCH: [1], INDEX: [0], XLOOKUP: [1, 2], VLOOKUP: [1], HLOOKUP: [1],
};

const lower = (s) => String(s || "").trim().toLowerCase();

/** The column name inside one bracket token (`[Price]`, `[@Price]`, `[@[Unit price]]`) and whether it was the `@` form. */
export function parseBracketToken(token) {
  let inner = token.slice(1, -1).trim();
  let atRow = false;
  if (inner[0] === "@") {
    atRow = true;
    inner = inner.slice(1).trim();
    if (inner[0] === "[" && inner[inner.length - 1] === "]") inner = inner.slice(1, -1).trim();
  }
  return { name: inner, atRow };
}

/** Index of the ")" matching the "(" at `open`, string-aware; -1 when unbalanced. */
function matchParen(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' || ch === "'") { let j = i + 1; while (j < s.length) { if (s[j] === ch) { if (s[j + 1] === ch) { j += 2; continue; } break; } j++; } i = j; continue; }
    if (ch === "(") depth++; else if (ch === ")") { depth--; if (depth === 0) return i; }
  }
  return -1;
}
/** Top-level comma split of a call's argument text (parens, braces, brackets and strings nest). */
function splitArgs(s) {
  const out = []; let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' || ch === "'") { let j = i + 1; while (j < s.length) { if (s[j] === ch) { if (s[j + 1] === ch) { j += 2; continue; } break; } j++; } i = j; continue; }
    if (ch === "(" || ch === "{" || ch === "[") depth++; else if (ch === ")" || ch === "}" || ch === "]") depth--;
    else if (ch === "," && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
  }
  out.push(s.slice(start));
  return out;
}
const indexArray = (n) => `{${Array.from({ length: n }, (_, i) => i + 1).join(",")}}`;

/** `XIRR(v1,d1,v2,d2,…)` / `XNPV(rate,v1,d1,…)` interleaved pairs → Excel's two-array shape. Returns { text, count }. */
export function rewriteInterleavedPairs(src) {
  const s = String(src ?? "");
  if (!/XIRR|XNPV/i.test(s)) return { text: s, count: 0 };
  let out = "", count = 0, i = 0;
  const re = /(^|[^A-Za-z0-9_.])(XIRR|XNPV)\s*\(/gi;
  for (let m; (m = re.exec(s));) {
    const nameStart = m.index + m[1].length;
    const open = s.indexOf("(", nameStart);
    const close = matchParen(s, open);
    if (close < 0) break;
    const args = splitArgs(s.slice(open + 1, close));
    const fn = m[2].toUpperCase();
    const lead = fn === "XNPV" ? 1 : 0;                       // XNPV carries the rate first
    const flows = args.length - lead;
    const interleaved = fn === "XIRR" ? (args.length >= 4 && args.length % 2 === 0) : (flows >= 4 && flows % 2 === 0);
    if (!interleaved) continue;
    const vals = [], dates = [];
    for (let k = lead; k < args.length; k += 2) { vals.push(args[k].trim()); dates.push(args[k + 1].trim()); }
    const idx = indexArray(vals.length);
    const body = `${lead ? `${args[0].trim()},` : ""}CHOOSE(${idx},${vals.join(",")}),CHOOSE(${idx},${dates.join(",")})`;
    out += s.slice(i, nameStart) + `${fn}(${body})`;
    i = close + 1; re.lastIndex = i; count++;
  }
  return { text: out + s.slice(i), count };
}

/**
 * Rewrite the `[Column]` references of ONE formula's text. `columns` is the sheet's ordered column list (each `{ name }`);
 * `rowIndex` is the 0-based row the formula sits in. Returns `{ text, changed, unresolved }`.
 */
export function rewriteColumnRefs(src, { rowIndex, columns }) {
  const s = String(src ?? "");
  if (s.indexOf("[") < 0) return { text: s, changed: false, unresolved: [] };
  const indexOfName = (name) => { const k = lower(name); return columns.findIndex((c) => lower(c && c.name) === k); };
  const unresolved = [];
  const frames = []; // one per open "(": { fn: UPPERCASE name or null, arg: index of the argument being read }
  let out = "";
  let changed = false;
  const n = s.length;
  const lastSig = () => { for (let k = out.length - 1; k >= 0; k--) if (!/\s/.test(out[k])) return out[k]; return ""; };
  for (let i = 0; i < n;) {
    const ch = s[i];
    if (ch === '"' || ch === "'") {
      // a string literal / a quoted sheet name: copied verbatim, a doubled quote is an escaped quote
      let j = i + 1;
      while (j < n) { if (s[j] === ch) { if (s[j + 1] === ch) { j += 2; continue; } break; } j++; }
      out += s.slice(i, j + 1); i = j + 1; continue;
    }
    if (ch === "[") {
      let depth = 0, j = i;
      for (; j < n; j++) { if (s[j] === "[") depth++; else if (s[j] === "]") { depth--; if (depth === 0) break; } }
      if (j >= n) { out += s.slice(i); i = n; continue; }            // unbalanced: leave the tail as typed
      const token = s.slice(i, j + 1);
      const { name, atRow } = parseBracketToken(token);
      const idx = indexOfName(name);
      if (idx < 0) { unresolved.push(name); out += token; i = j + 1; continue; }
      const letter = colLetterName(idx);
      let rest = j + 1; while (rest < n && /\s/.test(s[rest])) rest++;
      const prev = lastSig(), next = s[rest] || "";
      const top = frames[frames.length - 1];
      const slots = top && top.fn ? RANGE_ARG_POSITIONS[top.fn] : null;
      const wholeColumn = !atRow && (prev === "(" || prev === ",") && (next === "," || next === ")") && !!slots
        && (slots === "ALL" || slots.includes(top.arg));
      out += wholeColumn ? `${letter}:${letter}` : `${letter}${rowIndex + 1}`;
      changed = true; i = j + 1; continue;
    }
    if (ch === "(") {
      const m = /([A-Za-z_][A-Za-z0-9_.]*)\s*$/.exec(out);
      frames.push({ fn: m ? m[1].toUpperCase() : null, arg: 0 });
    } else if (ch === ",") {
      if (frames.length) frames[frames.length - 1].arg++;
    } else if (ch === ")") {
      frames.pop();
    }
    out += ch; i++;
  }
  return { text: out, changed, unresolved };
}

/** `-Name` → `-(Name)` where Univer would read the sign and the name as one unknown token. Skips strings, quoted sheet names, function
 *  calls (`-SUM(`), sheet-qualified references (`-Sheet1!B9`), plain cell references (`-B9`) and a minus that is subtraction. Returns { text, count }. */
export function rewriteUnaryMinusBeforeName(src) {
  const s = String(src ?? "");
  if (s.indexOf("-") < 0) return { text: s, count: 0 };
  let out = "", count = 0;
  const n = s.length;
  for (let i = 0; i < n;) {
    const ch = s[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n) { if (s[j] === ch) { if (s[j + 1] === ch) { j += 2; continue; } break; } j++; }
      out += s.slice(i, j + 1); i = j + 1; continue;
    }
    if (ch === "-") {
      let k = out.length - 1; while (k >= 0 && /\s/.test(out[k])) k--;
      const prev = k >= 0 ? out[k] : "";
      const unary = prev === "" || "=(,+-*/^&<>".includes(prev);
      const m = unary ? /^\s*([A-Za-z_][A-Za-z0-9_.]*)/.exec(s.slice(i + 1)) : null;
      if (m) {
        const after = s[i + 1 + m[0].length] || "";
        const word = m[1];
        const isCellRef = /^\$?[A-Za-z]{1,3}\$?\d+$/.test(word);
        const sheetQualified = after === "!";
        const isCall = /^\s*\(/.test(s.slice(i + 1 + m[0].length));
        if (!isCellRef && !sheetQualified && !isCall) {
          out += `-(${word})`; i += 1 + m[0].length; count++; continue;
        }
      }
    }
    out += ch; i++;
  }
  return { text: out, count };
}

/** All rewrites on one formula: { text, changed, columnRefs, pairs, unaryNames, unresolved }. */
export function rewritePlanyrSyntax(src, ctx) {
  const a = rewriteColumnRefs(src, ctx);
  const b = rewriteInterleavedPairs(a.text);
  const c = rewriteUnaryMinusBeforeName(b.text);
  const columnRefs = a.changed ? 1 : 0;
  return { text: c.text, changed: a.changed || b.count > 0 || c.count > 0, columnRefs, pairs: b.count, unaryNames: c.count, unresolved: a.unresolved };
}

const isFormulaText = (t) => String(t ?? "").trim().startsWith("=");

/**
 * Rewrite every `[Column]` formula of a Planyr workbook. Returns a NEW workbook (the input is never mutated; untouched
 * sheets are shared) and `rewritten`, one `{ sheetId, sheetName, key, row, from, to }` per changed cell, plus `unresolved`
 * (`[Name]` references naming no column — left as typed). `rewritten.length === 0` means the same workbook object comes back.
 */
export function migratePlanyrSyntaxInWorkbook(workbook) {
  const rewritten = [], unresolved = [];
  let touched = false;
  const sheets = workbook.sheets.map((entry) => {
    const sh = entry.sheet;
    let cells = null;
    for (const [key, raw] of Object.entries(sh.cells || {})) {
      if (!isFormulaText(raw) || !/\[|XIRR|XNPV|-/i.test(String(raw))) continue;
      const i = key.lastIndexOf(":");
      const row = Number(key.slice(i + 1));
      const { text, changed, columnRefs, pairs, unaryNames, unresolved: un } = rewritePlanyrSyntax(raw, { rowIndex: row, columns: sh.columns });
      for (const u of un) unresolved.push({ sheetId: entry.id, sheetName: entry.name, key, name: u });
      if (!changed) continue;
      if (!cells) cells = { ...sh.cells };
      cells[key] = text;
      rewritten.push({ sheetId: entry.id, sheetName: entry.name, key, row, from: String(raw), to: text, columnRefs, pairs, unaryNames });
    }
    if (!cells) return entry;
    touched = true;
    return { ...entry, sheet: { ...sh, cells } };
  });
  return { workbook: touched ? { ...workbook, sheets } : workbook, rewritten, unresolved };
}

/** The one-line plain-words note shown when a load rewrote `[Column]` formulas (never silent). */
export function planyrSyntaxNote(rewritten) {
  const cols = rewritten.filter((r) => r.columnRefs).length, pairs = rewritten.filter((r) => r.pairs).length;
  const parts = [];
  if (cols) parts.push(`${cols} formula${cols === 1 ? "" : "s"} used [Column] names, which Excel and the grid do not understand — rewritten to ordinary cell references (same cells, same answers)`);
  if (pairs) parts.push(`${pairs} XIRR/XNPV formula${pairs === 1 ? "" : "s"} listed value, date, value, date… — rewritten to Excel's two-list form (same answer)`);
  const unary = rewritten.filter((r) => r.unaryNames).length;
  if (unary) parts.push(`${unary} formula${unary === 1 ? "" : "s"} had a minus sign straight before a name (=-Rate) — written =-(Rate), which reads the same and calculates correctly`);
  return parts.length ? `${parts.join("; ")}.` : "";
}
