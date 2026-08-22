/* B655552 — the Schedule grid's predecessor/successor cell (`DepCell`) had two owner-reported
 * defects: (A) the second line renders but gets sliced off mid-glyph at the row boundary, and
 * (B) a single link ellipsizes on line 1 while line 2 sits empty instead of wrapping into it.
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
    expect(seq, "DEPCELL_LINE_H must be defined").toMatch(/const DEPCELL_LINE_H = 12;/);
    expect(seq, "DEPCELL_TWO_LINE_MIN_H must be derived from it, never hardcoded separately")
      .toMatch(/const DEPCELL_TWO_LINE_MIN_H = DEPCELL_LINE_H \* 2;/);
    expect(depCellSrc, "DepCell must gate its layout on the row's actual height, not assume it")
      .toMatch(/const canTwoLine = \(s\.height \|\| 0\) >= DEPCELL_TWO_LINE_MIN_H;/);
  });

  it("below the threshold, exactly ONE line renders — never a doomed partial second line", () => {
    expect(depCellSrc, "visibleCount must collapse to 1 when canTwoLine is false")
      .toMatch(/const visibleCount = canTwoLine \? 2 : 1;/);
  });

  it("the 2-slot layout has NO vertical padding (defect A's fix: 2×12px lines must fit inside 24px exactly)", () => {
    expect(depCellSrc, "the multi-item slots container must use 0 vertical padding")
      .toMatch(/padding:"0 8px"/);
    expect(depCellSrc, "the OLD 2px vertical padding (which caused the 4px shortfall at ROW_H=24) must not return")
      .not.toMatch(/padding:"2px 8px"/);
    expect(depCellSrc, "each slot's line-height must be the measured natural height, never the old flex-shrink minHeight:10 floor")
      .not.toMatch(/minHeight:10\b/);
  });

  it("a single link WRAPS into the unused second line instead of ellipsizing on line 1 (defect B's fix)", () => {
    expect(depCellSrc, "the single-item branch must exist, gated on items.length === 1 && canTwoLine")
      .toMatch(/items\.length === 1 && canTwoLine/);
    expect(depCellSrc, "it must use line-clamp to allow up to 2 lines")
      .toMatch(/WebkitLineClamp:2/);
    expect(depCellSrc, "it must allow wrapping — the shared cell style's inherited nowrap must be overridden")
      .toMatch(/whiteSpace:"normal"/);
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
