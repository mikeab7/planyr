/* lib/keyTips.js — Excel's Alt key-tip sequences as a pure state machine (Alt, H, O, I -> autofit column; Esc backs out one
 * level; an unknown letter cancels). Every leaf must name a real registry command. */
import { describe, it, expect } from "vitest";
import { KEYTIP_TREE, allKeyTips, choicesAt, beginKeyTips, stepKeyTips, START, nodeAt } from "../src/workspaces/model/lib/keyTips.js";
import { COMMANDS, runCommandById } from "../src/workspaces/model/lib/commandRegistry.js";

// feed a string of keys; returns the final state and every command id that fired
function press(keys, from = beginKeyTips()) {
  let state = from; const ran = [];
  for (const k of keys) { const r = stepKeyTips(state, k); state = r.state; if (r.run) ran.push(r.run); }
  return { state, ran };
}

describe("the Alt sequence state machine", () => {
  it("Alt, H, O, I runs autofit-column and ends the sequence", () => {
    const { state, ran } = press(["h", "o", "i"]);
    expect(ran).toEqual(["autofit-column"]);
    expect(state.active).toBe(false);
  });
  it("Alt H O A = autofit row, Alt H O W = column width dialog, Alt H O H = row height dialog", () => {
    expect(press("HOA".split("")).ran).toEqual(["autofit-row"]);
    expect(press("HOW".split("")).ran).toEqual(["column-width"]);
    expect(press("HOH".split("")).ran).toEqual(["row-height"]);
  });
  it("letters are case-insensitive", () => expect(press(["H", "O", "I"]).ran).toEqual(["autofit-column"]));
  it("a branch advances without running anything", () => {
    const { state, ran } = press(["h", "o"]);
    expect(ran).toEqual([]);
    expect(state).toEqual({ active: true, path: "HO" });
  });
  it("Escape backs out ONE level at a time and cancels from the top", () => {
    let r = stepKeyTips({ active: true, path: "HO" }, "Escape");
    expect(r.state).toEqual({ active: true, path: "H" });
    r = stepKeyTips(r.state, "Escape");
    expect(r.state).toEqual({ active: true, path: "" });
    r = stepKeyTips(r.state, "Escape");
    expect(r.state.active).toBe(false);
  });
  it("an unknown letter cancels, and runs nothing", () => {
    const r = press(["h", "o", "q"]);
    expect(r.state.active).toBe(false);
    expect(r.ran).toEqual([]);
  });
  it("a second Alt, Enter, an arrow or a function key cancel; a bare Shift is ignored", () => {
    for (const k of ["Alt", "Enter", "ArrowDown", "F4", "Tab"]) expect(stepKeyTips({ active: true, path: "H" }, k).state.active).toBe(false);
    expect(stepKeyTips({ active: true, path: "H" }, "Shift").state).toEqual({ active: true, path: "H" });
  });
  it("an inactive machine ignores keys", () => expect(stepKeyTips(START, "h")).toEqual({ state: START, run: null }));
});

describe("the owner's Home-tab paths", () => {
  const wanted = {
    HOI: "autofit-column", HOA: "autofit-row", HOW: "column-width", HOH: "row-height",
    HBA: "border-all", HBN: "border-none", HBT: "border-thick-box", HH: "fill-color-menu", HFC: "font-color-menu",
    HAL: "align-left", HAC: "align-center", HAR: "align-right", HW: "wrap-text", HMM: "merge-cells", HMU: "unmerge-cells",
    HIR: "insert-row", HIC: "insert-column", HDR: "delete-row", HDC: "delete-column", HFP: "format-painter", HEA: "clear-all",
    HSS: "sort-asc", HSO: "sort-desc", HSF: "filter-toggle", WFF: "freeze-toggle", H0: "decimal-increase", H9: "decimal-decrease",
    HK: "thousands-toggle", HP: "percent-style",
  };
  for (const [path, id] of Object.entries(wanted)) it(`Alt ${path.split("").join(" ")} -> ${id}`, () => expect(press(path.split("")).ran).toEqual([id]));

  it("every leaf in the tree names a real registry command", () => {
    const ids = new Set(COMMANDS.map((c) => c.id));
    for (const { path, run } of allKeyTips()) expect(ids.has(run), `${path} -> ${run}`).toBe(true);
  });
  it("no two leaves share a path and no leaf is also a branch", () => {
    const paths = allKeyTips().map((t) => t.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const p of paths) expect(nodeAt(p).keys).toBeUndefined();
  });
  it("choicesAt lists the next level for the key-tip strip", () => {
    expect(choicesAt("HO").map((c) => c.key).sort()).toEqual(["A", "H", "I", "W"]);
    expect(choicesAt("").map((c) => c.key).sort()).toEqual(Object.keys(KEYTIP_TREE).sort());
    expect(choicesAt("HOI")).toEqual([]);
  });
  it("running a leaf through the registry calls the real handler once per selected column set (autofit asks for COLUMNS)", () => {
    const ctx = { onAutofit: (axis) => { ctx.last = axis; } };
    expect(runCommandById("autofit-column", ctx)).toBe(true);
    expect(ctx.last).toBe("columns");
    expect(runCommandById("autofit-row", ctx)).toBe(true);
    expect(ctx.last).toBe("rows");
  });
});
