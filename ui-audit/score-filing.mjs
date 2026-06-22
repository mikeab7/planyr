/* Title-block scoring runner (B360) — NOT in the app bundle. Node-only dev harness.
 *
 * Usage:  node ui-audit/score-filing.mjs
 *
 * It scores the REAL readers (readTitleBlockText + matchProjectInText + parseSheetScale) against
 * ground truth derived from each file's name, and prints a per-file scorecard + field pass rates.
 *
 * Corpus (once the Drive connector is re-authed to michael@planyr.io):
 *   1. For each training PDF, extract its first ~2 pages of embedded text (read_file_content via
 *      the Drive connector returns this text directly; do NOT download the 10–94 MB bytes).
 *   2. Save it as ui-audit/corpus/<exact original filename>.txt  (the .txt name IS the ground
 *      truth — e.g. "2024-10-22 - JACINTOPORT - STRUCTURAL - IFC.pdf.txt").
 *   3. Re-run this script. Each red ✗ cell points at the table/regex to tune; add a unit test
 *      with the real snippet to lock the fix in. △ = correct only by resolving to "Other"
 *      (a taxonomy gap — Fire Protection / Structural / MEP have no dedicated bucket; owner call).
 *
 * With no corpus present it runs the SYNTHETIC fixtures so the harness always proves itself.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { scoreCorpus, formatScorecard, SYNTHETIC_FIXTURES } from "./lib/filingScore.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const corpusDir = join(here, "corpus");

function loadCorpus() {
  if (!existsSync(corpusDir)) return [];
  return readdirSync(corpusDir)
    .filter((f) => f.toLowerCase().endsWith(".txt"))
    .map((f) => ({ name: f.replace(/\.txt$/i, ""), text: readFileSync(join(corpusDir, f), "utf8") }));
}

const corpus = loadCorpus();
const usingReal = corpus.length > 0;
const files = usingReal ? corpus : SYNTHETIC_FIXTURES;

console.log(`\n=== Planyr title-block scoring (V79 filing + V67 scale) ===`);
console.log(
  usingReal
    ? `Corpus: ${files.length} file(s) from ui-audit/corpus/`
    : `No ui-audit/corpus/*.txt found — running ${files.length} SYNTHETIC fixtures (self-check only).\n` +
      `Drop the owner's extracted title-block text into ui-audit/corpus/ once Drive is re-authed to score for real.`
);

const result = scoreCorpus(files);
console.log(formatScorecard(result));

if (!usingReal) {
  console.log(`\n(⚠ synthetic data — these numbers validate the harness, not the real reader accuracy.)`);
}
console.log("");
