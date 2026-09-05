/* B1197328 — the Owner (responsibleParty) column was reachable in code but effectively
 * invisible in practice: 10th in default column order (0% visible at 1280px width, 23% at
 * 1440px — full width only from ~1610px up), and an empty cell rendered as a literally blank
 * span with no click affordance at all. Fixed three ways in public/sequence/index.html:
 *   (1) DEFAULT_GRID_COLS reorders Owner to position 6 (right after Duration).
 *   (2) An empty Owner cell now paints a "+ Assign" affordance; a single click opens the same
 *       ContactPicker a double-click on a filled cell already does.
 *   (3) Naming a brand-new task parks the cursor on that task's own Owner cell ONCE (never
 *       opens an editor, never writes anything — see commitAndAdvance/parkOwnerAfterNameRef).
 *
 * ⛔ THE OWNER HAS STATED A HARD CONSTRAINT, checked by the FAILING test at the bottom of this
 * file: he does NOT assign an owner to every task, and a high unassigned count is normal usage,
 * not a defect. None of the above may become a default value, a required field, or a nag —
 * reachability only. `mkt()` must still create every task with `responsibleParty: ""`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");

function mktBody() {
  const start = SRC.indexOf("const mkt = (");
  expect(start, "mkt() not found in public/sequence/index.html").toBeGreaterThan(-1);
  const end = SRC.indexOf("\n};", start);
  return SRC.slice(start, end);
}

describe("DEFAULT_GRID_COLS — Owner reordered to position 6 (B1197328)", () => {
  it("places responsibleParty right after duration, before predecessors", () => {
    const m = SRC.match(/const DEFAULT_GRID_COLS = (\[[^\]]+\]);/);
    expect(m, "DEFAULT_GRID_COLS not found").toBeTruthy();
    const cols = JSON.parse(m[1].replace(/'/g, '"'));
    expect(cols.indexOf("responsibleParty")).toBe(5); // 6th column, 0-indexed
    expect(cols.indexOf("duration")).toBe(4);
    expect(cols.indexOf("predecessors")).toBe(6);
    // No column was dropped or duplicated by the reorder.
    expect(cols.sort()).toEqual(
      ["id", "name", "start", "end", "duration", "responsibleParty", "predecessors", "successors", "health", "status", "cost", "notes"].sort(),
    );
  });
});

describe("Empty Owner cell — a click affordance, not dead space (B1197328)", () => {
  it("renders a distinct '+ Assign' affordance for an empty cell, and the plain name for a set one", () => {
    expect(SRC).toMatch(/\+ Assign/);
    // The old literally-blank rendering (task.responsibleParty||"") is gone from this branch.
    const idx = SRC.indexOf('case "responsibleParty":');
    expect(idx).toBeGreaterThan(-1);
    const branch = SRC.slice(idx, SRC.indexOf("case \"cost\":", idx));
    expect(branch).not.toMatch(/\{task\.responsibleParty\|\|""\}/);
    expect(branch).toMatch(/onClick=\{\(\) => setEdit\(\{taskId: task\.id, col: "responsibleParty"\}\)\}/);
  });
});

describe("Naming a new task parks focus on Owner once — never writes, never re-opens an editor (B1197328)", () => {
  it("commitAndAdvance moves selection to the Owner column without calling setEdit", () => {
    const idx = SRC.indexOf("const commitAndAdvance = (taskId, col, val) => {");
    expect(idx).toBeGreaterThan(-1);
    const body = SRC.slice(idx, SRC.indexOf("\n  };", idx));
    expect(body).toMatch(/shouldParkOwner/);
    expect(body).toMatch(/setSelectedColIdx\(oi\)/);
    expect(body).not.toMatch(/setEdit\(/); // moves focus only — never opens an editor
  });

  it("the park is armed only when a brand-new task's Name edit is auto-opened, and disarms on first use", () => {
    const idx = SRC.indexOf("const revealInserted = useCallback(");
    expect(idx).toBeGreaterThan(-1);
    const body = SRC.slice(idx, SRC.indexOf("}, []);", idx));
    expect(body).toMatch(/parkOwnerAfterNameRef\.current = id/);
    // Only armed inside the shouldOpenEdit branch, not unconditionally on every reveal.
    const armIdx = body.indexOf("parkOwnerAfterNameRef.current = id");
    const guardIdx = body.lastIndexOf("if (shouldOpenEdit)", armIdx);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(armIdx);
  });
});

describe("⛔ HARD CONSTRAINT — Owner is reachability only, never a default/required field (B1197328)", () => {
  it("mkt() still creates every task with responsibleParty: \"\" — a non-empty default here is the exact regression this rule forbids", () => {
    expect(mktBody()).toMatch(/responsibleParty:\s*""/);
  });

  // ⛔ THE FAILING-TEST REQUIREMENT: simulates the "default-the-field fix" a well-meaning but
  // wrong session might ship (defaulting mkt()'s responsibleParty to a placeholder name so the
  // "Needs an owner" dashboard card / unassigned count reads lower) and asserts it would be
  // CAUGHT. This is not a live mutation test (mkt() lives inside a walled inline script, not an
  // importable module) — it pins the exact assertion shape so a real regression trips the test
  // above, and proves the shape is discriminating by checking it against a literal string that
  // models the forbidden change.
  it("a hypothetical default-the-field change is provably distinguishable from the real, correct mkt() body", () => {
    const real = mktBody();
    const defaulted = real.replace('responsibleParty: ""', 'responsibleParty: "Unassigned"');
    expect(defaulted).not.toMatch(/responsibleParty:\s*""/);
    expect(real).toMatch(/responsibleParty:\s*""/);
    expect(real).not.toBe(defaulted);
  });

  it("the Assign affordance never pre-fills a name — it only opens the same picker a filled cell's double-click uses", () => {
    const idx = SRC.indexOf('case "responsibleParty":');
    const branch = SRC.slice(idx, SRC.indexOf("case \"cost\":", idx));
    // The click handler only ever opens the editor (setEdit) — it must never call commit()
    // itself, which is what a "default the field" shortcut would look like here.
    expect(branch).not.toMatch(/commit\(task\.id,\s*"responsibleParty"/);
  });
});
