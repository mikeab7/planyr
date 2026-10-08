/* NAMES HAVE ONE SOURCE OF TRUTH — never copy a name into component state.
 *
 * B1934528 was `useState(() => restored.site)` in SitePlanner: a copy taken at mount that every
 * other rename door missed, patched once with a listener. The structural cure is that displays
 * READ through `shared/names/names.js`; this test keeps a component from growing the copy again
 * (a grep-based rule, since "is this state a copy of a name?" is not decidable from types).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { validateName, fileSafe, resolveProjectName, setPendingProjectName, clearPendingProjectName, NAME_MAX } from "../src/shared/names/nameCore.js";
import { sheetFileName } from "../src/workspaces/site-planner/lib/printSheet.js";

const walk = (d, out = []) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsx|js)$/.test(f)) out.push(p);
  }
  return out;
};
const files = walk("src");
const STATE_FROM_NAME = /useState\((?:\(\) *=> *)?[^;]*?(siteLabel|planLabel|projectName|siteName|planName|\b\w+\??\.(?:name|site|title)\b)/;

// Modal FORM editors that seed a DRAFT BUFFER of the entity's own field from the record being
// edited — an edit buffer for one open form, committed through that entity's own rename/save.
// Not displays. A NEW entry needs the same justification; the list may only be argued down.
const DRAFT_EDITORS = [
  "src/shared/mapNotes/components/MapNoteEditor.jsx",
  "src/workspaces/model/components/NameManager.jsx",
];

describe("no component seeds state from a name", () => {
  it("finds no useState seeded from a name field outside the declared draft editors", () => {
    const bad = [];
    for (const f of files) {
      if (f.includes("/shared/names/")) continue;
      if (DRAFT_EDITORS.includes(f)) continue;
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (STATE_FROM_NAME.test(line)) bad.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(bad, "read the name via useProjectName/usePlanName (shared/names/names.js)").toEqual([]);
  });

  it("SitePlanner never holds siteLabel/planLabel as state again", () => {
    const s = readFileSync("src/workspaces/site-planner/SitePlanner.jsx", "utf8");
    expect(s).not.toMatch(/\[siteLabel, setSiteLabel\]/);
    expect(s).not.toMatch(/\[planLabel, setPlanLabel\]/);
    expect(s).toMatch(/useProjectName\(groupId/);
  });

  it("the draft-editor allowlist has no dead entries", () => {
    for (const f of DRAFT_EDITORS) expect(STATE_FROM_NAME.test(readFileSync(f, "utf8"))).toBe(true);
  });

  it("CLAUDE.md states the rule", () => {
    expect(readFileSync("CLAUDE.md", "utf8")).toMatch(/never copy a name into component state/i);
  });
});

describe("rename rules", () => {
  it("rejects empty / whitespace names with a message, trims and collapses the rest", () => {
    expect(validateName("   ", "project").ok).toBe(false);
    expect(validateName("", "plan").error).toMatch(/needs a name/);
    expect(validateName("  A   B ").name).toBe("A B");
    expect(validateName("x".repeat(NAME_MAX + 1)).ok).toBe(false);
  });
  it("fileSafe strips path/colon characters but the source name is never altered", () => {
    expect(fileSafe("A/B: C*D")).toBe("A-B- C-D");
    expect(fileSafe("///")).toBe("site-plan");
    expect(sheetFileName({ project: "A/B: C", plan: "P?1" })).not.toMatch(/[\\/:*?"<>|]/);
  });
  it("a stored name wins over a pending one; pending fills in only for an unsaved project", () => {
    setPendingProjectName("g1", "Pending");
    expect(resolveProjectName(null, "g1", "Untitled")).toBe("Pending");
    expect(resolveProjectName("Stored", "g1", "Untitled")).toBe("Stored");
    clearPendingProjectName("g1");
    expect(resolveProjectName(null, "g1", "Untitled")).toBe("Untitled");
  });
});
