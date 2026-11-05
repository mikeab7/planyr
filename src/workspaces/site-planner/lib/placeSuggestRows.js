/* placeSuggestRows.js — B831779 (NEW-4): the PURE decision half of PlaceSearchField.jsx.
 *
 * Split out so the two behaviours the owner called non-negotiable — Enter always working, and a
 * genuine no-match saying so — are provable in a plain vitest run with no browser, rather than
 * only inside the combobox component itself. `PlaceSearchField.jsx` is a thin wrapper over these.
 */

import { looksLikeTnParcelId } from "./tnParcelId.js";

/** Build the list of rows to render below the field, given the current fetch status. `status` is
 * one of 'idle' | 'loading' | 'ready' | 'nomatch' | 'unavailable' (see PlaceSearchField.jsx).
 * `results` is the (possibly empty) suggestion array; `text` is the raw typed string.
 *
 * Returns { rows, noMatchNote }: `rows` are the INTERACTIVE options, in keyboard-nav order;
 * `noMatchNote` is a display-only line (never a row a keyboard user can land on).
 *
 * (d) LOUD-FAILURE: a genuine no-match (status 'nomatch' — both providers answered, neither
 * found anything) gets its own two actions instead of just going quiet; a raw-search row is never
 * shown alongside it, so there is exactly one honest next step, not two overlapping ones. */
export function buildPlaceRows(status, results, text) {
  const t = (text || "").trim();
  /* NEW-2 (TN, 2026-10-21) — text that reads as a Tennessee parcel id leads with its own row: the geocoder has nothing useful to say about a
   * number, and a no-match note ("No matches for 156-027.00-000") would be false — the id search is exactly what Enter runs. */
  const idRow = t && looksLikeTnParcelId(t) ? [{ kind: "parcelId", text: t }] : [];
  if (status === "nomatch") {
    return {
      rows: [...idRow, { kind: "searchAnyway", text: t }, { kind: "dropPin" }],
      noMatchNote: idRow.length ? null : `No matches for "${t}".`,
    };
  }
  const rows = (results || []).map((hit) => ({ kind: "result", hit }));
  if (t) rows.push({ kind: "raw", text: t });
  return { rows: [...idRow, ...rows], noMatchNote: null };
}

/** (a) ENTER MUST ALWAYS WORK, including before any suggestion has arrived (a slow network must
 * never turn Enter into a dead key). Resolves what pressing Enter should DO, given the current
 * rows and which one (if any) is keyboard-highlighted:
 *   - an explicitly highlighted row wins, whatever it is;
 *   - otherwise, with text typed, Enter always falls through to a raw-text search — regardless of
 *     whether `rows` is empty (nothing has come back yet), mid-flight, or a genuine no-match;
 *   - with no text typed, there is nothing to search, so Enter is correctly a no-op (null).
 * Returns { type: 'result', hit } | { type: 'raw', text } | { type: 'dropPin' } | null. */
export function resolvePlaceEnter(rows, activeIndex, text) {
  const active = activeIndex >= 0 && activeIndex < (rows || []).length ? rows[activeIndex] : null;
  if (active) return rowToAction(active);
  const t = (text || "").trim();
  return t ? { type: "raw", text: t } : null;
}

function rowToAction(row) {
  if (row.kind === "result") return { type: "result", hit: row.hit };
  if (row.kind === "raw" || row.kind === "searchAnyway" || row.kind === "parcelId") return { type: "raw", text: row.text };
  if (row.kind === "dropPin") return { type: "dropPin" };
  return null;
}

/** Resolve a click/Enter commit on one specific row (the mouse-click path — no activeIndex
 * involved, the row itself was the target). Same action shape as resolvePlaceEnter. */
export function resolvePlaceRowCommit(row) {
  return rowToAction(row);
}
