/* restaurantPanel — the pure rules behind the redesigned restaurant panel (NEW-1 / NEW-2, owner-approved mockup
 * 2026-10-20: "i like it all as is, send it"). No React, no Supabase — every function here is a plain read over
 * rows FoodApp already holds, so the panel, its tests and its harnesses all ask the SAME questions.
 *
 * ⛔ ONE NUMBER, ONE PRECISION (the mockup's own rule). The old panel showed "Food 8.3" in the top tile and "8.25" in the
 * visit row for the SAME value. Ratings are quarter steps, so every display of a rating goes through `formatRating`:
 * 8.25 → "8.25", 8 → "8.0", 9.5 → "9.5". dishAggregates.formatScore delegates here — there is no second formatter.
 *
 * ⛔ THE DISH LIST IS THE ORDER. There is no separate "The order" card any more: a dish's eat-again answer decides its
 * section — WHAT TO ORDER (yes), MAYBE (maybe or unanswered), SKIP (no, collapsed by default) — each sorted by score,
 * highest first. An empty section is not drawn.
 *
 * PRICE LEVEL is OpenTable-style $ … $$$$ (1–4), one value per restaurant, stored in food_place_prefs (db/food_place_prefs.sql).
 * Tapping the current level clears it. */

import { formatScore } from "./dishAggregates.js";

export const PRICE_LEVELS = [1, 2, 3, 4];

/** The exact quarter value, always with one decimal at least: 8.25 → "8.25", 8 → "8.0", 9.5 → "9.5", 7.75 → "7.75".
 *  null / non-finite → null (the caller's own placeholder decides what "no rating" looks like). The ONE implementation is
 *  dishAggregates.formatScore (that file must stay import-free); this is the same function under the name the panel uses. */
export const formatRating = formatScore;

/** The level after a tap on `tapped` (1–4): the current one clears, any other sets. */
export function nextPriceLevel(current, tapped) {
  if (!PRICE_LEVELS.includes(tapped)) return current ?? null;
  return current === tapped ? null : tapped;
}

/** "$$$" for 3, "" for unset — the plain-text reading of a level (the control itself draws the grey remainder). */
export function priceLevelText(level) {
  return PRICE_LEVELS.includes(level) ? "$".repeat(level) : "";
}

/** Line 2 of the header: "<cuisine> · <city>" — the price level is drawn as its own control after it. */
export function headerSubline({ cuisine, city }) {
  return [cuisine, city].filter(Boolean).join(" · ");
}

const scoreNum = (r) => (r.latestScore == null ? -1 : Number(r.latestScore));
const byScoreDesc = (a, b) => scoreNum(b) - scoreNum(a) || a.name.localeCompare(b.name);

/** Which section a dish row belongs to, from its LATEST eat-again answer. */
export function dishSectionOf(row) {
  if (row.order_again === "yes") return "order";
  if (row.order_again === "no") return "skip";
  return "maybe";
}

/** The three sections, each sorted by score (highest first; unscored last, then by name). */
export function dishSections(rows) {
  const out = { order: [], maybe: [], skip: [] };
  for (const r of rows || []) out[dishSectionOf(r)].push(r);
  for (const k of Object.keys(out)) out[k].sort(byScoreDesc);
  return out;
}

/** The one grey line under a dish name: its note (the caller truncates it), or — when it has been rated two or more
 *  times and has no note — its movement since the previous rating, or "Add a note" when there is nothing to say. */
export function dishSubline(row) {
  if (row.note) return { kind: "note", text: row.note };
  const prev = row.history && row.history[0];
  if (prev && row.latestScore != null && prev.score != null) {
    const was = Number(prev.score), now = Number(row.latestScore);
    const dir = now > was ? "up from last time" : now < was ? "down from last time" : "same as last time";
    return { kind: "movement", text: `Was ${formatRating(was)} · ${dir}` };
  }
  return { kind: "empty", text: "Add a note" };
}

/** A visit's one-line row as parts, so the row can set the date (secondary) apart from the scores (primary — NEW-1, 2026-10-27):
 *  [{ kind: "date", text }, { kind: "score", label: "Food", value: "8.25" }, …]. Missing scores are left out; a missing date reads "No date". */
export function visitRowParts(visit, formatDate) {
  const parts = [{ kind: "date", text: visit.visited_on ? formatDate(visit.visited_on) : "No date", undated: !visit.visited_on }];
  if (visit.rating != null) parts.push({ kind: "score", label: "Food", value: formatRating(visit.rating) });
  if (visit.rating_ambiance != null) parts.push({ kind: "score", label: "Ambiance", value: formatRating(visit.rating_ambiance) });
  return parts;
}

/** A visit's one-line row as plain text: "<date> · Food 8.25 · Ambiance 8.0" (the accessible name of the row). */
export function visitRowLabel(visit, formatDate) {
  return visitRowParts(visit, formatDate).map((p) => (p.kind === "date" ? p.text : `${p.label} ${p.value}`)).join(" · ");
}

export const VISITS_SHOWN = 2;

/** The two most recent visits (the incoming list is already newest-first), the rest behind "Show N more". */
export function visitsToShow(visits, expanded) {
  const all = visits || [];
  const shown = expanded ? all : all.slice(0, VISITS_SHOWN);
  return { shown, hidden: Math.max(0, all.length - shown.length) };
}

/** A dish's ratings for the sheet's history list — newest first, only when there are two or more. */
export function dishHistoryEntries(row) {
  const entries = [row, ...(row.history || [])];
  return entries.length >= 2 ? entries : [];
}
