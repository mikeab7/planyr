/* The colour control: a current-colour CHIP that opens a compact picker popover.
 *
 * Owner rule (NEW-3, this round): the swatches do NOT live on the panel. The panel row carries
 * ONE thing — the chip showing the colour in force. Choosing a colour opens the picker, and the
 * picker is where the palette and the previously-used colours are. Before this, a permanent
 * recents row sat inline beside a native wheel: two control sizes and two different gaps
 * free-wrapping in one row, which is exactly the "off" spacing the owner called out. Now it is
 * ONE swatch size on ONE grid with ONE gap, and nothing wraps.
 *
 * Popover order, top to bottom:
 *   (a) the standard palette — the app's own default colours, on the grid;
 *   (b) a hairline divider;
 *   (c) RECENTLY USED — same size, same grid; the whole section is absent when you haven't used
 *       any (never padded out of the palette above it, which would make the list lie);
 *   (d) a quiet "Custom…" row that opens the native wheel for any colour not on the grid.
 *
 * CONSTRAINT, stated plainly: the wheel is the OS colour picker (`<input type="color">`). Nothing
 * can be injected into it — no browser lets a page add a row to that dialog. So "recents at the
 * bottom of the picker" is only reachable by replacing the always-visible native control with our
 * own popover and keeping the native wheel as the "Custom…" escape hatch inside it. That is what
 * this file does.
 *
 * Two commit paths, deliberately different (B567), both preserved exactly:
 *  · the wheel keeps live picking — recolors as you move through the palette, ONE undo frame per
 *    picking session (the caller's `livePick`, spread in through `pick`);
 *  · a swatch is a discrete click — applies immediately and takes exactly ONE undo frame, like any
 *    other discrete commit. Clicking three swatches = three undos.
 * The picking session also owns the recents entry: ONE per session, committed at the boundary
 * (`commitPick`), never one per intermediate shade (the NEW-4 bug).
 *
 * MODULE-SCOPE-COMPONENTS: defined here at module scope, never inside a render body.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import AnchoredMenu from "./AnchoredMenu.jsx";
import { getRecents, subscribeRecents, uniqueHexes, normalizeHex, commitPick } from "./colorRecents.js";

/** Live view of the shared recents list — only colours actually used, never padded. */
export function useColorRecents(max) {
  const [list, setList] = useState(getRecents);
  useEffect(() => subscribeRecents(setList), []);
  return uniqueHexes(list, max);
}

/* ONE size, ONE gap — the whole point of the layout fix. Both the palette and the recents
 * section are laid on this same grid, so the two sections read as one control. */
const SWATCH = 18;
const GAP = 5;
const COLS = 8;
const gridStyle = { display: "grid", gridTemplateColumns: `repeat(${COLS}, ${SWATCH}px)`, gap: GAP, justifyContent: "start" };
const capStyle = {
  fontSize: 9.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase",
  color: "var(--text-secondary)", margin: "0 0 5px",
};

/** Hatched fill for a multi-selection whose members disagree — a "Mixed" chip has no one colour. */
const MIXED_FILL = "repeating-linear-gradient(45deg, var(--surface-raised) 0 5px, var(--border-default) 5px 10px)";

function Swatch({ hex, current, onPick, label }) {
  return (
    <button type="button" data-swatch="1" title={hex} aria-label={label || `Use ${hex}`} aria-pressed={hex === current}
      onClick={() => onPick(hex)}
      style={{
        width: SWATCH, height: SWATCH, padding: 0, borderRadius: 3, background: hex,
        // The colour in force reads as chosen through a ring, not a fade — never low-contrast.
        border: hex === current ? "2px solid var(--text-primary)" : "1px solid var(--border-default)",
        cursor: "pointer",
      }} />
  );
}

/** The picker itself. Split out so the chip stays trivial and the grid math lives in one place. */
function ColorPicker({ palette, current, onPick, pick, onClose, testId }) {
  const recents = useColorRecents();
  const wheelRef = useRef(null);
  const gridRef = useRef(null);

  // Arrow-key roving across every swatch in the popover (palette + recents read as one grid),
  // so the control is fully usable without a mouse. Tab still steps through in DOM order.
  const onKeyDown = (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLS, ArrowUp: -COLS }[e.key];
    if (!step) return;
    const all = Array.from(gridRef.current?.querySelectorAll("[data-swatch]") || []);
    const i = all.indexOf(document.activeElement);
    if (i < 0) return;
    const next = all[Math.max(0, Math.min(all.length - 1, i + step))];
    if (next) { e.preventDefault(); next.focus(); }
  };

  return (
    <div ref={gridRef} onKeyDown={onKeyDown} data-testid={testId} style={{ padding: "9px 10px 8px" }}>
      <div style={capStyle}>Palette</div>
      <div style={gridStyle} role="group" aria-label="Palette colors">
        {palette.map((c) => <Swatch key={c} hex={c} current={current} onPick={onPick} />)}
      </div>

      {recents.length > 0 && (<>
        <div style={{ height: 1, background: "var(--border-default)", margin: "9px 0" }} />
        <div style={capStyle}>Recently used</div>
        <div style={gridStyle} role="group" aria-label="Recently used colors">
          {recents.map((c) => <Swatch key={c} hex={c} current={current} onPick={onPick} />)}
        </div>
      </>)}

      <div style={{ height: 1, background: "var(--border-default)", margin: "9px 0 7px" }} />
      {/* (d) the escape hatch: any colour the grid doesn't carry. The native wheel is kept for
          exactly this, and keeps its live-picking + one-undo-frame-per-session behaviour. */}
      <button type="button" data-testid={testId ? `${testId}-custom` : undefined}
        onClick={() => wheelRef.current?.click()}
        style={{
          display: "flex", alignItems: "center", gap: 7, width: "100%", padding: "4px 3px",
          border: "none", background: "transparent", cursor: "pointer", fontFamily: "inherit",
          fontSize: 11.5, fontWeight: 600, color: "var(--text-secondary)",
        }}>
        <span aria-hidden="true" style={{
          width: SWATCH, height: SWATCH, borderRadius: 3, border: "1px solid var(--border-default)",
          background: "conic-gradient(#ef4444,#eab308,#22c55e,#06b6d4,#3b82f6,#a855f7,#ef4444)",
        }} />
        Custom…
      </button>
      <input ref={wheelRef} type="color" value={current || "#808080"} aria-label="Custom color"
        {...{ onChange: () => {}, ...(pick || {}) }}
        onBlur={(e) => { pick?.onBlur?.(e); onClose?.(); }}
        style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }} />
    </div>
  );
}

export default function ColorField({
  value,               // current color (any CSS hex form)
  pick,                // spread from the caller's livePick(apply[, hist]) — drives the native wheel
  onSwatch,            // (hex) => void — discrete apply for a swatch click (caller pushes history)
  seed = [],           // the app's standard palette, rendered as the popover's top grid
  title,               // tooltip / accessible name for the chip
  style,               // chip style override (some panels use a smaller chip)
  mixed = false,       // multi-selection whose members disagree — no single colour to show
  disabled = false,
  "data-testid": testId,
}) {
  const cur = normalizeHex(value);
  const [open, setOpen] = useState(false);
  const chipRef = useRef(null);
  const palette = uniqueHexes(seed, 32);

  // Closing the picker ENDS the picking session, so the colour it settled on is recorded once.
  // (A blur alone can't be relied on: dismissing the popover unmounts the wheel.)
  const close = useCallback(() => { commitPick(); setOpen(false); }, []);
  useEffect(() => () => { commitPick(); }, []);

  return (
    <span style={{ display: "inline-flex", alignItems: "center", minWidth: 0 }}>
      <button ref={chipRef} type="button" title={title} aria-label={title || "Color"} data-testid={testId}
        aria-haspopup="dialog" aria-expanded={open} disabled={disabled}
        onClick={disabled ? undefined : () => setOpen((o) => !o)}
        style={{
          width: 34, height: 26, padding: 0, borderRadius: 6, flex: "0 0 auto",
          border: "1px solid var(--border-default)", background: mixed ? MIXED_FILL : (cur || value),
          cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1,
          ...(style || {}),
        }} />
      <AnchoredMenu open={open && !disabled} onClose={close} anchorRef={chipRef}
        placement="below-left" width={COLS * SWATCH + (COLS - 1) * GAP + 20}
        panelStyle={{
          background: "var(--surface-overlay)", border: "1px solid var(--border-default)",
          borderRadius: 10, boxShadow: "0 10px 30px rgba(0,0,0,0.24)",
        }}>
        <ColorPicker palette={palette} current={cur} pick={pick} onClose={close} testId={testId ? `${testId}-picker` : "color-picker"}
          onPick={(hex) => { onSwatch?.(hex); close(); }} />
      </AnchoredMenu>
    </span>
  );
}
