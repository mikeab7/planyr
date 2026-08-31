import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/* B966630 (NEW-7, owner "while you're doing this, change References to Overlays") — the
 * user-facing name for the panel that renders `sheetOverlays` is "Overlays", everywhere the user
 * can see it. The internal id stays `references` (it keys persisted panel state and every
 * `setLeftPanel("references")` call site — renaming it would orphan data, same shape as the
 * B418 "Review"/`doc-review` split). This is a SOURCE-SWEEP guard: the accessible name (button
 * `title`, which is what an assistive-tech user and the rail tooltip both read) can't silently
 * drift back to "References" without turning this red.
 */
const SRC = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");

describe("Overlays panel — user-facing name, internal id untouched (B966630)", () => {
  it("the Sections/rail-tab entry shows Overlays, keyed on the untouched `references` id", () => {
    expect(SRC).toMatch(/\{ id: "references", label: "Overlays" \}/);
  });

  it("the panel chrome header (PanelChrome bar title) reads Overlays", () => {
    expect(SRC).toMatch(/references: "Overlays",/);
  });

  it("the mobile Sections button names every section including Overlays", () => {
    expect(SRC).toMatch(/title="Show Land \/ Analysis \/ Yield \/ Properties \/ Overlays \/ Standards"/);
  });

  it("the B952 Library-independence note is reworded to Overlays, meaning intact both directions", () => {
    expect(SRC).toMatch(/Map overlays are managed here, separate from your Library documents — deleting a Library file won't remove an overlay from the map, and adding a Library file won't add one\./);
  });

  it("the add-overlay button, drop hint, and one-at-a-time warning all say overlay, not reference", () => {
    expect(SRC).toMatch(/Add overlay \(PDF \/ image \/ CAD\)…/);
    expect(SRC).toMatch(/Drop to add this overlay/);
    expect(SRC).toMatch(/Added the first file — one overlay is added at a time\./);
  });

  it("the canvas placeholder's direct remove action says overlay", () => {
    expect(SRC).toMatch(/✕ remove this overlay/);
  });

  it("front/back and above-the-plan tooltips say overlay, not reference", () => {
    expect(SRC).toMatch(/title="Draw this overlay above the other overlays"/);
    expect(SRC).toMatch(/title="Draw this overlay beneath the other overlays"/);
    expect(SRC).toMatch(/title="Draw this overlay over the parcel boundary, the setback ring and the site elements instead of underneath them"/);
  });

  it("the right-click menu's cross-band item says overlay, not reference", () => {
    expect(SRC).toMatch(/"Put this overlay back under the parcel and the site elements"/);
    expect(SRC).toMatch(/"Lift this overlay over the parcel boundary, the setback ring and the site elements"/);
  });

  /* ⛔ Internal identifiers must NOT have moved — a rename that touches these orphans persisted
   * state (every plan's `leftPanel` local-storage value, every `setLeftPanel("references")`
   * call). This is the other half of the guard: the label moved, the id didn't. */
  it("internal identifiers are untouched: the panel id, sheetOverlays, and addOverlayFile", () => {
    expect(SRC).toMatch(/setLeftPanel\("references"\)/);
    expect(SRC).toContain("sheetOverlays");
    expect(SRC).toContain("addOverlayFile");
    expect(SRC).not.toMatch(/setLeftPanel\("overlays"\)/);
  });

  /* No stray "References" (capital R, the panel's old display name) remains anywhere a user
   * could see it — this is the sweep the item's own brief asked for: no user-facing string left
   * unrenamed. Comments and unrelated words ("georeferenced", "preference", "recordingReference")
   * are excluded by requiring the literal word "References" as its own token. */
  it("no bare capitalized \"References\" token remains outside a code comment", () => {
    // Tracks /* … */ block-comment state across lines (a naive per-line check misreads a
    // continuation line — no leading `//`/`*` — as code, and a comment's OWN closing ` */}` line
    // as code too). `//` line comments and jsx `{/* … */}` are still handled per-line.
    const lines = SRC.split("\n");
    const offenders = [];
    let inBlockComment = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let codePart = "";
      let rest = line;
      while (rest.length) {
        if (inBlockComment) {
          const end = rest.indexOf("*/");
          if (end === -1) { rest = ""; break; }
          inBlockComment = false;
          rest = rest.slice(end + 2);
          continue;
        }
        const lineCommentAt = rest.indexOf("//");
        const blockStartAt = rest.indexOf("/*");
        if (lineCommentAt === -1 && blockStartAt === -1) { codePart += rest; break; }
        if (lineCommentAt !== -1 && (blockStartAt === -1 || lineCommentAt < blockStartAt)) {
          codePart += rest.slice(0, lineCommentAt);
          break; // the rest of the line is a // comment
        }
        codePart += rest.slice(0, blockStartAt);
        inBlockComment = true;
        rest = rest.slice(blockStartAt + 2);
      }
      if (/\bReferences\b/.test(codePart)) offenders.push(`line ${i + 1}: ${line.trim()}`);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
