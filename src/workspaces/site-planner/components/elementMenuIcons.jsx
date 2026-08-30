/* Element context-menu row icons (B845584 — the context-menu rebuild).
 *
 * A dedicated idiom from `icons.jsx`'s 24×24/stroke-2 family on purpose: the menu rebuild's brief
 * measured the app's own row/icon geometry from the live app and the owner-approved mockup at
 * 14×14 viewBox, stroke-width 1.3, in a 16px gutter — smaller and finer than every other icon family
 * in this file, because a context-menu row is denser than a button or a panel field. `currentColor`
 * is still the load-bearing part (a row's own text colour, incl. the danger-red Delete row, without
 * a second per-theme copy). Route-local, same reasoning as `icons.jsx`'s own header: every consumer
 * is the Site Planner's element context menu, so these bytes stay inside the planner's chunk.
 *
 * Where the owner's approved mockup (`Main.dc.html`, the "A+" artboard) drew a specific glyph —
 * Reshape, Bump-outs, the dock-zone "stack" mark, the four Arrange rows, Duplicate, Delete — the
 * path is reproduced here near-verbatim (recolored to `currentColor`). Every other row's icon is
 * new, drawn in the same stroke idiom so the menu reads as one family rather than "the four the
 * mockup covered plus whatever was lying around".
 */
const base = (size, extra) => ({
  width: size, height: size, viewBox: "0 0 14 14", fill: "none", stroke: "currentColor",
  strokeWidth: 1.3, "aria-hidden": "true", style: { flex: "none", display: "block", ...extra },
});

// Reshape — the mockup's hexagonal outline with two hollow corner handles.
export const ReshapeIcon = ({ size = 14 }) => (
  <svg {...base(size)}>
    <path d="M2.5 4.5 7 2l4.5 2.5v5L7 12 2.5 9.5z" />
    <circle cx="2.5" cy="4.5" r="1.1" fill="var(--surface-raised, #fff)" />
    <circle cx="11.5" cy="9.5" r="1.1" fill="var(--surface-raised, #fff)" />
  </svg>
);

// Reset footprint to rectangle — the reshape outline with a return arrow, so it reads distinct
// from plain Reshape rather than reusing the identical glyph for two different actions.
export const ResetFootprintIcon = ({ size = 14 }) => (
  <svg {...base(size)}>
    <rect x="2.3" y="2.3" width="9.4" height="9.4" rx="0.8" />
    <path d="M4.2 7.4a2.8 2.8 0 1 1 0.8 2" />
    <path d="M3.2 8.6 4.2 9.4l0.9-1.4" />
  </svg>
);

// Bump-outs — the mockup's stepped-corner glyph (two notches reading as a dock-corner bump-out).
export const BumpOutIcon = ({ size = 14 }) => (
  <svg {...base(size)}>
    <path d="M1.5 10.5v-7h4v2h3v-2h4v7z" />
  </svg>
);

// Dock zones — the mockup's three stacked horizontal bars (court / trailer / buffer, outward).
export const DockZonesIcon = ({ size = 14 }) => (
  <svg {...base(size)}>
    <path d="M2 3.5h10M2 7h10M2 10.5h10" />
  </svg>
);

// Group — two overlapping squares (a selection folded into one unit).
export const GroupIcon = ({ size = 14 }) => (
  <svg {...base(size)}>
    <rect x="2" y="2" width="7.5" height="7.5" rx="0.8" />
    <rect x="4.5" y="4.5" width="7.5" height="7.5" rx="0.8" />
  </svg>
);

// Ungroup — the same two squares, pulled apart.
export const UngroupIcon = ({ size = 14 }) => (
  <svg {...base(size)}>
    <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="0.8" />
    <rect x="7" y="7" width="5.5" height="5.5" rx="0.8" />
  </svg>
);

// Parking split — a stall divider between two rows.
export const SplitRowsIcon = ({ size = 14 }) => (
  <svg {...base(size)}>
    <path d="M2 2.5h10M2 11.5h10M4.5 2.5v9M7 2.5v9M9.5 2.5v9" />
  </svg>
);

// Properties — a short list with a dot lead, reading as "details" rather than "settings".
export const PropertiesIcon = ({ size = 14 }) => (
  <svg {...base(size)}>
    <circle cx="2.3" cy="3.2" r="0.6" fill="currentColor" stroke="none" />
    <circle cx="2.3" cy="7" r="0.6" fill="currentColor" stroke="none" />
    <circle cx="2.3" cy="10.8" r="0.6" fill="currentColor" stroke="none" />
    <path d="M4.5 3.2h8M4.5 7h8M4.5 10.8h6" />
  </svg>
);

// Copy — two offset outlines (distinct from Duplicate's solid+corner mark below).
export const CopyIcon = ({ size = 14 }) => (
  <svg {...base(size)}>
    <rect x="1.8" y="1.8" width="7.2" height="7.2" rx="0.8" />
    <path d="M5.6 5.6h6.6v6.6H5.6z" />
  </svg>
);

// Duplicate — the mockup's rounded square with a trailing corner sweep.
export const DuplicateIcon = ({ size = 14 }) => (
  <svg {...base(size)}>
    <rect x="1.8" y="1.8" width="7.5" height="7.5" rx="1" />
    <path d="M4.7 12.2h6a1.5 1.5 0 0 0 1.5-1.5v-6" />
  </svg>
);

// Lock — closed and open padlock, one path swapped on the `open` prop (same idiom as the app's
// existing 24×24 PadlockIcon, redrawn at 14×14/1.3 to match this menu's finer stroke).
export const LockIcon = ({ size = 14, open = false }) => (
  <svg {...base(size)}>
    <rect x="2.8" y="6.2" width="8.4" height="5.3" rx="1" />
    <path d={open ? "M4.6 6.2V4.6a2.4 2.4 0 0 1 4.5-1.2" : "M4.6 6.2V4.6a2.4 2.4 0 0 1 4.8 0v1.6"} />
  </svg>
);

// Align rotation — a compass-style return arrow around a centre dot.
export const AlignRotationIcon = ({ size = 14 }) => (
  <svg {...base(size)}>
    <path d="M2.2 7A4.8 4.8 0 1 1 3.7 10.4" />
    <path d="M2.1 4v3h3" />
    <circle cx="7" cy="7" r="0.6" fill="currentColor" stroke="none" />
  </svg>
);

// Attach — a paperclip.
export const AttachIcon = ({ size = 14 }) => (
  <svg {...base(size)}>
    <path d="M4.2 7.8 8.4 3.6a2 2 0 0 1 2.8 2.8L6.4 11a1.1 1.1 0 0 1-1.6-1.6l3.8-3.8a0.5 0.5 0 0 1 .7.7L5.6 9.9" />
  </svg>
);

// Detach — the same paperclip, broken.
export const DetachIcon = ({ size = 14 }) => (
  <svg {...base(size)}>
    <path d="M4.2 5.2 6.4 3a2 2 0 0 1 2.8 2.8L8 7" />
    <path d="M6.9 9 5.6 10.3a1.1 1.1 0 0 1-1.6-1.6L5.2 7.4" />
    <path d="M2 12l2-2M10 4l2-2" />
  </svg>
);

// Delete — the mockup's trash can (lid + basket + two lines already implied by the outline).
export const DeleteIcon = ({ size = 14 }) => (
  <svg {...base(size)} stroke="currentColor">
    <path d="M2.5 3.7h9M5.6 3.7V2.4h2.8v1.3M3.7 3.7l.6 7.9h5.4l.6-7.9" />
  </svg>
);

// ── Arrange (identical everywhere) — the mockup's four glyphs, recolored to currentColor. ──
export const BringToFrontIcon = ({ size = 14 }) => (
  <svg {...base(size)}>
    <path d="M3 2h8" />
    <path d="M4 10.5 7 7.5l3 3M4 7.5 7 4.5l3 3" />
  </svg>
);
export const BringForwardIcon = ({ size = 14 }) => (
  <svg {...base(size)}>
    <path d="M4 9 7 6l3 3" />
  </svg>
);
export const SendBackwardIcon = ({ size = 14 }) => (
  <svg {...base(size)}>
    <path d="M4 5 7 8l3-3" />
  </svg>
);
export const SendToBackIcon = ({ size = 14 }) => (
  <svg {...base(size)}>
    <path d="M4 3.5 7 6.5l3-3M4 6.5 7 9.5l3-3" />
    <path d="M3 12h8" />
  </svg>
);

// Pond settings — a small gear, replacing the ⚙ emoji.
export const PondSettingsIcon = ({ size = 14 }) => (
  <svg {...base(size)}>
    <circle cx="7" cy="7" r="2.1" />
    <path d="M7 2.4v1.3M7 11.3v1.3M2.4 7h1.3M11.3 7h1.3M3.5 3.5l.9.9M9.6 9.6l.9.9M3.5 10.5l.9-.9M9.6 4.4l.9-.9" />
  </svg>
);

// Pond sizing assistant — a ruler, replacing the 📐 emoji.
export const PondSizingIcon = ({ size = 14 }) => (
  <svg {...base(size)}>
    <path d="M2 9.5 9.5 2l2.5 2.5L4.5 12z" />
    <path d="M5.6 8.4 7 7M7.8 6.6l.9-.9M9.4 5l.9-.9" />
  </svg>
);

// Branch a road — a trunk line with a spur peeling off, tee'd.
export const RoadBranchIcon = ({ size = 14 }) => (
  <svg {...base(size)}>
    <path d="M2 7h10" />
    <path d="M7 7 10.5 11.5" />
  </svg>
);

// Turn into sidewalk / landscape buffer — two curved swap arrows.
export const SwapIcon = ({ size = 14 }) => (
  <svg {...base(size)}>
    <path d="M2.5 5h7.6M8.4 3l1.7 2-1.7 2" />
    <path d="M11.5 9H3.9M5.6 7l-1.7 2 1.7 2" />
  </svg>
);
