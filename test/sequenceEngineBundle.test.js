// Audit batch J1 — the Schedule page runs the REAL engine modules through one generated bundle
// (public/sequence/engine.js), not pasted-in copies. This replaces the four *-inline-sync tests
// (formula, ownership, range selection, health-engine parity): there is nothing left to keep in step by hand
// except the bundle itself, and this fails when it is stale.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildEngine, OUT } from "../scripts/build-sequence-engine.mjs";
import { sequencePageSource } from "./helpers/sequenceSource.js";

describe("public/sequence/engine.js (the Schedule's engine bundle)", () => {
  it("is exactly what the engine modules build to (run: npm run build:sequence-engine)", () => {
    expect(readFileSync(OUT, "utf8")).toBe(buildEngine());
  });

  it("is loaded by the page before its own code, and the page carries no second copy of the engine", () => {
    const page = sequencePageSource();
    const engineAt = page.indexOf('<script src="/sequence/engine.js"></script>');
    expect(engineAt).toBeGreaterThan(-1);
    expect(engineAt).toBeLessThan(page.indexOf('<script type="text/babel">'));
    // Each of these used to be defined in index.html (pasted in, or hand-copied). Now they come from the bundle.
    for (const name of [
      "addBD", "difBD", "cascadeDates", "recomputeSchedule", "rollupParentDates", "mergeCloudDoc", "rowDropIntent",
      "ownerListOf", "computeDisplayHealth", "loadDocument", "normalizeToV6", "evalHealthRules", "makeSelection",
      "crossScheduleLabel",
    ]) {
      expect(page, name).not.toMatch(new RegExp(`(?:^|\\n)\\s*(?:const|let|function)\\s+${name}\\b`));
    }
    for (const marker of ["FORMULA-ENGINE:START", "SCHEDULE-OWNERSHIP:START", "RANGE-SELECTION:START", "@shared-engine:begin"]) {
      expect(page, marker).not.toContain(marker);
    }
  });

  it("publishes the live clock, holiday set and meeting index as accessors, so `NOW = …` in the page reaches the engine", () => {
    // Run the bundle in a bare context the way a classic <script> would, then drive the globals like the page does.
    const g = {};
    new Function("globalThis", "window", readFileSync(OUT, "utf8"))(g, g);
    expect(typeof g.addBD).toBe("function");
    expect(typeof g.PlanyrFormula.evaluateFormula).toBe("function");
    g.NOW = "2031-02-03";
    expect(g.NOW).toBe("2031-02-03");
    g.HOLIDAY_SET = new Set(["2031-02-04"]);
    expect(g.addBD("2031-02-03", 1)).toBe("2031-02-05");   // the new holiday is skipped by the engine's own addBD
    g.MEETING_BODY_INDEX = { 7: { id: 7 } };
    expect(g.MEETING_BODY_INDEX[7].id).toBe(7);
  });
});
