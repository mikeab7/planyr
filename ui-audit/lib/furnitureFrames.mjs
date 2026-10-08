/* furnitureFrames — per-frame judgement of the Site canvas's corner FURNITURE (NEW-1/NEW-2, B2206704–B2206706).
 *
 * The oracle is deliberately INDEPENDENT of the code under test (CLAUDE.md → DRIVER-SCROLL §6: a probe needs a case whose
 * answer is known without the app's own arithmetic). The app positions furniture with `paneInset`; this judges it against
 * MEASURED rects only: the docked panel, its drag grip (the visible map pane begins at the grip's right edge) and the
 * canvas SVG (the pane's right/bottom). A frame is bad when any furniture rect (a) pokes outside the visible pane, (b)
 * touches the panel or the grip, or (c) overlaps another furniture item.
 *
 * The in-page recorder is a STRING-free function so Playwright can serialise it; the verdict is pure and Node-testable. */
import { rectInside, rectOverlap } from "../../src/workspaces/site-planner/lib/mapCorners.js";

/** In the page: read one frame of everything the verdict needs. */
export function readFurnitureFrame() {
  const q = (sel) => document.querySelector(sel)?.getBoundingClientRect();
  const R = (r) => (r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null);
  const panel = R(q('[data-testid="left-menu-panel"]'));
  const grip = R(q('[title="Drag to resize"]'));
  const canvas = R(q('[data-testid="planner-canvas"]'));
  const items = {};
  for (const n of document.querySelectorAll("[data-map-furniture]")) {
    const r = n.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const k = n.getAttribute("data-map-furniture");
    if (k === "corner-br") continue; // the container is judged through its children
    items[k] = R(r);
  }
  return { panel, grip, canvas, items };
}

/** Pure verdict over recorded frames → { observed:Set, violations:[string] }. */
export function judgeFurniture(frames, { requireObserved = [] } = {}) {
  const violations = [];
  const observed = new Set();
  frames.forEach((f, i) => {
    if (!f || !f.canvas) return;
    const paneLeft = f.grip ? f.grip.right : f.panel ? f.panel.right : f.canvas.left;
    const pane = { left: paneLeft, top: f.canvas.top, right: f.canvas.right, bottom: f.canvas.bottom };
    const keys = Object.keys(f.items);
    for (const k of keys) {
      observed.add(k);
      const r = f.items[k];
      if (!rectInside(r, pane)) violations.push(`frame ${i}: ${k} [${r.left.toFixed(1)},${r.top.toFixed(1)} → ${r.right.toFixed(1)},${r.bottom.toFixed(1)}] is outside the visible map pane [${pane.left.toFixed(1)}…${pane.right.toFixed(1)} × ${pane.top.toFixed(1)}…${pane.bottom.toFixed(1)}]`);
      if (f.panel && rectOverlap(r, f.panel) > 0) violations.push(`frame ${i}: ${k} overlaps the docked panel`);
      if (f.grip && rectOverlap(r, f.grip) > 0) violations.push(`frame ${i}: ${k} overlaps the panel's drag grip`);
    }
    for (let a = 0; a < keys.length; a++) for (let b = a + 1; b < keys.length; b++) {
      const ov = rectOverlap(f.items[keys[a]], f.items[keys[b]]);
      if (ov > 0) violations.push(`frame ${i}: ${keys[a]} overlaps ${keys[b]} (${ov.toFixed(0)} px²)`);
    }
  });
  for (const k of requireObserved) if (!observed.has(k)) violations.push(`VACUOUS: "${k}" was never observed in any frame`);
  return { observed, violations };
}
