// v3 UI SPEC Part A — the Yield panel's structure + copy deletions, guarded by source scan
// (the repo's vitest config is DOM-free). The verdict grammar itself is unit-tested in
// test/yieldVerdicts.test.js; this locks in the render wiring.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");
const at = (needle) => {
  const i = src.indexOf(needle);
  if (i < 0) throw new Error(`marker not found: ${needle}`);
  return i;
};

describe("A1/A2/A5/A6 — top-to-bottom order", () => {
  it("verdict strip → LAND USE → BUILDINGS render in order (Buildability is now a strip row, B2)", () => {
    const order = [
      'data-testid="yield-verdict-strip"',
      'sectionId="yield-land"',
      'sectionId="yield-buildings"',
    ].map(at);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("the groups carry the v3 titles (the Buildability GROUP is deleted, B2)", () => {
    expect(src).toContain('title="Land use"');
    expect(src).toContain('title="Buildings"');
    expect(src).toContain('title="Costs"');
    expect(src.includes('sectionId="yield-buildability"')).toBe(false);
  });
});

describe("A5 — LAND USE stacked bar (validated palette) replaces the donut + tiles", () => {
  it("has the four segment fills in spec order", () => {
    const land = src.slice(at('sectionId="yield-land"'), at('sectionId="yield-buildings"'));
    const fills = ["#eda100", "#008300", "#2a78d6", "#eb6834"];
    const idx = fills.map((f) => land.indexOf(f));
    expect(idx.every((i) => i >= 0), "all four fills present").toBe(true);
    expect(idx).toEqual([...idx].sort((a, b) => a - b)); // Buildings, Open space, Pond, Paving
  });

  it("the donut, the KPI tiles, and the standalone Detention rows are gone", () => {
    expect(src.includes('viewBox="0 0 100 100"')).toBe(false); // donut svg
    expect(src.includes('kpi("Site"')).toBe(false);
    expect(src.includes('row("Detention storage"')).toBe(false);
    expect(src.includes('row("Detention %"')).toBe(false);
  });
});

describe("G1/A3 — the provided/required pair renders once (in the strip); the band bar is gone", () => {
  it("RequirementBand and its aria-label pair are removed", () => {
    expect(src.includes("function RequirementBand")).toBe(false);
    expect(src.includes("<RequirementBand")).toBe(false);
    // the old aria-label restated the pair ("provided X of Y ac-ft") — gone
    expect(src.includes("provided ${fmtAcFt(provided)} of ${fmtAcFt(required)} ac-ft")).toBe(false);
  });
});

describe("G8 — the button reads ⚡ Optimize pond, never ⚡ Design pond (visible labels)", () => {
  it("no visible '⚡ Design pond' button label remains", () => {
    // Comments may still reference the old name; the rendered button label must be Optimize.
    expect(src.includes(">\n                ⚡ Design pond\n")).toBe(false);
    expect(src).toContain("⚡ Optimize pond");
  });
});

describe("A9 — footer legend (Yield panel only)", () => {
  it("carries the four provenance tag definitions", () => {
    for (const def of ["measured from your drawing", "adopted criteria", "estimated", "your input"]) {
      expect(src, def).toContain(def);
    }
  });
});

// ── Follow-up punch list (live-verification fixes) ──────────────────────────────────
describe("punch 1 — the steady-state freshness clock + standalone Re-check pill are gone", () => {
  it("the deleted clock render templates are gone (only the header 'Flood data … ago' remains)", () => {
    expect(src.includes("remembered from your last check")).toBe(false);
    expect(src.includes('"Checked this session"')).toBe(false);
    expect(src.includes("As of ${checkedOnDate}")).toBe(false);
    expect(src.includes("As of ${label}")).toBe(false);
  });
});

describe("punch 2 — the verdict sentence never ellipsizes; the strip carries no ⚡ button", () => {
  const strip = src.slice(at("the VERDICT STRIP"), at("DETENTION DETAIL (open)"));
  it("the sentence span has no textOverflow ellipsis", () => {
    expect(strip.includes("yield-verdict-sentence")).toBe(true);
    expect(strip.includes('textOverflow: "ellipsis"')).toBe(false);
  });
  it("no Optimize-pond button wiring inside the strip block (the B2 ↻ re-check button is allowed)", () => {
    // The ⚡ Optimize-pond button lives in DETENTION DETAIL; its onDesignPond WIRING must be
    // absent from the strip. (B2 adds a ↻ re-check <button> to the Buildability row, and the
    // strip comment mentions "⚡ Optimize pond", so we match the wiring, not those strings.)
    expect(/onClick=\{[^}]*onDesignPond\}/.test(strip)).toBe(false);
  });
});

describe("punch 4 — DETENTION DETAIL: prior detail folds into Assumptions & method; visible = per-pond + explainer + basis", () => {
  it("the det groupFold passes detR as opts.method and the visible body is the spec's items", () => {
    expect(src).toContain('groupFold("det", "Detention detail"');
    expect(src).toContain("method: detR");
    expect(src).toContain("Requirement basis");
    expect(src).toContain("ac-ft counts");
    // NEW-15 — the explainer now has partial + total variants; the total-dead branch keeps the
    // original "none counts yet" wording (the rim clause is feasibility-gated, not unconditional).
    expect(src).toContain("All of its storage sits below the flood level, so none counts yet.");
    expect(src).toContain("sits below the flood level and doesn't count.");
  });
});

describe("punch 5 — the cited em dashes are swept to colons / middots", () => {
  it("SitePlanner strings", () => {
    expect(src).toContain("for this county: verify with the county engineer");
    expect(src.includes("for this county — verify")).toBe(false);
    expect(src).toContain("Zone A with no published BFE: the governing");
    expect(src).toContain("Rate-control district: the volume above");
    // the two rendered reviewing-agency <option> labels now use a middot (comments elsewhere
    // may still document the old "Auto — detected" wording, so scope to the rendered forms).
    expect(src).toContain('Auto{ac.detectedLabel ? ` · detected: ');
    expect(src).toContain('Auto · detected: {(fm.rules');
    expect(src.includes('">Auto — detected:')).toBe(false);
  });
  it("the BKDD overlay data string (detentionRules.js)", () => {
    const rules = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/lib/detentionRules.js", import.meta.url)), "utf8");
    expect(rules).toContain("in Brookshire–Katy DD: rate-control detention");
    expect(rules.includes("Brookshire–Katy DD — rate-control")).toBe(false);
  });
});

describe("punch 6/7/8 — group summaries", () => {
  it("BUILDINGS is '{n} · {sf} sf'; COSTS is 'not priced yet' when unpriced; the BUILDABILITY group is gone (B2)", () => {
    expect(src).toContain("${buildingCount || 0} · ${f0(bldg)} sf");
    expect(src).toContain('"not priced yet"');
    expect(src.includes('summary="road + earthwork"')).toBe(false);
    // v3 B2 — the BUILDABILITY group was deleted; its verdict is a permanent strip row.
    expect(src.includes('sectionId="yield-buildability"')).toBe(false);
  });
});

// ── v3 post-ship audit — PR-A ───────────────────────────────────────────────────────
describe("A1 — the 'Assumptions & method' disclosure is a real accessible <button> that opens", () => {
  it("a module-scope InlineDisclosure carries aria-expanded on a real button", () => {
    const i = src.indexOf("function InlineDisclosure(");
    expect(i, "InlineDisclosure component defined").toBeGreaterThan(-1);
    const body = src.slice(i, i + 900);
    expect(body).toContain('type="button"');
    expect(body).toContain("aria-expanded={open}");
    expect(body).toContain('data-testid="assumptions-method-toggle"');
    expect(body).toContain('data-testid="assumptions-method-body"');
    // the chevron flips with open state
    expect(body).toContain('{open ? "▾" : "▸"}');
  });
  it("groupFold renders the method fold through InlineDisclosure, not the old bare button", () => {
    expect(src).toContain("<InlineDisclosure");
    expect(src).toContain('label="Assumptions & method"');
    // the pre-audit inline button (no aria-expanded) is gone
    expect(src.includes('{methodShown ? "▾" : "▸"} Assumptions &amp; method')).toBe(false);
  });
});

describe("A2 — the Optimize pond tooltip never promises the drawn outline 'grows'", () => {
  it("carries the exact has-pond and no-pond titles", () => {
    expect(src).toContain("One click: sets the pond's elevations and outlet so storage counts. Your drawn outline is never changed.");
    expect(src).toContain("One click: draws a right-sized pond and solves its outlet.");
  });
  it("none of the banned '(or grows)' Optimize-pond promises remain", () => {
    expect(src.includes("Draws (or grows)")).toBe(false);
    expect(src.includes("(or grows) ONE pond")).toBe(false);
    expect(src.includes("Creates (or grows)")).toBe(false);
  });
});

// ── v3 post-ship audit — PR-B ───────────────────────────────────────────────────────
describe("PR-B — Yield panel + shared copy fixes", () => {
  it("B1 — the swept em-dash strings are colons now", () => {
    expect(src).toContain("Overall: Post ≤ Pre");
    expect(src).toContain('"PASS: every storm"');
    expect(src).toContain("Criteria values are unverified placeholders: confirm in Standards against the county criteria manual (PCPM / DCM).");
    expect(src).toContain('title="Pin in place: prevents accidental moves/edits"');
    expect(src.includes("Overall — Post")).toBe(false);
    expect(src.includes("PASS — every storm")).toBe(false);
  });
  it("B3 — freshness unknown-age reads 'Flood data: not checked'; with age '{age} ago'", () => {
    expect(src).toContain('"Flood data: not checked"');
    expect(src).toContain("`Flood data ${formatAge(floodAgeMs)} ago`");
  });
  it("B4 — the requirement basis reads the appendix off source.section too (Waller Co. App. E)", () => {
    expect(src).toContain("req.rule.governingManual?.section || req.rule.source?.section");
    expect(src).toContain("Adopted criteria.");
    expect(src).toContain("Screening range ${f1(req.bandAcFt[0])} to ${f1(req.bandAcFt[1])} ac-ft; planned to the conservative end.");
    expect(src).toContain("Criteria values still unverified: confirm in Standards.");
  });
  it("B6 — the COSTS body is two flat CostDisclosure rows, Earthwork before Road, no '(screening)' sub-headers", () => {
    const e = src.indexOf('<CostDisclosure label="Earthwork">');
    const r = src.indexOf('<CostDisclosure label="Road">');
    expect(e).toBeGreaterThan(-1);
    expect(r).toBeGreaterThan(-1);
    expect(e).toBeLessThan(r); // Earthwork first (B6 order)
    expect(src.includes('title="Road cost (screening)"')).toBe(false);
    expect(src.includes('title="Earthwork cost (screening)"')).toBe(false);
    expect(src).toContain("Set unit prices →");
  });
  it("B7 — SURVEY is in the ONE shared provenance legend, rendered in both the Yield footer and pond panel", () => {
    expect(src).toContain('["SURVEY", "from terrain data"]');
    const uses = src.match(/<ProvenanceLegend/g) || [];
    expect(uses.length).toBeGreaterThanOrEqual(2);
  });
});
