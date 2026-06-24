/* Shared tool REGISTRY + arm policy (B423 / NEW-2).
 *
 * Encodes the one sanctioned behavioral divergence between the workspaces: what happens to
 * the active tool AFTER a markup is committed.
 *   • Site Planner ("site")  → REVERTS to Select (its long-standing feel: draw one, fall
 *                              back to the pointer).
 *   • Document Review ("doc") and the Stitcher ("stitch") → REUSE (stay armed to draw
 *                              another of the same, Bluebeam-style).
 * The shared interaction model (NEW-8) reads `nextToolAfterCommit` so neither host hard-codes
 * the rule. Also maps the Site Planner's prefixed tool ids (`mline`/`mrect`/…) to the
 * canonical matrix ids so both speak the same vocabulary. Pure: matrix only.
 */
import { toolById } from "./tools.matrix.js";

/** Per-workspace arm policy after a commit. */
export const ARM_POLICY = { site: "revert", doc: "reuse", stitch: "reuse" };

/** Site Planner tool id ⇄ canonical matrix id (its markup tools carry an `m` prefix). */
export const SITE_TOOL_ALIAS = {
  mline: "line", mrect: "rect", mellipse: "ellipse", mpolygon: "polygon", mpolyline: "polyline",
};
const SITE_TOOL_ALIAS_INV = Object.fromEntries(Object.entries(SITE_TOOL_ALIAS).map(([k, v]) => [v, k]));

/** Resolve any host's tool id to the canonical matrix id. */
export const canonicalToolId = (id) => SITE_TOOL_ALIAS[id] || id;

/** The id a workspace uses to ARM a canonical tool (Site re-prefixes its markup tools). */
export function hostToolId(canonicalId, workspace) {
  if (workspace === "site" && SITE_TOOL_ALIAS_INV[canonicalId]) return SITE_TOOL_ALIAS_INV[canonicalId];
  return canonicalId;
}

/* The tool that should be active AFTER committing `toolId` in `workspace`. "reuse" keeps the
 * same tool armed; "revert" drops back to Select. A pointer mode (select/pan/calibrate)
 * never changes. */
export function nextToolAfterCommit(toolId, workspace) {
  const canon = canonicalToolId(toolId);
  const row = toolById(canon);
  if (!row || row.category === "mode") return toolId; // modes don't auto-switch
  return (ARM_POLICY[workspace] || "reuse") === "revert" ? hostToolId("select", workspace) : toolId;
}
