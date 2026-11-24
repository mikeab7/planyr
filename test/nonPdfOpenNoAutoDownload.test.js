import { describe, it, expect } from "vitest";
import { docReviewSource } from "./helpers/docReviewSource.js";
import fs from "node:fs";
import path from "node:path";

/* B1456896 — RED-PROOF: opening a document from a NAVIGATION row (Dashboard's "Jump back in"
 * card, Library Home's Recent/Pinned rows, a project's document list in the Library, or a
 * boot-resume deep link to #/markup) must never write a file to the user's machine on its own.
 * A row click means "show me this", never "put this on my computer" — a download belongs behind
 * a separate, explicit action.
 *
 * Before this fix, both entry points into "a non-PDF has no markup-canvas preview" auto-fired an
 * anchor `.click()` the instant they resolved that fact — DocReview.jsx's `fetchSourceBytes`
 * (reached by the Dashboard card, Library Home, MapFinder's brochure link, and boot resume, all
 * via the shared `onOpenReviewInDocReview` intent) and, separately, Library FileBrowser.jsx's own
 * `open()` (a project's document list). Both were regressions from the #1609 fix, which correctly
 * stopped a non-PDF dead-ending with no feedback but replaced the dead end with an unrequested
 * download instead of an offer.
 *
 * A full render of either component would need to mount Supabase/IndexedDB/pdf.js; the
 * load-bearing fact is source-checkable without one: neither non-PDF code path may call
 * `.click()` on a download anchor except from a handler wired to its own explicit button
 * (DocReview's redrop-banner Download button; FileBrowser's pendingDl-confirmation Download
 * button) — and this test fails against the pre-fix source, which had no such handler at all.
 */
const DOC_REVIEW = docReviewSource();
const FILE_BROWSER = fs.readFileSync(path.join(process.cwd(), "src/workspaces/library/components/FileBrowser.jsx"), "utf8");

describe("DocReview.jsx fetchSourceBytes — a non-PDF open never auto-downloads", () => {
  const fnStart = DOC_REVIEW.indexOf("const fetchSourceBytes = async (src, tok) => {");
  const fnEnd = DOC_REVIEW.indexOf("const downloadNonPdfOffer = () => {");

  it("locates fetchSourceBytes and downloadNonPdfOffer", () => {
    expect(fnStart).toBeGreaterThan(-1);
    expect(fnEnd).toBeGreaterThan(fnStart);
  });

  it("the non-PDF branch holds the bytes for later instead of clicking a download anchor", () => {
    const body = DOC_REVIEW.slice(fnStart, fnEnd);
    const branchStart = body.indexOf("if (!pdf && src && src.name && !isPdfName(src.name)) {");
    expect(branchStart).toBeGreaterThan(-1);
    const branchEnd = body.indexOf("\n    if (!pdf) {", branchStart);
    expect(branchEnd).toBeGreaterThan(branchStart);
    const branch = body.slice(branchStart, branchEnd);

    expect(branch).toMatch(/setNonPdfOffer\(/);
    // RED-PROOF (mutation replay): the pre-fix (#1609/B685) shape was an unconditional anchor
    // click inside this branch, fired the instant the bytes were fetched — no user gesture
    // anywhere between the fetch and the write. Reintroducing either line here is the regression.
    expect(branch).not.toMatch(/\.click\(\)/);
    expect(branch).not.toMatch(/document\.createElement\(\s*"a"\s*\)/);
  });

  it("downloadNonPdfOffer — the only place a non-PDF is written to disk — is wired to a button click, never called at load time", () => {
    expect(DOC_REVIEW).toMatch(/const downloadNonPdfOffer = \(\) => \{/);
    expect(DOC_REVIEW).toMatch(/onClick=\{downloadNonPdfOffer\}/);
  });
});

describe("Library FileBrowser.jsx open() — a non-PDF row click never auto-downloads", () => {
  const fnStart = FILE_BROWSER.indexOf("const open = (f) => {");
  const fnEnd = FILE_BROWSER.indexOf("\n  };", fnStart);

  it("locates open()", () => {
    expect(fnStart).toBeGreaterThan(-1);
    expect(fnEnd).toBeGreaterThan(fnStart);
  });

  it("arms an explicit confirmation instead of calling downloadFile directly", () => {
    const body = FILE_BROWSER.slice(fnStart, fnEnd);
    expect(body).toMatch(/setPendingDl\(f\)/);
    // RED-PROOF (mutation replay): the pre-fix (B685) shape called the fetch-and-download
    // function straight from the row click, with no confirmation step in between.
    expect(body).not.toMatch(/downloadFile\(f\)/);
  });

  it("downloadFile is reachable only from the pendingDl confirmation's own Download button", () => {
    const confirmStart = FILE_BROWSER.indexOf("{pendingDl && (");
    const confirmEnd = FILE_BROWSER.indexOf("{/* non-PDF download", confirmStart);
    expect(confirmStart).toBeGreaterThan(-1);
    expect(confirmEnd).toBeGreaterThan(confirmStart);
    const confirmBlock = FILE_BROWSER.slice(confirmStart, confirmEnd);
    expect(confirmBlock).toMatch(/onClick=\{\(\) => \{ const f = pendingDl; setPendingDl\(null\); downloadFile\(f\); \}\}/);

    // And there is no OTHER call to downloadFile anywhere else in the file (i.e. no second,
    // un-gated path that hands it a file straight from a row click).
    const allCalls = FILE_BROWSER.match(/downloadFile\(f\)/g) || [];
    expect(allCalls.length).toBe(1);
  });
});
