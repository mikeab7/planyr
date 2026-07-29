/* NEW-3 (B1124) — the dead-store ratchet, as a test so `npm test` carries it too.
 *
 * A value computed on every render and read by nobody reads as a rendered fact and is not one — the
 * B1110 class (`detVerdict`/`detTone`/`detSub`), and three such defects surfaced in five dispatches.
 * The baseline is frozen per file and may only go DOWN, so an existing one is paid off opportunistically
 * while a NEW one fails here immediately. Rationale and the limits of what it can see (it catches the
 * unread-VARIABLE shape, not the unmounted-JSX shape) are in ui-audit/dead-store-audit.mjs.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { collect, compare } from "../ui-audit/dead-store-audit.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const baseline = JSON.parse(readFileSync(resolve(here, "../ui-audit/dead-store-baseline.json"), "utf8"));

describe("B1124 · no NEW computed-but-never-read value may land", () => {
  it("every file is at or below its frozen dead-store count", async () => {
    const { byFile } = await collect();
    const { worse, fresh } = compare(byFile, baseline);
    const msg = [
      ...worse.map((w) => `${w.file}: ${w.was} → ${w.now}`),
      ...fresh.map((f) => `${f.file}: ${f.n} new (clean at baseline)`),
    ].join("\n  ");
    expect(
      worse.length + fresh.length === 0,
      msg ? `NEW dead store(s) — render it, delete it, or prefix with _:\n  ${msg}` : "",
    ).toBe(true);
  }, 120000);

  it("B1110's own dead stores are gone and stay gone", () => {
    // The item that started this: assigned by every branch of the detention verdict block, read by
    // none. Deleted in B1110 rather than rendered (rendering them would duplicate the verdict strip's
    // number — PANEL-BREVITY rule 5). This asserts the names cannot creep back.
    const src = readFileSync(resolve(here, "../src/workspaces/site-planner/SitePlanner.jsx"), "utf8");
    for (const name of ["detVerdict", "detTone", "detSub"]) {
      // Allowed in prose (the comments explaining why they are gone); never as a declaration.
      expect(src, name).not.toMatch(new RegExp(`(let|const|var)\\s[^\\n]*\\b${name}\\b\\s*=`));
    }
  });
});
