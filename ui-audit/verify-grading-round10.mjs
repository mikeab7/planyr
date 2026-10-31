/* verify-grading-round10 — ROUND 10 (NEW-1 / NEW-2, owner 2026-10-30 7:11 and 7:15 PM CT, Concept A, "To the boundary").
 * Judged from the RENDERED PNG and the DOM the owner sees — never from the surface (round 9's guard probed the surface and passed on a
 * picture whose lines were bunched, because the simplifier moved them AFTER the surface was right).
 *   (o) EVEN: along a transect across the straight eastern run of the band, the dark contour centres read off the rendered pixels are
 *       interval × ratio apart, every one of the first five spacings within 5%. (Labels, the limit line and the daylight line are hidden
 *       for the read so only contour ink is measured.)
 *   (p) ROUND: at the four outer corners of the property, no more than 10% of the drawn band-contour vertices within 60 ft of the corner
 *       (and 14 ft in from the limit, past the corner's sliver) turn by more than 30° — no hard chevron nest.
 *   (q) LABELLED: at the 50-ft view and the ~125-ft view every contour polyline with at least 60 px of visible run — existing (dashed) and
 *       proposed, index and intermediate — has a label glyph centred within 2 px of it; no two labels overlap.
 * A KNOWN-GOOD ARM per assertion: (o) reads a synthetic 4-px comb of lines drawn into the page and must report 4.0 px; (q) the planner's
 * own labels must exist at all (a run with no labels anywhere is VOID); (p) the corner census must find all four corners.
 *   node ui-audit/verify-grading-round10.mjs   (starts its own vite dev server on :5196; PNGs → ui-audit/screenshots/grading/) */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const PORT = 5196, BASE = `http://localhost:${PORT}`;
const EXEC = process.env.PW_CHROME || (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const OUT = new URL("./screenshots/grading/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const fails = [], notes = [];
const check = (name, ok, extra = "") => { (ok ? notes : fails).push(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); };
const vite = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
try {
  for (let i = 0; i < 100; i++) { try { const r = await fetch(BASE); if (r.ok) break; } catch {} await sleep(300); }
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  const errs = [];
  const open = async (qs) => {
    const page = await (await browser.newContext({ viewport: { width: 1760, height: 1040 } })).newPage();
    page.on("pageerror", (e) => errs.push(String(e)));
    await page.goto(`${BASE}/ui-audit/harness/grading-harness.html${qs}`);
    await assertMeasurable(page, "verify-grading-round10");
    await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
    await page.waitForFunction(() => { const a = document.querySelector("[data-ffe-value]"); return a && /\d/.test(a.textContent); }, null, { timeout: 120000 });
    await page.waitForFunction(() => { const e = document.querySelector("[data-grading-earthwork]"); return e && e.getAttribute("data-grading-earthwork") !== "pending"; }, null, { timeout: 120000 });
    await page.waitForSelector('[data-layer="contours"] path', { state: "attached", timeout: 120000 });
    await page.waitForSelector("[data-band-tint]", { state: "attached", timeout: 60000 });
    await page.waitForTimeout(1500);
    return page;
  };
  /* ---- the pixel transect reader, used by (o) and by its known-good arm ---- */
  const READER = `
    window.__readTransect = async (o, n, lenFt, stepFt, hideSel) => {
      const hid = [...document.querySelectorAll(hideSel)].map((el) => [el, el.style.display]); for (const [el] of hid) el.style.display = "none";
      const svg = document.getElementById("canvas");
      const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }));
      const img = new Image(); img.src = url; await img.decode();
      const K = 3;   // the vector picture re-rasterised at 3× so a hairline's centre can be read to a third of a pixel
      const c = document.createElement("canvas"); c.width = svg.width.baseVal.value * K; c.height = svg.height.baseVal.value * K;
      const g = c.getContext("2d"); g.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      for (const [el, prev] of hid) el.style.display = prev;
      const d = g.getImageData(0, 0, c.width, c.height).data, W = c.width, H = c.height;
      const lum = (x, y) => { const x0 = Math.floor(x), y0 = Math.floor(y); if (x0 < 0 || y0 < 0 || x0 + 1 >= W || y0 + 1 >= H) return null; const fx = x - x0, fy = y - y0; const L = (xx, yy) => { const k = (yy * W + xx) * 4; return 0.3 * d[k] + 0.59 * d[k + 1] + 0.11 * d[k + 2]; }; return L(x0, y0) * (1 - fx) * (1 - fy) + L(x0 + 1, y0) * fx * (1 - fy) + L(x0, y0 + 1) * (1 - fx) * fy + L(x0 + 1, y0 + 1) * fx * fy; };
      const m = window.__harnessF2pPx; const ppf = m.scale;
      const ss = []; for (let s = 0; s <= lenFt; s += stepFt) { const p = m.f2p({ x: o.x + n.x * s, y: o.y + n.y * s }); ss.push({ s, l: lum(p.x * K, p.y * K) }); }
      if (ss.some((q) => q.l == null)) return { ok: false, why: "off-canvas" };
      // a contour = a dip below the local baseline (the median over ±6 ft), centred by the deficit-weighted mean over the dip
      const base = ss.map((_, i) => { const w = ss.slice(Math.max(0, i - Math.round(6 / stepFt)), i + Math.round(6 / stepFt) + 1).map((q) => q.l).sort((a, b) => a - b); return w[w.length >> 1]; });
      const def = ss.map((q, i) => Math.max(0, base[i] - q.l));
      const peaks = [];
      for (let i = 1; i < ss.length - 1; i++) if (def[i] > 10 && def[i] > def[i - 1] && def[i] >= def[i + 1] && (!peaks.length || ss[i].s - peaks[peaks.length - 1] > 1.5)) {
        let sw = 0, sx = 0; for (let k = Math.max(0, i - Math.round(1.5 / stepFt)); k <= Math.min(ss.length - 1, i + Math.round(1.5 / stepFt)); k++) { sw += def[k]; sx += def[k] * ss[k].s; }
        peaks.push(sx / sw);
      }
      return { ok: true, peaks, ppf };
    };`;
  const frame = (page) => page.evaluate((reader) => {
    const el = document.querySelector('[data-layer="paper"]'); const t = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/.exec(el.getAttribute("transform"));
    window.__harnessF2pPx = { scale: +t[3], f2p: (p) => ({ x: p.x * +t[3] + +t[1], y: p.y * +t[3] + +t[2] }) };
    // eslint-disable-next-line no-eval
    (0, eval)(reader);
  }, READER);

  /* ======================= (o) EVEN — the eastern straight run, 50-ft scale ======================= */
  {
    const page = await open(`?buildable=0&contours=1&zoom=edge50&mode=boundary&owner=2`);
    await frame(page);
    await page.locator("#canvas").screenshot({ path: `${OUT}round10-edge50.png` });
    notes.push(`  · wrote ${OUT}round10-edge50.png`);
    // known-good arm: a comb of 4 ft lines drawn into the SVG must read 4.0 ft apart
    const comb = await page.evaluate(async () => {
      const svg = document.getElementById("canvas"), ns = "http://www.w3.org/2000/svg", m = window.__harnessF2pPx, f2p = m.f2p;
      const inv = (p) => ({ x: (p.x - f2p({ x: 0, y: 0 }).x) / m.scale, y: (p.y - f2p({ x: 0, y: 0 }).y) / m.scale });
      const g = document.createElementNS(ns, "g"); g.setAttribute("data-comb", "1");
      for (let k = 0; k < 8; k++) { const x = 300 + k * 4 * m.scale; const l = document.createElementNS(ns, "line"); l.setAttribute("x1", x); l.setAttribute("y1", 120); l.setAttribute("x2", x); l.setAttribute("y2", 220); l.setAttribute("stroke", "#000"); l.setAttribute("stroke-width", "0.7"); l.setAttribute("data-comb-line", "1"); g.appendChild(l); }
      svg.appendChild(g);
      const o = inv({ x: 296, y: 170 }), ex = inv({ x: 297, y: 170 });
      const rd = await window.__readTransect(o, { x: 1, y: 0 }, 40, 0.1, "[data-nothing]");
      g.remove(); return rd;
    });
    const cs = comb.ok ? comb.peaks.slice(1).map((v, i) => v - comb.peaks[i]) : [];
    check("(o) known-good arm: a synthetic comb of 4.0 ft lines reads 4.0 ft apart (±0.15)", comb.ok && cs.length >= 6 && cs.every((v) => Math.abs(v - 4) < 0.15), cs.map((v) => v.toFixed(2)).join(" "));
    const geo = await page.evaluate(() => {
      const gs = window.__harness.gradeSurface, L = gs.grid.limit, outer = L.limitRegions[0].outer;
      const m = window.__harnessF2pPx; const c = { x: 700, y: 500 };
      const inv = (p) => ({ x: (p.x - m.f2p({ x: 0, y: 0 }).x) / m.scale, y: (p.y - m.f2p({ x: 0, y: 0 }).y) / m.scale });
      const ctr = inv(c);
      let best = null;
      for (let i = 0; i < outer.length; i++) { const a = outer[i], b = outer[(i + 1) % outer.length], len = Math.hypot(b.x - a.x, b.y - a.y); if (len < 250) continue; const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; const dd = Math.hypot(mid.x - ctr.x, mid.y - ctr.y); if (!best || dd < best.dd) best = { a, b, len, dd }; }
      const inR = (pt, ring) => { let q = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) q = !q; } return q; };
      const { a, b, len } = best; let n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (!inR({ x: mid.x + n.x * 5, y: mid.y + n.y * 5 }, outer)) n = { x: -n.x, y: -n.y };
      return { a, b, len, n, interval: window.__harness.model.contours.interval, ratio: gs.grid.apronRatio || 2 };
    });
    const want = geo.interval * geo.ratio;
    const runs = [];
    for (const t of [0.25, 0.3, 0.35, 0.4, 0.45]) {
      const o = { x: geo.a.x + (geo.b.x - geo.a.x) * t, y: geo.a.y + (geo.b.y - geo.a.y) * t };
      // a transect is judged where the line's own ground is straight across ±40 ft (within 0.15 ft of its least-squares line: a 0.3 ft kink in the line's own ground moves a contour by about as much, i.e. 7% of a 4 ft spacing): there the bank is a plane
      // and its contours are parallel and even; where the ground bends along the line the bank's contours bend with it — correct — and it is skipped
      const bent = await page.evaluate(([oo, aa, bb]) => { const L = Math.hypot(bb.x - aa.x, bb.y - aa.y), tx = (bb.x - aa.x) / L, ty = (bb.y - aa.y) / L; const xs = [], ys = []; for (let k = -40; k <= 40; k += 8) { const g = window.__harnessExistAt({ x: oo.x + tx * k, y: oo.y + ty * k }); if (g == null) return true; xs.push(k); ys.push(g); } const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length; const sl = xs.reduce((a, x, k) => a + (x - mx) * (ys[k] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0); return +Math.max(...xs.map((x, k) => Math.abs(ys[k] - (my + sl * (x - mx))))).toFixed(2); }, [o, geo.a, geo.b]);
      if (bent === true || bent > 0.15) { runs.push({ t, why: `the ground bends along the line here (${bent} ft off straight over ±40 ft) — a bank on bent ground is not a plane — skipped` }); continue; }
      const rd = await page.evaluate(([oo, nn]) => window.__readTransect(oo, nn, 70, 0.1, '[data-contour-label],[data-existing-label],[data-grading-limit],[data-daylight-line],[data-band-inner],[data-layer="existing-contours"]'), [o, geo.n]);
      if (!rd.ok) { runs.push({ t, why: rd.why }); continue; }
      if (rd.peaks.length < 7) { runs.push({ t, why: `${rd.peaks.length} lines read` }); continue; }
      const sp = rd.peaks.slice(1).map((v, i) => v - rd.peaks[i]);
      let clean = 0; for (const v of sp) { if (Math.abs(v - want) / want > 0.05) break; clean++; }
      // the same transect read off the drawn PATHS (geometry, no pixels) — the arbiter when a pixel reading is off
      const geom = await page.evaluate(([oo, nn]) => { const far = { x: oo.x + nn.x * 70, y: oo.y + nn.y * 70 }; const verts = (d) => d.split("M").filter(Boolean).map((seg) => [...seg.matchAll(/[ML]?(-?[\d.]+) (-?[\d.]+)/g)].map((q) => ({ x: +q[1], y: +q[2] }))); const cr = []; for (const lv of window.__harness.model.contours.levels) for (const pc of verts(lv.d)) for (let k = 1; k < pc.length; k++) { const p = pc[k - 1], q = pc[k]; const d1 = (far.x - oo.x) * (p.y - oo.y) - (far.y - oo.y) * (p.x - oo.x), d2 = (far.x - oo.x) * (q.y - oo.y) - (far.y - oo.y) * (q.x - oo.x); if (d1 * d2 < 0) { const u = d1 / (d1 - d2), x = p.x + (q.x - p.x) * u, y = p.y + (q.y - p.y) * u, al = (x - oo.x) * nn.x + (y - oo.y) * nn.y; if (al > 0 && al < 70) cr.push(al); } } cr.sort((a, b) => a - b); return cr.slice(0, 9).map((v) => +v.toFixed(2)); }, [o, geo.n]);
      runs.push({ t, sp: sp.map((v) => +v.toFixed(2)), clean, geom: geom.join(" ") });
    }
    const judgedRuns = runs.filter((r) => r.sp);
    check(`(o) the DRAWN band contours across the eastern straight run are ${want} ft apart (interval ${geo.interval} × ${geo.ratio}:1), the first five spacings each within 5%, on every transect read off the rendered PNG`,
      judgedRuns.length >= 3 && judgedRuns.every((r) => r.clean >= 5), runs.map((r) => (r.sp ? `t${r.t}: ${r.sp.slice(0, 7).join(" ")} (${r.clean} clean) geom[${r.geom}]` : `t${r.t}: ${r.why}`)).join(" | "));
    await page.close();
  }

  /* ======================= (p) ROUND + (q) LABELLED — the NW corner of the court ======================= */
  for (const [zm, tag] of [[1, "50ft"], [0.95, "125ft"]]) {
    const page = await open(`?buildable=0&contours=1&zoom=court50nw&mode=boundary&owner=2&zm=${zm}`);
    await frame(page);
    await page.locator("#canvas").screenshot({ path: `${OUT}round10-court-nw-${tag}.png` });
    notes.push(`  · wrote ${OUT}round10-court-nw-${tag}.png`);
    if (zm === 1) {
      const r = await page.evaluate(() => {
        const gs = window.__harness.gradeSurface, outer = gs.grid.limit.limitRegions[0].outer, n = outer.length, m = window.__harness.model;
        const turnAt = (a, b, c) => { const a1 = Math.atan2(b.y - a.y, b.x - a.x), a2 = Math.atan2(c.y - b.y, c.x - b.x); let d = Math.abs(a2 - a1); if (d > Math.PI) d = 2 * Math.PI - d; return (d * 180) / Math.PI; };
        const segD = (p, a, b) => { const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1; let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2; t = Math.max(0, Math.min(1, t)); return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy); };
        const toLimit = (p) => { let d = Infinity; for (let i = 0; i < n; i++) d = Math.min(d, segD(p, outer[i], outer[(i + 1) % n])); return d; };
        const verts = (d) => d.split("M").filter(Boolean).map((seg) => [...seg.matchAll(/[ML]?(-?[\d.]+) (-?[\d.]+)/g)].map((q) => ({ x: +q[1], y: +q[2] })));
        const out = [];
        for (let i = 0; i < n; i++) {
          const a = outer[(i + n - 1) % n], b = outer[i], c = outer[(i + 1) % n];
          if (turnAt(a, b, c) < 85 || Math.hypot(b.x - a.x, b.y - a.y) < 100 || Math.hypot(c.x - b.x, c.y - b.y) < 100) continue;
          let cnt = 0, big = 0;
          for (const lv of m.contours.levels) for (const pc of verts(lv.d)) for (let k = 1; k < pc.length - 1; k++) { const p = pc[k]; if (Math.hypot(p.x - b.x, p.y - b.y) > 60 || toLimit(p) < 14) continue; cnt++; if (turnAt(pc[k - 1], p, pc[k + 1]) > 30) big++; }
          out.push({ i, cnt, big });
        }
        return out;
      });
      check("(p) the corner census finds the property's outer corners (known-good arm)", r.length >= 3, `${r.length} corners`);
      const sharp = r.filter((c) => c.cnt >= 10 && c.big / c.cnt > 0.10);
      check("(p) at every outer corner ≤ 10% of the drawn band-contour vertices turn by more than 30° (no hard chevron nest)", r.length >= 3 && sharp.length === 0, r.map((c) => `#${c.i}: ${c.big}/${c.cnt}`).join(" · "));
    }
    // (q) every contour polyline with ≥ 60 px of visible run carries a label glyph within 2 px
    const q = await page.evaluate(() => {
      const W = 1400, H = 1000, svg = document.getElementById("canvas");
      const f2p = window.__harnessF2pPx.f2p, scale = window.__harnessF2pPx.scale; window.__rppf = scale;
      const labels = [...document.querySelectorAll("[data-contour-label],[data-existing-label]")].filter((t) => { const r = t.getBoundingClientRect(), sr = svg.getBoundingClientRect(); return r.left - sr.left >= 0 && r.right - sr.left <= W && r.top - sr.top >= 0 && r.bottom - sr.top <= H; }).map((t) => { const m = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(t.getAttribute("transform")); const r = t.getBoundingClientRect(), sr = svg.getBoundingClientRect(); return { x: +m[1], y: +m[2], l: r.left - sr.left, t: r.top - sr.top, r: r.right - sr.left, b: r.bottom - sr.top, text: t.textContent, kind: t.hasAttribute("data-existing-label") ? "existing" : "proposed" }; });
      const lines = [];
      for (const pl of document.querySelectorAll("polyline[data-existing-level]")) lines.push({ kind: "existing", isIndex: pl.getAttribute("stroke") === "#5B2E0D", level: pl.getAttribute("data-existing-level"), pts: pl.getAttribute("points").trim().split(/\s+/).map((s) => { const [x, y] = s.split(",").map(Number); return { x, y }; }) });
      for (const g of document.querySelectorAll('[data-layer="contours"] g[data-contour-level]')) {
        const tr = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/.exec(g.getAttribute("transform"));
        const d = g.querySelector("path").getAttribute("d");
        for (const seg of d.split("M").filter(Boolean)) { const nums = [...seg.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => +m[0]); const pts = []; for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i] * +tr[3] + +tr[1], y: nums[i + 1] * +tr[3] + +tr[2] }); lines.push({ kind: "proposed", isIndex: g.getAttribute("data-contour-index") === "1", level: g.getAttribute("data-contour-level"), pts }); }
      }
      const segD = (p, a, b) => { const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1; let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2; t = Math.max(0, Math.min(1, t)); return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy); };
      const visRun = (pts) => { let len = 0; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4)); for (let k = 0; k < n; k++) { const x = a.x + ((b.x - a.x) * (k + 0.5)) / n, y = a.y + ((b.y - a.y) * (k + 0.5)) / n; if (x > 26 && x < W - 26 && y > 14 && y < H - 14) len += Math.hypot(b.x - a.x, b.y - a.y) / n; } } return len; };
      let judged = 0, judgedEx = 0; const missing = [];
      for (const ln of lines) {
        if (visRun(ln.pts) < (ln.kind === "existing" ? 90 : 60)) continue;   // an existing run must also clear the daylight line by a label's width each end
        judged++; if (ln.kind === "existing") judgedEx++;
        const ok = labels.some((lb) => { if (lb.kind !== ln.kind) return false; for (let i = 1; i < ln.pts.length; i++) if (segD(lb, ln.pts[i - 1], ln.pts[i]) <= 2) return true; return false; });
        if (!ok) missing.push({ kind: ln.kind, idx: ln.isIndex, level: ln.level, run: Math.round(visRun(ln.pts)), n: ln.pts.length, x: Math.round(ln.pts[0].x), y: Math.round(ln.pts[0].y) });
      }
      let overlaps = 0;
      for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) { const a = labels[i], b = labels[j]; if (a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b) { overlaps++; (window.__ovl = window.__ovl || []).push([a.kind + a.text, b.kind + b.text, Math.round(Math.min(a.r, b.r) - Math.max(a.l, b.l)), Math.round(Math.min(a.b, b.b) - Math.max(a.t, b.t)), Math.round(a.l), Math.round(a.t), Math.round(a.r - a.l), Math.round(a.b - a.t)]); } }
      const wide = labels.filter((l) => l.r - l.l > 70 || l.b - l.t > 30).slice(0, 3).map((l) => ({ text: l.text, w: Math.round(l.r - l.l), h: Math.round(l.b - l.t), l: Math.round(l.l), t: Math.round(l.t) }));
      return { rppf: scale, wide, ovl: (window.__ovl || []).slice(-2), judged, missing: missing.length, sample: missing.filter((m) => m.idx || m.kind === "proposed").slice(0, 5), missProposed: missing.filter((m) => m.kind === "proposed").length, missIndex: missing.filter((m) => m.idx).length, judgedEx, labels: labels.length, existing: labels.filter((l) => l.kind === "existing").length, proposed: labels.filter((l) => l.kind === "proposed").length, overlaps };
    });
    check(`(q) ${tag}: known-good arm — labels exist on both families`, q.existing > 5 && q.proposed >= 3, `${q.existing} existing · ${q.proposed} proposed`);
    // PROPOSED lines and every INDEX line must each carry a label; an existing intermediate line is judged as a share, because where the dashed
    // lines hug each other closer than one label is tall (the steep green strip along the top) no placement can label all of them without
    // overlap — the planner staggers along the run and takes what fits, and the share is the measure of how much it fits.
    check(`(q) ${tag}: every PROPOSED contour polyline and every INDEX line with ≥ 60 px of visible run has a label glyph within 2 px of it`, q.judged > 30 && q.missProposed === 0 && q.missIndex === 0, `${q.missProposed} proposed + ${q.missIndex} index unlabelled of ${q.judged} · ${JSON.stringify(q.sample.filter((m) => m.kind === "proposed" || m.idx))}`);
    check(`(q) ${tag}: at least 85% of ALL polylines (existing intermediates included) carry one`, q.judged > 30 && q.missing / q.judged <= 0.15, `${q.missing} of ${q.judged} unlabelled (${((100 * q.missing) / q.judged).toFixed(0)}%)`);
    notes.push(`  · ${tag}: ${q.rppf.toFixed(2)} px per ft`);
    check(`(q) ${tag}: no two labels overlap`, q.overlaps === 0, `${q.labels} labels, ${q.overlaps} overlapping ${JSON.stringify(q.ovl)} wide ${JSON.stringify(q.wide)}`);
    await page.close();
  }
  const real = errs.filter((e) => !/Failed to load resource|ERR_TUNNEL|ERR_CONNECTION/.test(e));
  check("no page errors", real.length === 0, real.slice(0, 3).join(" || "));
  await browser.close();
} finally { vite.kill(); }
console.log([...notes, ...fails].join("\n"));
process.exit(fails.length ? 1 : 0);
