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
 * ROUND 7 adds three (owner live pass 2026-10-22: "the daylight line and the slope bands are drawn as a cell staircase"):
 *   (i) the daylight polygon is smooth — every ring of the drawn daylight line (and boundary mode's inner edge) is closed, never
 *       crosses itself, and has no run of more than two vertices on the earthwork lattice's cell corners / cell edges;
 *   (j) the hatch is clipped to the polygon — rendered ALONE, zero tint pixels more than 2 px outside the band polygon, and the
 *       tint reaches the outline (no gaps: ≥ 97% of samples ≥ 3 px inside the band carry tint);
 *   (k) the contours read over the tint — inside the band, contour-brown pixels outnumber tint pixels as heavy as a stroke
 *       (alpha ≥ 0.3) at the building and corner zooms, and the tint never exceeds a quarter opacity.
 * ROUND 9 adds two (B2500224 ×2, owner live check 2026-10-30 on Concept A, "To the boundary", NE corner at the 50-ft scale), on the
 * owner's current layout (`owner=2`) at the building's NE (cut) and SW (fill) corners:
 *   (n) nothing but grading between the band and the limit — zero existing-contour vertices inside the limit, graded ground within
 *       one lattice cell of the line on every walk inward, the band painted is the one composed against the panel's limit, and on
 *       the owner's own path (open "Around the layout", choose "To the boundary") no frame paints the old limit's band or contours;
 *   (o) the drawn band contours are evenly spaced along every transect across a straight run (within 10%).
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
const MARGIN = (process.argv.find((a) => a.startsWith("--margin=")) || "").slice(9);   // round 8: the grading margin (default 10 ft)
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
    await page.waitForSelector("[data-band-tint]", { state: "attached", timeout: 60000 });    // ROUND 7: the traced band has landed
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

  const bandJudged = {};
  for (const mode of ["layout", "boundary"]) {
    for (const zoom of ["site", "bldg", "ne", "nw"]) {
      const tag = `${mode}-${zoom}${OWNER ? "-owner" : ""}`;
      const page = await open(`?buildable=0&contours=1&zoom=${zoom}&mode=${mode}${OWNER ? "&owner=1" : ""}${MARGIN ? `&margin=${MARGIN}` : ""}`);
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
      check(`(a) ${tag}: zero contour pixels inside the building ring`, pad.brownPx === 0 && (pad.total > 1000 || zoom === "nw"), `${pad.brownPx} brown of ${pad.total} px${zoom === "nw" && !pad.total ? " (the building is out of this view)" : ""}`);
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
      // ---- ROUND 8 (owner live check 2026-10-29, NW corner, "To the boundary"): the open ground is one continuous drainage
      // surface (proposedSurface.js "ROUND 8"). (R8-k) zero closed proposed rings whose interior is OPEN GROUND (every probe
      // sample inside the ring is open ground — no element, no slope band); (R8-l) no proposed polyline crosses a pavement
      // outline except at a level that pavement's own plane reaches there (±half an interval); (R8-m) boundary mode: the limit
      // sits inside the parcel by the grading margin everywhere (never on the setback) and outside every buffer.
      const r8 = await page.evaluate(() => {
        const m = window.__harness.model, s = window.__harness.gradeSurface, H = window.__harness; const L = s.grid.limit; const iv = m.contours.interval, cell = m.contours.cellFt;
        const inR = (p, ring) => { let ins = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) ins = !ins; } return ins; };
        const verts = (d) => d.split("M").filter(Boolean).map((seg) => [...seg.matchAll(/[ML]?(-?[\d.]+) (-?[\d.]+)/g)].map((q) => ({ x: +q[1], y: +q[2] })));
        const ringOf = (e) => e.ring;
        const paved = H.els.filter((e) => e.type !== "building" && Array.isArray(e.ring));
        const closedOpen = [];
        const crossBad = [];
        let crossings = 0;
        const segX = (p, q, a, b) => { const d = (q.x - p.x) * (b.y - a.y) - (q.y - p.y) * (b.x - a.x); if (Math.abs(d) < 1e-12) return null; const t = ((a.x - p.x) * (b.y - a.y) - (a.y - p.y) * (b.x - a.x)) / d, u = ((a.x - p.x) * (q.y - p.y) - (a.y - p.y) * (q.x - p.x)) / d; return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y), u } : null; };
        for (const lv of m.contours.levels) for (const pc of verts(lv.d)) {
          if (pc.length >= 4) {
            const a = pc[0], b = pc[pc.length - 1];
            if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) {
              let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const v of pc) { x0 = Math.min(x0, v.x); y0 = Math.min(y0, v.y); x1 = Math.max(x1, v.x); y1 = Math.max(y1, v.y); }
              // open ground = not a graded element (the slope band counts: a ring through it is a pit or a hump all the same);
              // a ring around a limit hole (a pond — an outlet) is allowed
              let n = 0, open = 0; const step = Math.max(1, Math.min(x1 - x0, y1 - y0) / 12);
              for (let x = x0 + step / 2; x < x1; x += step) for (let y = y0 + step / 2; y < y1; y += step) { const q = { x, y }; if (!inR(q, pc)) continue; n++; const r = s.grid.probe(q); if (r && r.status === "value" && (r.cls === "infill" || r.cls === "transition")) open++; }
              const holdsHole = L.limitRegions.some((r) => r.holes.some((h) => inR(h[0], pc)));
              if (n > 0 && open === n && !holdsHole) closedOpen.push({ level: lv.level, at: { x: Math.round(a.x), y: Math.round(a.y) }, samples: n });
            }
          }
          for (const e of paved) for (let i = 1; i < pc.length; i++) for (let k = 0; k < e.ring.length; k++) {
            const A = e.ring[k], B = e.ring[(k + 1) % e.ring.length];
            const x = segX(pc[i - 1], pc[i], A, B); if (!x) continue;
            crossings++;
            // the element's own plane at the crossing: a probe a hair inside the outline
            const cx = e.ring.reduce((t, p) => t + p.x, 0) / e.ring.length, cy = e.ring.reduce((t, p) => t + p.y, 0) / e.ring.length;
            const l = Math.hypot(cx - x.x, cy - x.y) || 1; const r = s.grid.probe({ x: x.x + (cx - x.x) / l * 0.75, y: x.y + (cy - x.y) / l * 0.75 });
            if (r && r.status === "value" && Math.abs(r.ft - lv.level) > iv / 2 + 0.05) crossBad.push({ id: e.id, level: lv.level, plane: +r.ft.toFixed(2), at: { x: Math.round(x.x), y: Math.round(x.y) } });
          }
        }
        let margin = null;
        if (L.mode === "boundary") {
          const basis = L.basis || { marginFt: 10, bufferFt: 0 };
          const need = (basis.marginFt || 0) + (basis.bufferFt || 0);
          const pr = H.ring;
          const dSeg = (p, a, b) => { const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1; const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)); return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy); };
          let minD = Infinity, outside = 0, n = 0;
          for (const r of L.limitRegions) for (const v of r.outer) { n++; if (!inR(v, pr)) outside++; let d = Infinity; for (let k = 0; k < pr.length; k++) d = Math.min(d, dSeg(v, pr[k], pr[(k + 1) % pr.length])); minD = Math.min(minD, d); }
          const sbRing = H.model && H.model.setback && H.model.setback.rings && H.model.setback.rings[0];
          let onSetback = 0; if (sbRing) for (const r of L.limitRegions) for (const v of r.outer) { let d = Infinity; for (let k = 0; k < sbRing.length; k++) d = Math.min(d, dSeg(v, sbRing[k], sbRing[(k + 1) % sbRing.length])); if (d < 1) onSetback++; }
          margin = { need, minD: +minD.toFixed(2), outside, n, onSetback, areaAc: +L.areaAc.toFixed(2) };
        }
        return { closedOpen, crossBad, crossings, margin };
      });
      check(`(R8-k) ${tag}: zero closed proposed rings whose interior is open ground`, r8.closedOpen.length === 0, JSON.stringify(r8.closedOpen));
      // (R8-l) is judged in boundary mode (the round-8 surface); layout mode's rounded limit corners cut inside a row's own
      // corner (round 4's opening by the corner radius), so a slope contour can graze that corner there — reported, not judged
      if (mode === "boundary") check(`(R8-l) ${tag}: no proposed contour crosses a pavement outline except where that pavement's own plane reaches the level`, r8.crossBad.length === 0, `${r8.crossings} crossings · bad ${JSON.stringify(r8.crossBad.slice(0, 6))}`);
      else notes.push(`  · (R8-l) ${tag} (reported, layout mode): ${r8.crossings} crossings · ${r8.crossBad.length} at a level the pavement does not reach — ${JSON.stringify(r8.crossBad.slice(0, 3))}`);
      if (r8.margin) check(`(R8-m) ${tag}: the limit is inside the parcel by the grading margin everywhere, never on the setback`, r8.margin.outside === 0 && r8.margin.minD >= r8.margin.need - 0.5 && r8.margin.onSetback < r8.margin.n * 0.05, JSON.stringify(r8.margin));
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
      // ---- ROUND 7 (i): the daylight polygon is smooth — closed, never crossing itself, no staircase on the earthwork lattice
      const smooth = await page.evaluate(() => {
        const m = window.__harness.model, s = window.__harness.gradeSurface; const cf = m.cutfill;
        const cells = s.grid.cells; const dx = cells[0].wFt, dy = cells[0].hFt;
        const x0 = Math.min(...cells.map((c) => c.x)) - dx / 2, y0 = Math.min(...cells.map((c) => c.y)) - dy / 2;
        const runs = (ring) => {
          let corner = 0, cRun = 0, edge = 0, eRun = 0, prev = 0;
          for (const p of ring) {
            const fx = Math.abs(((p.x - x0) / dx) % 1), fy = Math.abs(((p.y - y0) / dy) % 1);
            const onX = Math.min(fx, 1 - fx) < 2e-3, onY = Math.min(fy, 1 - fy) < 2e-3;
            cRun = onX && onY ? cRun + 1 : 0; corner = Math.max(corner, cRun);
            const kind = onX && !onY ? 1 : onY && !onX ? 2 : onX && onY ? 3 : 0;
            if (kind && prev && kind !== prev) eRun += 1; else eRun = kind ? 1 : 0; edge = Math.max(edge, eRun); prev = kind;
          }
          return { corner, edge };
        };
        const crosses = (r) => { const n = r.length; for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) { if (i === 0 && j === n - 1) continue; const a = r[i], b = r[(i + 1) % n], c = r[j], d = r[(j + 1) % n]; const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x); if (Math.abs(den) < 1e-12) continue; const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den, u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / den; if (t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9) return true; } return false; };
        const rings = [...(cf.daylightRings || []), ...(cf.innerRings || [])];
        const traced = cf.bandMode !== "boundary";             // boundary: the daylight line IS the limit (B2376240), any vertex count
        const dl = document.querySelector("[data-daylight-line]"), inner = document.querySelector("[data-band-inner]");
        const subpaths = (el) => (el ? (el.getAttribute("d").match(/M/g) || []).length : 0), closes = (el) => (el ? (el.getAttribute("d").match(/Z/gi) || []).length : 0);
        const each = rings.map((r, i) => ({ n: r.length, needN: traced || i >= (cf.daylightRings || []).length ? 9 : 3, ...runs(r), crosses: crosses(r) }));
        return { rings: (cf.daylightRings || []).length, each, drawn: subpaths(dl), closed: closes(dl), inner: subpaths(inner), innerClosed: closes(inner), source: cf.bandSource };
      });
      check(`(i) ${tag}: the daylight polygon is smooth — every ring closed, never crossing itself, no run of more than two vertices on cell corners / edges`,
        smooth.rings > 0 && smooth.drawn === smooth.rings && smooth.closed === smooth.drawn && smooth.innerClosed === smooth.inner && smooth.each.every((r) => r.n >= r.needN && !r.crosses && r.corner <= 2 && r.edge <= 2),
        `${smooth.rings} ring(s) [${smooth.each.map((r) => `${r.n}v corner ${r.corner} edge ${r.edge}${r.crosses ? " CROSSES" : ""}`).join("; ")}] · drawn ${smooth.drawn}/${smooth.closed} closed · inner ${smooth.inner} · source ${smooth.source}`);
      // ---- ROUND 7 (j) + (k): the tint rendered ALONE, against the band polygon; then the contours against the tint
      const tint = await page.evaluate(async (brownSrc) => {
        const brown = new Function("return " + brownSrc)();
        const svg = document.getElementById("canvas"), W = svg.width.baseVal.value, H = svg.height.baseVal.value;
        const img = document.querySelector("[data-band-tint]"), g = img.parentNode, clip = document.querySelector("[data-band-clip]");
        const M = g.getCTM();
        const clone = g.cloneNode(true); for (const el of clone.querySelectorAll("path:not([data-band-clip])")) el.remove();
        clone.setAttribute("transform", `matrix(${M.a} ${M.b} ${M.c} ${M.d} ${M.e} ${M.f})`);
        const xml = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}">${new XMLSerializer().serializeToString(clone)}</svg>`;
        const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml" })); const im = new Image(); im.src = url; await im.decode();
        const c = document.createElement("canvas"); c.width = W; c.height = H; const ctx = c.getContext("2d"); ctx.drawImage(im, 0, 0); URL.revokeObjectURL(url);
        const d = ctx.getImageData(0, 0, W, H).data;
        const inv = M.inverse(), pt = svg.createSVGPoint();
        const inBand = (x, y) => { pt.x = x; pt.y = y; return clip.isPointInFill(pt.matrixTransform(inv)); };
        const near = (x, y, r) => { for (const [ox, oy] of [[0, 0], [-r, 0], [r, 0], [0, -r], [0, r], [-r, -r], [r, -r], [-r, r], [r, r]]) if (inBand(x + ox, y + oy)) return true; return false; };
        // a band thinner than a pixel antialiases to a faint tint: look for it on a quarter-pixel grid before calling a pixel "outside"
        const nearDense = (x, y, r) => { for (let oy = -r; oy <= r; oy += 0.25) for (let ox = -r; ox <= r; ox += 0.25) if (inBand(x + ox, y + oy)) return true; return false; };
        const deep = (x, y, r) => { for (const [ox, oy] of [[0, 0], [-r, 0], [r, 0], [0, -r], [0, r]]) if (!inBand(x + ox, y + oy)) return false; return true; };
        const { d: full } = window.__px;
        const outSamples = [];
        let tinted = 0, outside = 0, deepN = 0, deepTinted = 0, strong = 0, brownIn = 0, maxA = 0;
        for (let y = 1; y < H; y += 2) for (let x = 1; x < W; x += 2) {
          const k = (y * W + x) * 4, a = d[k + 3];
          if (a > 0) { tinted++; maxA = Math.max(maxA, a); if (!near(x + 0.5, y + 0.5, 2) && !nearDense(x + 0.5, y + 0.5, 2)) { outside++; if (outSamples.length < 6) outSamples.push([x, y, a]); } }
          if (deep(x + 0.5, y + 0.5, 3)) { deepN++; if (a > 0) deepTinted++; if (a >= 77) strong++; if (brown(full[k], full[k + 1], full[k + 2])) brownIn++; }
        }
        return { outSamples, tinted, outside, deepN, deepTinted, cover: deepTinted / Math.max(1, deepN), strong, brownIn, maxAlpha: +(maxA / 255).toFixed(3) };
      }, brown.toString());
      if (tint.tinted <= 200) notes.push(`  · (j)/(k) ${tag}: no slope band in this view (${tint.tinted} tint px) — judged in the other views of this mode`);
      else {
        bandJudged[mode] = (bandJudged[mode] || 0) + 1;
        check(`(j) ${tag}: the hatch is clipped to the polygon — zero tint pixels outside the band (2 px margin), and the tint reaches the outline`,
          tint.outside === 0 && tint.cover >= 0.97, JSON.stringify(tint));
      }
      if (tint.tinted > 200 && zoom !== "site") check(`(k) ${tag}: inside the band the contours outnumber any stroke-weight tint, and the tint stays a tint (≤ 0.25)`,
        tint.brownIn > 50 && tint.brownIn > tint.strong && tint.maxAlpha <= 0.26, `contour px ${tint.brownIn} vs stroke-weight tint px ${tint.strong} · max tint ${tint.maxAlpha}`);
      else notes.push(`  · (k) ${tag} (reported, the parcel view draws index lines only): contour px ${tint.brownIn} vs stroke-weight tint px ${tint.strong} · max tint ${tint.maxAlpha}`);
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
  check("(j) known-good coverage: the clip was judged on a view carrying the band in BOTH limit modes", (bandJudged.layout || 0) > 0 && (bandJudged.boundary || 0) > 0, JSON.stringify(bandJudged));
  // the top-of-bank straightness test for (o): offsets along the line (ft) and the worst deviation from the least-squares line
  const STRAIGHT_OFFS = [-40, -32, -24, -16, -8, 0, 8, 16, 24, 32, 40];
  const straightDev = (xs, ys) => { const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
    const sl = xs.reduce((a, x, k) => a + (x - mx) * (ys[k] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
    return Math.max(...xs.map((x, k) => Math.abs(ys[k] - (my + sl * (x - mx))))); };
  // ---- ROUND 9 (B2500224 ×2, owner live check 2026-10-30): the owner's Concept A (`owner=2`), "To the boundary", the NE (cut) and SW
  // (fill) corners of the building at about the 50-ft scale — and the owner's own path: open in "Around the layout", switch.
  {
    const verts = (d) => d.split("M").filter(Boolean).map((seg) => [...seg.matchAll(/[ML]?(-?[\d.]+) (-?[\d.]+)/g)].map((q) => ({ x: +q[1], y: +q[2] })));
    for (const zoom of ["ne50", "sw50"]) {
      const tag = `boundary-${zoom}-conceptA`;
      const page = await open(`?buildable=0&contours=1&zoom=${zoom}&mode=boundary&owner=2`);
      try { await waitPicture(page); } catch (e) { fails.push(`✗ ${tag}: the picture never settled — ${e.message.split("\n")[0]}`); await page.close(); continue; }
      await page.locator("#canvas").screenshot({ path: `${OUT}${tag}.png` });
      notes.push(`  · wrote ${OUT}${tag}.png`);
      const r = await page.evaluate(() => {
        const m = window.__harness.model, gs = window.__harness.gradeSurface, L = gs.grid.limit;
        const inR = (pt, ring) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) c = !c; } return c; };
        const inLimit = (pt) => L.limitRegions.some((rg) => inR(pt, rg.outer) && !rg.holes.some((h) => inR(pt, h)));
        const segD = (p, a, b) => { const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1; let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2; t = Math.max(0, Math.min(1, t)); return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy); };
        const toLimit = (p) => { let d = Infinity; for (const rg of L.limitRegions) for (const ring of [rg.outer, ...rg.holes]) for (let i = 0; i < ring.length; i++) d = Math.min(d, segD(p, ring[i], ring[(i + 1) % ring.length])); return d; };
        // existing contour vertices more than a foot inside the limit (the cut leaks)
        let ex = 0, exIn = 0;
        for (const ln of window.__harnessExisting || []) for (const p of ln.pts) { ex++; if (inLimit(p) && toLimit(p) > 1) exIn++; }
        // a paper-only strip inside the limit: walk inward from the limit along its normals at every 25 ft — the first point the
        // probe calls band (or graded ground) must come within one lattice cell of the line
        const cell = m.contours && m.contours.cellFt ? m.contours.cellFt : 6;
        let walks = 0, gaps = [];
        for (const rg of L.limitRegions) {
          const ring = rg.outer;
          for (let i = 0; i < ring.length; i++) {
            const a = ring[i], b = ring[(i + 1) % ring.length], len = Math.hypot(b.x - a.x, b.y - a.y);
            if (len < 60) continue;
            let n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            if (!inLimit({ x: mid.x + n.x * 3, y: mid.y + n.y * 3 })) n = { x: -n.x, y: -n.y };
            for (let s2 = 25; s2 < len - 25; s2 += 25) {
              const o = { x: a.x + (b.x - a.x) * s2 / len, y: a.y + (b.y - a.y) * s2 / len };
              walks++;
              let first = null;
              for (let d = 0.5; d < 4 * cell; d += 0.5) { const q = gs.grid.probe({ x: o.x + n.x * d, y: o.y + n.y * d }); if (q.status === "value") { first = d; break; } }
              if (first == null || first > cell) gaps.push({ x: Math.round(o.x), y: Math.round(o.y), first });
            }
          }
        }
        // the band's DRAWN contours along transects normal to the long limit edges: consecutive spacings of the levels drawn
        const drawn = [...document.querySelectorAll('[data-layer="contours"] g[data-contour-level]')].map((g) => ({ level: +g.getAttribute("data-contour-level"), d: g.querySelector("path").getAttribute("d") }));
        return { ex, exIn, walks, gaps: gaps.slice(0, 8), nGaps: gaps.length, cell, drawn, limit: L.limitRegions.map((rg) => rg.outer), bandLimit: document.querySelector("[data-layer=cutfill]")?.getAttribute("data-band-limit"), panelLimit: document.querySelector("[data-graded-area]")?.getAttribute("data-limit-sig") };
      });
      check(`(n) ${tag}: zero existing-contour vertices inside the limit (known-good: there is existing ink outside it)`, r.ex > 100 && r.exIn === 0, `${r.exIn} inside of ${r.ex}`);
      check(`(n) ${tag}: no paper-only strip inside the limit — graded ground starts within one lattice cell (${r.cell} ft) of the line on every walk`, r.walks > 20 && r.nGaps === 0, `${r.nGaps} of ${r.walks} walks · ${JSON.stringify(r.gaps)}`);
      check(`(n) ${tag}: the band painted is the one composed against the limit the panel names`, !!r.bandLimit && r.bandLimit === r.panelLimit, `band ${String(r.bandLimit).slice(0, 40)} · panel ${String(r.panelLimit).slice(0, 40)}`);
      // (o) evenly spaced band contours, read off the drawn paths: along normals into the band from each long straight limit edge,
      // consecutive crossings of DRAWN levels are equal within 10% (the bank body; the last three crossings are the toe)
      const pieces = r.drawn.flatMap((lv) => verts(lv.d).map((pc) => ({ level: lv.level, pc })));
      // a transect is judged where the line's own ground is straight across ±40 ft (within 0.4 ft of its least-squares line): there the bank is
      // a plane and its contours must be parallel and even; where the ground bends along the line (a ravine meeting it) the bank's
      // contours bend with it — correct — and are skipped (counted). Tolerance: 10%, or 0.15 of the contour lattice's cell, the
      // tracer's own resolution, whichever is larger.
      const gAt = await page.evaluate((pts) => pts.map((p) => window.__harnessExistAt(p)), r.limit.flatMap((ring) => ring.flatMap((a, i) => {
        const b = ring[(i + 1) % ring.length], len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 250) return [];
        const tx = (b.x - a.x) / len, ty = (b.y - a.y) / len;
        return [0.35, 0.5, 0.65].flatMap((t) => STRAIGHT_OFFS.map((o) => ({ x: a.x + (b.x - a.x) * t + tx * o, y: a.y + (b.y - a.y) * t + ty * o })));
      })));
      let gk = 0, skippedBent = 0;
      const runs = [];
      for (const ring of r.limit) for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length], len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 250) continue;
        const nIn = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
        for (const t of [0.35, 0.5, 0.65]) {
          const g = gAt.slice(gk, gk + STRAIGHT_OFFS.length); gk += STRAIGHT_OFFS.length;
          if (g.some((v) => v == null) || straightDev(STRAIGHT_OFFS, g) > 0.4) { skippedBent++; continue; }
          for (const sg of [1, -1]) {
          const o = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, e = { x: o.x + sg * nIn.x * 90, y: o.y + sg * nIn.y * 90 };
          const hits = [];
          for (const { pc } of pieces) for (let k = 1; k < pc.length; k++) {
            const p = pc[k - 1], q = pc[k];
            const d1 = (e.x - o.x) * (p.y - o.y) - (e.y - o.y) * (p.x - o.x), d2 = (e.x - o.x) * (q.y - o.y) - (e.y - o.y) * (q.x - o.x);
            const d3 = (q.x - p.x) * (o.y - p.y) - (q.y - p.y) * (o.x - p.x), d4 = (q.x - p.x) * (e.y - p.y) - (q.y - p.y) * (e.x - p.x);
            if (d1 * d2 < 0 && d3 * d4 < 0) { const tt = d3 / (d3 - d4); hits.push(Math.hypot((e.x - o.x) * tt, (e.y - o.y) * tt)); }
          }
          hits.sort((x, y) => x - y);
          // the bank's body: the first crossing is where a line weaves along the limit itself (the daylight), the last three the toe
          const sp = hits.slice(1).map((h, k) => h - hits[k]).slice(1, -3);
          if (sp.length >= 3) runs.push(sp);
          }
        }
      }
      const tolOf = (med) => 0.05 * med;   // ROUND 10: 5% flat — the old `max(10%, 0.15 cell)` was 0.9 ft on a 4 ft spacing and let a 20% scatter through (owner 2026-10-30 7:15 PM)
      const uneven = runs.filter((sp) => { const med = [...sp].sort((x, y) => x - y)[sp.length >> 1]; return sp.some((v) => Math.abs(v - med) > tolOf(med)); });
      check(`(o) ${tag}: the drawn band contours are evenly spaced along every transect across a straight run (within 5% of the median; the PNG transect proof is verify-grading-round10)`, runs.length >= 2 && uneven.length === 0, `${runs.length} transects judged · ${skippedBent} skipped where the line's ground bends · uneven ${uneven.length}${uneven.length ? " e.g. " + uneven[0].map((v) => v.toFixed(1)).join(" ") : ""}`);
      await page.close();
    }
    // the owner's path: the plan opens "Around the layout", then "To the boundary" is chosen in the panel — at NO moment after the
    // panel names the boundary may the map paint a band or contours traced against the layout limit (the measured defect)
    {
      const page = await open(`?buildable=0&contours=1&zoom=ne50&mode=layout&owner=2`);
      await waitPicture(page);
      const layoutSig = await page.evaluate(() => document.querySelector("[data-graded-area]").getAttribute("data-limit-sig"));
      await page.locator('[data-testid="grading-limit-mode"]').getByText("To the boundary").click();
      await page.waitForFunction(() => document.querySelector("[data-graded-area]")?.getAttribute("data-limit-mode") === "boundary", null, { timeout: 120000 });
      const seen = [];
      for (let k = 0; k < 60; k++) {
        seen.push(await page.evaluate(() => ({ panel: document.querySelector("[data-graded-area]")?.getAttribute("data-limit-sig"),
          band: document.querySelector("[data-layer=cutfill]")?.getAttribute("data-band-limit") || "", src: document.querySelector("[data-layer=cutfill]")?.getAttribute("data-band-source") || "",
          contours: document.querySelector("[data-layer=contours]")?.getAttribute("data-contour-limit") || "" })));
        if (seen[seen.length - 1].band && seen[seen.length - 1].contours) break;
        await page.waitForTimeout(250);
      }
      const bad = seen.filter((x) => (x.band && x.band !== x.panel) || (x.contours && x.contours !== x.panel) || x.src === "contours");
      check("(n) mode switch layout → boundary: no frame after the switch paints the layout limit's band or contours under the boundary label", layoutSig && bad.length === 0 && seen.length > 0, `${seen.length} samples · bad ${bad.length}${bad.length ? " " + JSON.stringify(bad[0]).slice(0, 160) : ""}`);
      check("(n) mode switch: the boundary picture lands (band + contours traced against the new limit)", !!seen.length && !!seen[seen.length - 1].band && !!seen[seen.length - 1].contours, JSON.stringify(seen[seen.length - 1] || {}).slice(0, 160));
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
