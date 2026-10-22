/* NEW-1 — Google Earth (KMZ) export is reachable from File ▾, and only ever through the ONE exportKmz.
 *
 * The behavioural proof (rows enabled/disabled, More menu, a real .kmz download) is the e2e spec
 * `e2e/file-menu-kmz.spec.js`. This is the CI-runnable source half: the File group's menu rows and its
 * dropdown rows exist, call the same lazy wrapper the canvas right-click calls, share ONE disabled reason,
 * and never pull `kmzExport` onto the boot path (B1042).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SP = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
const PT = readFileSync(new URL("../src/shared/ui/PriorityToolbar.jsx", import.meta.url), "utf8");

describe("NEW-1 — File ▾ Google Earth export", () => {
  it("the File group's overflow menuRows carry both KMZ rows, disabled without a map origin", () => {
    const g = SP.slice(SP.indexOf('id: "file", label: "File"'), SP.indexOf("render: ({ measuring })", SP.indexOf('id: "file", label: "File"')));
    expect(g).toMatch(/id: "export-kmz"[^\n]*exportKmz\(false\)[^\n]*disabled: !origin[^\n]*KMZ_NEEDS_ORIGIN/);
    expect(g).toMatch(/id: "export-kmz-3d"[^\n]*exportKmz\(true\)[^\n]*disabled: !origin[^\n]*KMZ_NEEDS_ORIGIN/);
  });

  it("the dropdown rows call the same exportKmz and are disabled with the shared reason", () => {
    expect(SP).toMatch(/data-testid="file-export-kmz"[\s\S]{0,400}exportKmz\(false\)/);
    expect(SP).toMatch(/data-testid="file-export-kmz-3d"[\s\S]{0,400}exportKmz\(true\)/);
    expect((SP.match(/disabled=\{!origin\} data-testid="file-export-kmz/g) || []).length).toBe(2);
  });

  it("one reason string, shared by the File rows and the More-menu rows (no second copy)", () => {
    expect((SP.match(/"Place this plan on the map first"/g) || []).length).toBe(1);
    expect((SP.match(/KMZ_NEEDS_ORIGIN/g) || []).length).toBeGreaterThanOrEqual(5);
  });

  it("the File button's title mentions Google Earth", () => {
    expect(SP).toMatch(/title="File — [^"]*Google Earth"/);
  });

  it("owner amendment 2026-10-22: the canvas right-click Map menu has NO export rows and no orphan divider", () => {
    const i = SP.indexOf('header = "Map";');
    expect(i).toBeGreaterThan(0);
    const body = SP.slice(i, SP.indexOf("return (", i));
    expect(body).toMatch(/Zoom to fit/); // known-good arm: the menu is the one we think it is
    expect(body).not.toMatch(/row\(\{ text: "Export to Google Earth/);
    expect(body).not.toMatch(/row\(\{ text: "Export with 3D buildings/);
    expect(body).not.toMatch(/exportKmz/);
    expect(body).not.toMatch(/paddingTop: 4 \}\} \/>\s*(\{\/\*[^]*?\*\/\})?\s*<\/>/); // no divider as the last child
  });

  it("exportKmz stays the lazy wrapper — kmzExport is never statically imported by the planner (B1042)", () => {
    expect(SP).toMatch(/const exportKmz = \(extrude = false\) => withExportSheet\(\(x\) => x\.exportKmz\(extrude\)\)/);
    expect(SP).not.toMatch(/from\s+["'][^"']*kmzExport(\.js)?["']/);
    expect(SP).not.toMatch(/import\(\s*["'][^"']*kmzExport/); // reached only through the export-sheet chunk
  });

  it("the shared More menu passes a row's title through, so a disabled row says why there too", () => {
    expect(PT).toMatch(/disabled=\{r\.disabled\} title=\{r\.title\}/);
  });

  it("owner decision 2026-10-22: the Map view has NO empty-map right-click menu and NO all-sites KMZ export (MapFinder)", () => {
    const MF = readFileSync(new URL("../src/workspaces/site-planner/MapFinder.jsx", import.meta.url), "utf8");
    expect(MF).not.toMatch(/exportSitesKmz/);
    expect(MF).not.toMatch(/\bmapMenu\b|setMapMenu/);
    expect(MF).not.toMatch(/onMapCtx/);
    expect(MF).not.toMatch(/"Map actions"/);
    expect(MF).not.toMatch(/import\(\s*["'][^"']*lib\/kmzExport/); // the site-plan KMZ writer is reached only from the planner's lazy export chunk
    // Untouched neighbours (a different feature): the comp-marker menu and its site-record export.
    expect(MF).toMatch(/exportCompSiteRecordKmz/);
    expect(MF).toMatch(/compMenu/);
    expect(MF).toMatch(/siteGroup\.on\("click", openSiteNow\)\.on\("contextmenu", onCtx\)/);
  });
});
