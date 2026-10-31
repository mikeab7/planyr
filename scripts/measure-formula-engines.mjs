// Run the differential corpus (test/fixtures/spreadsheet/engineCorpus.js) and the pro-forma / fixture workbooks through BOTH formula
// engines (Planyr's older one and Univer's, headless) and print every disagreement, grouped by class. NEW-1 (one formula engine).
//   node scripts/measure-formula-engines.mjs [--json]
import { allComparisons, diffId } from "../test/fixtures/spreadsheet/engineCorpus.js";
import { acquisitionProForma, columnRefTable, PROJECT_NAMES } from "../test/fixtures/spreadsheet/proFormaWorkbooks.js";
import { parseSpreadsheetFile } from "../src/workspaces/model/lib/spreadsheetFile.js";
import { evaluateWorkbookUniver } from "../src/workspaces/model/lib/univerEval.js";

const sets = await allComparisons({ evaluateWorkbookUniver, parseSpreadsheetFile, acquisitionProForma, columnRefTable, PROJECT_NAMES });
if (process.argv.includes("--json")) { console.log(JSON.stringify(sets, null, 1)); process.exit(0); }
for (const [name, { compared, diffs }] of Object.entries(sets)) {
  console.log(`\n=== ${name}: compared ${compared} formulas, ${diffs.length} differ`);
  for (const d of diffs) console.log(`  [${d.cls}] ${diffId(name, d)}   old=${d.old}  univer=${d.univer}`);
}
process.exit(0);
