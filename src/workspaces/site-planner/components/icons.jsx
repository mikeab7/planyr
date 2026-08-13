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
