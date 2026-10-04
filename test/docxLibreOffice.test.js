import { describe, it, expect } from "vitest";
import { findSoffice, runLibreOfficeCheck, SKIP_MESSAGE, readFodt, buildPlanyrSavedFixture } from "../ui-audit/verify-docx-libreoffice.mjs";

/* NEW-3 (B2022929 amend, V1448016): a Planyr-saved .docx opens correctly in a SECOND word processor.
 * This is LibreOffice, NOT Microsoft Word (that stays on V1448016 for the owner). The real work is in
 * ui-audit/verify-docx-libreoffice.mjs; this case runs it under `npm test` when LibreOffice is installed and says plainly
 * that it was skipped when it is not (CI has none), rather than going quietly green. */
const lo = findSoffice();
if (!lo) console.warn(`\n[docxLibreOffice] ${SKIP_MESSAGE}\n`);

describe("a Planyr-saved .docx, read back by LibreOffice (not Word)", () => {
  it.skipIf(!lo)("reads every tracked change and comment with the right author, date and text; the package validates", async () => {
    const res = await runLibreOfficeCheck();
    const failed = res.checks.filter((c) => !c.pass).map((c) => `${c.name} — ${c.detail}`);
    expect(res.voided || 0).toBe(0);
    expect(failed).toEqual([]);
    expect(res.checks.filter((c) => c.name.startsWith("Planyr ")).length).toBeGreaterThanOrEqual(4);
  }, 180000);

  // These need no LibreOffice, so they run in CI too: the parser the check relies on, against LibreOffice-shaped XML.
  it("the .fodt reader extracts kind, author, date, changed text, comments and reply parents", () => {
    const xml = `<office:document xmlns:office="o" xmlns:text="t" xmlns:dc="d" xmlns:loext="l"><office:body><office:text><text:tracked-changes>
      <text:changed-region text:id="a"><text:insertion><office:change-info><dc:creator>Ann</dc:creator><dc:date>2026-01-02T03:04:05</dc:date></office:change-info></text:insertion></text:changed-region>
      <text:changed-region text:id="b"><text:deletion><office:change-info><dc:creator>Bo</dc:creator><dc:date>2026-01-03T00:00:00</dc:date></office:change-info><text:p>gone</text:p></text:deletion></text:changed-region></text:tracked-changes>
      <text:p>x<text:change-start text:change-id="a"/>new<text:change-end text:change-id="a"/><office:annotation office:name="n1"><dc:creator>Cy</dc:creator><dc:date>2026-02-01T00:00:00</dc:date><text:p>hi</text:p></office:annotation><office:annotation office:name="n2" loext:parent-name="n1"><dc:creator>Di</dc:creator><text:p>re</text:p></office:annotation></text:p></office:text></office:body></office:document>`;
    const r = readFodt(xml);
    expect(r.changes).toEqual([{ kind: "insertion", author: "Ann", date: "2026-01-02T03:04:05", text: "new" }, { kind: "deletion", author: "Bo", date: "2026-01-03T00:00:00", text: "gone" }]);
    expect(r.comments.map((c) => [c.name, c.parent, c.author, c.text])).toEqual([["n1", "", "Cy", "hi"], ["n2", "n1", "Di", "re"]]);
  });
  it("the fixture is a real package built by Planyr's own writer", () => {
    const bytes = buildPlanyrSavedFixture();
    expect(bytes[0]).toBe(0x50); expect(bytes[1]).toBe(0x4b); // PK
  });
});
