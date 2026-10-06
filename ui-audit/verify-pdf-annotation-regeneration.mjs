// Regeneration parity for the editable PDF markups (B2127664 amendment, NEW-1 2026-10-06).
// Builds the shared fixture PDF through the REAL writer (imagePdf.jpegToPdf + pdfAnnotations.buildAnnotations) over a
// real JPEG, then has MuPDF rebuild every annotation's appearance from its dictionary (what Bluebeam / Acrobat do when a
// recipient edits one) and compares against the as-written render. Needs `pip install pymupdf numpy`; exits 2 (VOID) when
// they are missing, never 0. Not a browser harness — no Chromium, so no tabTiming precondition applies.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { jpegToPdf } from "../src/workspaces/site-planner/lib/imagePdf.js";
import { buildFixture } from "../test/fixtures/pdfAnnotationsFixture.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-regen-"));
const py = (code, ...args) => spawnSync("python3", ["-I", "-c", code, ...args], { encoding: "utf8" });

const jpg = path.join(out, "base.jpg");
const mk = py("import sys,pymupdf\np=pymupdf.Pixmap(pymupdf.csRGB,pymupdf.IRect(0,0,792,612),False);p.clear_with(225);p.save(sys.argv[1])", jpg);
if (mk.status !== 0) { console.error("VOID: PyMuPDF is not installed (pip install pymupdf numpy)\n" + mk.stderr); process.exit(2); }

const built = buildFixture();
const pdf = jpegToPdf({ jpeg: new Uint8Array(fs.readFileSync(jpg)), pixelW: 792, pixelH: 612, widthIn: 11, heightIn: 8.5, title: "regen", annotations: built.annots, date: new Date(2026, 9, 5) });
const file = path.join(out, "fixture.pdf");
fs.writeFileSync(file, pdf);

const r = spawnSync("python3", ["-I", path.join(here, "tools", "pdf_regen_compare.py"), file, path.join(out, "run")], { encoding: "utf8" });
process.stdout.write(r.stdout); process.stderr.write(r.stderr);
console.log(`PNGs: ${out}/run_written.png, run_regen.png`);
process.exit(r.status ?? 1);
