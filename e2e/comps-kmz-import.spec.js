/* Comps .kmz import (NEW-1/B1577424) — logged-out UI mechanics, driven headlessly per
 * ATTEMPT-BEFORE-YOU-PARK: no external GIS, no sign-in needed to prove the FILE gets accepted,
 * unzipped and either parsed or refused with the right named error. The pure unzip/parse logic
 * is unit-tested in test/kmzImport.test.js; this proves the real file input in the real browser
 * is actually wired to it (accepts .kmz, routes through kmzToKmlText, surfaces its error text).
 *
 * What this CANNOT prove signed out: a genuinely valid .kmz still has to pass through
 * `insertDrafts` (a real Supabase write) before its rows show up in the Import review screen —
 * that leg is `Blocker: auth`, parked as V1130672 in VERIFICATION.md, same shape as
 * e2e/leasing-comps.spec.js's own signed-out save. What IS proven here: a valid .kmz reaches
 * that write at all (no "couldn't read" error along the way) and gets exactly the SAME honest
 * failure the KML path already gets signed out ("Sign in to add a comp" / "Supabase not
 * configured" / a raw Supabase error) — never the wrong error swallowing the real one.
 *
 * Run: PW_CHROME=/opt/pw-browsers/chromium npx playwright test e2e/comps-kmz-import.spec.js --project=chromium
 */
import { test, expect } from "@playwright/test";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openModule } from "./helpers.js";
import { buildKmz, pointFeature, zipStore } from "../src/shared/comps/lib/kmlExport.js";

const tmpDir = mkdtempSync(join(tmpdir(), "planyr-kmz-e2e-"));
const writeTmp = (name, bytes) => {
  const p = join(tmpDir, name);
  writeFileSync(p, bytes);
  return p;
};

async function openCompsTab(page) {
  await page.goto("/");
  await openModule(page, "site-planner");
  await page.getByRole("tab", { name: "Comps" }).click();
}

// The KML-import input lives beside "＋ Paste comps" in the Comps list view — B849233's original
// entry point, now labeled "⤒ Import (KML/KMZ)" since this item widened it past bare .kml.
// Scoped to its own <label> (rather than a bare `input[type=file]`) because other file inputs
// exist elsewhere in the app's kept-alive DOM (e.g. the plan-upload flow) and a bare selector
// would be ambiguous.
function kmlImportInput(page) {
  return page.locator("label", { hasText: "Import (KML/KMZ)" }).locator('input[type="file"]');
}

test("the import control accepts .kmz files (not just .kml)", async ({ page }) => {
  await openCompsTab(page);
  await expect(page.getByText("⤒ Import (KML/KMZ)")).toBeVisible();
  await expect(kmlImportInput(page)).toHaveAttribute("accept", ".kml,.kmz");
});

test("a .kmz that isn't a valid ZIP archive gets its own named error", async ({ page }) => {
  await openCompsTab(page);
  const path = writeTmp("not-a-zip.kmz", Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));
  await kmlImportInput(page).setInputFiles(path);
  await expect(page.getByText(/isn't a valid ZIP archive/i)).toBeVisible({ timeout: 10_000 });
});

test("a real ZIP with no .kml entry inside gets a DIFFERENT named error", async ({ page }) => {
  await openCompsTab(page);
  const zip = zipStore([{ name: "readme.txt", bytes: new TextEncoder().encode("hello") }]);
  const path = writeTmp("not-really-kmz.kmz", Buffer.from(zip));
  await kmlImportInput(page).setInputFiles(path);
  await expect(page.getByText(/doesn't contain a \.kml file/i)).toBeVisible({ timeout: 10_000 });
  // And NOT the unrelated "no placemarks" wording — the two failure modes must stay distinct.
  await expect(page.getByText("No placemarks found in that file.")).toHaveCount(0);
});

test("a valid Planyr-authored .kmz unzips and parses cleanly, reaching the same signed-out save failure the .kml path already gets", async ({ page }) => {
  await openCompsTab(page);
  const kmz = buildKmz("Test comps", [pointFeature({ name: "FM 359 tract", folder: ["Comps"], coord: [-95.789, 29.812], description: "3.2 AC, asking $850k" })]);
  const path = writeTmp("test-comps.kmz", Buffer.from(kmz));
  await kmlImportInput(page).setInputFiles(path);
  // Never the parse-failure wording — the archive and its one placemark were read correctly.
  await expect(page.getByText(/isn't a valid ZIP archive|doesn't contain a \.kml file|No placemarks found/i)).toHaveCount(0, { timeout: 10_000 });
  // Signed out, the draft insert itself fails — the SAME honest, named failure the existing
  // .kml path already produces (see e2e/leasing-comps.spec.js's identical signed-out assertion).
  await expect(page.getByText(/Sign in|Supabase not configured|permission denied|row-level security/i)).toBeVisible({ timeout: 10_000 });
});
