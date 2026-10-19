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
