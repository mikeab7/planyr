import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/* B2671309 — source sweep: a NEW hand-rolled point-in-ring / point-to-segment / extent helper fails
 * here. The shared leaf is src/workspaces/site-planner/lib/ringMath.js. A genuine different
 * contract goes in EXEMPT with the reason; a copy does not. */
const ROOT = path.resolve(__dirname, "../src");
const LEAF = "workspaces/site-planner/lib/ringMath.js";
const EXEMPT = {
  "workspaces/site-planner/lib/siteRegion.js": "walks a FLAT [x0,y0,x1,y1,…] array, not a ring of points",
  "workspaces/site-planner/lib/vectorLayers.js": "tolerates sparse GeoJSON rings (`ring[i] || []`)",
  "workspaces/site-planner/MapFinder.jsx": "[lat,lng] rings with a lat-first signature",
  "shared/markup/geometry.js": "markup module: `|| 1e-12` divide guard and its own {x,y,w,h} bbox shape",
  "workspaces/site-planner/lib/splitIntegrity.js": "bboxOf skips non-finite points and returns null",
  "workspaces/site-planner/lib/contours.js": "segDist also returns the nearest point, in a latitude-scaled frame",
  "workspaces/site-planner/lib/polygonSplit.js": "distToSeg delegates to nearestPointOnSeg (no loop)",
  "workspaces/site-planner/lib/labelFitLadder.js": "one-line alias over ringContains (no loop)",
};
// Names that were each hand-copied; a DEFINITION of one outside the leaf is a copy.
const DEF = /(?:function\s+|(?:const|let)\s+)(pointInRing|pointInPoly|inRing|segDist|distToSeg|distToSegment|ptSegDist|bboxOf|bboxOfRings)\b\s*(?:\(|=\s*(?:async\s*)?\()/g;
const walk = (d, out = []) => {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p, out); else if (/\.(js|jsx|mjs)$/.test(f.name)) out.push(p);
  }
  return out;
};
// An arrow that only forwards to the leaf is an alias, not a copy: its body is a single call.
const isForwarder = (src, at) => /^[^\n]*=>\s*[A-Za-z_$][\w$]*\(/.test(src.slice(at, at + 200).split("\n")[0]) && !/\{\s*$/.test(src.slice(at, at + 200).split("\n")[0]);

describe("geometry leaf sweep (B2671309)", () => {
  it("no new point-in-ring / segment-distance / extent copy outside ringMath.js", () => {
    const offenders = [];
    for (const file of walk(ROOT)) {
      const rel = path.relative(ROOT, file).replace(/\\/g, "/");
      if (rel === LEAF || EXEMPT[rel]) continue;
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(DEF)) {
        if (isForwarder(src, m.index)) continue;
        offenders.push(`${rel}: ${m[1]}`);
      }
    }
    expect(offenders, "import from lib/ringMath.js instead of re-implementing (or add an EXEMPT entry with a reason)").toEqual([]);
  });
  it("every exemption still exists", () => {
    for (const rel of Object.keys(EXEMPT)) expect(fs.existsSync(path.join(ROOT, rel)), rel).toBe(true);
  });
});
