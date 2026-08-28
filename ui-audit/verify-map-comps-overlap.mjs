#!/usr/bin/env node
/* RETIRED — B831777 (NEW-2, 2026-08-28): the defect class this harness guarded no longer exists.
 *
 * This rig verified the Comps toggle pill (top-right corner) against the Layers panel it shared
 * that corner with (B814913's overlap fix, B814913/NEW-2's width-matching fix, B649136's shape
 * convergence). Per the owner's chosen toolbar/rail redesign, Comps moved OFF the right side
 * entirely — it is now a tab in the LEFT rail beside Sites (see MapFinder.jsx's rail block and
 * shared/comps/components/CompsPanel.jsx's `embedded` rendering). There is no more `[data-testid
 * ="map-comps-toggle"]` for this file's checks to find, and the corner it used to fight the
 * Layers panel for has exactly one occupant again.
 *
 * DEDUPE-FIRST: this does not reopen B814913/B814914/B649136 — their fixes were correct for the
 * shape they described and shipped; the shape itself was superseded by this redesign, not broken.
 *
 * The shape/overlap questions THIS cluster raises now (does the rail collide with the toolbar or
 * the Layers panel corner at any width, do the switch/rail-tab/checkbox radii converge, does the
 * suggestion combobox behave) are covered by `ui-audit/verify-map-toolbar-rebuild.mjs` — run that
 * instead. This file is kept (rather than deleted) only so a stale reference to it in
 * BACKLOG-DONE.md still resolves to an explanation instead of a 404.
 *
 *   node ui-audit/verify-map-comps-overlap.mjs   — prints this note and exits 0.
 */
console.log("verify-map-comps-overlap.mjs is RETIRED (B831777/NEW-2) — the Comps corner chip it checked was removed; Comps is now a left-rail tab.");
console.log("Run ui-audit/verify-map-toolbar-rebuild.mjs instead.");
process.exitCode = 0;
