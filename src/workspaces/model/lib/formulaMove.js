/* Model workspace — "references follow a moved block" (Excel's cut-and-paste semantics).
 *
 * Cutting a block and pasting it elsewhere does NOT shift the moved formulas' own references (a
 * formula that read A1 still reads A1) — it re-points every reference that pointed INTO the block
 * (from any cell, on any sheet) at the block's new home. That is a different transform from
 * rewriteFormulaForCopy (relative shift) and rewriteFormulaForStructuralShift (row/column
 * insert/delete), so it lives here, built only on the shared engine's exported tokenizer.
 *
 * A reference — single cell or range — moves when EVERY cell it names is inside the moved block
 * (a range that only partly overlaps the block is left alone, as Excel does). `$` anchoring is
 * preserved. A reference's effective sheet is its qualifier, else `ownerSheetName`.
 */
import { tokenize, parseRefText, colNumToLetters } from "../../../shared/formula/formula.js";

const refText = ({ col, row, colAbs, rowAbs }) => `${colAbs ? "$" : ""}${colNumToLetters(col)}${rowAbs ? "$" : ""}${row}`;

function qualifierAt(toks, idx) {
  const t = toks[idx];
  if (!t || (t.t !== "id" && t.t !== "sheetq")) return null;
  const bang = toks[idx + 1];
  if (!bang || bang.t !== "op" || bang.v !== "!") return null;
  return { name: t.v, refIdx: idx + 2 };
}

/** `rect` is 1-based `{ r1, r2, c1, c2 }` on `movedSheetName`; the block moves by (dRow, dCol). */
export function rewriteFormulaForMove(formulaSrc, ownerSheetName, movedSheetName, rect, dRow, dCol) {
  const text = String(formulaSrc == null ? "" : formulaSrc);
  if (!text.startsWith("=") || (dRow === 0 && dCol === 0)) return text;
  let toks;
  try { toks = tokenize(text); } catch { return text; }
  const norm = (n) => String(n || "").replace(/^'|'$/g, "").trim().toLowerCase();
  const isRefEligible = (t, idx) => {
    if (t.t === "ref") return true;
    if (t.t !== "id") return false;
    const next = toks[idx + 1];
    if (next && next.t === "op" && next.v === "(") return false;
    const up = t.v.toUpperCase();
    if (up === "TRUE" || up === "FALSE") return false;
    return parseRefText(t.v) !== null;
  };
  const inside = (info) => info.row >= rect.r1 && info.row <= rect.r2 && info.col >= rect.c1 && info.col <= rect.c2;
  const shifted = (info) => refText({ ...info, col: info.col + dCol, row: info.row + dRow });
  let out = "", cursor = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t === "eof") continue;
    const qual = qualifierAt(toks, i);
    const refIdx = qual ? qual.refIdx : i;
    const refTok = toks[refIdx];
    if (!refTok || !isRefEligible(refTok, refIdx)) continue;
    const isRange = toks[refIdx + 1] && toks[refIdx + 1].t === "op" && toks[refIdx + 1].v === ":" &&
      toks[refIdx + 2] && isRefEligible(toks[refIdx + 2], refIdx + 2);
    const endTok = isRange ? toks[refIdx + 2] : refTok;
    const spanEnd = endTok.pos + String(endTok.v).length;
    const effective = qual ? qual.name : ownerSheetName;
    i = isRange ? refIdx + 2 : refIdx;
    if (norm(effective) !== norm(movedSheetName)) continue;
    const a = parseRefText(refTok.v), b = isRange ? parseRefText(endTok.v) : a;
    if (!a || !b || !inside(a) || !inside(b)) continue;
    const replacement = isRange ? `${shifted(a)}:${shifted(b)}` : shifted(a);
    out += text.slice(cursor, refTok.pos) + replacement;
    cursor = spanEnd;
  }
  return out + text.slice(cursor);
}
