// source-scan: guards that a JSX attribute spread is present on every panel input; there is no runtime surface to test without a browser extension
// Every free-text <input> in the Site Planner panels opts out of password-manager icons (LastPass "•••" in the
// encumbrance Name field). Real sign-in / contact fields carry their own autoComplete token or data-contact-field.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = "src/workspaces/site-planner/components";
const SKIP = /type="(checkbox|radio|range|file|color|hidden|password)"/;
describe("site-planner inputs opt out of password managers", () => {
  it("no single-line <input> lacks NO_AUTOFILL / a real token", () => {
    const bad = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".jsx") && !/^AuthPanel/.test(n))) {
      readFileSync(join(dir, f), "utf8").split("\n").forEach((l, i) => {
        if (l.includes("<input ") && !SKIP.test(l) && !/NO_AUTOFILL|autoComplete|contactField|data-contact/.test(l)) bad.push(`${f}:${i + 1}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
