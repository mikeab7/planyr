/* The Grading panel's view model — what the panel shows, as data, so it is testable without a DOM (NEW-1).
 * It only READS the model GradingController already publishes; it never starts or restarts a build.
 *
 *   loading — the controller has not published yet ("Reading the ground…" / "…" as shipped)
 *   empty   — a model, but no building on the plan: one line, and the Ground section still shows
 *   cards   — one card per building (the selected one expanded, the others one line each — the controller sets `focus`)
 */
export const EMPTY_LINE = "Place a building to grade it.";
export const LOADING_LINE = "Reading the ground…";

export function gradingPanelView(model) {
  if (!model) return { state: "loading", cards: [], line: LOADING_LINE, noSetback: false };
  const cards = Array.isArray(model.cards) ? model.cards : [];
  const noSetback = !!(model.setback && model.setback.usingPropertyLine);
  if (!cards.length) return { state: "empty", cards: [], line: EMPTY_LINE, noSetback };
  return { state: "cards", cards, line: null, noSetback };
}

/* ROUND 8 (NEW-2) — the words for the line the grading may not cross: the property line less the grading margin and any
 * undisturbed buffer (never the setback). `basis` = grid.limit.basis ({ marginFt, bufferFt }); null reads as the defaults. */
const ftWord = (v) => `${Math.round(v * 10) / 10} ft`;
export function limitBasisPhrase(basis) {
  const m = basis && Number.isFinite(basis.marginFt) ? basis.marginFt : 10;
  const b = basis && Number.isFinite(basis.bufferFt) ? basis.bufferFt : 0;
  const parts = [m > 0 ? `${ftWord(m)} margin` : "no margin"];
  if (b > 0) parts.push(`${ftWord(b)} buffer`);
  return `to the property line (${parts.join(", ")})`;
}
/* Where a slope that leaves the graded area lands: on the neighbour's land, in the buffer, or in the working margin. */
export function limitCrossPlace(basis, beyondParcel) {
  if (beyondParcel) return "past the property line";
  const b = basis && Number.isFinite(basis.bufferFt) ? basis.bufferFt : 0;
  return b > 0 ? "into the buffer" : "into the grading margin";
}
