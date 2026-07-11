import { describe, it, expect } from "vitest";
import { rowInfoSections, combineLayerStatus } from "../src/workspaces/site-planner/lib/layerPanelInfo.js";

/* B760/B761 — the pure Layers-panel row helpers: what the per-row ⓘ shows, and how the
 * merged City/ETJ row folds two live statuses into one dot. */

const texts = (secs) => secs.map((s) => s.text);

describe("rowInfoSections (B760) — ⓘ popover content", () => {
  it("puts sublabel, source, vintage and note behind the ⓘ (in order)", () => {
    const cfg = { sublabel: "Detected in street photos.", source: "Mapillary", note: "Loads at zoom ≥ 16." };
    const secs = rowInfoSections(cfg, { vintage: "Capture date varies", age: "", ls: null });
    expect(texts(secs)).toEqual([
      "Detected in street photos.",
      "Source: Mapillary",
      "As of: Capture date varies",
      "Loads at zoom ≥ 16.",
    ]);
  });

  it("falls back to an honest 'vintage unknown' when no vintage is known", () => {
    const secs = rowInfoSections({}, { vintage: null, age: "", ls: null });
    expect(texts(secs)).toEqual(["As of: vintage unknown"]);
  });

  it("appends the refreshed-age ONLY when the layer is loaded/empty (not while loading/off)", () => {
    const cfg = { note: "x" };
    const loaded = rowInfoSections(cfg, { vintage: "2026", age: "3m ago", ls: { state: "loaded", ts: 1 } });
    expect(loaded[0].text).toBe("As of: 2026 · refreshed 3m ago");
    // loading → no refreshed stamp yet
    const loading = rowInfoSections(cfg, { vintage: "2026", age: "3m ago", ls: { state: "loading", ts: 1 } });
    expect(loading[0].text).toBe("As of: 2026");
    // off (ls null) → no refreshed stamp
    const off = rowInfoSections(cfg, { vintage: "2026", age: "", ls: null });
    expect(off[0].text).toBe("As of: 2026");
  });

  it("flags a stale refresh with a warn tone + an (updating…) marker", () => {
    const secs = rowInfoSections({}, { vintage: "2026", age: "3m ago", ls: { state: "loaded", ts: 1, stale: true } });
    expect(secs[0].text).toBe("As of: 2026 · refreshed 3m ago (updating…)");
    expect(secs[0].tone).toBe("warn");
  });

  it("adds the has-jurisdiction caveat as a warn line only when cfg.infoCaveat is set", () => {
    const withCaveat = rowInfoSections({ note: "n", infoCaveat: "HAS JURISDICTION, not service." }, { vintage: "2026" });
    const last = withCaveat[withCaveat.length - 1];
    expect(last).toEqual({ text: "HAS JURISDICTION, not service.", tone: "warn" });
    const without = rowInfoSections({ note: "n" }, { vintage: "2026" });
    expect(without.some((s) => s.tone === "warn")).toBe(false);
  });

  it("is empty of extra lines for a bare row (only the vintage line)", () => {
    expect(rowInfoSections({}, {}).length).toBe(1); // just the "As of:" line
  });
});

describe("combineLayerStatus (B761) — merged City/ETJ status dot", () => {
  const S = (state, extra = {}) => ({ state, ...extra });

  it("returns null when neither underlying layer is on", () => {
    expect(combineLayerStatus(null, null)).toBe(null);
    expect(combineLayerStatus()).toBe(null);
    expect(combineLayerStatus(undefined)).toBe(null);
  });

  it("prefers loading over everything (a load in progress shows as loading)", () => {
    expect(combineLayerStatus(S("loaded"), S("loading")).state).toBe("loading");
    expect(combineLayerStatus(S("failed"), S("loading")).state).toBe("loading");
  });

  it("prefers failed over loaded/empty (a real failure is never hidden by the other's success)", () => {
    expect(combineLayerStatus(S("loaded"), S("failed", { msg: "down" })).state).toBe("failed");
    // carries the failing layer's message
    expect(combineLayerStatus(S("empty"), S("failed", { msg: "down" })).msg).toBe("down");
  });

  it("prefers loaded over empty; falls to empty when both are empty", () => {
    expect(combineLayerStatus(S("empty"), S("loaded")).state).toBe("loaded");
    expect(combineLayerStatus(S("empty"), S("empty")).state).toBe("empty");
  });
});
