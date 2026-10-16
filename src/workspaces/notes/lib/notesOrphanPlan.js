/* notesOrphanPlan — PURE: what to do with every body that has no node (NEW-1, 2026-10-16).
 *
 * ⛔ EXHAUSTIVE BY CONSTRUCTION. Every id handed in ends in EXACTLY ONE outcome, so the effect
 * in Notes.jsx has no "none of the above" path that leaves a finding standing:
 *   adopted  a live body with no node → given a node under "Not in a project"
 *   binned   a server-deleted body inside its 30-day window → back into the bin
 *   purged   a deliberately deleted body (tombstoned, or past the window) → finish the purge
 *   settled  it already has a home by the time we look (a race) → nothing to do
 * The FIFTH outcome, "write-refused", is not decided here: only the caller knows whether
 * `writeTree` returned false. The bar may claim a refused write off that signal alone.
 *
 * ⛔ A TOMBSTONED ID IS A PURGE TO FINISH, NEVER A LOST NOTE. The tree's ledger says the user
 * (or a prior session) already decided; adopting it would un-delete it. */
import { adoptDeletedOrphans, adoptUnreachable, tombstoneIds } from "./notesModel.js";

export function planOrphanResolution(tree, unreachable = [], purgedLeftovers = [], opts = {}) {
  const dead = tombstoneIds(tree);
  const purgeSet = new Set();
  for (const id of purgedLeftovers || []) if (id) purgeSet.add(id);
  const live = [], deleted = [];
  for (const o of unreachable || []) {
    if (!o?.pageId) continue;
    if (dead.has(o.pageId)) purgeSet.add(o.pageId);
    else if (Number.isFinite(o.deletedAt)) deleted.push(o);
    else live.push(o);
  }
  let next = tree;
  let adopted = [];
  if (live.length) {
    const r = adoptUnreachable(next, live, opts);
    next = r.tree; adopted = r.adopted;
  }
  let binned = [];
  if (deleted.length) {
    const r = adoptDeletedOrphans(next, deleted, opts);
    next = r.tree; binned = r.binned;
    for (const id of r.purge) purgeSet.add(id);
  }
  const outcome = {};
  for (const id of purgeSet) outcome[id] = "purged";
  for (const a of adopted) outcome[a.pageId] = "adopted";
  for (const b of binned) outcome[b.pageId] = "binned";
  for (const o of [...live, ...deleted]) {
    if (outcome[o.pageId]) continue;
    outcome[o.pageId] = "settled";   // already homed / tombstoned by the time we looked
  }
  return { tree: next, adopted, binned, purge: [...purgeSet], outcome, changed: next !== tree };
}
