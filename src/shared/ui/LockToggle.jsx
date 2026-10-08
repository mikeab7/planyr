import { IconButton } from "./controls.jsx";

/* THE lock control (B-NEW-2, owner 2026-10-08: "make it greyscale everywhere").
 *
 * Two pieces, one source for every lock in the app — properties panels, the context menus,
 * the on-canvas "this is locked" cue, the parcel/overlay rows:
 *   · LockGlyph  — the drawn padlock. GREYSCALE ONLY, never a colour (the old 🔒/🔓 emoji
 *                  rendered yellow, and a stroke-only icon on an accent fill read as the brand
 *                  colour). State is carried by SHAPE and WEIGHT (never by colour, never by fading) —
 *                  locked   = closed shackle + SOLID filled body in the stronger grey token
 *                  unlocked = open shackle + OUTLINE-only body in the lighter grey token
 *   · LockToggle — the square icon button that wraps it (aria-pressed, no accent fill when on).
 *
 * Tokens only: `--lock-locked` / `--lock-open` (neutral greys, defined in index.css for both themes).
 * Do not add a second padlock anywhere: extend this one. Guard: test/lockGreyscale.test.js. */

export const LOCK_GREY_LOCKED = "var(--lock-locked)";
export const LOCK_GREY_OPEN = "var(--lock-open)";

export function LockGlyph({ locked = false, size = 14, style }) {
  const c = locked ? LOCK_GREY_LOCKED : LOCK_GREY_OPEN;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-lock-glyph={locked ? "locked" : "open"}
      style={{ flex: "none", display: "block", ...style }}>
      <rect x="5" y="11" width="14" height="9" rx="2" fill={locked ? c : "none"} />
      <path d={locked ? "M8 11V8a4 4 0 0 1 8 0v3" : "M8 11V8a4 4 0 0 1 7.5-2"} />
    </svg>
  );
}

/* The on-canvas cue (SVG <g>, canvas units): a small greyscale padlock centred at (x, y). Same
 * drawing as LockGlyph so the canvas and the panels cannot disagree. */
export function LockCue({ x, y, size = 13, ...rest }) {
  const k = size / 24;
  return (
    <g data-lock-cue="1" transform={`translate(${x - size / 2} ${y - size}) scale(${k})`} {...rest}>
      <rect x="5" y="11" width="14" height="9" rx="2" fill={LOCK_GREY_LOCKED} stroke={LOCK_GREY_LOCKED} strokeWidth="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke={LOCK_GREY_LOCKED} strokeWidth="2" strokeLinecap="round" />
    </g>
  );
}

export function LockToggle({ locked, onToggle, label = "", size = 30, testId, style }) {
  const noun = label ? ` ${label}` : "";
  const text = locked ? `Unlock${noun}` : `Lock${noun}`;
  return (
    <IconButton type="button" size={size} data-testid={testId} aria-pressed={!!locked} aria-label={text} title={text}
      style={style}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}>
      <LockGlyph locked={!!locked} size={Math.round(size * 0.5)} />
    </IconButton>
  );
}
