/* NEW-1 (parcel-slow toast without parcels) — the pure gate + the wiring that makes it load-bearing.
 * The browser half (real timers, real Leaflet layers, the owner's exact banner text) is
 * e2e/parcel-outage-context.spec.js; this file pins the truth table and that every banner site consults it. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parcelNoticeMayRaise, isLiveDisplayLayer, countyOutageMessage } from "../src/workspaces/site-planner/lib/parcelOutageGate.js";

describe("parcelNoticeMayRaise — only while parcels are in use", () => {
  const ok = { selectMode: true, layerLive: true, inDrawRange: true };
  it("raises in the useful case: Select parcels on, layer live, in draw range", () => expect(parcelNoticeMayRaise(ok)).toBe(true));
  it("never raises with Select parcels off (Draw / Drop a pin / plain map) — the owner's report", () => {
    expect(parcelNoticeMayRaise({ ...ok, selectMode: false })).toBe(false);
    expect(parcelNoticeMayRaise({ ...ok, selectMode: undefined })).toBe(false);
  });
  it("never raises for a layer that was removed / replaced / left behind", () => expect(parcelNoticeMayRaise({ ...ok, layerLive: false })).toBe(false));
  it("never raises below the layer's draw range (metro zoom)", () => expect(parcelNoticeMayRaise({ ...ok, inDrawRange: false })).toBe(false));
  it("a draw range it cannot judge keeps the old behaviour (unknown reads as in range)", () => expect(parcelNoticeMayRaise({ ...ok, inDrawRange: undefined })).toBe(true));
  it("no arguments → false", () => expect(parcelNoticeMayRaise()).toBe(false));
});

describe("isLiveDisplayLayer — by identity across every key (an alias may own the layer)", () => {
  const a = {}, b = {};
  it("finds a layer under any key", () => expect(isLiveDisplayLayer({ harris: a, alias: b }, b)).toBe(true));
  it("a removed layer is not live", () => expect(isLiveDisplayLayer({ harris: a }, b)).toBe(false));
  it("empty / missing inputs", () => { expect(isLiveDisplayLayer({}, a)).toBe(false); expect(isLiveDisplayLayer(null, a)).toBe(false); expect(isLiveDisplayLayer({ x: a }, null)).toBe(false); });
});

describe("countyOutageMessage — names statewide outlines only where they exist", () => {
  it("with a statewide backup: the original wording", () => expect(countyOutageMessage(true)).toMatch(/showing statewide outlines/));
  it("without one: no promise of a picture nothing draws", () => {
    expect(countyOutageMessage(false)).not.toMatch(/statewide/);
    expect(countyOutageMessage(false)).toMatch(/slow/);
  });
});

describe("wiring — every parcel banner site in MapFinder passes the gate (source guard; red on the pre-fix file)", () => {
  const src = readFileSync(new URL("../src/workspaces/site-planner/MapFinder.jsx", import.meta.url), "utf8");
  it("the county hang handler, the statewide error handler and both slow timers consult parcelNoticeAllowed", () => {
    expect((src.match(/parcelNoticeAllowed\(fl\)/g) || []).length).toBeGreaterThanOrEqual(4);
  });
  it("turning the tool off retracts a banner the tool raised", () => {
    const clear = src.slice(src.indexOf("const clearDisplays = () => {"), src.indexOf("const removeDisplay = (key)"));
    expect(clear).toMatch(/retractSourceNotice\(\)/);
  });
  it("no banner site still tests `displaysRef.current[key] === fl` alone (the guard that let a removed layer through)", () => {
    expect(src).not.toMatch(/displaysRef\.current\[key\] === fl && sourceNoticeStillPlausible/);
  });
});
