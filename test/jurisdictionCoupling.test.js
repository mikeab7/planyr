import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { formatJurisdictionBadge } from "../src/workspaces/site-planner/lib/jurisdiction.js";
import { governingCityOf } from "../src/workspaces/site-planner/lib/jurisdictionLabel.js";
import { administratorCandidates, resolveAdministrator } from "../src/workspaces/site-planner/lib/floodAdministrator.js";
import { DEFAULT_BUILDABILITY_RULES } from "../src/workspaces/site-planner/lib/buildability.js";

/* ═══ NEW-2 (B367297) — NOTHING DOWNSTREAM MAY KEY OFF THE FORMATTED JURISDICTION LABEL ══════════
 *
 * NEW-1 changes that string on 16 of the owner's 28 sites. The question this suite answers is the
 * one that decides whether that change is safe: does anything READ the label to make a decision?
 *
 * ⛔ THE ANSWER WAS YES, AND IT WAS THE WORST POSSIBLE ONE. `SitePlanner.jsx` derived the governing
 * city as
 *     (jurBadge?.jur || "").split(" / ")[0].replace(/^City of\s+/, "")
 * and handed it to `assessAdministrator` as `cityLabel` — the signal that decides whether a CITY's
 * floodplain ordinance is a candidate for the finished-floor elevation. The parse worked only while
 * the label happened to lead with the city and join everything with " / ". The first test below is
 * the RED PROOF, run against the real administrator resolver with the real FFE rule bag: with the
 * pre-fix parse the City of Houston's Ch. 19 rule (0.2% WSE + 2 ft) is never raised as a candidate
 * at all — the parsed string matches no rule record, and `resolveAdministrator` may never let an
 * UNMODELED candidate govern — so the comparison happens without the city's standard in it. On
 * flat Harris / Fort Bend ground the standard left holding the floor commonly sits 1–2 ft lower.
 * That is a wrong FLOOR, presented as a settled number.
 *
 * The fix is not a better parse — it is that the label became a LEAF. `governingCityOf` answers
 * from the structured model, and the source sweep below keeps it that way. */

/* The SAME rule bag `SitePlanner.jsx` hands `assessAdministrator` (`rules: buildRules`), so what is
 * measured here is what the panel would have shown — the FFE rules, not the mitigation records. */
const RULES = DEFAULT_BUILDABILITY_RULES;

// SitePlanner.jsx's pre-fix derivation, verbatim. Kept as the mutation control.
const preFixCityLabel = (b) =>
  b?.cityContainment === "in" ? (b?.jur || "").split(" / ")[0].replace(/^City of\s+/, "") || null : null;

const badgeFor = (j) => formatJurisdictionBadge({ sources: [], ...j });

/* SHAPE 2 with HOUSTON as the governing city: in Houston's limits and inside a second city's ETJ.
 * This is the arrangement that turns a wording change into a floodplain-rule change, because
 * Houston is the jurisdiction whose Ch. 19 rule is the strictest thing in the registry. */
const HOUSTON_PLUS_ETJ = badgeFor({
  city: ["Houston"], cityCentroid: ["Houston"], cityAll: ["Houston"],
  etj: ["Jersey Village"], county: ["Harris"],
});

describe("NEW-2 — the RED proof: the old string coupling silently downgraded the floodplain rule", () => {
  it("shape 2 breaks the parse, and the broken parse loses the City of Houston candidate", () => {
    expect(HOUSTON_PLUS_ETJ.jur).toBe("City of Houston · Jersey Village ETJ");

    const broken = preFixCityLabel(HOUSTON_PLUS_ETJ);
    const correct = governingCityOf(HOUSTON_PLUS_ETJ);
    expect(broken).toBe("Houston · Jersey Village ETJ");   // ← the coupling, in one string
    expect(correct).toBe("Houston");

    const candidatesFrom = (cityLabel) =>
      administratorCandidates({ county: "Harris", cityLabel, etjLabel: "Jersey Village", rules: RULES });

    const withBroken = candidatesFrom(broken);
    const withCorrect = candidatesFrom(correct);

    // The City of Houston record (`coh`) — the one carrying Ch. 19 — is present only with the
    // structured read. With the parsed label it is a candidate with NO modeled rule, which the
    // resolver may never let govern.
    expect(withCorrect.some((c) => c.key === "coh" && c.ruleModeled)).toBe(true);
    expect(withBroken.some((c) => c.key === "coh")).toBe(false);
    expect(withBroken.find((c) => c.kind === "primary" && c.label?.includes("Houston"))?.ruleModeled ?? false).toBe(false);

    /* And the consequence, in the terms the panel reasons in. `resolveAdministrator` only ever lets
     * a PRIMARY candidate WITH A MODELED RULE govern — an unmodeled one is a flag, never an
     * administrator. So the broken parse does not produce a wrong Houston; it produces NO Houston,
     * and the city's Ch. 19 standard (0.2% WSE + 2 ft) is simply never in the comparison. */
    const cohFfe = (res) => res.candidates.find((c) => c.key === "coh" && c.kind === "primary")?.ffe ?? null;
    expect(cohFfe(resolveAdministrator(withCorrect))).toMatchObject({ basis: "wse02pct", plusFt: 2 });
    expect(cohFfe(resolveAdministrator(withBroken))).toBe(null);
    expect(resolveAdministrator(withBroken).candidates.every((c) => c.kind !== "primary" || c.key !== "coh")).toBe(true);
  });

  it("shape 1 is why this hid for a year — the parse and the model agree there", () => {
    const inCity = badgeFor({ city: ["Houston"], cityCentroid: ["Houston"], cityAll: ["Houston"], etj: [], county: ["Harris"] });
    expect(preFixCityLabel(inCity)).toBe(governingCityOf(inCity));
  });

  it("…and the ETJ path was never string-coupled, so ETJ sites keep the rule they had", () => {
    // 16 of the 28 sites are this shape. `etjLabels` is structured and always was.
    const etjSite = badgeFor({ city: [], cityCentroid: [], cityAll: [], etj: ["Houston"], county: ["Harris"] });
    expect(etjSite.etjLabels).toEqual(["Houston"]);
    const res = resolveAdministrator(administratorCandidates({
      county: "Harris", cityLabel: governingCityOf(etjSite), etjLabel: etjSite.etjLabels[0], rules: RULES,
    }));
    // The Houston ETJ is still raised as a candidate — losing it is the 1–2 ft downgrade this
    // whole family of items exists to prevent.
    expect(res.candidates.some((c) => c.kind === "etj" && c.key === "coh" && c.ruleModeled)).toBe(true);
  });
});

/* ═══ THE SWEEP — a guard, not a one-time audit ══════════════════════════════════════════════════
 *
 * Comments are stripped first, so the two places that QUOTE the banned expression to explain why it
 * is banned do not trip their own guard. */
const SRC = path.join(process.cwd(), "src");
const OWNERS = [                              // the only modules allowed to build or split a label
  path.join("workspaces", "site-planner", "lib", "jurisdictionLabel.js"),
  path.join("workspaces", "site-planner", "lib", "jurisdiction.js"),
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|jsx)$/.test(p)) out.push(p);
  }
  return out;
}
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

describe("NEW-2 — no source may recover a jurisdiction FACT from the jurisdiction LABEL", () => {
  const files = walk(SRC).filter((f) => !OWNERS.some((o) => f.endsWith(o)));

  it("nothing takes a badge label apart", () => {
    /* A read of `.jur` / `.text` off a badge, followed by a string operation on the same line — the
     * exact shape of the defect. Anything matching here is either the bug coming back or a genuinely
     * new case that has to be argued on the item before it is added to OWNERS. */
    const BANNED = /\b(?:jurBadge|badge|jur)\s*(?:\?\.|\.)\s*(?:jur|text)\b[^\n;]*\.(?:split|match|indexOf|lastIndexOf|slice|substring|startsWith|endsWith|search)\s*\(/;
    const hits = [];
    for (const f of files) {
      const src = stripComments(readFileSync(f, "utf8"));
      src.split("\n").forEach((line, i) => { if (BANNED.test(line)) hits.push(`${path.relative(process.cwd(), f)}:${i + 1}  ${line.trim()}`); });
    }
    expect(hits).toEqual([]);
  });

  it("nothing tests a badge label for the WORD 'Unincorporated' (NEW-1 removes it from 16 of 28 sites)", () => {
    /* `siteAnalysis.js` and `detentionRules.js` legitimately branch on `j.unincorporated`, the
     * BOOLEAN from the identify — that is the model, and it is unchanged. What must never appear is
     * a test of the rendered string, which now says nothing at all on an ETJ site. */
    const BANNED = /\.(?:jur|text)\b[^\n;]*(?:includes|match|test|indexOf)\s*\(\s*\/?["'/]?Unincorporated/i;
    const hits = [];
    for (const f of files) {
      const src = stripComments(readFileSync(f, "utf8"));
      src.split("\n").forEach((line, i) => { if (BANNED.test(line)) hits.push(`${path.relative(process.cwd(), f)}:${i + 1}`); });
    }
    expect(hits).toEqual([]);
  });

  it("SitePlanner's floodplain `cityLabel` reads the structured accessor, by name", () => {
    const src = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
    expect(src).toContain("cityLabel: governingCityOf(jurBadge)");
    expect(src).toContain('import { governingCityOf } from "./lib/jurisdictionLabel.js"');
  });

  /* The other three signals `assessAdministrator` receives were already structured. Pinned here so a
   * later "tidy" cannot quietly route one of them back through the label. */
  it("the ETJ, the split and the unresolved-role signals are structured too", () => {
    const src = stripComments(readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8"));
    expect(src).toContain("(jurBadge?.etjLabels || [])[0]");
    expect(src).toContain("unresolvedRoles: jurBadge?.unresolvedRoles || []");
    expect(src).toContain("city: jurBadge.partialCities[0]");
  });
});
