/* Model workspace — Stage 3, part 2: named ranges (NEW-1).
 *
 * A user can give a cell or a range a name — LandCost instead of B17 — and use it in a formula
 * exactly where a cell reference would go. This module is the pure model: define / rename /
 * retarget / delete, the naming-rule validator, the structural-edit reshape (row/column
 * insert/delete), and the token-level formula rewrite a rename has to perform. It owns NO
 * evaluation or parsing of formulas beyond the token scan a rename/usage-count needs — resolving
 * a name AT eval time is the shared formula engine's job (src/shared/formula/formula.js's "name"
 * AST node + its own `ctx.names` contract), and dependency ordering is the EXISTING per-cell
 * graph in lib/sheetEngine.js (collectCellDeps's own "name" case) — this file builds neither.
 *
 * ⛔ SCOPE DECISION, stated explicitly per the build brief: names are WORKBOOK-scoped, not
 * sheet-scoped. Today the workbook IS exactly one sheet (`sheet.names`), so there is nothing to
 * disambiguate yet — every name is already effectively global. Workbook scope is also the
 * simpler, more common default for a first version (Excel's own default scope), and it avoids
 * inventing qualified-reference syntax (`Sheet1!LandCost`) for a multi-sheet feature that isn't
 * built yet. If/when the workbook gains multiple sheets (a concurrent session's own Stage 3
 * part 1), `sheet.names` is the one table every sheet's formulas already resolve against via
 * ctx.names — lifting it from "the current single sheet" to "the wrapping workbook object" is a
 * storage-location move, not a resolution-model change, which is exactly the shape the brief
 * asked this session to stay defensive about without building.
 *
 * STORAGE SHAPE: `sheet.names` is a plain object, keyed by the name's LOWERCASED text (case-
 * insensitive lookup, like Excel and like this engine's own [Column]/ctx.columns convention).
 * Each entry is `{ name, r1, c1, r2, c2 }` — `name` is the display-cased text as the user typed
 * it; r1/c1/r2/c2 are a 1-based, inclusive rectangle (r1<=r2, c1<=c2 — a single-cell name has
 * r1===r2 && c1===c2), the SAME 1-based convention formula.js's own "ref"/"range" AST nodes use
 * (parseRefText, colNumToLetters) — so `sheet.names` can be handed to evaluateFormula as
 * `ctx.names` with NO translation. The app's own selection state (SheetView/ModelApp's `selRange`,
 * parseNameBoxAddress) is 0-based; `rectFromSelRange`/`rectToSelRange` are the one conversion
 * point between the two conventions, so that translation never has to be repeated at each call
 * site.
 *
 * DELETE BEHAVIOUR, decided and stated per the brief: deleting a name does NOT block, and does
 * NOT rewrite the formulas that used it. A formula referencing a deleted name simply shows
 * #NAME? on the next recalc — exactly the error an ordinary unresolved identifier already shows,
 * because the deleted name is no longer in ctx.names and the shared engine's "name" resolution
 * falls through to that same #NAME? path with no special-casing needed. This mirrors how
 * deleting a COLUMN already works here (a formula referencing the deleted column's cells simply
 * shows #REF!/#NAME? on next recalc — never a blocking confirmation dialog), and it is
 * deliberately NOT a silent no-op: the Name Manager UI shows each name's live usage count before
 * a delete, so the user sees the blast radius without a modal standing in the way (KEY DECISIONS
 * — no dialog-box edits; this app never blocks with window.confirm).
 *
 * STRUCTURAL-EDIT RESHAPE: a row/column insert or delete elsewhere in the sheet has to shift a
 * name's OWN target rectangle the same way it already shifts a formula's cell references
 * (rewriteFormulaForStructuralShift) — otherwise a name silently keeps pointing at the wrong
 * cell the moment a row is inserted above it, exactly the "wrong number that looks right" class
 * this whole engine exists to prevent. `shiftNamesForStructuralChange` mirrors that function's
 * own interval-shift math (see its header) rather than reusing it directly, because a name's
 * rectangle is stored as {r1,c1,r2,c2} plain numbers, not formula source text to re-tokenize. A
 * shift that collapses a name's rectangle entirely (every row/column it named was deleted) drops
 * the name — its own formulas then read #NAME?, per the delete-behaviour decision above.
 */
import { parseRefText, colNumToLetters, tokenize, FUNCTION_NAMES } from "../../../shared/formula/formula.js";

const NAME_SHAPE_RE = /^[A-Za-z_][A-Za-z0-9_.]*$/;
const RESERVED_WORDS = new Set(["TRUE", "FALSE"]);
const FUNCTION_NAME_SET = new Set(FUNCTION_NAMES.map((n) => n.toUpperCase()));

/** A cell's own raw text is a formula iff it starts with "=" — the same predicate sheetModel.js
 *  exports as `isFormulaText`, duplicated here (rather than imported) to keep this module's only
 *  dependency the shared formula engine, not sheetModel.js — sheetModel.js is one of this task's
 *  explicitly high-traffic, small-footprint files, and importing FROM it here would make it the
 *  target of a circular import the moment sheetModel.js imports this module's structural-shift
 *  helper (which it does, below). One duplicated one-line predicate is cheaper than a cycle. */
const isFormulaText = (text) => String(text ?? "").trim().startsWith("=");

function normalizeRect(rect) {
  return {
    r1: Math.min(rect.r1, rect.r2), r2: Math.max(rect.r1, rect.r2),
    c1: Math.min(rect.c1, rect.c2), c2: Math.max(rect.c1, rect.c2),
  };
}

/** The app's 0-based selection range (SheetView/ModelApp's `selRange`) → a 1-based rect. */
export function rectFromSelRange(selRange) {
  return normalizeRect({ r1: selRange.r1 + 1, r2: selRange.r2 + 1, c1: selRange.c1 + 1, c2: selRange.c2 + 1 });
}
/** The inverse — a name's stored 1-based rect → a 0-based selection range (for "jump to target"). */
export function rectToSelRange(rect) {
  return { r1: rect.r1 - 1, r2: rect.r2 - 1, c1: rect.c1 - 1, c2: rect.c2 - 1 };
}
/** "B5" (single cell) or "B5:D5" (range) — the Name Manager's "Refers to" readout. */
export function rectToAddressText(rect) {
  const a = `${colNumToLetters(rect.c1)}${rect.r1}`;
  if (rect.r1 === rect.r2 && rect.c1 === rect.c2) return a;
  return `${a}:${colNumToLetters(rect.c2)}${rect.r2}`;
}

/** Naming rules, enforced with a specific reason per rejection (never a bare "invalid") — every
 *  one of these is checked against a normal-form regex/table, never re-derived per call site, so
 *  the Name Manager's live validation and any future caller agree by construction:
 *    - can't be empty
 *    - can't start with a digit
 *    - can't contain whitespace
 *    - can only use letters/digits/underscore/period, and must start with a letter or underscore
 *      (exactly the shape formula.js's own tokenizer accepts for a bare identifier — anything
 *      this validator accepts is therefore guaranteed to tokenize as a single "id" and resolve
 *      through the engine's new "name" AST node; anything it rejects could never be typed into a
 *      formula and mean this name in the first place)
 *    - can't be shaped like a cell address (A1, XFD1048576) — parseRefText is the engine's own
 *      single source of truth for that shape, reused here rather than a second, possibly-
 *      disagreeing regex
 *    - can't be TRUE/FALSE (the engine's own boolean literals)
 *    - can't be a built-in function name (SUM, IF, …) — legal to type, but "=SUM" bare (no
 *      parens) would permanently read as this function's own #NAME? error the moment it's
 *      followed by anything but "(", and "=SUM(...)" would always mean the FUNCTION, never this
 *      name — the ambiguity has no upside, so it's refused up front rather than left as a trap
 *    - must be UNIQUE within the workbook (case-insensitive), unless it's the name currently
 *      being edited (`excludeKey`) */
export function validateNameText(rawText, sheet, { excludeKey } = {}) {
  const text = String(rawText || "").trim();
  if (!text) return { ok: false, reason: "Give the name some text." };
  if (/^[0-9]/.test(text)) return { ok: false, reason: "A name can't start with a digit." };
  if (/\s/.test(text)) return { ok: false, reason: "A name can't contain spaces." };
  if (!NAME_SHAPE_RE.test(text)) {
    return { ok: false, reason: "A name can only use letters, numbers, underscores and periods, and must start with a letter or underscore." };
  }
  if (parseRefText(text)) return { ok: false, reason: `"${text}" looks like a cell address and can't be used as a name.` };
  const upper = text.toUpperCase();
  if (RESERVED_WORDS.has(upper)) return { ok: false, reason: `"${text}" is a reserved word and can't be used as a name.` };
  if (FUNCTION_NAME_SET.has(upper)) return { ok: false, reason: `"${text}" is already a built-in function name.` };
  const key = text.toLowerCase();
  const existing = sheet.names && sheet.names[key];
  if (existing && key !== excludeKey) return { ok: false, reason: `A name called "${existing.name}" already exists.` };
  return { ok: true, key, text };
}

/** Every defined name, sorted by display name — the Name Manager's list. Cheap: no formula
 *  scanning (see `nameUsageCount` for that, computed on demand per row, not on every list read). */
export function namesList(sheet) {
  const names = sheet.names || {};
  return Object.keys(names)
    .map((key) => ({ key, ...names[key] }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/** Define a NEW name (or overwrite one at the same key, wholesale — the Name Manager only ever
 *  calls this after `validateNameText` has already passed, matching sheetModel.js's own
 *  "mutators are pure setters, validation lives at the UI boundary" convention). `rect` is a
 *  1-based rectangle in either corner order. */
export function defineName(sheet, name, rect) {
  const trimmed = String(name).trim();
  const key = trimmed.toLowerCase();
  const names = { ...(sheet.names || {}), [key]: { name: trimmed, ...normalizeRect(rect) } };
  return { ...sheet, names };
}

/** Point an EXISTING name at a different cell/range — "renaming" the target rather than the name
 *  itself. A no-op if the name doesn't exist (defensive; the UI never calls this for one that
 *  doesn't). */
export function retargetName(sheet, name, rect) {
  const key = String(name).trim().toLowerCase();
  const entry = sheet.names && sheet.names[key];
  if (!entry) return sheet;
  return { ...sheet, names: { ...sheet.names, [key]: { ...entry, ...normalizeRect(rect) } } };
}

/** Delete a name outright — see the file header for why this never blocks and never rewrites
 *  the formulas that used it (they resolve to an honest #NAME? on the next recalc). */
export function deleteName(sheet, name) {
  const key = String(name).trim().toLowerCase();
  if (!sheet.names || !(key in sheet.names)) return sheet;
  const names = { ...sheet.names };
  delete names[key];
  return { ...sheet, names };
}

/** Every "id" token in `text` that is a genuine reference to `nameLower` (case-insensitive) —
 *  never one immediately followed by "(" (that's always a function CALL under this engine's own
 *  disambiguation rule — see formula.js's header — so it can never be THIS name, which
 *  `validateNameText` already refused to let collide with a real function name; the guard here
 *  is just defensive symmetry with that same rule, not a case that can currently occur). Shared
 *  by the rename-rewrite and the usage-count below so the two can never disagree about what
 *  counts as "using" a name. */
function nameTokenPositions(text, nameLower) {
  let toks;
  try { toks = tokenize(text); } catch { return []; }
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t !== "id" || t.v.toLowerCase() !== nameLower) continue;
    const nextTok = toks[i + 1];
    if (nextTok && nextTok.t === "op" && nextTok.v === "(") continue; // a function call, not this name
    out.push(t);
  }
  return out;
}

/** Rewrite every occurrence of `nameLower` in one formula's raw text to `newName`'s exact
 *  spelling — a token-level splice (same technique as formula.js's own rewriteFormulaForCopy/
 *  rewriteFormulaForStructuralShift: walk tokenize()'s output, splice only the matched spans,
 *  leave every other character byte-identical), so a rename never touches a same-named
 *  substring hiding inside a string literal or a [Column] reference. */
function rewriteNameInFormulaText(text, nameLower, newName) {
  const positions = nameTokenPositions(text, nameLower);
  if (!positions.length) return text;
  let out = "", cursor = 0;
  for (const t of positions) {
    out += text.slice(cursor, t.pos) + newName;
    cursor = t.pos + t.v.length;
  }
  out += text.slice(cursor);
  return out;
}

/** How many formula cells reference `name` right now — the Name Manager's delete-impact hint
 *  (see the file header on why delete never blocks: this is the non-blocking substitute). */
export function nameUsageCount(sheet, name) {
  const nameLower = String(name).trim().toLowerCase();
  let count = 0;
  for (const raw of Object.values(sheet.cells)) {
    if (!isFormulaText(raw)) continue;
    count += nameTokenPositions(raw, nameLower).length;
  }
  return count;
}

/** Rename a name — updates `sheet.names`' own key/display text AND rewrites every formula cell
 *  that referenced the OLD spelling to the new one, as one combined edit (one undo frame). A
 *  no-op if the name doesn't exist. Renaming to the same key (only the display CASE changed,
 *  e.g. "landcost" → "LandCost") still rewrites formula text, so every reference picks up the
 *  new casing too. */
export function renameName(sheet, oldName, newName) {
  const oldKey = String(oldName).trim().toLowerCase();
  const entry = sheet.names && sheet.names[oldKey];
  if (!entry) return sheet;
  const trimmedNew = String(newName).trim();
  const newKey = trimmedNew.toLowerCase();
  if (trimmedNew === entry.name) return sheet; // nothing actually changed

  let names;
  if (newKey === oldKey) {
    names = { ...sheet.names, [oldKey]: { ...entry, name: trimmedNew } };
  } else {
    names = { ...sheet.names };
    delete names[oldKey];
    names[newKey] = { ...entry, name: trimmedNew };
  }

  const oldLower = entry.name.toLowerCase();
  let cells = sheet.cells, changed = false;
  for (const [cellKey, raw] of Object.entries(sheet.cells)) {
    if (!isFormulaText(raw)) continue;
    const next = rewriteNameInFormulaText(raw, oldLower, trimmedNew);
    if (next !== raw) { if (!changed) cells = { ...cells }; cells[cellKey] = next; changed = true; }
  }
  return { ...sheet, names, cells };
}

/** Shift one name's target rectangle for a structural row/column insert/delete elsewhere on the
 *  sheet — the SAME interval-shift rule formula.js's rewriteFormulaForStructuralShift applies to
 *  a formula's own references (see that function's header for the worked cases), reproduced here
 *  over plain {min,max} numbers instead of re-tokenizing formula text, because a name's target is
 *  already stored as structured numbers, not source text.
 *    axis:  "row" | "col"
 *    at:    1-based index of the insertion point (insert) or the deleted line (delete)
 *    delta: +1 (insert a blank line BEFORE `at`) or -1 (delete the line AT `at`)
 *  Returns the shifted rect, or `null` if the shift collapsed it (every line the name named on
 *  this axis was deleted) — the caller drops the name entirely in that case (see the file header
 *  on why a collapsed name is dropped rather than kept as a dangling reference). */
function shiftRectForStructuralChange(entry, axis, at, delta) {
  const isRow = axis === "row";
  const min = isRow ? entry.r1 : entry.c1, max = isRow ? entry.r2 : entry.c2;
  let minN, maxN;
  if (delta > 0) {
    minN = min >= at ? min + 1 : min;
    maxN = max >= at ? max + 1 : max;
  } else {
    minN = min > at ? min - 1 : min;
    maxN = max >= at ? max - 1 : max;
  }
  if (minN > maxN || minN < 1) return null;
  return isRow ? { ...entry, r1: minN, r2: maxN } : { ...entry, c1: minN, c2: maxN };
}

/** Shift EVERY name in `names` (sheetModel.js's `sheet.names`, or undefined on a pre-names
 *  sheet) for one structural row/column change — called from sheetModel.js's insertRowAt/
 *  deleteRowAt/insertColumnAt/deleteColumn, the same four call sites that already shift every
 *  formula's own references. Returns the SAME `names` reference when nothing actually moved or
 *  collapsed, matching every other structural mutator's no-op-returns-input convention. */
export function shiftNamesForStructuralChange(names, axis, at, delta) {
  if (!names) return names;
  const out = {};
  let changed = false;
  for (const [key, entry] of Object.entries(names)) {
    const shifted = shiftRectForStructuralChange(entry, axis, at, delta);
    if (shifted) {
      out[key] = shifted;
      if (shifted.r1 !== entry.r1 || shifted.r2 !== entry.r2 || shifted.c1 !== entry.c1 || shifted.c2 !== entry.c2) changed = true;
    } else {
      changed = true; // collapsed — dropped
    }
  }
  return changed ? out : names;
}
