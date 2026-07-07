// B707 — the editable floodplain-mitigation rules file: seed integrity, the
// verified-flag discipline, load/save round-trip (injectable store), jurisdiction
// defaulting off the resolved drainage authority. Pure — no browser.
import { describe, it, expect } from "vitest";
import {
  DEFAULT_FLOODPLAIN_RULES,
  loadFloodplainRules,
  saveFloodplainRules,
  defaultFloodJurForAuthority,
  defaultFloodJurForCounty,
  triggerClasses,
} from "../src/workspaces/site-planner/lib/floodplainRules.js";

const memStore = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
};

describe("seed integrity", () => {
  it("every jurisdiction carries the full schema and ships UNVERIFIED", () => {
    for (const [key, r] of Object.entries(DEFAULT_FLOODPLAIN_RULES)) {
      expect(r.label, key).toBeTruthy();
      expect(["1pct", "1pct_plus_02pct"], key).toContain(r.trigger);
      expect(r.ratio, key).toBeGreaterThan(0);
      expect(r.floodwayPolicy, key).toBe("prohibit_fill");
      expect(["storage", "storage_and_conveyance"], key).toContain(r.offsetScope);
      expect(r.locationRule, key).toBeTruthy();
      expect(r.source, key).toBeTruthy();
      expect(r.verified, key).toBe(false); // no seed may claim verification
      expect(r.note, key).toMatch(/VERIFY/i);
    }
  });
  it("COH's trigger extends to the 0.2% band; Harris offsets storage AND conveyance", () => {
    expect(DEFAULT_FLOODPLAIN_RULES.coh.trigger).toBe("1pct_plus_02pct");
    expect(DEFAULT_FLOODPLAIN_RULES.harris.trigger).toBe("1pct");
    expect(DEFAULT_FLOODPLAIN_RULES.harris.offsetScope).toBe("storage_and_conveyance");
    expect(DEFAULT_FLOODPLAIN_RULES.harris.note).toMatch(/no-rise|hydraulic/i);
  });
});

describe("load / save", () => {
  it("round-trips edits through an injected store and merges over the seeds", () => {
    const store = memStore();
    const rules = loadFloodplainRules(store);
    rules.harris = { ...rules.harris, ratio: 1.5, verified: true, sourceDate: "2026-07-07" };
    saveFloodplainRules(rules, store);
    const back = loadFloodplainRules(store);
    expect(back.harris.ratio).toBe(1.5);
    expect(back.harris.verified).toBe(true);
    expect(back.coh.trigger).toBe("1pct_plus_02pct"); // untouched seeds survive
  });
  it("a corrupted store falls back to the seeds instead of throwing", () => {
    const store = { getItem: () => "{not json", setItem: () => {} };
    expect(loadFloodplainRules(store).generic.trigger).toBe("1pct");
  });
  it("no store at all (bare Node) still yields the seeds", () => {
    expect(loadFloodplainRules().coh.label).toBe("City of Houston");
  });
});

describe("jurisdiction defaulting", () => {
  it("maps the resolved drainage authority (COH ≠ unincorporated Harris)", () => {
    expect(defaultFloodJurForAuthority("coh")).toBe("coh");
    expect(defaultFloodJurForAuthority("hcfcd")).toBe("harris");
    expect(defaultFloodJurForAuthority("fortbend")).toBe("fortbend");
    expect(defaultFloodJurForAuthority("missouricity")).toBe("fortbend"); // overlay → its county
    expect(defaultFloodJurForAuthority("nowhere")).toBe("generic");
    expect(defaultFloodJurForAuthority(null)).toBe("generic");
  });
  it("county fallback for plans that haven't run the drainage identify", () => {
    expect(defaultFloodJurForCounty("harris")).toBe("harris");
    expect(defaultFloodJurForCounty("Waller")).toBe("waller");
    expect(defaultFloodJurForCounty("bexar")).toBe("generic");
  });
  it("triggerClasses expands the trigger band", () => {
    expect(triggerClasses(DEFAULT_FLOODPLAIN_RULES.harris)).toEqual(["1pct"]);
    expect(triggerClasses(DEFAULT_FLOODPLAIN_RULES.coh)).toEqual(["1pct", "02pct"]);
    expect(triggerClasses(null)).toEqual(["1pct"]);
  });
});
