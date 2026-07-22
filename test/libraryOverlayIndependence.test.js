import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

// B952 — a Cowork round-5 live report worried that uploading an image through the Library's
// root drop-zone ALSO created a "reference/overlay" in the Site Planner's References panel, so
// deleting the Library file left a stray overlay on the map. An AUDIT-FIRST trace found there is
// NO such linkage: the Library filing pipeline writes only to the doc-review stores
// (doc_reviews / file_facts / the file-storage bucket) and never touches the site model's
// `sheetOverlays`; the only creator of an overlay is SitePlanner's `addOverlayFile`, whose sole
// callers are Site-Planner-local drop/pick gestures. The observed overlay was an independent
// Site-Planner overlay (a self-added test artifact). The product decision (B952) is to KEEP the
// two features independent — a Library holds many non-spatial docs (title commitments, MEP sets)
// that must never auto-splat onto the map — and make the separation clear in the UI.
//
// This guard LOCKS IN that independence at the source level so a future refactor can't silently
// re-introduce the exact surprise the report feared (a Library upload leaking into map
// References). It reads the real filing sources off disk and asserts none of them reference the
// site overlay creator or the overlay model field. If someone wires filing to overlays, this
// test goes red and forces a deliberate decision instead of a silent data-consistency bug.

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

// The Library filing surface + the shared doc-review file-storage data layer it drives.
const FILING_SOURCES = {
  "library/components/FileBrowser.jsx": "../src/workspaces/library/components/FileBrowser.jsx",
  "doc-review/lib/reviewStore.js": "../src/workspaces/doc-review/lib/reviewStore.js",
  "doc-review/lib/autofiling.js": "../src/workspaces/doc-review/lib/autofiling.js",
  "doc-review/lib/fileIndex.js": "../src/workspaces/doc-review/lib/fileIndex.js",
};

// The site-overlay creator + the site model's overlay collection field. Filing code must touch
// neither — an overlay is created only by a Site-Planner drop/pick, never by filing a document.
const FORBIDDEN = ["addOverlayFile", "setSheetOverlays"];

describe("B952 — Library filing and Site Planner map references are independent (no bridge)", () => {
  for (const [label, rel] of Object.entries(FILING_SOURCES)) {
    it(`${label} never creates or mutates a Site Planner map reference`, () => {
      const code = src(rel);
      for (const token of FORBIDDEN) {
        expect(code, `${label} must not reference \`${token}\` — filing a document must never create/mutate a map overlay`).not.toContain(token);
      }
      // It also must not import from the Site Planner overlay modules (the only home of overlays).
      expect(code, `${label} must not import SitePlanner (the overlay owner)`).not.toMatch(/from\s+["'][^"']*site-planner\/SitePlanner/);
      expect(code, `${label} must not import the overlay-storage helper`).not.toMatch(/from\s+["'][^"']*overlayStorage/);
    });
  }

  it("SitePlanner's only overlay CREATOR is addOverlayFile, and filing cannot reach it", () => {
    // Sanity anchor: the site model persists overlays under `sheetOverlays`, and SitePlanner is
    // the sole module that appends to it. If this ever stops being true, the independence claim
    // above needs re-checking. (We assert the field name still exists so the guard can't silently
    // pass against a renamed model.)
    const planner = src("../src/workspaces/site-planner/SitePlanner.jsx");
    expect(planner).toContain("addOverlayFile");
    expect(planner).toContain("setSheetOverlays");
    // And the Library never imports SitePlanner at all (belt-and-suspenders on the whole surface).
    const library = src("../src/workspaces/library/Library.jsx");
    expect(library).not.toMatch(/SitePlanner/);
  });
});
