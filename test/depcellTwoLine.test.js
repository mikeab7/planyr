/* B655552 — the Schedule grid's predecessor/successor cell (`DepCell`) had two owner-reported
 * defects: (A) the second line renders but gets sliced off mid-glyph at the row boundary, and
 * (B) a single link ellipsizes on line 1 while line 2 sits empty instead of wrapping into it.
 * B655552 fixed both, but gated two-line rendering on a 24px row-height threshold — below it,
 * DepCell fell back to one line + a "+N" badge. The owner's OWN saved row height is 20 (the
 * slider's floor), so every cell on his real schedule hit that fallback — which he never asked
 * for and explicitly rejected by name ("all you gave me was a '+1'").
 *
 * B655552 (round 2) (2026-08-25) — shown the honest tradeoff (a taller row vs. smaller cell text), the
 * owner chose to shrink the cell's own text rather than change row height globally. Re-measured
 * against the REAL Inter font: the natural (non-clipping) line-height for this font is exactly
 * font-size+2px at every size tested, so DEPCELL_FONT_SIZE 8 / DEPCELL_LINE_H 10 is the largest
 * size whose two-line total (20px) still fits the slider's floor with zero clipping — the same
 * box-equals-ink relationship the original 10px/12px pair already shipped safely at. This makes
 * canTwoLine true across the ENTIRE 20-34 slider range in the grid/split view, so the "+N"
 * fallback below is now reachable only from MasterView's own DepCell call site (a separate,
 * pre-existing, narrower list view outside this report's scope). B655552 (round 2) also adds a native
 * `title` tooltip listing every item's FULL, untruncated name — the owner's new, explicit ask.
 *
 * The real behaviour is pixel geometry across a range of row-height settings, so the actual proof
 * is `ui-audit/verify-depcell-two-line.mjs` — a real headless-Chromium harness, mutation-proven both
 * ways (reverting the vertical padding reproduces defect A's clip; forcing the threshold unreachable
 * reproduces defect B's stuck single line). It is NOT wired into CI (same standing gap as every
 * other `ui-audit/verify-*.mjs` harness — B613760).
 *
 * This is the CI-RUNNABLE HALF: it pins the structural facts the fix rests on, so a future edit
 * that quietly removes the threshold check, restores the old vertical padding, or drops the
 * line-clamp wrap branch fails the build instead of only failing a script nobody remembered to run.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const seq = readFileSync(resolve(here, "../public/sequence/index.html"), "utf8");

// Adapted from the same helper in test/contactCreateConfirm.test.js — extended to skip past the
// PARAMETER LIST first (via paren depth) before brace-matching the body, because DepCell destructures
// its params (`function DepCell({items, ...})`), and a `{` inside the parameter list is not the body.
const bodyOf = (src, name) => {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) return null;
  let parenDepth = 0, bodyStart = -1;
  for (let j = src.indexOf("(", i); j < src.length; j++) {
    if (src[j] === "(") parenDepth++;
    else if (src[j] === ")") { parenDepth--; if (parenDepth === 0) { bodyStart = src.indexOf("{", j); break; } }
  }
  if (bodyStart < 0) return null;
  let depth = 0, started = false;
  for (let j = bodyStart; j < src.length; j++) {
    if (src[j] === "{") { depth++; started = true; }
    else if (src[j] === "}") { depth--; if (started && depth === 0) return src.slice(i, j + 1); }
  }
  return null;
};

const depCellSrc = bodyOf(seq, "DepCell");

describe("B655552 — DepCell two-line threshold, never a partial second line", () => {
  it("DepCell exists and was found whole", () => {
    expect(depCellSrc, "DepCell must exist").toBeTruthy();
  });

  it("the two-line threshold is a measured constant, not a magic number inline", () => {
    expect(seq, "DEPCELL_FONT_SIZE must be defined (B655552 (round 2) shrink)").toMatch(/const DEPCELL_FONT_SIZE = 8;/);
    expect(seq, "DEPCELL_LINE_H must be defined").toMatch(/const DEPCELL_LINE_H = 10;/);
    expect(seq, "DEPCELL_TWO_LINE_MIN_H must be derived from it, never hardcoded separately")
      .toMatch(/const DEPCELL_TWO_LINE_MIN_H = DEPCELL_LINE_H \* 2;/);
    expect(depCellSrc, "DepCell must gate its layout on the row's actual height, not assume it")
      .toMatch(/const canTwoLine = \(s\.height \|\| 0\) >= DEPCELL_TWO_LINE_MIN_H;/);
  });

  it("the threshold is <= the row-height slider's REAL floor, computed from source (not asserted separately)", () => {
    // Extract both numbers from source rather than hardcoding two numbers that could silently drift
    // apart — the actual bug being guarded against is "the floor moved (or the threshold crept up)
    // and nobody noticed the two no longer agree," which a pair of independent hardcoded checks
    // would not catch if both were edited to still (wrongly) agree with each other.
    const floorMatch = seq.match(/ROW_H = Math\.min\(34, Math\.max\((\d+),/);
    const lineHMatch = seq.match(/const DEPCELL_LINE_H = (\d+);/);
    expect(floorMatch, "ROW_H's floor clamp must be findable in source").toBeTruthy();
    expect(lineHMatch, "DEPCELL_LINE_H must be findable in source").toBeTruthy();
    const floor = Number(floorMatch[1]);
    const twoLineTotal = Number(lineHMatch[1]) * 2;
    expect(twoLineTotal, `two lines at ${twoLineTotal}px must fit inside the row-height floor of ${floor}px — otherwise the floor can select a height where canTwoLine is false again`)
      .toBeLessThanOrEqual(floor);
  });

  it("every DepCell text span uses the shared font-size constant, never a re-hardcoded 10", () => {
    // The three content spans (label, name, +N badge) must all reference DEPCELL_FONT_SIZE — a
    // future edit re-hardcoding fontSize:10 on any of them would silently reintroduce clipping at
    // the 20px floor (10px font needs a 12px line, not the 10px DEPCELL_LINE_H this fix relies on).
    const fontSizeRefs = depCellSrc.match(/fontSize:DEPCELL_FONT_SIZE/g) || [];
    expect(fontSizeRefs.length, "1 wrap-branch span + label/name/badge in the slot branch = 4 references").toBe(4);
    expect(depCellSrc, "no span inside DepCell may hardcode fontSize:10 again").not.toMatch(/fontSize:10\b/);
  });

  it("below the threshold, exactly ONE line renders — never a doomed partial second line", () => {
    expect(depCellSrc, "visibleCount must collapse to 1 when canTwoLine is false")
      .toMatch(/const visibleCount = canTwoLine \? 2 : 1;/);
  });

  it("the 2-slot layout has NO vertical padding (defect A's fix: 2 natural-height lines must fit the row's height exactly, whatever that height now is)", () => {
    expect(depCellSrc, "the multi-item slots container must use 0 vertical padding")
      .toMatch(/padding:"0 8px"/);
    expect(depCellSrc, "the OLD 2px vertical padding (which caused the 4px shortfall at ROW_H=24) must not return")
      .not.toMatch(/padding:"2px 8px"/);
    expect(depCellSrc, "each slot's line-height must be the measured natural height, never the old flex-shrink minHeight:10 floor")
      .not.toMatch(/minHeight:10\b/);
  });

  it("a single link WRAPS into the unused second line instead of ellipsizing on line 1 (defect B's fix)", () => {
    /* Anchored to the exact `if (...) {` form, not a bare substring match — a loose
     * `/items\.length === 1 && canTwoLine/` regex still matches a semantically-DISABLED gate like
     * `if (false && items.length === 1 && canTwoLine) {`, since that string still CONTAINS the
     * matched substring. Mutation-caught during the B655552 close-out audit: the loose form let
     * exactly that mutation through undetected. */
    expect(depCellSrc, "the single-item branch must exist, gated on EXACTLY `if (items.length === 1 && canTwoLine) {` — not merely contain that text as a substring of a disabled condition")
      .toMatch(/if \(items\.length === 1 && canTwoLine\) \{/);
    expect(depCellSrc, "it must use line-clamp to allow up to 2 lines")
      .toMatch(/WebkitLineClamp:2/);
    /* Scoped to the line-clamp SPAN's own occurrence specifically (`whiteSpace:"normal"` also
     * appears on the outer wrap div, two lines above) — a bare `/whiteSpace:"normal"/` regex
     * stays green even if it's removed from the SPAN alone, as long as the div's copy survives.
     * Mutation-caught during the B655552 close-out audit: removing just the span's copy (the one
     * that actually fixed the wrap-not-happening bug) left the loose regex passing. */
    expect(depCellSrc, "the line-clamp SPAN itself (not just its ancestor div) must override nowrap — this is the exact fix for the bug where the span inherited nowrap and silently failed to wrap")
      .toMatch(/whiteSpace:"normal", width:"100%"/);
  });

  it("hidden items are never silently dropped — the +N indicator logic covers whatever is off-screen", () => {
    expect(depCellSrc, "extra must be computed off the ACTUAL visible count, not a hardcoded 2")
      .toMatch(/const extra = items\.length - visibleCount;/);
    expect(depCellSrc, "the +N badge must render on the last VISIBLE slot, whatever visibleCount is")
      .toMatch(/i === visibleCount - 1 && extra > 0/);
  });

  it("the hover-to-see-all popup gate tracks visibleCount too (never assumes 2 are always shown)", () => {
    const onEnter = depCellSrc.slice(depCellSrc.indexOf("const onEnter ="), depCellSrc.indexOf("const onEnter =") + 300);
    expect(onEnter, "onEnter must bail based on the real visible count").toMatch(/items\.length <= visibleCount/);
  });
});

describe("B655552 (round 2) — hovering a predecessor/successor cell reveals every item's FULL name", () => {
  const helperSrc = (() => {
    const i = seq.indexOf("function depCellFullTitle(");
    if (i < 0) return null;
    let depth = 0, started = false, bodyStart = seq.indexOf("{", i);
    for (let j = bodyStart; j < seq.length; j++) {
      if (seq[j] === "{") { depth++; started = true; }
      else if (seq[j] === "}") { depth--; if (started && depth === 0) return seq.slice(i, j + 1); }
    }
    return null;
  })();

  it("a dedicated helper builds the tooltip text — not an inline one-off", () => {
    expect(helperSrc, "depCellFullTitle must exist").toBeTruthy();
  });

  it("the tooltip lists every item's label + FULL name, one per line — not just the visible/truncated ones", () => {
    expect(helperSrc, "must map every item to 'label · name', joined with newlines for the native tooltip")
      .toMatch(/renderLabel\(item\)\}[^`]*·[^`]*\$\{renderName\(item\)\}/);
    expect(helperSrc, "must join on items, not on a pre-sliced visible subset")
      .toMatch(/items\.map\(/);
  });

  it("an existing caller-supplied note (the flagged-predecessor explanation, or the lag plain-English hint) is APPENDED, never replaced", () => {
    expect(helperSrc, "extraNote must still be threaded through, appended after the name list")
      .toMatch(/extraNote \? `\$\{list\}\\n\\n\$\{extraNote\}` : list/);
  });

  it("both DepCell render branches use the computed full title, not the caller's raw (often name-less) title prop", () => {
    expect(depCellSrc, "the wrap branch (single item) must use fullTitle")
      .toMatch(/<div ref=\{ref\} title=\{fullTitle\}/);
    // The multi-slot branch's own <div ref={ref} title={fullTitle} ...> — same literal text, so a
    // single occurrence count below confirms BOTH branches (wrap + multi-slot) were updated, since
    // the old `title={title || undefined}` form must be gone entirely from DepCell.
    const fullTitleRefs = depCellSrc.match(/title=\{fullTitle\}/g) || [];
    expect(fullTitleRefs.length, "both the single-item wrap div and the multi-slot div must use fullTitle").toBe(2);
    expect(depCellSrc, "the old raw-title form must not survive anywhere in DepCell")
      .not.toMatch(/title=\{title \|\| undefined\}/);
  });

  it("a native title attribute was chosen deliberately — not a new positioned overlay that could eat a press", () => {
    // CHROME-NEVER-EATS-A-PRESS: this grid has a documented history of overlays intercepting clicks
    // meant for the cell beneath them. A native `title` never participates in hit-testing, so this
    // pins that the fix stayed with the browser's own tooltip mechanism for the FULL-NAME feature,
    // distinct from the pre-existing "+N" popup (which IS a positioned overlay, gated on hover+extra>0
    // and already scoped away from the cell's own click targets — unchanged by this fix).
    expect(depCellSrc, "DepCell must not grow a second createPortal call for the new full-name feature")
      .toMatch(/ReactDOM\.createPortal\(/g);
    const portalCount = (depCellSrc.match(/ReactDOM\.createPortal\(/g) || []).length;
    expect(portalCount, "exactly one portal — the pre-existing +N popup — no new overlay added").toBe(1);
  });
});

describe("B655552 — export parity (buildPDFHtml)", () => {
  /* buildPDFHtml renders the predecessors column as a bare comma-joined id list — no names, no
   * multi-line layout, nothing that can clip or need wrapping. This fix touches DepCell's on-screen
   * pixel layout only; there is no equivalent rendering in the export to keep in sync, so no export
   * change was needed. This test pins that fact so a future PR that DOES give the export names/lines
   * is forced to consider DepCell's behaviour deliberately, rather than the two silently re-diverging
   * in some other way. */
  it("the PDF export's predecessors column is still a plain id list (no name/line-wrap logic to diverge)", () => {
    const matches = seq.match(/case "predecessors": return \(t\.predecessors\|\|\[\]\)\.map\(p=>p\.id\|\|p\)\.join\(", "\);/g) || [];
    expect(matches.length, "buildPDFHtml's predecessors cases must still be the bare id-list form").toBeGreaterThan(0);
  });
});
