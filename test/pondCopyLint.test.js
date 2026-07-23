// PR-O (O1) — copy lint: render EVERY generated pond warning / optimize / note template with sample
// values and assert it is grammatically complete — no orphaned "the {number} the ..." pattern (a
// number substituted where a noun phrase belongs, the bug behind "Rim 157.1' is above the 153.1' the
// site can still drain..."). Pure, fixture-driven; guards against the whole class recurring.
import { describe, it, expect } from "vitest";
import {
  assessBuildability, unbuildableNote, makeItBuildableOptions, unbuildableHeading, requirementNote,
} from "../src/workspaces/site-planner/lib/buildableEnvelope.js";
import {
  gapProposalNote, bermCapProposalNote, buildChangeSummaryRows,
} from "../src/workspaces/site-planner/lib/pondChangeSummary.js";
import { tailwaterNote, deriveTailwater } from "../src/workspaces/site-planner/lib/tailwaterSource.js";

// Render every number-bearing template with representative values, collect the strings.
function everyGeneratedSentence() {
  const out = [];
  // buildableEnvelope — each hard / soft / requirement label
  const drainageCap = assessBuildability({ tobElev: 157.1, gradeFt: 153, drainageCapElevFt: 153.1 });
  const outfall = assessBuildability({ floorElev: 145.1, outletInvertFt: 145.1, tailwaterFt: 153.1 });
  const deepExc = assessBuildability({ waterDepthFt: 16.3, maxExcavDepthFt: 12 });
  const floodway = assessBuildability({ tobElev: 108, gradeFt: 100, inFloodway: true });
  for (const a of [drainageCap, outfall, deepExc, floodway]) {
    for (const h of a.hard) out.push(h.label);
    for (const s of a.soft) out.push(s.label);
    for (const q of a.requirements) out.push(q.label);
  }
  out.push(unbuildableNote({ hard: drainageCap.hard, extraAcres: 2.5 }));
  out.push(unbuildableNote({ hard: outfall.hard }));
  out.push(makeItBuildableOptions({ extraAcres: 4 }));
  out.push(makeItBuildableOptions({}));
  out.push(unbuildableHeading({ requiredAcFt: 33.8 }));
  out.push(requirementNote({ requirements: floodway.requirements }));
  // pondChangeSummary — the gap + berm-cap proposals
  out.push(gapProposalNote({ bermFt: 4, extraAcres: 2.5 }));
  out.push(gapProposalNote({}));
  out.push(bermCapProposalNote({ binding: "drainage", bermFt: 4, controllingGradeFt: 152.4, designWaterFt: 151.9, extraAcres: 2 }));
  out.push(bermCapProposalNote({ binding: "geometry", geometricMaxFt: 6.5, extraAcres: 1.5 }));
  // change-summary row notes
  const AF = 43560;
  const before = { depthFt: 8, tobElevFt: 100, gradeFt: 100, usableCf: 5 * AF, mitCandidateCf: 2 * AF, landTakeSf: 5 * AF, excavationCf: 1000, bermFillCf: 0 };
  const after = { depthFt: 12, tobElevFt: 104, gradeFt: 100, usableCf: 15 * AF, mitCandidateCf: 6 * AF, landTakeSf: 5 * AF, excavationCf: 90000, bermFillCf: 55000 };
  for (const r of buildChangeSummaryRows({ before, after, siteDetReqAcFt: 33.8, siteDetProvidedOtherAcFt: 3, siteMitReqAcFt: 10, siteMitProvidedOtherAcFt: 1 })) {
    if (r.from) out.push(String(r.from));
    if (r.to) out.push(String(r.to));
    if (r.note) out.push(String(r.note));
  }
  // tailwater
  out.push(tailwaterNote(deriveTailwater({ district: { valueFt: 145.9 } }, { gradeFt: 153.1 })));
  out.push(tailwaterNote(deriveTailwater({})));
  return out.filter(Boolean);
}

// The template bug: an article + number (+ optional unit) directly followed by another article, i.e.
// a number used as a noun ("the 153.1′ the site"). Also catch "above/below the {number} {clause}".
const ORPHAN_ARTICLE_NUMBER_ARTICLE = /\bthe\s+[\d.,]+\s*(?:′|ft|ac-?ft|ac|cy|%)?\s+the\b/i;
// A number immediately followed by a bare verb/subject clause with no noun between (the missing-noun form).
const NUMBER_THEN_CLAUSE = /\bthe\s+[\d.,]+\s*(?:′|ft)?\s+(?:site|pond|highest|lowest|it|which|storage)\b/i;

describe("O1 — every generated pond sentence is grammatically complete (no orphaned number-as-noun)", () => {
  const sentences = everyGeneratedSentence();

  it("renders a non-trivial set of templates", () => {
    expect(sentences.length).toBeGreaterThan(12);
  });

  it("no sentence has the 'the {number} the ...' orphan (the O1 bug)", () => {
    const bad = sentences.filter((s) => ORPHAN_ARTICLE_NUMBER_ARTICLE.test(s));
    expect(bad, `orphaned article-number-article in: ${JSON.stringify(bad)}`).toEqual([]);
  });

  it("no sentence uses a bare number where a noun phrase belongs ('the {number} site/pond/...')", () => {
    const bad = sentences.filter((s) => NUMBER_THEN_CLAUSE.test(s));
    expect(bad, `number-as-noun in: ${JSON.stringify(bad)}`).toEqual([]);
  });

  it("the corrected drainage advisory (O2: now SOFT) reads as a complete clause", () => {
    const a = assessBuildability({ tobElev: 157.1, gradeFt: 153, drainageCapElevFt: 153.1 });
    const label = a.soft.find((h) => h.code === "drainage-inlets").label;
    expect(label).toBe("Rim 157.1′ is above 153.1′, the highest rim the site drains into by surface flow; above it, plan on inlets through the berm to convey runoff into the pond (standard practice).");
    expect(ORPHAN_ARTICLE_NUMBER_ARTICLE.test(label)).toBe(false);
    expect(NUMBER_THEN_CLAUSE.test(label)).toBe(false);
  });

  it("no em dash anywhere in the generated copy (house rule)", () => {
    const bad = sentences.filter((s) => s.includes("—"));
    expect(bad, `em-dash in: ${JSON.stringify(bad)}`).toEqual([]);
  });
});
