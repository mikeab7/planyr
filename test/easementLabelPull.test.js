/* NEW-1/NEW-2 — an easement label that can be pulled off its strip, moved, rotated through 360°
 * (upside down allowed), snapped back, and whose area line is OFF by default. Every assertion here is
 * red on main: there is no `easementLabelPull` module, no stored pull, and the area line was drawn
 * whenever the easement was selected. Drives the REAL ring derivation + placement + JSON round-trip. */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { deriveEasementRing, easementLabel } from "../src/workspaces/site-planner/lib/easements.js";
import { placeEasementLabel } from "../src/workspaces/site-planner/lib/easementLabelPlacement.js";
import { featureNameFontPx } from "../src/workspaces/site-planner/lib/labelLayout.js";
import { createSiteModel } from "../src/workspaces/site-planner/lib/siteModel.js";
import {
  resolveEasementLabel, pullOf, withPull, withoutPull, snapLabelAngle, normDeg, showAreaOn,
  nearestOnPath, leaderTargetFt, leaderGeometry,
} from "../src/workspaces/site-planner/lib/easementLabelPull.js";

const PPF = 0.45, BASE = 10.5, ident = (p) => p;
const AREA = "510,172 SF · 11.71 AC";
function strip(centerline, width, extra = {}) {
  const m = { id: "e1", kind: "easement", mode: "centerline", type: "storm", centerline, width, ...extra };
  m.pts = deriveEasementRing(m);
  return m;
}
const resolve = (m, o = {}) => resolveEasementLabel(m, easementLabel(m), { labelPpf: PPF, basePx: BASE, toScreen: ident, areaText: AREA, ...o });
const move = (m, dx, dy) => ({
  ...m, pts: m.pts.map((p) => ({ x: p.x + dx, y: p.y + dy })), centerline: m.centerline.map((p) => ({ x: p.x + dx, y: p.y + dy })),
});
const VERT = () => strip([{ x: 0, y: 0 }, { x: 0, y: 5100 }], 100);
const DIAG = () => strip([{ x: 0, y: 0 }, { x: 1500, y: 866 }], 90);
const BENT = () => strip([{ x: 0, y: 0 }, { x: 0, y: 1500 }, { x: 900, y: 1500 }], 80);

describe("NEW-2 — area is OFF by default", () => {
  it("an easement with no showArea draws the name only, selected or not", () => {
    for (const m of [VERT(), DIAG(), BENT()]) {
      expect(showAreaOn(m)).toBe(false);
      expect(resolve(m).showArea).toBe(false);
    }
  });
  it("turning it on draws the area line; off again removes it (round trip), inline and pulled", () => {
    const m = VERT();
    expect(resolve({ ...m, showArea: true }).showArea).toBe(true);
    expect(resolve({ ...m, showArea: false }).showArea).toBe(false);
    const p = withPull(m, { dx: 200, dy: 0, angle: 0 });
    expect(resolve({ ...p, showArea: true }).showArea).toBe(true);
    expect(resolve(p).showArea).toBe(false);
  });
  it("only a literal true counts (legacy / junk values stay off)", () => {
    expect(showAreaOn({ showArea: "yes" })).toBe(false);
    expect(showAreaOn({ showArea: 1 })).toBe(false);
    expect(showAreaOn({})).toBe(false);
  });
});

describe("pulled-out state persists", () => {
  it("survives a JSON save/reload and the site-model normaliser", () => {
    const m = withPull({ ...VERT(), showArea: true }, { dx: 180.456, dy: -40, angle: 200 });
    const reloaded = JSON.parse(JSON.stringify(m));
    expect(pullOf(reloaded)).toEqual({ dx: 180.46, dy: -40, angle: -160 });
    const model = createSiteModel({ id: "s1", markups: [reloaded] });
    const back = model.markups.find((x) => x.id === "e1");
    expect(pullOf(back)).toEqual(pullOf(m));
    expect(back.showArea).toBe(true);
  });
  it("upside down is stored and read back upside down — never folded upright", () => {
    const m = withPull(VERT(), { dx: 150, dy: 0, angle: 180 });
    const L = resolve(m);
    expect(Math.abs(L.angle)).toBeCloseTo(180, 5);
    const inline = resolve(VERT());
    expect(Math.abs(inline.angle)).toBeCloseTo(90, 5);   // the inline label still folds upright
  });
  it("an unusable stored value reads as inline (a damaged record can never hide its own label)", () => {
    expect(pullOf({ labelPull: { dx: NaN, dy: 1 } })).toBeNull();
    expect(pullOf({ labelPull: "x" })).toBeNull();
    expect(pullOf({})).toBeNull();
  });
});

describe("pulled-out label geometry", () => {
  it("is not limited to fit the strip: shows at the full ramp size on a thin ribbon", () => {
    const thin = strip([{ x: 0, y: 0 }, { x: 0, y: 5100 }], 20);
    const inline = resolve(thin);
    const pulled = resolve(withPull(thin, { dx: 300, dy: 0, angle: 0 }));
    expect(pulled.fontPx).toBeCloseTo(featureNameFontPx(PPF, BASE), 6);
    expect(pulled.fontPx).toBeGreaterThan(inline.fontPx);
  });
  it("custom map-label text + pulled out", () => {
    const m = withPull({ ...VERT(), labelOverride: "Drainage easement (Vol 12 Pg 3)" }, { dx: 250, dy: 100, angle: 30 });
    const L = resolve(m);
    expect(L.pulled).toBe(true);
    expect(L.halfW).toBeGreaterThan(resolve(withPull(VERT(), { dx: 250, dy: 100, angle: 30 })).halfW * 0.9);
  });
  it("sits at anchor + offset, to each side of the strip", () => {
    const m = VERT(), a = resolve(m).anchor;
    for (const [dx, dy] of [[300, 0], [-300, 0], [0, 400], [0, -400]]) {
      const L = resolve(withPull(m, { dx, dy, angle: 0 }));
      expect(L.x).toBeCloseTo(a.x + dx, 1); expect(L.y).toBeCloseTo(a.y + dy, 1);
    }
  });
  it("the leader ends ON the easement's centerline (vertical, diagonal and bent)", () => {
    for (const m0 of [VERT(), DIAG(), BENT()]) {
      const a = resolve(m0).anchor;
      const m = withPull(m0, { dx: 260, dy: -180, angle: 0 });
      const L = resolve(m);
      expect(L.leader).not.toBeNull();
      const tgt = leaderTargetFt(m, { x: a.x + 260, y: a.y - 180 });
      expect(nearestOnPath(m.centerline, tgt).d).toBeCloseTo(0, 6);
    }
  });
  it("no leader while the label is inline; none either when the pulled label still overlaps its target", () => {
    const m = VERT();
    expect(resolve(m).leader).toBeNull();
    expect(resolve(withPull(m, { dx: 0, dy: 0, angle: 0 })).leader).toBeNull();
  });
  it("leader starts on the label's edge (rotated) and ends at the target", () => {
    const g = leaderGeometry({ centre: { x: 0, y: 0 }, angleDeg: 90, labelK: 1, halfW: 50, halfH: 10, target: { x: 0, y: 200 } });
    // label rotated 90°: its long axis points down the screen, so a target straight down is hit through the short end
    expect(g).not.toBeNull();
    expect(Math.hypot(g.x2, g.y2)).toBeCloseTo(200, 6);
    expect(Math.abs(g.x1)).toBeCloseTo(50, 6);
    expect(leaderGeometry({ centre: { x: 0, y: 0 }, angleDeg: 0, labelK: 1, halfW: 50, halfH: 10, target: { x: 20, y: 3 } })).toBeNull();
  });
});

describe("moving or reshaping the easement carries the label", () => {
  it("keeps its offset and the leader re-aims to the nearest point of the MOVED easement", () => {
    const m = withPull(DIAG(), { dx: 220, dy: -260, angle: 15 });
    const before = resolve(m);
    const moved = move(m, 700, 300);
    const after = resolve(moved);
    expect(after.x - before.x).toBeCloseTo(700, 6);
    expect(after.y - before.y).toBeCloseTo(300, 6);
    expect(after.angle).toBeCloseTo(before.angle, 6);
    expect(pullOf(moved)).toEqual(pullOf(m));
    const t0 = leaderTargetFt(m, { x: before.x, y: before.y }), t1 = leaderTargetFt(moved, { x: after.x, y: after.y });
    expect(t1.x - t0.x).toBeCloseTo(700, 6); expect(t1.y - t0.y).toBeCloseTo(300, 6);
    expect(after.leader).not.toBeNull();
  });
  it("reshaping (extending the strip) re-aims the leader but never changes the stored offset", () => {
    const m = withPull(strip([{ x: 0, y: 0 }, { x: 0, y: 1000 }], 100), { dx: 300, dy: 0, angle: 0 });
    const longer = { ...m, centerline: [{ x: 0, y: 0 }, { x: 0, y: 3000 }] };
    longer.pts = deriveEasementRing(longer);
    expect(pullOf(longer)).toEqual(pullOf(m));
    expect(resolve(longer).y).toBeGreaterThan(resolve(m).y);   // the anchor (strip middle) moved, the label followed
  });
});

describe("snap back", () => {
  it("removes the pull and restores the exact inline placement, with no leader", () => {
    for (const m0 of [VERT(), DIAG(), BENT()]) {
      const rotated = withPull(m0, { dx: 120, dy: 90, angle: 137 });
      const back = withoutPull(rotated);
      expect("labelPull" in back).toBe(false);
      const L = resolve(back);
      const inline = placeEasementLabel(back, easementLabel(back), { labelPpf: PPF, basePx: BASE, toScreen: ident });
      expect(L.pulled).toBe(false);
      expect(L.leader).toBeNull();
      expect(L.x).toBeCloseTo(inline.x, 9); expect(L.y).toBeCloseTo(inline.y, 9); expect(L.angle).toBeCloseTo(inline.angle, 9);
    }
  });
  it("is a no-op on an already-inline easement (same object)", () => {
    const m = VERT();
    expect(withoutPull(m)).toBe(m);
  });
});

describe("rotation + soft snap", () => {
  it("free 360°: arbitrary angles are kept, and 179.9 → 180.1 crosses upside down without a fold", () => {
    expect(snapLabelAngle(137).angle).toBeCloseTo(137, 9);
    expect(snapLabelAngle(-61).angle).toBeCloseTo(-61, 9);
    expect(normDeg(180.1)).toBeCloseTo(-179.9, 9);
    expect(Math.abs(snapLabelAngle(178.3).angle)).toBeCloseTo(180, 9);   // snapped to level, upside down
  });
  it("snaps near level, plumb and the strip's own angle (either direction), and only near them", () => {
    expect(snapLabelAngle(2.5)).toEqual({ angle: 0, to: "level" });
    expect(snapLabelAngle(88)).toEqual({ angle: 90, to: "plumb" });
    expect(snapLabelAngle(-91.5)).toEqual({ angle: -90, to: "plumb" });
    expect(snapLabelAngle(31.5, 30)).toEqual({ angle: 30, to: "strip" });
    expect(snapLabelAngle(-148, 30)).toEqual({ angle: -150, to: "strip" });
    expect(snapLabelAngle(45, 30).to).toBeNull();
    expect(snapLabelAngle(20).to).toBeNull();
  });
});

describe("wiring (source guards)", () => {
  const src = fs.readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
  it("the render reads the one resolver and the area is the stored toggle, not the selection", () => {
    expect(src).toMatch(/resolveEasementLabel\(m, txt/);
    expect(src).not.toMatch(/withArea: isSel/);
  });
  it("label press / rotate / right-click are wired, and drags go through the shared click-vs-drag gate", () => {
    expect(src).toMatch(/mode: "easeLabelMove"[^\n]*\.\.\.startGate\(e\)/);
    expect(src).toMatch(/mode: "easeLabelRot"[^\n]*\.\.\.startGate\(e, \{ rebase: false \}\)/);
    expect(src).toMatch(/kind: "easeLabel"/);
  });
  it("menu rows and the panel checkbox exist", () => {
    expect(src).toMatch(/Snap back to strip/);
    expect(src).toMatch(/"Hide area" : "Show area"/);
    expect(src).toMatch(/check\("Show area on label"/);
  });
  it("the hit rect and the handles never print (PDF-PARITY)", () => {
    expect(src).toMatch(/data-export="skip" data-easement-label-hit/);
    expect(src).toMatch(/data-easement-label-handles=\{m\.id\} data-export="skip"/);
  });
});
