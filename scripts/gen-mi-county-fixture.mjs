#!/usr/bin/env node
/* NEW-1 (Michigan, 2026-10-19) — derives test/fixtures/miCounties.json's county roster (name, fips, interior centre, bbox, 5 spread points, 4 points beside
 * the county line) from the repo's own bundled county polygons, so no point is hand-picked. Usage: node scripts/gen-mi-county-fixture.mjs [out.json] */
import { readFileSync, writeFileSync } from "node:fs";
const STATE = process.env.STATE || "MI";
const d = JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8"));
const S = d.scale;
const dec = (r) => { const o = []; let x = r[0], y = r[1]; o.push([x / S, y / S]); for (let i = 2; i < r.length; i += 2) { x += r[i]; y += r[i + 1]; o.push([x / S, y / S]); } return o; };
const inRing = (p, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c; } return c; };
const segD = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
const depth = (p, rings) => { let m = 1e9; for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) m = Math.min(m, segD(p, r[j], r[i])); return m; };
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const out = [];
for (const c of d.counties.filter((c) => c.state === STATE).sort((a, b) => a.name.localeCompare(b.name))) {
  const rings = c.rings.map(dec);
  const inside = (p) => rings.some((r) => inRing(p, r));
  const [x0, y0, x1, y1] = c.bbox.map((v) => v / S);
  const N = 60, cand = [];
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) { const p = [x0 + ((x1 - x0) * i) / N, y0 + ((y1 - y0) * j) / N]; if (inside(p)) cand.push({ p, dep: depth(p, rings) }); }
  cand.sort((a, b) => b.dep - a.dep);
  const centre = cand[0].p;
  // 5 spread points: the centre, then greedy farthest-point picks among the well-interior candidates (so they spread across the county)
  const pool = cand.filter((q) => q.dep > cand[0].dep * 0.2).map((q) => q.p);
  const chosen = [centre];
  while (chosen.length < 5 && pool.length) { let bp = null, bd = -1; for (const q of pool) { const dm = Math.min(...chosen.map((c2) => Math.hypot(q[0] - c2[0], q[1] - c2[1]))); if (dm > bd) { bd = dm; bp = q; } } chosen.push(bp); }
  const spread = chosen.map((p) => [r4(p[1]), r4(p[0])]);
  // 4 line points: just inside the boundary toward N / E / S / W extremes
  const line = [];
  for (const [ax, ay] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
    let best = null;
    for (const q of cand) { const dd = q.dep; if (dd < 0.003 || dd > 0.012) continue; const s = q.p[0] * ax + q.p[1] * ay; if (!best || s > best.s) best = { s, p: q.p }; }
    if (best) line.push([r4(best.p[1]), r4(best.p[0])]);
  }
  out.push({ name: c.name, fips: c.fips, lat: r4(centre[1]), lng: r4(centre[0]), bbox: [r4(y0 - 0.01), r4(x0 - 0.01), r4(y1 + 0.01), r4(x1 + 0.01)], spread, line });
}
writeFileSync(process.argv[2] || "/dev/stdout", JSON.stringify({ source: "public/geo/county-polygons.json (bundled county boundaries)", counties: out }, null, 1));
console.error(out.length + " counties; spread<5: " + out.filter((c) => c.spread.length < 5).map((c) => c.name) + "; line<4: " + out.filter((c) => c.line.length < 4).map((c) => c.name));
