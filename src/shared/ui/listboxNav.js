/* listboxNav.js — THE one rule set for a typeahead suggestion list (address / place / party name / restaurant).
 *
 * Owner report 2026-10-29 (B<NEW-1 address-suggest-arrows>): "you can't use the up or down keys to pick one of the drop-down
 * suggestions. Or if it does work, I can't see it." MEASURED on planyr.io: the keys DID work (aria-activedescendant moved,
 * aria-selected flipped) — the highlighted row was painted `--surface-raised` on a `--surface-overlay` list, which are both
 * white in the light theme, so the highlight was drawn and was invisible. Every list rolled its own highlight and its own
 * arrow handling; this module is the one answer for both.
 *
 * Pure (no React, no DOM) so the rules are provable in a plain vitest run. The hook over it, `useListboxNav`, lives in controls.jsx (see the note there).
 *
 * THE POLICY, applied everywhere: Down from the box (nothing highlighted) enters at row 1; Up from the box enters at the LAST
 * row; both WRAP at the ends (never a dead stop); Enter picks the highlighted row (nothing highlighted → the caller's own
 * Enter, e.g. "search the raw text"); Escape closes the list and leaves the typed text alone; typing resets the highlight.
 */

/** Next highlighted index after a step. `current` is -1 for "nothing highlighted". Wraps; 0 rows → -1. */
export function stepListIndex(current, dir, count) {
  if (!count || count < 1) return -1;
  if (current < 0 || current >= count) return dir > 0 ? 0 : count - 1;
  return (current + (dir > 0 ? 1 : -1) + count) % count;
}

/** What a keydown means for an open/closed suggestion list.
 *  → "next" | "prev" | "commit" | "close" | null (null = not ours; the caller's own handling runs).
 *  Alt/Ctrl/Meta chords are never ours (Alt+Down is the browser's own "open list"). Up/Down with no rows is not ours either,
 *  so the caret keeps its normal Home/End-style behaviour in an empty list. Enter only commits a HIGHLIGHTED row of an OPEN list. */
export function listboxKeyAction(e, { open, count, active }) {
  if (!e || e.altKey || e.ctrlKey || e.metaKey) return null;
  if (e.key === "ArrowDown") return count > 0 ? "next" : null;
  if (e.key === "ArrowUp") return count > 0 ? "prev" : null;
  if (e.key === "Enter") return open && active >= 0 && active < count ? "commit" : null;
  if (e.key === "Escape") return open ? "close" : null;
  return null;
}

export const listboxOptionId = (base, i) => `${base}-opt-${i}`;

/** The highlighted row's look: a SOLID accent fill with its on-accent ink (house style — never an opacity fade, never a tint
 *  that lands on the list's own colour). Spread it AFTER the row's base style; an inactive row only gets a transparent fill so
 *  the list's own surface shows. `accent` / `ink` default to the app's active-row pair; a module passes its own
 *  (e.g. Food: `--accent-food` / `--on-accent-food`). Child text that has its own muted colour must inherit while active. */
export function listboxRowStyle(active, accent = "var(--accent)", ink = "var(--on-accent)") {
  return active ? { background: accent, color: ink } : { background: "transparent" };
}
