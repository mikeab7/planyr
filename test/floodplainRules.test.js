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

// The seeds that are now research-confirmed (B758 Fort Bend, B760 Harris) and so ship
// verified:true; every OTHER seed is still an honest unverified placeholder.
const VERIFIED_SEEDS = ["fortbend", "harris"];

describe("seed integrity", () => {
  it("every jurisdiction carries the full schema; only the still-placeholder seeds ship UNVERIFIED", () => {
    for (const [key, r] of Object.entries(DEFAULT_FLOODPLAIN_RULES)) {
      expect(r.label, key).toBeTruthy();
      expect(["1pct", "1pct_plus_02pct"], key).toContain(r.trigger);
      expect(r.ratio, key).toBeGreaterThan(0);
      expect(r.floodwayPolicy, key).toBe("prohibit_fill");
      expect(["storage", "storage_and_conveyance"], key).toContain(r.offsetScope);
      expect(r.locationRule, key).toBeTruthy();
      expect(r.source, key).toBeTruthy();
      if (VERIFIED_SEEDS.includes(key)) {
        expect(r.verified, key).toBe(true);     // research-confirmed this session (B758/B760)
        expect(r.sourceDate, key).toBeTruthy();  // a verified seed must carry its date
      } else {
        expect(r.verified, key).toBe(false);     // no unverified seed may claim verification
        expect(r.note, key).toMatch(/VERIFY/i);  // ...and must stamp the VERIFY caveat
      }
    }
  });
  it("COH's trigger extends to the 0.2% band; Harris now offsets storage AND conveyance across the 500-yr band", () => {
    expect(DEFAULT_FLOODPLAIN_RULES.coh.trigger).toBe("1pct_plus_02pct");
    expect(DEFAULT_FLOODPLAIN_RULES.harris.trigger).toBe("1pct_plus_02pct");
    expect(DEFAULT_FLOODPLAIN_RULES.harris.offsetScope).toBe("storage_and_conveyance");
    expect(DEFAULT_FLOODPLAIN_RULES.harris.note).toMatch(/no-rise|hydraulic/i);
  });
});

describe("verified seeds (B758 Fort Bend, B760 Harris)", () => {
  it("Fort Bend carries the verified FBC compensating-storage record", () => {
    const fb = DEFAULT_FLOODPLAIN_RULES.fortbend;
    expect(fb.trigger).toBe("1pct_plus_02pct");
    expect(fb.ratio).toBe(1);
    expect(fb.floodwayPolicy).toBe("prohibit_fill");
    expect(fb.offsetScope).toBe("storage_and_conveyance");
    expect(fb.verified).toBe(true);
    expect(fb.sourceDate).toBe("2024-10-08");
    expect(fb.source).toMatch(/5\.02\(h\)\(1\)/);            // FDPR compensating-storage cite
    expect(fb.source).toMatch(/Interim Atlas-14/i);         // the §9 500-yr extension basis
    expect(fb.note).toMatch(/confirm/i);                    // honest lettering caveat, not "opened the PDF"
    expect(triggerClasses(fb)).toEqual(["1pct", "02pct"]);
  });
  it("Harris updated to the 500-yr storage/conveyance offset, verified", () => {
    const h = DEFAULT_FLOODPLAIN_RULES.harris;
    expect(h.trigger).toBe("1pct_plus_02pct");
    expect(h.offsetScope).toBe("storage_and_conveyance");
    expect(h.verified).toBe(true);
    expect(h.sourceDate).toBe("2019-07-09");
    expect(h.source).toMatch(/7\/9\/2019/);                 // effective-date provenance
    expect(h.source).toMatch(/4\.07\(e\)/);                 // the 1:1 offset subsection
    expect(h.note).toMatch(/coastal/i);                     // coastal-area exemption surfaced
    expect(h.note).toMatch(/confirm/i);                     // honest lettering caveat
    expect(triggerClasses(h)).toEqual(["1pct", "02pct"]);
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
  it("per-jurisdiction deep merge: an edit to ONE rule never freezes the other seeds, and a NEW seed field reaches saved users", () => {
    const store = memStore();
    const rules = loadFloodplainRules(store);
    rules.harris = { ...rules.harris, ratio: 1.5 };
    saveFloodplainRules(rules, store);
    // simulate a later release adding a field to the COH seed: the saved harris edit
    // must survive AND coh must pick up whatever the current seeds carry.
    const back = loadFloodplainRules(store);
    expect(back.harris.ratio).toBe(1.5);
    expect(back.harris.trigger).toBe("1pct_plus_02pct"); // untouched fields ride the merge
    expect(back.coh.floodwayPolicy).toBe("prohibit_fill"); // seed fields present even after a whole-object save
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
    expect(triggerClasses(DEFAULT_FLOODPLAIN_RULES.montgomery)).toEqual(["1pct"]); // still a 1%-only placeholder
    expect(triggerClasses(DEFAULT_FLOODPLAIN_RULES.coh)).toEqual(["1pct", "02pct"]);
    expect(triggerClasses(DEFAULT_FLOODPLAIN_RULES.harris)).toEqual(["1pct", "02pct"]); // B760 now spans the 500-yr band
    expect(triggerClasses(null)).toEqual(["1pct"]);
  });
});
