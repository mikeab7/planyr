/* NEW-1 (2026-09-28) — GUARD: a road's per-road decoration (cross-section band fills, lane
 * striping, ROW lines, inner curb stripes, width dimension, labels) may never sit UNDER the dissolved
 * cluster fill it decorates. B1788912 put each cluster into the creation-order paint stack at its
 * newest member's z, so a road's own node painted at-or-before the fill and buried every designed
 * section. The real-render proof is e2e/road-xsection-paint-order.spec.js (red on the pre-fix build);
 * this is the CI-runnable source half — it fails if the two-pass split or the "decoration follows its
 * region" emission is removed, the shape of the next paint-order change that would silently bury it. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SP = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");

describe("road cross-section decoration paints above its cluster's fill", () => {
  it("an in-network road's ordinary node paints only its hit target; decoration is a separate pass", () => {
    expect(SP).toMatch(/if \(inNetwork && roadPass !== "deco"\) \{\s*return \(/);
    expect(SP).toMatch(/data-road-deco=\{roadPass === "deco"/);
  });
  it("each cluster's paint item emits its region FIRST and its members' decoration AFTER", () => {
    const i = SP.indexOf("const renderPaintItem");
    expect(i, "renderPaintItem exists").toBeGreaterThan(0);
    const body = SP.slice(i, i + 1600);
    const region = body.indexOf("renderRoadRegion(it.r, it.i)");
    const deco = body.indexOf('roadPass="deco"');
    expect(region).toBeGreaterThan(-1);
    expect(deco).toBeGreaterThan(region);
  });
  it("both stack tiers (normal and lifted) go through that one emitter", () => {
    expect(SP).toMatch(/elPaintItems\.normal\.map\(renderPaintItem\)/);
    expect(SP).toMatch(/elPaintItems\.lifted\.map\(renderPaintItem\)/);
  });
  it("the decoration members ride the cluster item (same tier as its fill)", () => {
    expect(SP).toMatch(/members: r\.ids\.map\(\(id\) => drawById\.get\(id\)\)/);
  });
});
