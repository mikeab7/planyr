/* NEW-1 — WHEN the pond optimizer is offered, and WHAT it does when clicked.
 *
 * THE BUG THIS MODULE EXISTS TO PREVENT (regression, 2026-07-28): the pond inspector's single
 * ⚡ Optimize pond button was mounted by `statusCards.findIndex(c => tone !== "ok")` — it rode
 * the FIRST NON-GREEN verdict row. That coupling was invisible until B1031 deliberately kept an
 * over-dug ledger GREEN (a surplus must never out-shout a shortfall) and B1032/B1036 demoted the
 * remaining amber states. On a plan where every row then read green there was no non-green row
 * for the button to attach to, so the optimizer silently VANISHED from the panel.
 *
 * The rule, stated once so it cannot drift back: THE OPTIMIZER IS A TOOL, NOT A REMEDY FOR A
 * FAILING ROW. Its availability is a question of POSSIBILITY (is there a drawn ring? is there a
 * known volume to size against? is the usable/dead split resolved?) and NEVER a question of
 * verdict tone. An over-provided pond arguably needs it MOST — that is exactly the case where
 * the basin can shrink and hand acreage back to the deal.
 *
 * Hence the two modes. Both are real work; neither is a no-op:
 *   • "solve"     — a ledger is short: solve elevations/outlet so storage counts (designPond).
 *   • "rightsize" — every ledger is covered: search for the smallest/shallowest basin that still
 *                   holds the requirement, and price the buildable land that recovers.
 *   • "draw"      — no pond drawn at all: place a right-sized one.
 *
 * OWNER DECISION (2026-07-28, amending the above): the optimizer is NOT a button to hunt for. In
 * the pond inspector it surfaces as ONE LINE, and only when there is a MATERIALLY BETTER
 * alternative to what the owner drew — "I want to lay out my buildings and then fill in with my
 * ponds." Three consequences, all load-bearing:
 *   • SILENCE IS INFORMATION. Nothing materially better → render NOTHING. No "no suggestions"
 *     line, no disabled control. (This is also PANEL-BREVITY: the default view earns every line.)
 *   • THE TOOL PROPOSES, NEVER AUTO-EDITS. Drawing is authorship: the suggestion is apply-gated
 *     and atomically undoable, and geometry the owner drew is never reshaped without that click.
 *   • The possibility gate below still decides WHETHER the search can run honestly at all; it is
 *     the material-delta test (materialAlternative) that decides whether it is worth a line.
 *
 * Pure; no DOM, no network. */

export const OPTIMIZE_LABEL = "⚡ Optimize pond";

export const OPTIMIZE_TITLE = {
  draw: "One click: draws a right-sized pond and solves its outlet.",
  solve: "One click: sets the pond's elevations and outlet so storage counts. Your drawn outline is never changed.",
  rightsize:
    "Your storage requirement is already covered. Optimize looks for a smaller or shallower basin that still holds it, and shows how much buildable land that would recover.",
};

/* Why the optimizer can't run right now. Each reason is a complete, plain-English sentence that
 * names the next action — it is rendered verbatim on the disabled button's tooltip. */
export const OPTIMIZE_BLOCKED = {
  "no-requirement":
    "No detention or floodplain-mitigation requirement is known for this site yet, so there's nothing to size the pond against. Run ↻ Re-check first.",
  "split-unknown":
    "This site's usable/dead pond split isn't known yet. Run ↻ Re-check, then Optimize can size against real numbers.",
};

const known = (v) => Number.isFinite(v) && v > 0;

/* Decide the optimizer affordance for ONE pond inspector panel.
 *
 * INPUTS ARE DELIBERATELY TONE-FREE. There is no `tone`, no `overdug`, no `statusCards` parameter
 * and there must never be one: that is the coupling this module was written to break. The only
 * thing the verdict contributes is WHICH JOB to run (solve vs rightsize), never WHETHER to offer
 * the tool at all.
 *
 * Returns { available, mode, label, title, reason }. */
export function optimizeAffordance({
  hasRing = false,
  detRequiredAcFt = null,
  mitRequiredAcFt = null,
  splitKnown = true,
  detShort = false,
  mitShort = false,
} = {}) {
  const withMode = (mode, extra = {}) => ({
    available: true,
    mode,
    label: OPTIMIZE_LABEL,
    title: OPTIMIZE_TITLE[mode],
    reason: null,
    ...extra,
  });
  const blocked = (code) => ({
    available: false,
    mode: null,
    label: OPTIMIZE_LABEL,
    title: OPTIMIZE_BLOCKED[code],
    reason: OPTIMIZE_BLOCKED[code],
    code,
  });

  // No pond drawn anywhere: the one path allowed to place geometry (it draws a right-sized basin).
  if (!hasRing) return withMode("draw");

  // Nothing to size against — a requirement of zero/unknown on BOTH ledgers. Disabled, never gone.
  if (!known(detRequiredAcFt) && !known(mitRequiredAcFt)) return blocked("no-requirement");

  // The ledger inputs themselves are unresolved: sizing would be against fabricated numbers.
  if (!splitKnown) return blocked("split-unknown");

  // Available. The verdict picks the JOB — it does not gate the tool.
  return withMode(detShort || mitShort ? "solve" : "rightsize");
}

/* How much land an alternative has to give back before it is worth spending a line of panel copy
 * on. Below this the "smaller" basin is search noise — inside the screening method's own error
 * bars — and saying so out loud would be worse than silence. */
export const MATERIAL_LAND_AC = 0.05;

/* Pick the ONE alternative worth showing from a lib/pondOptimizer.js result, or null.
 *
 * null is the common, correct answer: the owner drew a reasonable basin and there is nothing to
 * say. The caller renders NOTHING on null — never a "no suggestions" line. */
export function materialAlternative(opt, { minLandAc = MATERIAL_LAND_AC } = {}) {
  if (!opt || !opt.ok || !opt.best || !opt.base) return null;
  const base = Number.isFinite(opt.base.landTakeAc) ? opt.base.landTakeAc : null;
  const alt = Number.isFinite(opt.best.landTakeAc) ? opt.best.landTakeAc : null;
  if (base == null || alt == null) return null;
  const landSavedAc = base - alt;
  if (!(landSavedAc >= minLandAc)) return null;
  return { ...opt.best, landSavedAc: Math.round(landSavedAc * 1000) / 1000, baseLandTakeAc: base };
}

export default optimizeAffordance;
