/* NEW-2 — NAVIGATION WINS: the jurisdiction pill must shrink, truncate or collapse before it ever
 * overlaps the project / plan chips.
 *
 * THE REPORT (owner, 2026-08-11): "if I am looking at a site on a normal sized laptop screen, I
 * can't change between the concepts or the plans because the unincorporated / city of Houston /
 * ETJ / Harris County chip is too big and it covers it." Reproduced and measured by him at a
 * 1280×800 window: the pill overlapped the plan chip's box by a sliver, and `elementFromPoint`
 * along the chip's right edge returned the PILL'S TEXT SPAN at −4, −8, −12, −20 and −30 px — so
 * the last stretch of the chip, the ▾ CARET included, was not clickable.
 *
 * ⛔ THE REAL PROOF IS A HIT TEST IN A BROWSER, and it lives in the ui-audit harness
 * `verify-header-nav-clickable` (4 widths × 4 jurisdiction strings, every pixel of the chip asked
 * `elementFromPoint`; pre-fix it loses 201/201 points on the owner's longest string at 1280 AND at
 * 1440). CI cannot run a browser, so this suite guards the two halves that CAN be checked without
 * one: the pure shortening model, and — by reading the real source — the layout rule that decides
 * which zone yields. A markdown note rots; a source guard does not.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { formatJurisdictionBadge } from "../src/workspaces/site-planner/lib/jurisdiction.js";
import { jurisdictionSegments, abbreviateJurisdiction } from "../src/workspaces/site-planner/lib/jurisdictionBadgeFit.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const header = read("src/shared/ui/AppHeader.jsx");
const crumb = read("src/shared/ui/ProjectBreadcrumb.jsx");
const badgeSrc = read("src/workspaces/site-planner/components/JurisdictionBadge.jsx");
const planner = read("src/workspaces/site-planner/SitePlanner.jsx");

/* THE OWNER'S OWN PILL, built through the real formatter — not a hand-written fixture. A hand-made
 * badge object tests the shortener against a shape the app may never produce. */
const bain = formatJurisdictionBadge({ city: [], cityCentroid: [], etj: ["Houston"], county: ["Harris"], isd: ["Katy ISD"] });
/* The LONGEST string his 28 sites produce: Goose Creek, 6 of 14 tested lots inside Baytown's
 * limits and the other 8 inside Baytown's own ETJ. */
const gooseCreek = formatJurisdictionBadge({
  city: ["Baytown"], cityAll: [], citySome: ["Baytown"], cityCentroid: [],
  etj: ["Baytown"], county: ["Harris"], isd: ["Goose Creek CISD"],
  cityCoverage: { inCity: 6, tested: 14 },
  sources: [{ id: "city", state: "ok" }, { id: "etj", state: "ok" }, { id: "county", state: "ok" }],
});

describe("the shortened pill drops whole FACTS, governing one first", () => {
  it("segments the owner's reported pill in reading order, governing slot first", () => {
    // The label grammar is B367296's: `·` separates SLOTS of the governing chain, and an ETJ site
    // leads with the city whose ETJ reaches it (unincorporated is implied, not printed).
    expect(bain.text).toBe("City of Houston ETJ · Harris County · Katy ISD");
    expect(jurisdictionSegments(bain)).toEqual([
      "City of Houston ETJ", "Harris County", "Katy ISD",
    ]);
  });

  it("shortens it to the governing fact plus a count", () => {
    expect(abbreviateJurisdiction(bain)).toEqual({
      text: "City of Houston ETJ +2", hidden: 2, full: bain.text,
    });
  });

  /* ⚠ AMENDED BY B367298, and the amendment is a correction of THIS test's premise rather than of
   * its rule. The rule — never cut a segment in half — is unchanged and is now enforced further
   * down the ladder. What changed is the claim in the old comment that "on a split site the lead
   * names BOTH halves": it did, as ONE pre-joined slot, and that is exactly what made the pill
   * unfittable. Driven in a real browser (`npm run verify:jurbadge`) on Goose Creek and Tsakiris at
   * 761 and 860 px, this short form is still ~330 px in a ~150 px box, so the pill fell back to a
   * CSS ellipsis and produced the very "Part in City of Bayto…" this test names. The two halves are
   * now two SLOTS — both still govern, both still lead, and now the shortener can drop one. */
  it("⛔ never cuts a segment in half — each governing half survives intact", () => {
    const short = abbreviateJurisdiction(gooseCreek);
    expect(short.text).toBe("Part in City of Baytown limits (full purpose, 6 of 14 lots) +3");
    expect(gooseCreek.text.startsWith("Part in City of Baytown limits (full purpose, 6 of 14 lots)")).toBe(true);
    expect(short.full).toBe(gooseCreek.text);
  });

  it("⛔ takes the SLOTS the label built, never a re-split of the rendered string", () => {
    /* The principle is untouched: the segments come from `formatJurisdictionLabel`'s own `slots`,
     * never from splitting the rendered text. B367298 changed what the LABEL puts in those slots —
     * a split now contributes its two governing facts separately — so this pins the two real slots
     * instead of the one pre-joined blob. Splitting the rendered string would still be wrong, and
     * the guard against it is `test/jurisdictionCoupling`. */
    expect(jurisdictionSegments(gooseCreek)).toContain("Part in City of Baytown limits (full purpose, 6 of 14 lots)");
    expect(jurisdictionSegments(gooseCreek)).toContain("rest in its ETJ");
    // Three hidden, not two: splitting the governing chain into its real slots means the count
    // finally matches the number of facts the pill is standing in for.
    expect(abbreviateJurisdiction(gooseCreek).hidden).toBe(3);
  });

  it("says nothing about a count it does not have, and survives a null", () => {
    const one = formatJurisdictionBadge({ city: [], cityCentroid: [], etj: [], county: [] });
    expect(abbreviateJurisdiction(one)).toEqual({ text: "Unincorporated", hidden: 0, full: "Unincorporated" });
    expect(abbreviateJurisdiction(null)).toEqual({ text: "", hidden: 0, full: "" });
    expect(jurisdictionSegments(null)).toEqual([]);
  });

  it("⛔ a legacy badge with no slots keeps its chain WHOLE — it is never re-split", () => {
    // Recovering a fact from the rendered label is banned repo-wide (test/jurisdictionCoupling),
    // and this module does not get an exemption for being the one that shortens it. A legacy badge
    // contributes its governing chain as one opaque segment: shorter than ideal, never wrong.
    const legacy = { text: "Unincorporated · Harris County", jur: "Unincorporated", county: "Harris County" };
    expect(jurisdictionSegments(legacy)).toEqual(["Unincorporated", "Harris County"]);
    expect(abbreviateJurisdiction(legacy).text).toBe("Unincorporated +1");
    const legacyChain = { text: "A · B · C", jur: "A · B", county: "C" };
    expect(jurisdictionSegments(legacyChain)).toEqual(["A · B", "C"]);
  });

  it("the non-governing tail is the LAST segment — the first thing worth dropping", () => {
    const withTail = formatJurisdictionBadge({
      city: ["Katy"], cityAll: [], cityCentroid: [], etj: [], county: ["Fort Bend"],
      sources: [{ id: "city", state: "ok" }, { id: "county", state: "ok" }],
    });
    const segs = jurisdictionSegments(withTail);
    expect(withTail.tail).toBeTruthy();
    expect(segs[segs.length - 1]).toBe(withTail.tail);
    expect(abbreviateJurisdiction(withTail).text.startsWith(segs[0])).toBe(true);
  });

  it("the label publishes its slots — the shortener never re-parses the display string", () => {
    expect(Array.isArray(bain.parts)).toBe(true);
    expect(bain.parts).toEqual(["City of Houston ETJ"]);
  });
});

describe("the layout rule, read off the real source", () => {
  it("⛔ the LEFT (navigation) zone takes the width it needs; the CENTRE takes what is left", () => {
    // The pre-fix zones were `1 | 0 1 auto (max 40%) | 1`: two equal side shares regardless of
    // content, so the breadcrumb was handed less than it needed while the pill sat under its cap
    // and never shrank. If that shape comes back, this goes red.
    expect(header).toContain(`{ flex: "0 1 auto", maxWidth: "60%", overflow: "hidden" }`);
    expect(header).toContain(`{ flex: "1 1 0%", minWidth: 0, overflow: "hidden" }`);
    expect(header).not.toContain(`maxWidth: "40%"`);
  });

  it("the RIGHT zone no longer competes for the row on desktop", () => {
    expect(header).toContain(`flex: narrow ? "1 0 auto" : "0 0 auto"`);
  });

  it("the phone layout is untouched — the row still scrolls sideways there", () => {
    expect(header).toContain(`{ flexShrink: 0, maxWidth: "none" }`);
    expect(header).toContain("...(narrow ? { flex: 1, ...zoneFixed }");
  });

  it("both crumbs may shrink, and neither may be squeezed below the shared floor", () => {
    expect(crumb).toContain("export const CRUMB_MIN_W =");
    expect(crumb).toContain(`flex: "0 1 auto", maxWidth: 240, minWidth: CRUMB_MIN_W`);
    // The plan chip reads the SAME constant — two floors that can drift is how one of the pair
    // ends up squeezable again.
    expect(planner).toContain(`import { CRUMB_MIN_W } from "../../shared/ui/ProjectBreadcrumb.jsx";`);
    expect(planner).toContain("minWidth: CRUMB_MIN_W, whiteSpace: \"nowrap\"");
    // …and the row itself must be shrinkable, or the zone's overflow clips the last caret off.
    expect(crumb).toContain(`gap: 2, minWidth: 0, flex: "0 1 auto"`);
  });

  it("the caret is addressable, so a hit-test guard can aim at the exact thing that was eaten", () => {
    expect(planner).toContain('data-testid="plan-caret"');
  });
});

describe("the pill keeps the whole answer even when it shows part of it", () => {
  it("publishes the full string in the DOM and leads the tooltip with it", () => {
    expect(badgeSrc).toContain("data-jurisdiction-full={text}");
    expect(badgeSrc).toContain("data-jurisdiction-abbrev=");
    // The tooltip's first line is the full jurisdiction, so a shortened pill is one hover away
    // from complete.
    const titleBlock = badgeSrc.slice(badgeSrc.indexOf("const title = ["), badgeSrc.indexOf("].filter(Boolean).join"));
    expect(titleBlock.split("\n").find((l) => /^\s*text,\s*$/.test(l))).toBeTruthy();
  });

  it("⛔ measures against the SPACE IT IS GIVEN, not against its own width", () => {
    /* The rule is unchanged and is the important one: measuring the PILL latches — abbreviating
     * shrinks it, which then "proves" the short form is all that fits, and it can never come back
     * when the window widens. (B367298 measured that latch: shortest rung at 860 px, still shortest
     * at 1440 px.) What B367298 changed is HOW the granted width is read, because
     * `host.clientWidth` alone was not content-independent in every mode: the centred zone is out
     * of flow and its budget is its measured `max-width`, while the in-flow zone still tracks its
     * content once the row is over-subscribed, so the span is briefly filled with the FULL label
     * before the width is read. Both readings are asked of the ZONE, never of the pill. */
    expect(badgeSrc).toContain("const host = pill.parentElement;");
    expect(badgeSrc).toContain("cs.maxWidth");                 // the out-of-flow budget
    expect(badgeSrc).toContain("span.textContent = text;");    // ask for everything, then read
    expect(badgeSrc).not.toMatch(/avail\s*=\s*pill\./);       // ⛔ never the pill's own width
    expect(badgeSrc).toContain("ro.observe(host);");
    // …and the candidate widths come from always-mounted hidden copies, so the measurement is
    // independent of the decision it drives.
    expect(badgeSrc).toContain("data-jurisdiction-measure=");
    expect(badgeSrc).toContain("visibility: \"hidden\"");
  });
});
