/* Small stroke icons shared by the Site Planner's panel components.
 *
 * NEW-3 — why this file exists. The planner used the 📍 EMOJI as an icon in four places: two button
 * labels ("📍 Set this plan's location", "📍 Move to a different spot…") and two status badges
 * (JurisdictionBadge, ParcelInfoCard). An emoji resolves to a full-COLOUR glyph from whatever font
 * the OS picks, so it (a) doesn't belong to the same visual family as the monochrome text and SVG
 * icons beside it, (b) ignores the theme token its own row is painted in, and (c) changes shape
 * between Windows, macOS and Linux. ParcelInfoCard was the clearest case: ONE status slot rendered
 * `📍` / `○` / `⚠` — a colour emoji and two text glyphs, in the same 13px box.
 *
 * Route-local on purpose: every consumer is a Site Planner panel, so these bytes stay inside the
 * planner's chunk. ⛔ Do not move this to `shared/ui/` — that lands in the entry chunk EVERY route
 * downloads, and this repo's bundle audit fails on exactly that (see src/shared/CLAUDE.md).
 *
 * Idiom, matched to ProjectBreadcrumb.jsx's icon set: 24×24 viewBox, `fill="none"`,
 * `stroke="currentColor"`, rounded joins, `display:block`. `currentColor` is the load-bearing part —
 * an icon inherits its row's colour instead of fighting it.
 */

// A map pin. Anchor point is the tip, which is what "this plan's location" means.
export const PinIcon = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    style={{ flex: "none", display: "block" }}>
    <path d="M12 21.5s7-6.6 7-11.5a7 7 0 1 0-14 0c0 4.9 7 11.5 7 11.5z" />
    <circle cx="12" cy="10" r="2.4" />
  </svg>
);

// The "nothing found here" counterpart to PinIcon — an empty ring, drawn rather than the `○`
// character, so the two states in one status slot are the same weight and the same family.
export const EmptyCircleIcon = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" aria-hidden="true"
    style={{ flex: "none", display: "block" }}>
    <circle cx="12" cy="12" r="7.5" />
  </svg>
);

// Warning triangle. Replaces `⚠`, which most platforms render as a colour emoji that then ignores
// the `--warn-text` token the surrounding row is deliberately set in.
export const WarnTriangleIcon = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    style={{ flex: "none", display: "block" }}>
    <path d="M12 4L2.5 20h19z" />
    <path d="M12 10v4.5M12 17.4v.1" />
  </svg>
);
