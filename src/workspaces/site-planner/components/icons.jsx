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

/* ── NEW-4 (B366389 ×2) — the PLAN MENU's icons, the surface the first sweep missed ──────────────
 *
 * Owner, on the earlier batch: *"let's improve the emojis for the rename and delete buttons. They
 * just look kinda like shit."* The plan switcher had the identical defect and was not in that pass:
 * a full-COLOUR emoji floppy `💾` on "Save now" sat directly above a flat text glyph `↺` on
 * "Version history…" and another, `🗄`, on "Storage on this device…" — three rows of one menu
 * rendering in three different visual families, two of them at the mercy of the platform font and
 * the coloured one ignoring its row's colour entirely. Same idiom as above, so the app ends with ONE
 * icon system rather than two rounds of partial cleanup.
 *
 * The `▾`/`▸` disclosure triangles are deliberately KEPT (B366389's recorded decision — monochrome
 * text on every platform, already inheriting colour). Do not "tidy" that away.
 */

// Save — the classic floppy outline, drawn. Replaces the 💾 emoji.
export const SaveIcon = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    style={{ flex: "none", display: "block" }}>
    <path d="M4.5 4.5h11L20 9v10.5H4.5z" />
    <path d="M8.5 4.5v5h7v-5" />
    <rect x="8" y="13" width="8" height="6.5" />
  </svg>
);

// Version history — a counter-clockwise arrow around a clock face. Replaces the `↺` text glyph.
export const HistoryIcon = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    style={{ flex: "none", display: "block" }}>
    <path d="M3.6 12a8.4 8.4 0 1 0 2.6-6.1" />
    <path d="M3.5 4v4.2h4.2" />
    <path d="M12 8v4.4l3 1.8" />
  </svg>
);

// Storage on this device — stacked platters. Replaces the `🗄` glyph.
export const StorageIcon = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    style={{ flex: "none", display: "block" }}>
    <ellipse cx="12" cy="6" rx="7.5" ry="2.8" />
    <path d="M4.5 6v12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V6" />
    <path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8" />
  </svg>
);

// Shared padlock, closed or open. Replaces the 🔒 / 🔓 emoji pair — which, being colour glyphs,
// were the only thing in the menu that could not follow its row's `--danger` / muted colour.
export const PadlockIcon = ({ size = 13, open = false }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    style={{ flex: "none", display: "block" }}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d={open ? "M8 11V8a4 4 0 0 1 7.5-2" : "M8 11V8a4 4 0 0 1 8 0v3"} />
  </svg>
);

// New plan. Replaces the fullwidth `＋`, which is a TEXT character whose width and weight vary by
// platform font — visibly heavier than the drawn icons it sat beside.
export const PlusIcon = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"
    style={{ flex: "none", display: "block" }}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

// Duplicate — two offset sheets. Replaces the `⧉` glyph, which many fonts do not carry at all
// (it then falls back to a substitute face, or to a hollow box).
export const DuplicateIcon = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    style={{ flex: "none", display: "block" }}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M15 6.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h.5" />
  </svg>
);

// A drawn ✕, for the per-row remove control that sits beside the icons above.
export const CloseXIcon = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"
    style={{ flex: "none", display: "block" }}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

/* ── TOOLBAR PASS (B727504) — Undo / Redo / Zoom-to-fit / Layers, rebuilt to standard toolbar
 * conventions instead of ad-hoc text glyphs (↶ ↷ ⤢ ❖). Owner-approved spec:
 *   - shapes are the shared Office/Google/Adobe convention, not anyone's proprietary artwork —
 *     these four paths are the actual Material Design Icons (Pictogrammers MDI) vectors, which
 *     are Apache-2.0 (free for commercial use, no attribution required); Microsoft's Fluent
 *     artwork files are never lifted.
 *   - fill="currentColor" on a single path (not the stroke idiom above) so the same path serves
 *     both themes with no per-theme variant.
 *   - Undo/Redo are drawn from ONE shared path pair that MDI itself ships as an exact mirror
 *     (verified point-for-point against the real MDI source: reflecting Undo's path across the
 *     viewBox's vertical centerline reproduces Redo's path exactly) — "if one is filled, both are
 *     filled" holds by construction, not by convention.
 */

// Undo — a counter-clockwise curved arrow. MDI "undo".
export const UndoIcon = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
    style={{ flex: "none", display: "block" }}>
    <path d="M12.5,8C9.85,8 7.45,9 5.6,10.6L2,7V16H11L7.38,12.38C8.77,11.22 10.54,10.5 12.5,10.5C16.04,10.5 19.05,12.81 20.1,16L22.47,15.22C21.08,11.03 17.15,8 12.5,8Z" />
  </svg>
);

// Redo — the exact horizontal mirror of UndoIcon's path. MDI "redo".
export const RedoIcon = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
    style={{ flex: "none", display: "block" }}>
    <path d="M18.4,10.6C16.55,9 14.15,8 11.5,8C6.85,8 2.92,11.03 1.54,15.22L3.9,16C4.95,12.81 7.95,10.5 11.5,10.5C13.45,10.5 15.23,11.22 16.62,12.38L13,16H22V7L18.4,10.6Z" />
  </svg>
);

// Zoom to fit — four arrows pointing OUTWARD to the corners. Deliberately not a magnifier glass
// (which reads as "zoom", not "fit", and would be confused with the separate zoom in/out
// controls). MDI "arrow-expand-all".
export const ZoomFitIcon = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
    style={{ flex: "none", display: "block" }}>
    <path d="M9.5,13.09L10.91,14.5L6.41,19H10V21H3V14H5V17.59L9.5,13.09M10.91,9.5L9.5,10.91L5,6.41V10H3V3H10V5H6.41L10.91,9.5M14.5,13.09L19,17.59V14H21V21H14V19H17.59L13.09,14.5L14.5,13.09M13.09,9.5L17.59,5H14V3H21V10H19V6.41L14.5,10.91L13.09,9.5Z" />
  </svg>
);

// Layers — two offset sheets seen in perspective, the mark Google Maps / Photoshop / Figma all
// use, so it needs no learning. Replaces the "❖" glyph, which some fonts render as a blank tofu
// box — indistinguishable from a shape tool, a stop button, or a crop. MDI "layers".
export const LayersIcon = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
    style={{ flex: "none", display: "block" }}>
    <path d="M12,16L19.36,10.27L21,9L12,2L3,9L4.63,10.27M12,18.54L4.62,12.81L3,14.07L12,21.07L21,14.07L19.37,12.8L12,18.54Z" />
  </svg>
);
