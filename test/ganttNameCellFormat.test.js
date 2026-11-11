// B2671223 — a name cell's own Bold / Italic / Underline (stored as task.cellFmt.name) must reach the
// Gantt name caption on screen AND in the print/PDF export (PDF-PARITY). Before, only the whole-row
// task.bold/italic/underline did, so underlining a name cell changed the grid and nothing else.
import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");

it("on-screen Gantt caption honours the name cell's bold / italic / underline", () => {
  const i = src.indexOf("const GanttName = ");
  expect(i > 0).toBeTruthy();
  const body = src.slice(i, i + 900);
  expect(body).toMatch(/task\.bold \|\| task\.cellFmt\?\.name\?\.bold/);
  expect(body).toMatch(/task\.italic \|\| task\.cellFmt\?\.name\?\.italic/);
  expect(body).toMatch(/task\.underline \|\| task\.cellFmt\?\.name\?\.underline/);
});

it("exported Gantt name records honour the same three flags", () => {
  const i = src.indexOf("nameRecords.push({");
  expect(i > 0).toBeTruthy();
  const body = src.slice(i, i + 600);
  expect(body).toMatch(/t\.bold \|\| t\.cellFmt\?\.name\?\.bold/);
  expect(body).toMatch(/t\.italic \|\| t\.cellFmt\?\.name\?\.italic/);
  expect(body).toMatch(/t\.underline \|\| t\.cellFmt\?\.name\?\.underline/);
});
