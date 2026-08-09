/* On-canvas "View" menu (B653) — the eye-icon card holding the what-you-see toggles
 * (dock doors, column grid, dimensions, areas) and the drawing aids (grid size, snap)
 * that used to hide inside the old Setup panel. View state now lives on the canvas it
 * affects, and the left-rail panel became pure "Standards" (starting values for new
 * elements). Snap's ONE interactive home is here — the top-bar duplicate was removed
 * with this card (B653); the S key still toggles it, and the collapsed header shows a
 * live "Snap N′" chip so the state stays glanceable without opening the card.
 *
 * ⛔ B286000 — SMOOTH ZOOM LIVES HERE, and the rule it encodes is worth keeping: THIS CARD IS
 * WHERE PER-DEVICE VIEW AND RENDERING BEHAVIOUR GOES. B1449 shipped the toggle into the PLAN
 * menu (the flyout off the plan name in the breadcrumb), which is otherwise entirely plan-scoped
 * — plan name, plans in this site, New plan, Duplicate, Save now, Version history — and which
 * carries no visible label anywhere in the UI, so there was nothing to read that would tell you
 * a rendering preference might be in there. The owner could not find it. Smooth zoom follows
 * neither the plan, the project nor the account: it is a per-DEVICE preference persisted in
 * localStorage under `smoothZoom`. The relocation changed nothing else — same key, same
 * default (on), same `disarmViewAnchor()` on turn-off, same `data-testid`, same title text.
 * Guard: the repo-root `test/` suite **smoothZoomHome** (both directions — present here, absent
 * from the plan menu) + the e2e spec **smooth-zoom-view-menu** (the real card, driven).
 * Card anatomy mirrors the Layers card next to it; `pal` is the planner's theme-mapped
 * palette (theme tokens only — B341), and data-export="skip" rides on the shared
 * top-right container so exports never include canvas chrome.
 */

import { useEffect, useRef, useState } from "react";

// Same 13px eye as the planner's per-overlay visibility toggle (B277) — redeclared here
// because SitePlanner.jsx keeps its icons file-private and importing back from the
// planner would be circular.
const EyeIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
  </svg>
);

// Commit-on-Enter/blur numeric field — the same semantics as the planner's file-private
// NumInput (edit freely, parse + clamp only on commit) so the Grid field can't half-apply.
function GridNumInput({ value, min = 1, max = 1000, style, onCommit }) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const editing = useRef(false);
  useEffect(() => { if (!editing.current) setDraft(value == null ? "" : String(value)); }, [value]);
  const commit = () => {
    editing.current = false;
    const n = parseFloat(draft);
    if (!Number.isFinite(n)) { setDraft(value == null ? "" : String(value)); return; }
    const v = Math.min(max, Math.max(min, n));
    setDraft(String(v));
    if (v !== value) onCommit(v);
  };
  return (
    <input type="text" inputMode="decimal" value={draft} style={style}
      onFocus={() => { editing.current = true; }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); e.target.blur(); } if (e.key === "Escape") { editing.current = false; setDraft(value == null ? "" : String(value)); e.target.blur(); } }} />
  );
}

export default function ViewMenu({ open, onToggle, settings, setSnap, patchSettings, pal, smoothZoom, onSmoothZoom }) {
  const row = { display: "flex", gap: 7, alignItems: "center", cursor: "pointer", fontSize: 12.5, color: pal.ink, padding: "3px 0" };
  const numInput = { width: 52, padding: "4px 6px", fontSize: 12, fontFamily: "inherit", color: pal.ink, background: "var(--surface-raised)", border: `1px solid ${pal.panelLine}`, borderRadius: 7 };
  return (
    <div data-wheelscroll="1" style={{ width: open ? 212 : "auto", background: "var(--surface-overlay)", border: `1px solid ${pal.panelLine}`, borderRadius: 9, boxShadow: "0 2px 10px rgba(28,25,20,0.16)", overflow: "hidden" }}>
      <button data-testid="view-menu-btn" onClick={onToggle} aria-expanded={open}
        title="What's shown on the canvas — visibility toggles, grid & snap, and how zooming redraws"
        style={{ display: "flex", alignItems: "center", gap: 7, width: "100%", padding: "8px 11px", border: "none", background: "transparent", color: pal.ink, cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700 }}>
        <span style={{ color: pal.accent, display: "inline-flex" }}><EyeIcon /></span> View
        {!open && settings.snap && (
          <span data-testid="view-snap-chip" title={`Snap is on (${settings.gridSize}′ grid) — press S to toggle`}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 2, fontSize: 10.5, fontWeight: 600, color: "var(--success-text)" }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: "var(--success-text)", display: "inline-block" }} />
            Snap {settings.gridSize}′
          </span>
        )}
        <span style={{ flex: 1 }} /> <span style={{ color: pal.muted, fontWeight: 500 }}>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div style={{ padding: "2px 11px 10px" }}>
          <label style={row}><input type="checkbox" checked={settings.showDocks} onChange={(e) => patchSettings({ showDocks: e.target.checked })} /> Show dock doors</label>
          <label style={row}><input type="checkbox" checked={settings.showGrid} onChange={(e) => patchSettings({ showGrid: e.target.checked })} /> Show column grid</label>
          <label style={row} title="Show the red footprint dimension callouts (building depth, road width, strip width)"><input type="checkbox" checked={settings.showDims !== false} onChange={(e) => patchSettings({ showDims: e.target.checked })} /> Show dimensions</label>
          <label style={row} title="Show the square-footage / acreage line on element labels"><input type="checkbox" checked={settings.showAreas !== false} onChange={(e) => patchSettings({ showAreas: e.target.checked })} /> Show areas</label>
          <div style={{ borderTop: `1px solid ${pal.panelLine}`, margin: "7px 0" }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: pal.muted }}>Grid (ft)</span>
            <GridNumInput style={numInput} value={settings.gridSize} min={1} onCommit={(n) => patchSettings({ gridSize: n })} />
          </div>
          <label style={{ ...row, color: pal.muted, fontSize: 12 }} title="Snap to grid & flush against neighbours — press S to toggle (this browser session only; off by default); hold Alt while dragging to place freely">
            <input type="checkbox" checked={settings.snap} onChange={(e) => setSnap(e.target.checked)} /> Snap to grid &amp; neighbours (S)
          </label>
          {/* B1449's one switch for the anchored zoom, rehomed here by B286000. Off, a wheel notch
              re-draws the whole plan at the new zoom exactly as it did before (crisper mid-gesture,
              slower); on, the drawing scales as one piece and re-draws when you stop. The PAN
              anchor (B1440) is deliberately NOT gated on this — turning smooth zoom off must not
              take that away. `onSmoothZoom` owns the persist + `disarmViewAnchor()`; this card
              only renders the state, so there is still exactly ONE place that decides. */}
          {onSmoothZoom && (
            <>
              <div style={{ borderTop: `1px solid ${pal.panelLine}`, margin: "7px 0" }} />
              {/* The old home was a fake `role="menuitemcheckbox"` on a <button> carrying a ☑/☐
                  glyph. Here it is a real <input type="checkbox"> in a <label>, exactly like the
                  four rows above it — so the checked state is native (no `aria-checked` to keep in
                  sync, and `menuitemcheckbox` would be invalid anyway outside a `menu` container).
                  The `data-testid` is unchanged and still addresses the clickable row. */}
              <label style={row} data-testid="smooth-zoom-toggle"
                title="Zoom scales the drawing as one piece while the wheel is turning, then re-draws it sharp the moment you stop. Turn off to re-draw on every notch instead.">
                <input type="checkbox" checked={!!smoothZoom} onChange={(e) => onSmoothZoom(e.target.checked)} /> Smooth zoom
              </label>
            </>
          )}
        </div>
      )}
    </div>
  );
}
