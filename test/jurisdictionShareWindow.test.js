import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  cityAreasFromFeatures, cityAreasFromFeaturesAsync, identifyCityShares, normalizeFeature, placeKey,
  citySourcesForPoint, etjSourcesForPoint, SHARE_WINDOW_PAD_M, SHARE_SLICE_MS,
} from "../src/workspaces/site-planner/lib/jurisdiction.js";
import {
  areaShare, ringsAsPolygons, esriPolygons, unionAreaSqM, distanceToBoundaryM, normalizePolys,
  siteWindow, clipRingToWindow, clipPolysToWindow, SQM_PER_ACRE,
} from "../src/workspaces/site-planner/lib/jurisdictionShare.js";
import { feetToLatLngPair } from "../src/workspaces/site-planner/lib/mapLock.js";
import { CITY_LIMIT_CLASSES } from "../src/workspaces/site-planner/lib/cityLimitClass.js";
import { createGisCache } from "../src/workspaces/site-planner/lib/gisCache.js";

/* ═════════════════════════════════════════════════════════════════════════════════════════════════════════
 * NEW-1 (slow report 55807aa9) — A JURISDICTION SHARE MUST NOT HOLD THE MAIN THREAD, AND MUST NOT CHANGE ITS ANSWER.
 *
 * The share pass dissolved each city's WHOLE published boundary (TxGIO's Baytown is 335 KB) once per parcel, inside the
 * continuation of the response that carried it: ~0.5–0.9 s per plan open on Bolt-on, all of it charged to
 * `Response.json.then:jurisdiction-…`. The fix cuts each boundary to a window around the site, dissolves it once per
 * jurisdiction, skips a per-parcel distance nothing reads, and time-slices the rest.
 *
 * ⛔ THE TWO THINGS THIS FILE HAS TO PROVE, because a speed-up that changes a number is a worse bug than the stall:
 *   1. EVERY NUMBER IS UNCHANGED — against the ORIGINAL algorithm, replayed verbatim below (`legacyCityAreas`), on the owner's
 *      own recorded boundaries (Goose Creek, Grand Port) and on randomised concave polygons with holes that cross the window.
 *   2. THE WINDOW IS NOT A NO-OP — a window that is too small to hold the site IS visible to the same comparison (the positive
 *      control), so "equal" cannot be the vacuous answer of a clip that never cut anything.
 * ═════════════════════════════════════════════════════════════════════════════════════════════════════════ */

const FIX = JSON.parse(fs.readFileSync(path.join(process.cwd(), "test/fixtures/jurisdictionAreas.json"), "utf8"));
const refOf = (rec) => [rec.origin.lon, rec.origin.lat];
const ringsOf = (rec) => rec.parcels.filter((p) => p.active !== "false").map((p) => p.pts.split(",").map((s) => {
  const [x, y] = s.trim().split(" ").map(Number);
  const [lat, lon] = feetToLatLngPair({ x, y }, rec.origin.lat, rec.origin.lon);
  return [lon, lat];
}));
const uniq = (a) => [...new Set(a)];

/* The ORIGINAL cityAreasFromFeatures (git 99c87bb), verbatim: whole published polygon, normalised again for every parcel,
 * a distance for every parcel. The reference every number is compared against. */
function legacyCityAreas(src, features, rings, ref, opts = {}) {
  const toleranceM = Number(opts.toleranceM) || 0;
  const site = ringsAsPolygons(rings);
  const totalSqM = unionAreaSqM(site, ref);
  const parcels = (rings || []).map((r) => ringsAsPolygons([r]));
  const groups = new Map();
  for (const f of features || []) {
    const n = normalizeFeature(src, f.attrs || {});
    if (n.name == null || n.name === "") continue;
    const cls = n.limitClass || CITY_LIMIT_CLASSES.unknown.id;
    for (const nm of (n.names && n.names.length ? n.names : [n.name])) {
      const key = placeKey(nm) + "|" + cls;
      const g = groups.get(key) || { name: String(nm), class: cls, polys: [], uniqueIds: [] };
      g.polys.push(...esriPolygons(f.geometry));
      if (n.uniqueId) g.uniqueIds.push(String(n.uniqueId));
      groups.set(key, g);
    }
  }
  const withGeom = (features || []).filter((f) => f && f.geometry && (f.geometry.rings || []).length).length;
  if ((features || []).length && !withGeom) return null;
  const rows = [];
  for (const g of groups.values()) {
    if (!g.polys.length) continue;
    const whole = areaShare(site, g.polys, ref, { toleranceM, totalSqM });
    rows.push({
      name: g.name, class: g.class, sourceId: src.id, uniqueIds: uniq(g.uniqueIds),
      share: whole.share, rawShare: whole.rawShare, insideAcres: whole.insideAcres, distanceM: whole.distanceM,
      confident: whole.confident, refusedReason: whole.refusedReason,
      perParcel: parcels.map((p, i) => {
        const r = areaShare(p, g.polys, ref, { toleranceM });
        return { index: i, id: (opts.parcelIds || [])[i] || null, acres: r.totalAcres, share: r.share, insideAcres: r.insideAcres };
      }),
    });
  }
  rows.sort((a, b) => (b.rawShare || 0) - (a.rawShare || 0));
  return { method: "area", sourceId: src.id, toleranceM, totalSqM, totalAcres: totalSqM / SQM_PER_ACRE, parcelCount: (rings || []).length,
    parcelAcres: parcels.map((p) => unionAreaSqM(p, ref) / SQM_PER_ACRE), parcelIds: (opts.parcelIds || []).slice(0, (rings || []).length), rows };
}

/* Two results are "the same" when every named number agrees to well inside clipper's 1 mm grid (cut vertices are re-rounded to it). */
function expectSame(a, b, digits = 9) {
  expect(a === null).toBe(b === null);
  if (!a) return;
  expect(a.rows.map((r) => r.name + "|" + r.class)).toEqual(b.rows.map((r) => r.name + "|" + r.class));
  expect(a.totalAcres).toBeCloseTo(b.totalAcres, 9);
  a.rows.forEach((r, i) => {
    const o = b.rows[i];
    expect(r.rawShare).toBeCloseTo(o.rawShare, digits);
    expect(r.insideAcres).toBeCloseTo(o.insideAcres, digits === 9 ? 7 : 3);
    expect(r.confident).toBe(o.confident);
    if (Number.isFinite(o.distanceM)) expect(r.distanceM).toBeCloseTo(o.distanceM, 3); else expect(r.distanceM).toBe(o.distanceM);
    r.perParcel.forEach((pp, j) => {
      expect(pp.share).toBeCloseTo(o.perParcel[j].share, digits);
      expect(pp.insideAcres).toBeCloseTo(o.perParcel[j].insideAcres, digits === 9 ? 7 : 3);
      expect(pp.acres).toBeCloseTo(o.perParcel[j].acres, 9);
    });
  });
}

const sourcesAt = (rec) => [...citySourcesForPoint(rec.origin.lat, rec.origin.lon), ...etjSourcesForPoint(rec.origin.lat, rec.origin.lon)];
const featsOf = (rec, id) => ((rec.answers[id] && rec.answers[id].features) || []).map((f) => ({ attrs: f.attributes || {}, geometry: f.geometry || null }));

describe("the windowed share equals the original, on the owner's recorded boundaries", () => {
  for (const rec of FIX.sites) {
    for (const src of sourcesAt(rec)) {
      const feats = featsOf(rec, src.id);
      if (!feats.some((f) => f.geometry)) continue;
      for (const pad of [20, 150, 600, SHARE_WINDOW_PAD_M]) {
        it(`${rec.site} · ${src.id} · window ${pad} m`, () => {
          const rings = ringsOf(rec), ref = refOf(rec);
          /* ≥150 m: BIT-IDENTICAL shares (measured max |Δ| = 0). The 20 m window hugs the site's own edge, where a cut vertex re-rounded to
           * clipper's 1 mm grid moves a share by ≈2e-7 (≈0.2 m² on 200 acres) — pinned at 4 digits (≤5e-5), and nowhere near production's 3 km. */
          expectSame(cityAreasFromFeatures(src, feats, rings, ref, { windowPadM: pad }), legacyCityAreas(src, feats, rings, ref), pad < 100 ? 4 : 9);
        });
      }
    }
  }
  it("the comparison saw real overlap (not a vacuous all-zero) — Goose Creek's southern parcel is in Baytown", () => {
    const rec = FIX.sites.find((s) => s.site === "Goose Creek");
    const src = sourcesAt(rec).find((s) => s.id === "city");
    const r = cityAreasFromFeatures(src, featsOf(rec, "city"), ringsOf(rec), refOf(rec), { windowPadM: 150 });
    expect(Math.max(...r.rows.map((x) => x.rawShare))).toBeGreaterThan(0.2);
  });
  it("the default call (no options) is the windowed path and agrees with the original", () => {
    const rec = FIX.sites.find((s) => s.site === "Goose Creek");
    const src = sourcesAt(rec).find((s) => s.id === "city");
    expectSame(cityAreasFromFeatures(src, featsOf(rec, "city"), ringsOf(rec), refOf(rec)), legacyCityAreas(src, featsOf(rec, "city"), ringsOf(rec), refOf(rec)));
  });
});

/* ── randomised: concave polygons with holes, crossing the window on every side ───────────────────────────────── */
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const ref0 = [-95.0, 29.8];
const D = 1 / 111000;                         // ≈ 1 m in degrees of latitude
const mx = (m) => ref0[0] + (m / 96000);      // metres east → lon
const my = (m) => ref0[1] + m * D;
function starPolygon(r, cx, cy, n, lo, hi) {   // a concave star: alternating radii, so every window edge sees reflex vertices
  const pts = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, rad = i % 2 ? lo : hi; pts.push([mx(cx + Math.cos(a) * rad * (0.6 + r() * 0.4)), my(cy + Math.sin(a) * rad * (0.6 + r() * 0.4))]); }
  return pts;
}
describe("clipping to a window never changes an area (randomised, concave, with holes)", () => {
  it("windowed + pre-normalised equals the whole polygon, for 40 random jurisdictions and sites", () => {
    const r = rng(7);
    for (let t = 0; t < 40; t++) {
      const outer = starPolygon(r, (r() - 0.5) * 400, (r() - 0.5) * 400, 14 + Math.floor(r() * 10), 2200, 6000);
      const hole = starPolygon(r, (r() - 0.5) * 1200, (r() - 0.5) * 1200, 8, 150, 700).reverse();
      const polys = [{ outer, holes: [hole] }];
      const sx = (r() - 0.5) * 1500, sy = (r() - 0.5) * 1500, w = 150 + r() * 500, h = 150 + r() * 500;
      const site = [{ outer: [[mx(sx), my(sy)], [mx(sx + w), my(sy)], [mx(sx + w), my(sy + h)], [mx(sx), my(sy + h)]], holes: [] }];
      const win = siteWindow(site.map((p) => p.outer), 300);
      const near = clipPolysToWindow(polys, win);
      const a = areaShare(site, polys, ref0, {});
      const b = areaShare(site, near, ref0, { clipNorm: near.length ? normalizePolys(near, ref0) : null });
      expect(b.insideSqM).toBeCloseTo(a.insideSqM, 1);
      expect(b.rawShare).toBeCloseTo(a.rawShare, 6);
    }
  });
  it("POSITIVE CONTROL — a window that does NOT hold the site is caught by the same comparison", () => {
    const outer = [[mx(-5000), my(-5000)], [mx(5000), my(-5000)], [mx(5000), my(5000)], [mx(-5000), my(5000)]];
    const polys = [{ outer, holes: [] }];
    const site = [{ outer: [[mx(0), my(0)], [mx(400), my(0)], [mx(400), my(400)], [mx(0), my(400)]], holes: [] }];
    const tooSmall = { minx: mx(0), maxx: mx(200), miny: my(0), maxy: my(400) };     // cuts the site in half
    const cut = clipPolysToWindow(polys, tooSmall);
    const whole = areaShare(site, polys, ref0, {}).rawShare, halved = areaShare(site, cut, ref0, {}).rawShare;
    expect(whole).toBeCloseTo(1, 6);
    expect(halved).toBeCloseTo(0.5, 2);
  });
  it("distance stays exact: a boundary inside the pad is read off the window, one beyond it off the full polygon", () => {
    const outer = [[mx(1000), my(-5000)], [mx(9000), my(-5000)], [mx(9000), my(5000)], [mx(1000), my(5000)]];   // west edge 1,000 m east of the site
    const polys = [{ outer, holes: [] }];
    const site = [{ outer: [[mx(0), my(0)], [mx(400), my(0)], [mx(400), my(400)], [mx(0), my(400)]], holes: [] }];
    const truth = distanceToBoundaryM(site, polys, ref0);
    expect(truth).toBeGreaterThan(590); expect(truth).toBeLessThan(610);     // ≈600 m (the synthetic grid's own metres-per-degree)
    for (const pad of [50, truth - 5, truth + 5, 3000]) {
      const near = clipPolysToWindow(polys, siteWindow(site.map((p) => p.outer), pad));
      let d = distanceToBoundaryM(site, near, ref0);
      if (!(d < pad)) d = distanceToBoundaryM(site, polys, ref0);      // the same rule cityAreasFromFeatures applies
      expect(d).toBeCloseTo(truth, 3);
    }
  });
});

describe("clipRingToWindow", () => {
  const w = { minx: 0, miny: 0, maxx: 10, maxy: 10 };
  const area = (r) => Math.abs(r.reduce((a, [x1, y1], i) => { const [x2, y2] = r[(i + 1) % r.length]; return a + x1 * y2 - x2 * y1; }, 0) / 2);
  it("a ring inside is untouched in area; outside is dropped; one swallowing the window becomes the window", () => {
    expect(area(clipRingToWindow([[2, 2], [4, 2], [4, 4], [2, 4]], w))).toBeCloseTo(4);
    expect(clipRingToWindow([[20, 20], [30, 20], [30, 30], [20, 30]], w)).toBeNull();
    expect(area(clipRingToWindow([[-50, -50], [50, -50], [50, 50], [-50, 50]], w))).toBeCloseTo(100);
  });
  it("a straddling ring keeps exactly the part inside", () => {
    expect(area(clipRingToWindow([[5, 5], [15, 5], [15, 15], [5, 15]], w))).toBeCloseTo(25);
  });
  it("a ring entirely inside the window is returned by identity (a small jurisdiction costs nothing)", () => {
    const ring = [[2, 2], [4, 2], [4, 4], [2, 4]];
    expect(clipPolysToWindow([{ outer: ring, holes: [] }], w)[0].outer).toBe(ring);
  });
  it("a null window is the identity", () => {
    const polys = [{ outer: [[0, 0], [1, 0], [1, 1]], holes: [] }];
    expect(clipPolysToWindow(polys, null)).toBe(polys);
  });
});

describe("the share work is sliced, and slicing changes nothing", () => {
  const rec = FIX.sites.find((s) => s.site === "Goose Creek");
  const src = sourcesAt(rec).find((s) => s.id === "city");
  const feats = featsOf(rec, "city"), rings = ringsOf(rec), ref = refOf(rec);
  it("a zero budget yields between every step and returns the identical answer", async () => {
    let yields = 0;
    const a = await cityAreasFromFeaturesAsync(src, feats, rings, ref, { sliceMs: 0, yieldFn: async () => { yields++; } });
    expect(yields).toBeGreaterThan(rings.length);                 // at least one step per parcel
    expect(a).toEqual(cityAreasFromFeatures(src, feats, rings, ref));
  });
  it("a generous budget never yields (no needless latency on a small site)", async () => {
    let yields = 0;
    await cityAreasFromFeaturesAsync(src, feats, rings, ref, { sliceMs: 1e9, yieldFn: async () => { yields++; } });
    expect(yields).toBe(0);
  });
  it("the default slice is well under the 50 ms long-task line", () => { expect(SHARE_SLICE_MS).toBeLessThanOrEqual(20); });
  it("the pad is the 3 km the recorded fixtures were cut at", () => { expect(SHARE_WINDOW_PAD_M).toBe(3000); });
});

describe("identifyCityShares", () => {
  const rec = FIX.sites.find((s) => s.site === "Goose Creek");
  const src = sourcesAt(rec).find((s) => s.id === "city");
  const body = { features: (rec.answers.city.features || []) };
  const mk = () => {
    let calls = 0;
    const cache = createGisCache({ disk: null, now: () => 1000 });
    const fetchJson = async () => { calls++; await new Promise((r) => setTimeout(r, 5)); return JSON.parse(JSON.stringify(body)); };
    return { cache, fetchJson, calls: () => calls };
  };
  it("two concurrent callers for the same site share ONE fetch and ONE compute (badge + drainage authority)", async () => {
    const { cache, fetchJson, calls } = mk();
    const [a, b] = await Promise.all([
      identifyCityShares(src, ringsOf(rec), refOf(rec), { cache, fetchJson }),
      identifyCityShares(src, ringsOf(rec), refOf(rec), { cache, fetchJson }),
    ]);
    expect(calls()).toBe(1);
    expect(a).toBe(b);
    expect(a && a.rows.length).toBeGreaterThan(0);
  });
  it("the in-flight entry is released, so a later call after an edit computes afresh", async () => {
    const { cache, fetchJson, calls } = mk();
    await identifyCityShares(src, ringsOf(rec), refOf(rec), { cache, fetchJson });
    const shifted = ringsOf(rec).map((r) => r.map(([x, y]) => [x + 0.0005, y]));
    await identifyCityShares(src, shifted, refOf(rec), { cache, fetchJson });
    expect(calls()).toBe(2);
  });
  it("SOURCE GUARD — the response continuation drives the SLICED path, never the synchronous one", () => {
    const code = fs.readFileSync(path.join(process.cwd(), "src/workspaces/site-planner/lib/jurisdiction.js"), "utf8");
    const body2 = code.slice(code.indexOf("export function identifyCityShares"), code.indexOf("export async function identifyJurisdiction"));
    expect(body2).toMatch(/await cityAreasFromFeaturesAsync\(/);
    expect(body2).not.toMatch(/=\s*cityAreasFromFeatures\(/);
  });
});
