/* Design tokens — spacing scale, type scale, and standard control heights (B809906, 2026-08-27).
 *
 * Owner: "shouldn't we have some sort of bible for design definitions, we keep having different
 * radii on buttons and it seems like a design bible would fix this." He's right that the symptom
 * is real: an AUDIT-FIRST sweep of every <button> element in this app (738 of them, across 573
 * files) found the radius alone expressed as 15+ different raw numbers where a handful of tokens
 * would do — see /docs/DESIGN-TOKENS.md for the full numbers.
 *
 * ⛔ RADIUS lives in `radius.js`, NOT here — it already IS the single source of truth (B427411,
 * shipped 2026-08-06 after an earlier owner report of the same symptom), with its own CSS mirror
 * (`--radius-*` in index.css) and its own consumer contract (`controls.jsx`'s literal-value
 * mirror, guarded by test/notesModule.test.js). This file is additive: it covers the THREE
 * categories the radius work never touched — spacing, type, and control height — following the
 * exact same rule radius.js states in its own header: "these numbers are not invented — they are
 * the tree's own dominant values, promoted." Every value below is the modal (most common) real
 * value measured across every <button> element in the app, not a number picked by eye.
 *
 * ⛔ WHAT THIS FILE DOES NOT CLAIM: unlike radius (which the B809906 session also mechanically
 * applied wherever a raw number exactly matched a token — zero visual change, pure dedup), the
 * spacing and type values here are NOT yet retrofitted onto every existing button. Padding alone
 * measured 94 distinct raw strings across those 738 buttons — collapsing that onto one scale would
 * nudge real visual proportions on a large fraction of the app's surface, which is a redesign
 * decision the owner explicitly ruled out for this session ("do NOT redesign anything"). This file
 * is the target scale for NEW work and for a future, deliberately-scoped retrofit — see
 * /docs/DESIGN-TOKENS.md for the open question that needs an owner decision before that retrofit
 * can start (the "7" radius value, and how far to take the spacing/type convergence).
 */

// Control height — the modal values found for <button height:N> across the app split cleanly
// into three real tiers already (20-22 / 24-26 / 30), so this one converges easily onto a scale
// without changing what anything currently renders at: pick the tier nearest an existing height.
export const CONTROL_H = { sm: 22, md: 26, lg: 30 };

// Type scale — the app's buttons already run a fine, half-point ladder (10 through 14). The six
// steps below are every value used 10+ times on a <button> alone, kept as six rather than forced
// down to three or four: collapsing "10.5 vs 11 vs 11.5" onto one number is exactly the kind of
// judgement call PANEL-BREVITY and this item's own brief say to flag rather than decide silently.
export const FONT_SIZE = { xs: 10, sm: 10.5, base: 11, md: 11.5, lg: 12, xl: 12.5, xxl: 13, display: 14 };

// Spacing scale — a conventional 2px-rooted ladder matching the most common padding numbers
// measured on <button> elements (2/3/4/6/7/8/9/10/11/12/14/16 all appear repeatedly). Use these
// for new gap/margin/padding values; PAD in controls.jsx (sm/md/lg button padding PAIRS) is the
// higher-level convenience built from the same numbers and is unchanged by this file.
export const SPACE = { xxs: 2, xs: 4, sm: 6, md: 8, lg: 10, xl: 12, xxl: 16 };
