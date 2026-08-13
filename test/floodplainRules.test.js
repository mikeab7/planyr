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
  floodJurCounty,
  triggerClasses,
} from "../src/workspaces/site-planner/lib/floodplainRules.js";

const memStore = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
};

// The seeds that are now research-confirmed (B758 Fort Bend, B760 Harris, NEW-1 Waller)
// and so ship verified:true; every OTHER seed is still an honest unverified placeholder.
const VERIFIED_SEEDS = ["fortbend", "harris", "waller"];

/* B393170 — A THIRD CLASS, and it is deliberately not "a placeholder with worse words".
 * A placeholder seed is a jurisdiction nobody has GOT TO yet: it carries a plausible schema and a
 * VERIFY caveat, and someone will transcribe it. An UNREADABLE one is a jurisdiction that was
 * reached for and could not be obtained — Baytown's ordinance is published only on hosts this
 * environment's egress proxy refuses (measured, connection refused, not a 404). Such a record must
 * carry NO trigger, NO ratio and NO policy, because the alternative is a fabricated finished-floor
 * rule, which is the most expensive wrong number this app can produce. It states what it tried,
 * where, and when — and `unreadable` is what `floodAdministrator` reads to keep it out of the
 * governing pool rather than silently pricing a site on it. */
const UNREADABLE_SEEDS = ["baytown"];

describe("seed integrity", () => {
  it("an UNREADABLE seed states what it could not read, and asserts NOTHING about the rule", () => {
    for (const key of UNREADABLE_SEEDS) {
      const r = DEFAULT_FLOODPLAIN_RULES[key];
      expect(r, key).toBeTruthy();
      expect(r.label, key).toBeTruthy();
      expect(r.verified, key).toBe(false);
      // the whole point: no invented rule, in any field a number could hide in
      for (const f of ["trigger", "ratio", "floodwayPolicy", "offsetScope", "ffeRule"]) {
        expect(r[f], `${key}.${f}`).toBeNull();
      }
      expect(r.unreadable?.reason, key).toBeTruthy();
      expect(r.unreadable?.hosts?.length, key).toBeGreaterThan(0);
      expect(r.unreadable?.checkedAt, key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.source, key).toMatch(/NOT TRANSCRIBED/);
      // "we have not read it" and "it does not say" are different statements (NEW-3)
      expect(["unknown", "governs", "does-not-govern", "silent"], key).toContain(r.limitedPurposeScope);
    }
  });

  it("every jurisdiction carries the full schema; only the still-placeholder seeds ship UNVERIFIED", () => {
    for (const [key, r] of Object.entries(DEFAULT_FLOODPLAIN_RULES)) {
      if (UNREADABLE_SEEDS.includes(key)) continue;   // asserted above, on its own terms
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
  it("NEW-1 — Waller carries the verified Art. 5 record: 500-yr trigger, on-site 1:1, floodway + 100-ft buffer", () => {
    const w = DEFAULT_FLOODPLAIN_RULES.waller;
    expect(w.trigger).toBe("1pct_plus_02pct");              // §A(8): SFHA AND moderate (500-yr) areas
    expect(w.ratio).toBe(1);
    expect(w.floodwayPolicy).toBe("prohibit_fill");
    expect(w.floodwayBufferFt).toBe(100);                   // §E: floodway PLUS a 100-ft buffer zone
    expect(w.offsetScope).toBe("storage");
    expect(w.locationRule).toMatch(/on the development site/i); // §A(8) on-site placement
    expect(w.verified).toBe(true);
    // NEW-3 (B1057 completion) — sourceDate is now the ORDINANCE'S OWN EFFECTIVE DATE, matching
    // how every other verified seed dates itself (Harris 2019-07-09, Fort Bend 2024-10-08); the
    // old value was the date the owner happened to pull the PDF. The versioning ambiguity that
    // caveat recorded is resolved: 2/28/2013 is the effective edition.
    expect(w.sourceDate).toBe("2013-02-28");
    expect(w.url).toMatch(/co\.waller\.tx\.us/);           // the county-posted ordinance itself
    expect(w.note).toMatch(/no net fill up to 500-year floodplain elevation/); // §A(8) verbatim
    expect(w.note).toMatch(/§5\.C\(3\)/);                   // now a FIRING rule, pointed at from the note
    expect(w.note).toMatch(/Brookshire–Katy|BKDD/);         // BKDD flagged unresolved, never fabricated
    expect(w.note).toMatch(/VERSIONING/i);                  // versioning resolved, and recorded as resolved
    expect(triggerClasses(w)).toEqual(["1pct", "02pct"]);
    // No OTHER seed gained a buffer — the field is Waller-specific until transcribed elsewhere.
    for (const [k, r] of Object.entries(DEFAULT_FLOODPLAIN_RULES)) {
      if (k !== "waller") expect(r.floodwayBufferFt, k).toBeUndefined();
    }
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
  it("B790 — floodJurCounty maps a rules key to its implied county (generic → none)", () => {
    expect(floodJurCounty("coh")).toBe("harris"); // COH sits inside Harris
    expect(floodJurCounty("harris")).toBe("harris");
    expect(floodJurCounty("fortbend")).toBe("fort bend"); // matches the identify county's display name
    expect(floodJurCounty("Waller")).toBe("waller");
    expect(floodJurCounty("generic")).toBeNull(); // implies no county — never mismatches
    expect(floodJurCounty(null)).toBeNull();
    // the mismatch predicate the picker uses: identify "Fort Bend" vs a picked harris rule
    expect("Fort Bend".toLowerCase().includes(floodJurCounty("harris"))).toBe(false);
    expect("Fort Bend".toLowerCase().includes(floodJurCounty("fortbend"))).toBe(true);
  });
});
