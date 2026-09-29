// test/scheduleOwnership-inline-sync.test.js
//
// The scheduler page (public/sequence/index.html) carries a VERBATIM inlined copy of the
// schedule-ownership module because it is a standalone, in-browser-Babel HTML file that cannot
// import from src/ at runtime. This guard fails CI if that copy ever drifts from the canonical
// source — so a change to who owns a schedule can never ship to the shell's New-schedule modal and
// per-project list without also shipping to the embedded app that actually owns the document (or
// vice-versa). Two divergent answers to "which schedules live under this project" is precisely the
// second implementation of a one-answer function that docs/DATA.md forbids.
//
// To re-sync after editing src/shared/schedule/scheduleOwnership.js:
//   node scripts/sync-sequence-ownership.mjs
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { ownershipBody } from "../scripts/sync-sequence-ownership.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("scheduler inline schedule-ownership module", () => {
  it("matches the canonical src/shared/schedule/scheduleOwnership.js between markers", () => {
    const src = readFileSync(resolve(ROOT, "src/shared/schedule/scheduleOwnership.js"), "utf8");
    const html = readFileSync(resolve(ROOT, "public/sequence/index.html"), "utf8");
    expect(ownershipBody(html, "scheduler HTML")).toBe(ownershipBody(src, "source module"));
  });

  it("the inlined copy carries no import/export — it runs as a plain script, not a module", () => {
    const html = readFileSync(resolve(ROOT, "public/sequence/index.html"), "utf8");
    const body = ownershipBody(html, "scheduler HTML");
    expect(body).not.toMatch(/^\s*export\s/m);
    expect(body).not.toMatch(/^\s*import\s/m);
  });

  // B1939344 — crossScheduleLabel/scheduleLabelParts moved INTO this sync block from a standalone
  // copy further down public/sequence/index.html; this pins them staying inside the markers so a
  // future edit can't silently move them back out (which would un-guard them from the drift check
  // above — a general full-text diff, but only for whatever the markers actually enclose).
  it("crossScheduleLabel/scheduleLabelParts moved INTO the sync block and are still exported by the canonical module", () => {
    const src = readFileSync(resolve(ROOT, "src/shared/schedule/scheduleOwnership.js"), "utf8");
    const body = ownershipBody(src, "source module");
    expect(body).toMatch(/function scheduleLabelParts\(schedule\)/);
    expect(body).toMatch(/function crossScheduleLabel\(schedule\)/);
    expect(src).toMatch(/export \{[\s\S]*scheduleLabelParts, crossScheduleLabel[\s\S]*\};/);
  });

  it("the embedded app actually USES the inlined module on every load path", () => {
    const html = readFileSync(resolve(ROOT, "public/sequence/index.html"), "utf8");
    // All four paths that turn a stored/imported/seeded blob into live state — a schedule that
    // reaches state through any of them without an explicit owner is the bug this work removes.
    expect((html.match(/normalizeScheduleOwnership\(normalizeToV8\(/g) || []).length).toBe(4);
    // And a delete prunes its references rather than leaving a counter behind forever.
    expect(html).toMatch(/return pruneScheduleRefs\(\{\.\.\.d, aPid: newAPid, projects: newProjects\}\)/);
  });
});
