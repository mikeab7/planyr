/* Model workspace — the computed values of a workbook as PLAIN data (NEW-1, one formula engine).
 *
 * lib/univerEval.js (Univer's engine, run headless) is the one evaluator. Its answer has to cross a Web Worker boundary to reach the
 * Excel writer (lib/xlsxIO.js runs in lib/spreadsheetWorker.js), and a structured clone loses object identity — the older value
 * model's BLANK is an identity-compared singleton — so the answer travels as `values`, a JSON-safe table, and is turned back into
 * the `get(sheetId).get(row, col)` shape on the other side. No Univer import here: this file is worker-safe and tiny. */
import { BLANK, isBlank, isDate, errVal, isErrVal } from "../../../shared/formula/formula.js";

/** `{ get(sheetId) → { get(row, col) → { ok, value, error, detail } | null } }` → `{ [sheetId]: { "row:col": record } }`. */
export function evalToPlain(cellsBySheet) {
  const out = {};
  for (const [sheetId, cells] of Object.entries(cellsBySheet)) {
    const t = {};
    for (const [key, rec] of cells) {
      if (!rec.ok) { t[key] = { ok: false, error: rec.error, detail: rec.detail || "" }; continue; }
      const v = rec.value;
      t[key] = { ok: true, value: isBlank(v) ? { k: "blank" } : isDate(v) ? { k: "date", s: v.s } : isErrVal(v) ? { k: "error", code: v.code } : v };
    }
    out[sheetId] = t;
  }
  return out;
}

/** The inverse: a plain table → the evaluator shape every reader (displayFor, the CSV writer, the Excel writer) already takes. */
export function evalFromPlain(values) {
  return {
    get(sheetId) {
      const t = (values && values[sheetId]) || {};
      return {
        get(row, col) {
          const rec = t[`${row}:${col}`];
          if (!rec) return null;
          if (!rec.ok) return { ok: false, error: rec.error, detail: rec.detail || "" };
          const v = rec.value;
          if (v && typeof v === "object" && v.k === "blank") return { ok: true, value: BLANK };
          if (v && typeof v === "object" && v.k === "error") return { ok: true, value: errVal(v.code) };
          return { ok: true, value: v };
        },
      };
    },
  };
}

/** "B23" — the A1 address of a 0-based row/column. */
const a1 = (row, col) => { let n = col + 1, s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return `${s}${row + 1}`; };

/** The plain-words notice for cells caught in a circular reference. Univer — like Excel — calculates them as 0, which looks like a real
 *  answer; every reader that shows or writes a number says so out loud (the grid after a calculation, the Excel and CSV exports). */
export function circularNotice(circular) {
  if (!circular || !circular.length) return "";
  const shown = circular.slice(0, 4).map((c) => `${c.sheetName}!${a1(c.row, c.col)}`).join(", ");
  const more = circular.length > 4 ? ` and ${circular.length - 4} more` : "";
  return `${circular.length} cell${circular.length === 1 ? " is" : "s are"} in a circular reference (${shown}${more}) — they show 0, as in Excel; their answers are not real until the loop is broken.`;
}
