/* 2026-10-11 OUTAGE GUARD — NO SQL MAY RAISE 40001 OR 40P01.
 *
 * planyr.io was down for every user from about 6:05 to 6:31 PM CT. `commit_site_plan_overlay_placement`
 * raised its version-conflict error with errcode '40001'. PostgREST treats 40001 (serialization_failure)
 * and 40P01 (deadlock_detected) as RETRYABLE and re-runs the whole transaction inside the same request —
 * forever, for a conflict that can never resolve itself — so every conflicting call pinned one of the
 * pool's connections until the pool was 10/10 and every REST call timed out (PGRST003). A business-rule
 * refusal must use a code PostgREST passes straight back (a 'PTxxx' custom code, e.g. PT409 → HTTP 409).
 *
 * The matcher reads the RAISE shapes only (`errcode = '…'`, `sqlstate '…'`), never prose, so a comment
 * that explains this rule is allowed. Its own teeth are proven below on the exact line that caused it. */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOTS = ["src", "server"];
const BANNED = /(errcode\s*=\s*'(40001|40P01)')|(raise\s+sqlstate\s+'(40001|40P01)')/i;

function sqlFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...sqlFiles(p));
    else if (e.name.endsWith(".sql")) out.push(p);
  }
  return out;
}
const codeOnly = (line) => line.replace(/--.*$/, "");

describe("no SQL raises a PostgREST-retryable errcode (40001 / 40P01)", () => {
  it("the matcher catches the exact line that took production down (teeth)", () => {
    const outageLine = "raise exception 'This site plan changed elsewhere — reload before moving it again.' using errcode = '40001';";
    expect(BANNED.test(codeOnly(outageLine))).toBe(true);
    expect(BANNED.test(codeOnly("raise sqlstate '40P01';"))).toBe(true);
    expect(BANNED.test(codeOnly("raise exception 'x' using errcode = 'PT409';"))).toBe(false);
    expect(BANNED.test(codeOnly("-- it WAS errcode = '40001', never again"))).toBe(false);
  });

  it("no .sql file under src/ or server/ raises one", () => {
    const files = ROOTS.flatMap((r) => sqlFiles(r));
    expect(files.length).toBeGreaterThan(50); // a walk that found nothing would pass vacuously
    const hits = [];
    for (const f of files) {
      fs.readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (BANNED.test(codeOnly(line))) hits.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it("the overlay-placement client recognises the replacement code", () => {
    const src = fs.readFileSync("src/shared/sitePlans/lib/sitePlanOverlayStore.js", "utf8");
    expect(src).toMatch(/\["PT409", "40001"\]\.includes\(String\(error\.code/);
  });
});
