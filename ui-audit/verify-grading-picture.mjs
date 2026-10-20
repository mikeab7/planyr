/* verify-grading-picture — ROUND 5 (NEW-4): does the grading picture read like a civil's grading plan?
 *
 * Renders the Chehaw geometry through the REAL GradingController + GradingCanvas (ui-audit/harness/grading-harness.*) with
 * grading on, Cut & Fill + proposed contours + the paper background on, at THREE zooms (the parcel fills the map, the
 * building fills the map, one zoom closer at the building's NE corner) in BOTH limit modes, saves the six PNGs under
 * ui-audit/screenshots/grading/, and asserts — from the rendered pixels and the traced polylines — the five things the
 * owner's screenshot got wrong (2026-10-20):
 *   (a) zero contour pixels inside the building ring (the slab is flat: no line may cross it);
 *   (b) at most ceil(depth × slope / interval) + 1 contour crossings per court / lot;
 *   (c) no contour polyline runs along lattice cell edges for more than two consecutive vertices (no staircase);
 *   (d) no two labels overlap;
 *   (e) proposed and existing contours tie at the daylight line: the ground at a proposed endpoint on the outer ring is
 *       the contour's own level (median ≤ 0.3 ft / p90 ≤ 1 ft in layout mode; boundary mode's setback kink: ≤ 1 / ≤ 2),
 *       and most endpoints sit within a cell of an existing endpoint of the same level.
 * ROUND 6 adds three (owner live check 2026-10-20, "To the boundary"): 
 *   (f) zero existing-contour pixels inside the daylight polygon (the proposed layer hidden, the probe re-read — inside the
 *       daylight line only the proposed surface may be contoured);
 *   (g) no closed proposed ring whose whole extent lies inside the limit unless the surface there is a real pit or hump
 *       (a probe sample inside the ring at least half an interval off the ring's level) — no leftover loops on open ground;
 *   (h) never a fill: no brown pixel sits in a run ≥ 5 px in BOTH directions (adjacent contours never touch; a steep bank
 *       reads as distinct parallel lines), and the parcel view draws index lines only.
 * A KNOWN-GOOD ARM runs first: the pixel probe must see the proposed contours it is about to judge (a run that cannot
 * see the ink would pass (a) vacuously), or the whole run is VOID. ROUND 6: every view must carry ink — the open ground
 * inside the limit now falls at 2%, so there is no flat plateau left to excuse an empty view.
 *   node ui-audit/verify-grading-picture.mjs            (starts its own vite dev server on :5198; --owner for the real cross-dock) */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const PORT = 5198, BASE = `http://localhost:${PORT}`;
const EXEC = process.env.PW_CHROME || (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const OUT = new URL("./screenshots/grading/", import.meta.url).pathname;
const OWNER = process.argv.includes("--owner");
const fails = [], notes = [];
const check = (name, ok, extra = "") => { (ok ? notes : fails).push(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); };
mkdirSync(OUT, { recursive: true });

const vite = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
try {
  for (let i = 0; i < 100; i++) { try { const r = await fetch(BASE); if (r.ok) break; } catch {} await sleep(300); }
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  const errs = [];
  const open = async (qs) => {
    const page = await (await browser.newContext({ viewport: { width: 1760, height: 1040 } })).newPage();
    page.on("pageerror", (e) => errs.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    await page.goto(`${BASE}/ui-audit/harness/grading-harness.html${qs}`);
    await assertMeasurable(page, "verify-grading-picture");
    await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
    return page;
  };
  const waitPicture = async (page) => {
    await page.waitForFunction(() => { const a = document.querySelector("[data-ffe-value]"); return a && /\d/.test(a.textContent); }, null, { timeout: 120000 });
    await page.waitForFunction(() => { const e = document.querySelector("[data-grading-earthwork]"); return e && e.getAttribute("data-grading-earthwork") !== "pending"; }, null, { timeout: 120000 });
    await page.waitForSelector('[data-layer="contours"] path', { state: "attached", timeout: 120000 });
    await page.waitForSelector('[data-layer="existing-contours"] polyline', { state: "attached", timeout: 60000 });
    await page.waitForSelector('[data-layer="paper"] path', { state: "attached", timeout: 60000 });
    await page.waitForTimeout(1500);
  };
  /* the canvas as pixels: alpha-weighted RGB of the #canvas SVG rendered to a bitmap (the paper is part of it) */
  const probe = (page) => page.evaluate(async () => {
    const svg = document.getElementById("canvas");
    const xml = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([xml], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = new Image(); img.src = url; await img.decode();
    const c = document.createElement("canvas"); c.width = svg.width.baseVal.value; c.height = svg.height.baseVal.value;
    const g = c.getContext("2d"); g.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    window.__px = { d, w: c.width, h: c.height };
    return { w: c.width, h: c.height };
  });
  const brown = (r, g, b) => r > 70 && r < 150 && g > 35 && g < 90 && b < 60 && r - b > 50;     // the contour browns (#7C3F12 / #5B2E0D) and their antialiased halo
  const countInside = (page, ringFt, insetPx) => page.evaluate(([ring, inset, brownSrc]) => {
    const brown = new Function("return " + brownSrc)();
    const { d, w, h } = window.__px;
    const m = window.__harness.model; const f2p = window.__harnessF2p;
    const pts = ring.map((p) => f2p(p));
    // shrink the ring toward its centroid by `inset` px so the pad's own outline stroke does not count
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length, cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    const sh = pts.map((p) => { const dx = p.x - cx, dy = p.y - cy, L = Math.hypot(dx, dy) || 1; return { x: p.x - dx / L * inset * 1.5, y: p.y - dy / L * inset * 1.5 }; });
    const inRing = (x, y) => { let ok = false; for (let i = 0, j = sh.length - 1; i < sh.length; j = i++) { if ((sh[i].y > y) !== (sh[j].y > y) && x < ((sh[j].x - sh[i].x) * (y - sh[i].y)) / (sh[j].y - sh[i].y) + sh[i].x) ok = !ok; } return ok; };
    const x0 = Math.max(0, Math.floor(Math.min(...sh.map((p) => p.x)))), x1 = Math.min(w - 1, Math.ceil(Math.max(...sh.map((p) => p.x))));
    const y0 = Math.max(0, Math.floor(Math.min(...sh.map((p) => p.y)))), y1 = Math.min(h - 1, Math.ceil(Math.max(...sh.map((p) => p.y))));
    let n = 0, total = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { if (!inRing(x, y)) continue; total++; const k = (y * w + x) * 4; if (brown(d[k], d[k + 1], d[k + 2])) n++; }
    return { brownPx: n, total, hasModel: !!m };
  }, [ringFt, insetPx, brown.toString()]);

  for (const mode of ["layout", "boundary"]) {
    for (const zoom of ["site", "bldg", "ne"]) {
      const tag = `${mode}-${zoom}${OWNER ? "-owner" : ""}`;
      const page = await open(`?buildable=0&contours=1&zoom=${zoom}&mode=${mode}${OWNER ? "&owner=1" : ""}`);
      try { await waitPicture(page); } catch (e) { fails.push(`✗ ${tag}: the picture never settled — ${e.message.split("\n")[0]}`); await page.close(); continue; }
      await page.evaluate(() => { window.__harnessF2p = (p) => { const el = document.querySelector('[data-layer="paper"]'); const t = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/.exec(el.getAttribute("transform")); return { x: p.x * +t[3] + +t[1], y: p.y * +t[3] + +t[2] }; }; });
      await page.locator("#canvas").screenshot({ path: `${OUT}${tag}.png` });
      notes.push(`  · wrote ${OUT}${tag}.png`);
      const dims = await probe(page);
      const els = await page.evaluate(() => window.__harness.els.map((e) => ({ id: e.id, type: e.type, ring: e.ring })));
      const bld = els.find((e) => e.type === "building");
      // ---- known-good arm: the probe sees the proposed contours' ink somewhere on the canvas (else VOID)
      const anyInk = await page.evaluate((brownSrc) => { const brown = new Function("return " + brownSrc)(); const { d, w, h } = window.__px; let n = 0; for (let k = 0; k < w * h * 4; k += 4) if (brown(d[k], d[k + 1], d[k + 2])) n++; return n; }, brown.toString());
      if (!(anyInk > 200)) { fails.push(`✗ VOID (${tag}) — the pixel probe saw no contour ink at all (${anyInk} px), so a clean pad would mean nothing`); await page.close(); continue; }
      {
      // (a) zero contour pixels inside the building ring (inset 4 px past the outline stroke)
      const pad = await countInside(page, bld.ring, 4);
      check(`(a) ${tag}: zero contour pixels inside the building ring`, pad.brownPx === 0 && pad.total > 1000, `${pad.brownPx} brown of ${pad.total} px`);
      // (b) crossings per court / lot ≤ ceil(depth × 1.5% / interval) + 1 — counted on the traced polylines across a transect
      const cross = await page.evaluate(() => {
        const m = window.__harness.model; const iv = m.contours.interval;
        const verts = (d) => d.split("M").filter(Boolean).map((seg) => [...seg.matchAll(/[ML]?(-?[\d.]+) (-?[\d.]+)/g)].map((q) => ({ x: +q[1], y: +q[2] })));
        const pieces = m.contours.levels.flatMap((lv) => verts(lv.d));
        const out = [];
        for (const e of window.__harness.els) {
          if (!["paving", "parking", "trailer"].includes(e.type)) continue;
          const xs = e.ring.map((p) => p.x), ys = e.ring.map((p) => p.y);
          const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys), depth = Math.min(w, h);
          const a = w < h ? { x: Math.min(...xs) + 0.5, y: (Math.min(...ys) + Math.max(...ys)) / 2 } : { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: Math.min(...ys) + 0.5 };
          const b = w < h ? { x: Math.max(...xs) - 0.5, y: a.y } : { x: a.x, y: Math.max(...ys) - 0.5 };
          const cr = (p, q) => { const d1 = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x), d2 = (b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x); const d3 = (q.x - p.x) * (a.y - p.y) - (q.y - p.y) * (a.x - p.x), d4 = (q.x - p.x) * (b.y - p.y) - (q.y - p.y) * (b.x - p.x); return d1 * d2 < 0 && d3 * d4 < 0; };
          let n = 0; for (const pc of pieces) for (let i = 1; i < pc.length; i++) if (cr(pc[i - 1], pc[i])) n++;
          out.push({ id: e.id, type: e.type, depth, n, max: Math.ceil(depth * 0.015 / iv) + 1 });
        }
        return out;
      });
      check(`(b) ${tag}: at most ceil(depth × 1.5% / interval) + 1 crossings per court / lot`, cross.length > 0 && cross.every((c) => c.n <= c.max), cross.map((c) => `${c.type} ${Math.round(c.depth)}′ ${c.n}/${c.max}`).join(", "));
      // (c) no polyline vertex on a lattice cell edge for more than two consecutive vertices
      const stair = await page.evaluate(() => {
        const m = window.__harness.model; const L = m.contours.lattice;
        const verts = (d) => d.split("M").filter(Boolean).map((seg) => [...seg.matchAll(/[ML]?(-?[\d.]+) (-?[\d.]+)/g)].map((q) => ({ x: +q[1], y: +q[2] })));
        let worst = 0, pieces = 0;
        for (const lv of m.contours.levels) for (const pc of verts(lv.d)) {
          pieces++; let run = 0;
          // the staircase signature: on-edge vertices that STEP between the two grid-line orientations (a straight line along one grid line is not a staircase)
          let prev = 0;
          for (const p of pc) { const fx = Math.abs(((p.x - L.x0) / L.dx) % 1), fy = Math.abs(((p.y - L.y0) / L.dy) % 1); const onX = Math.min(fx, 1 - fx) < 2e-3, onY = Math.min(fy, 1 - fy) < 2e-3; const kind = onX && !onY ? 1 : onY && !onX ? 2 : onX && onY ? 3 : 0; if (kind && prev && kind !== prev) run += 1; else run = kind ? 1 : 0; if (run > worst) worst = run; prev = kind; }
        }
        return { worst, pieces };
      });
      check(`(c) ${tag}: no staircase — longest run of vertices on cell edges ≤ 2`, stair.worst <= 2 && stair.pieces > 5, `${stair.worst} over ${stair.pieces} pieces`);
      // (d) no two labels overlap (the rendered text boxes)
      const labels = await page.evaluate(() => [...document.querySelectorAll("[data-contour-label]")].map((t) => { const r = t.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, text: t.textContent }; }));
      let overlaps = 0;
      for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) { const a = labels[i], b = labels[j]; if (a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b) overlaps++; }
      check(`(d) ${tag}: no two labels overlap`, overlaps === 0 && (zoom === "site" || labels.length > 0), `${labels.length} labels, ${overlaps} overlapping`);
      // (e) the tie at the daylight line
      const tie = await page.evaluate(() => {
        const m = window.__harness.model; const ex = window.__harnessExisting; const existAt = window.__harnessExistAt;
        const outer = m.contours.daylight.rings;
        const onRing = (p) => outer.some((r) => { for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; const dx = b.x - a.x, dy = b.y - a.y; const l2 = dx * dx + dy * dy || 1; const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)); if (Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t) < 0.05) return true; } return false; });
        const verts = (d) => d.split("M").filter(Boolean).map((seg) => [...seg.matchAll(/[ML]?(-?[\d.]+) (-?[\d.]+)/g)].map((q) => ({ x: +q[1], y: +q[2] })));
        const errs = [], dists = [];
        for (const lv of m.contours.levels) for (const pc of verts(lv.d)) for (const end of [pc[0], pc[pc.length - 1]]) {
          if (!onRing(end)) continue;
          errs.push(Math.abs(existAt(end) - lv.level));
          let best = Infinity;
          for (const x of ex) { if (x.level !== lv.level) continue; for (const q of [x.pts[0], x.pts[x.pts.length - 1]]) best = Math.min(best, Math.hypot(q.x - end.x, q.y - end.y)); }
          dists.push(best / m.contours.cellFt);
        }
        errs.sort((a, b) => a - b); dists.sort((a, b) => a - b);
        const pc = (arr, f) => arr[Math.min(arr.length - 1, Math.floor(arr.length * f))];
        return { n: errs.length, median: pc(errs, 0.5), p90: pc(errs, 0.9), within1: dists.filter((d) => d <= 1).length / Math.max(1, dists.length), within2: dists.filter((d) => d <= 2).length / Math.max(1, dists.length), existing: ex.length };
      });
      const tol = mode === "layout" ? { median: 0.3, p90: 1.0 } : { median: 1.0, p90: 2.0 };
      check(`(e) ${tag}: proposed ends on the daylight line where the ground IS its level (median ≤ ${tol.median} ft, p90 ≤ ${tol.p90} ft) and meets an existing endpoint within a cell for most`,
        tie.n > 20 && tie.median <= tol.median && tie.p90 <= tol.p90 && tie.within2 >= 0.6 && tie.existing > 20,
        `n ${tie.n} · median ${tie.median?.toFixed(2)} · p90 ${tie.p90?.toFixed(2)} ft · within 1 cell ${(tie.within1 * 100).toFixed(0)}% · within 2 ${(tie.within2 * 100).toFixed(0)}% · ${tie.existing} existing pieces`);
      }
      // ---- ROUND 6 (f): zero EXISTING-contour pixels inside the daylight polygon. Both families are the same brown, so hide the
      // proposed layer, re-read the pixels, and count brown inside the daylight rings (less the holes) mapped to canvas px.
      const exist = await page.evaluate(async (brownSrc) => {
        const brown = new Function("return " + brownSrc)();
        // hide the proposed layer AND the Cut & Fill picture (its dashed limit line over the rust tint blends to the same brown)
        const hid = [...document.querySelectorAll('[data-layer="contours"], [data-layer="cutfill"]')].map((el) => [el, el.style.display]); for (const [el] of hid) el.style.display = "none";
        const svg = document.getElementById("canvas");
        const xml = new XMLSerializer().serializeToString(svg);
        const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml" }));
        const img = new Image(); img.src = url; await img.decode();
        const c = document.createElement("canvas"); c.width = svg.width.baseVal.value; c.height = svg.height.baseVal.value;
        const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0); URL.revokeObjectURL(url);
        const d = ctx.getImageData(0, 0, c.width, c.height).data; for (const [el, prev] of hid) el.style.display = prev;
        const m = window.__harness.model; const dl = m.contours.daylight;
        const f2p = window.__harnessF2p;
        const toPx = (r) => r.map((p) => { const q = f2p(p); return [q.x, q.y]; });
        const rings = dl.rings.map(toPx), holes = dl.holes.map(toPx);
        const inRing = (x, y, ring) => { let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside; } return inside; };
        const edgeDist = (x, y) => Math.min(...[...rings, ...holes].map((r) => { let best = Infinity; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; const dx = b[0] - a[0], dy = b[1] - a[1]; const l2 = dx * dx + dy * dy || 1; const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)); best = Math.min(best, Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t)); } return best; }));
        let n = 0, inside = 0, existingVerts = 0, existingInside = 0;
        for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) {
          if (!rings.some((r) => inRing(x + 0.5, y + 0.5, r)) || holes.some((r) => inRing(x + 0.5, y + 0.5, r))) continue;
          if (edgeDist(x + 0.5, y + 0.5) < 3) continue;        // the dashed line's own antialiased body ON the clip line is not "inside"
          inside++; const k = (y * c.width + x) * 4; if (brown(d[k], d[k + 1], d[k + 2])) n++;
        }
        // and the drawn existing polylines' own vertices (feet): none strictly inside the daylight polygon
        const inF = (p, ring) => { let ins = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) ins = !ins; } return ins; };
        const edgeF = (p) => Math.min(...[...dl.rings, ...dl.holes].map((r) => { let best = Infinity; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; const dx = b.x - a.x, dy = b.y - a.y; const l2 = dx * dx + dy * dy || 1; const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)); best = Math.min(best, Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t)); } return best; }));
        for (const ln of window.__harnessExisting) for (const p of ln.pts) { existingVerts++; if (dl.rings.some((r) => inF(p, r)) && !dl.holes.some((r) => inF(p, r)) && edgeF(p) > 0.05) existingInside++; }
        return { n, inside, existingVerts, existingInside, rings: rings.length, holes: holes.length };
      }, brown.toString());
      check(`(f) ${tag}: zero existing-contour pixels (and vertices) inside the daylight polygon`, exist.inside > 500 && exist.n === 0 && exist.existingVerts > 50 && exist.existingInside === 0, JSON.stringify(exist));
      // ---- ROUND 6 (g): no closed proposed ring wholly inside the limit unless the surface there is a real pit or hump
      const loops = await page.evaluate(() => {
        const m = window.__harness.model, s = window.__harness.gradeSurface; const L = s.grid.limit; const iv = m.contours.interval, cell = m.contours.cellFt;
        const lim = L.limitRegions.flatMap((r) => [r.outer, ...r.holes]);
        const inR = (p, ring) => { let ins = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) ins = !ins; } return ins; };
        const inLimit = (p) => { let k = 0; for (const r of lim) if (inR(p, r)) k++; return k % 2 === 1; };
        const verts = (d) => d.split("M").filter(Boolean).map((seg) => [...seg.matchAll(/[ML]?(-?[\d.]+) (-?[\d.]+)/g)].map((q) => ({ x: +q[1], y: +q[2] })));
        const out = { closed: 0, insideClosed: 0, bad: [] };
        for (const lv of m.contours.levels) for (const pc of verts(lv.d)) {
          if (pc.length < 4) continue;
          const a = pc[0], b = pc[pc.length - 1]; if (Math.hypot(a.x - b.x, a.y - b.y) > 1e-6) continue;
          out.closed++;
          if (!pc.every(inLimit)) continue;
          out.insideClosed++;
          let area = 0, cx = 0, cy = 0; for (let i = 0; i < pc.length - 1; i++) { area += pc[i].x * pc[i + 1].y - pc[i + 1].x * pc[i].y; cx += pc[i].x; cy += pc[i].y; } area = Math.abs(area) / 2; cx /= pc.length - 1; cy /= pc.length - 1;
          if (area < 4 * cell * cell) { out.bad.push({ level: lv.level, why: "noise loop", areaSf: Math.round(area) }); continue; }
          // a real pit or hump: a sample inside the ring at least half an interval off the ring's level
          const samples = [{ x: cx, y: cy }];
          for (let k = 0; k < 8; k++) { const v = pc[Math.floor((k / 8) * (pc.length - 1))]; const dx = cx - v.x, dy = cy - v.y, l = Math.hypot(dx, dy) || 1; samples.push({ x: v.x + dx / l * cell, y: v.y + dy / l * cell }); }
          let extreme = 0;
          for (const q of samples) { if (!inR(q, pc)) continue; const r = s.grid.probe(q); if (r && r.status === "value") extreme = Math.max(extreme, Math.abs(r.ft - lv.level)); }
          // a surface with a closed contour on it has an interior above or below that level by construction unless the ground is
          // FLAT there — which is exactly the leftover-loop case (a flat plateau blended to its edges); 0.1 ft is "flat"
          if (extreme < 0.1) out.bad.push({ level: lv.level, why: "closed ring on flat ground (neither a pit nor a hump)", areaSf: Math.round(area), off: +extreme.toFixed(2) });
          else out.real = (out.real || []).concat([{ level: lv.level, areaSf: Math.round(area), off: +extreme.toFixed(2) }]);
        }
        return out;
      });
      check(`(g) ${tag}: no closed proposed ring wholly inside the limit unless the surface there is a real pit or hump`, loops.bad.length === 0, JSON.stringify(loops));
      // ---- ROUND 6 (h): never a fill — no brown pixel in a run ≥ 5 px in BOTH directions; the parcel view is index lines only
      const fill = await page.evaluate(async (brownSrc) => {
        const brown = new Function("return " + brownSrc)();
        // the PROPOSED ink alone: the existing stand-in (1 ft at every zoom here — the app's layer has its own zoom rule) and the
        // Cut & Fill picture are hidden for this read
        const hid = [...document.querySelectorAll('[data-layer="existing-contours"], [data-layer="cutfill"]')].map((el) => [el, el.style.display]); for (const [el] of hid) el.style.display = "none";
        const svg = document.getElementById("canvas"); const xml = new XMLSerializer().serializeToString(svg);
        const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml" })); const img = new Image(); img.src = url; await img.decode();
        const c = document.createElement("canvas"); c.width = svg.width.baseVal.value; c.height = svg.height.baseVal.value;
        const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0); URL.revokeObjectURL(url);
        const d = ctx.getImageData(0, 0, c.width, c.height).data, w = c.width, h = c.height; for (const [el, prev] of hid) el.style.display = prev;
        const B = new Uint8Array(w * h); let brownN = 0;
        for (let k = 0, q = 0; k < w * h * 4; k += 4, q++) if (brown(d[k], d[k + 1], d[k + 2])) { B[q] = 1; brownN++; }
        const rowRun = new Uint16Array(w * h), colRun = new Uint16Array(w * h);
        for (let y = 0; y < h; y++) { let run = 0, start = 0; for (let x = 0; x <= w; x++) { const on = x < w && B[y * w + x]; if (on) { if (!run) start = x; run++; } else if (run) { for (let i = start; i < x; i++) rowRun[y * w + i] = run; run = 0; } } }
        for (let x = 0; x < w; x++) { let run = 0, start = 0; for (let y = 0; y <= h; y++) { const on = y < h && B[y * w + x]; if (on) { if (!run) start = y; run++; } else if (run) { for (let j = start; j < y; j++) colRun[j * w + x] = run; run = 0; } } }
        let fillN = 0; for (let q = 0; q < w * h; q++) if (B[q] && rowRun[q] >= 5 && colRun[q] >= 5) fillN++;
        const g = document.querySelector('[data-layer="contours"]');
        return { brownN, fillN, share: fillN / Math.max(1, brownN), indexOnly: g.getAttribute("data-contour-index-only"), drawn: +g.getAttribute("data-contour-levels-drawn"), traced: window.__harness.model.contours.levels.length, labels: document.querySelectorAll("[data-contour-label]").length };
      }, brown.toString());
      check(`(h) ${tag}: never a fill — brown pixels in a run ≥ 5 px both ways are under 0.5% of the ink${zoom === "site" ? "; the parcel view draws index lines only (thin)" : "; the building view draws every level"}`,
        fill.share < 0.005 && (zoom === "site" ? fill.indexOnly === "1" && fill.drawn * 4 < fill.traced + 5 : fill.indexOnly === "0" && fill.drawn > fill.traced / 2), JSON.stringify(fill));
      // the paper: on by default — inside the paper path NOT ONE pixel is the stand-in aerial (the harness canvas's green background),
      // and the view's own ink is what remains
      const plateauView = false;
      const paper = await page.evaluate((plateau) => {
        const { d, w, h } = window.__px;
        const el = document.querySelector('[data-layer="paper"] path'); if (!el) return { ok: false, why: "no paper path" };
        // canvas pixels are the SVG's own viewport units (no viewBox): map them into the path's user space through getCTM (NOT
        // getScreenCTM — the canvas sits below the panel on this page, and a screen-space inverse puts every probe 600 px off)
        const svg = document.getElementById("canvas"); const pt = svg.createSVGPoint(); const inv = el.getCTM().inverse();
        let bg = 0, white = 0, n = 0;
        for (let y = 6; y < h; y += 12) for (let x = 6; x < w; x += 12) {
          // 2 px inside the path on every side, so an antialiased edge pixel never reads as the aerial showing through
          let inside = true;
          for (const [ox, oy] of [[0, 0], [-2, -2], [2, -2], [-2, 2], [2, 2]]) { pt.x = x + 0.5 + ox; pt.y = y + 0.5 + oy; if (!el.isPointInFill(pt.matrixTransform(inv))) { inside = false; break; } }
          if (!inside) continue;
          n++; const k = (y * w + x) * 4;
          if (Math.abs(d[k] - 0x9a) < 10 && Math.abs(d[k + 1] - 0xa8) < 10 && Math.abs(d[k + 2] - 0x8f) < 10) bg++;
          if (d[k] > 225 && d[k + 1] > 225 && d[k + 2] > 225) white++;
        }
        return { ok: n > 50 && bg === 0 && (!plateau || white / n > 0.95), n, bg, white };
      }, plateauView);
      check(`${tag}: the paper background is on by default — no aerial shows through it`, paper.ok, JSON.stringify(paper));
      await page.close();
    }
  }
  // the paper checkbox turns it off (one arm)
  {
    const page = await open(`?buildable=0&contours=1&zoom=bldg&mode=layout`);
    await waitPicture(page);
    check("the panel's fourth checkbox 'Paper background' is checked by default", (await page.locator('[data-testid="grading-show-paper"]').count()) === 1 && (await page.isChecked('[data-testid="grading-show-paper"]')));
    await page.click('[data-testid="grading-show-paper"]');
    const gone = await page.waitForFunction(() => !document.querySelector('[data-layer="paper"]'), null, { timeout: 15000 }).then(() => true, () => false);
    check("unchecking it removes the paper (the aerial would show again); the contours stay", gone && (await page.locator('[data-layer="contours"] path').count()) > 0);
    const row = await page.evaluate(() => window.__harness.model.layerRows.find((r) => r.id === "paper"));
    check("the Layers popover carries a 'Paper background' row bound to the same setting", !!row && row.label === "Paper Background" && row.on === false, JSON.stringify(row));
    await page.close();
  }
  const real = errs.filter((e) => !/Failed to load resource|ERR_TUNNEL|ERR_CONNECTION/.test(e));
  check("no page errors", real.length === 0, real.slice(0, 3).join(" || "));
  await browser.close();
} finally { vite.kill(); }
console.log([...notes, ...fails].join("\n"));
process.exit(fails.length ? 1 : 0);
