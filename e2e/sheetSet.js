/* A synthetic multi-sheet drawing set, generated in-process for the Review specs (NEW-1…NEW-7).
 *
 * Deterministic (no PRNG, no dates) and built with pdf-lib, which is already a runtime dependency —
 * so nothing new is committed as a binary and nothing can drift out of sync with a generator.
 *
 * The NAMES are the point. The owner's report was about a real set whose 32 file names are byte-for-
 * byte identical for their whole readable length and differ only at the very end
 * ("2024-10-08 - JACINTOPORT - MEP - ISSUE FOR CONSTRUCTION - p1" … "- p32"), which is precisely the
 * part a plain CSS ellipsis throws away. The sheet TITLES are built the same way on purpose
 * ("OVERALL ROOF PLAN" vs "OVERALL FLOOR PLAN"): shared prefix, distinguishing tail.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/* No real client data: a placeholder project name, per e2e/fixtures/README.md. */
export const SET_NAME = "2026-01-08 - E2E DISTRIBUTION CENTER - MEP - ISSUE FOR CONSTRUCTION.pdf";
const TITLES = ["OVERALL FLOOR PLAN", "OVERALL ROOF PLAN", "OVERALL SITE PLAN", "OVERALL POWER PLAN"];

/** @returns {Promise<Buffer>} a `pages`-page D-size (24×36 in) set with a readable title block. */
export async function buildSheetSet(pages = 14) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 2592, H = 1728;
  for (let i = 1; i <= pages; i++) {
    const p = doc.addPage([W, H]);
    p.drawRectangle({ x: 40, y: 40, width: W - 80, height: H - 80, borderColor: rgb(0, 0, 0), borderWidth: 3 });
    // Title block, bottom-right — where readSheetMeta looks for the number/title band.
    p.drawRectangle({ x: W - 560, y: 60, width: 480, height: 300, borderColor: rgb(0, 0, 0), borderWidth: 2 });
    p.drawText("E2E DISTRIBUTION CENTER", { x: W - 540, y: 300, size: 26, font: bold });
    p.drawText(TITLES[i % TITLES.length], { x: W - 540, y: 250, size: 22, font: bold });
    p.drawText('SCALE: 1" = 40\'', { x: W - 540, y: 190, size: 20, font });
    p.drawText(`A${100 + i}`, { x: W - 540, y: 110, size: 60, font: bold });
    // Enough drawing content that reading and rasterising cost something real (a set that reads
    // instantly would never exercise the "still reading" state these specs assert about).
    for (let k = 0; k < 220; k++) {
      const x = 100 + (k * 37) % (W - 700), y = 100 + (k * 91) % (H - 300);
      p.drawRectangle({ x, y, width: 120, height: 60, borderColor: rgb(0.1, 0.1, 0.1), borderWidth: 1 });
      p.drawText(`RM ${k}`, { x: x + 6, y: y + 20, size: 10, font });
    }
  }
  return Buffer.from(await doc.save());
}

/** Hand the set to a file input under the owner's long, identical-prefix name. */
export async function dropSheetSet(page, pages = 14, name = SET_NAME) {
  const buffer = await buildSheetSet(pages);
  await page.locator('input[type="file"]').first().setInputFiles({ name, mimeType: "application/pdf", buffer });
}
