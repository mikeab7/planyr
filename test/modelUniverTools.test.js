/* The Planyr-only Spreadsheet tools on the Univer grid (lib/univerTools/, NEW-1 cutover step 6): the pure rules, the palette routing
 * and the wiring guards. The pixels (a corner marker, an arrow, blue text) and the Univer commands (one undo step, the saved workbook)
 * are the parity harness's `tools-*` checks (ui-audit/lib/univerToolsChecks.mjs); this file pins what needs no browser. */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  activeFlagsOf, flagLookup, markerFor, dismissKey, withDismissal, colorKindOfRaw, autoColorFor, AUTO_COLORS,
  edgePoint, traceShapes, refStringFor, definedNameParams, nameIdFor, colLetters, traceFor, renderTrace,
} from "../src/workspaces/model/lib/univerTools/model.js";
import { buildPaletteRows, TOOL_COMMAND, TOOL_COMMAND_IDS, UNIVER_EXEC, PALETTE_UNAVAILABLE, isNamedGap, stepZoom, EXTRA_UNIVER_COMMANDS } from "../src/workspaces/model/lib/univerTools/palette.js";
import { COMMANDS } from "../src/workspaces/model/lib/commandRegistry.js";
import { createWorkbook, setRaw, setInconsistencyDismissed } from "../src/workspaces/model/lib/sheetModel.js";
import { evaluateWorkbook } from "../src/workspaces/model/lib/sheetEngine.js";
import { workbookToUniver, univerToWorkbook } from "../src/workspaces/model/lib/univerBridge.js";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const walk = (d) => readdirSync(join(ROOT, d)).flatMap((f) => { const p = `${d}/${f}`; return statSync(join(ROOT, p)).isDirectory() ? walk(p) : [p]; });

const colWithOdd = () => {
  let sh = createWorkbook().sheets[0].sheet;
  for (let i = 0; i < 6; i++) { sh = setRaw(sh, i, 0, String(i + 1)); sh = setRaw(sh, i, 1, i === 3 ? "99" : `=A${i + 1}*2`); }
  return sh;
};

describe("flags — the old grid's rule, the old grid's dismissal key", () => {
  it("flags the hardcoded value and nothing else, and a clean run has none", () => {
    expect(activeFlagsOf(colWithOdd()).map((f) => `${f.row}:${f.col}:${f.kind}`)).toEqual(["3:1:hardcoded"]);
    let clean = createWorkbook().sheets[0].sheet;
    for (let i = 0; i < 6; i++) { clean = setRaw(clean, i, 0, String(i + 1)); clean = setRaw(clean, i, 1, `=A${i + 1}*2`); }
    expect(activeFlagsOf(clean)).toEqual([]);
  });
  it("a dismissed flag is hidden — through the SAME key sheetModel.setInconsistencyDismissed writes", () => {
    const sh = colWithOdd();
    const old = setInconsistencyDismissed(sh, 3, 1, true);
    expect(activeFlagsOf(old)).toEqual([]);
    // the Univer-side dismissal (sidecar) produces the identical key, so the saved workbook is byte-compatible
    const { data, sidecar } = workbookToUniver({ ...createWorkbook(), sheets: [{ ...createWorkbook().sheets[0], sheet: sh }] });
    const id = Object.keys(sidecar.sheets)[0];
    const key = dismissKey(sidecar, id, 3, 1);
    expect(key).toBe(Object.keys(old.dismissedInconsistencies)[0]);
    const next = withDismissal(sidecar, id, key, true);
    expect(next).not.toBe(sidecar);
    expect(sidecar.sheets[id].dismissedInconsistencies).toEqual({});           // never mutates the input
    expect(next.sheets[id].dismissedInconsistencies).toEqual({ [key]: true });
    expect(withDismissal(next, id, key, true)).toBe(next);                      // a no-op returns the same object (no spurious save)
    expect(withDismissal(next, id, key, false).sheets[id].dismissedInconsistencies).toEqual({});
    expect(dismissKey(sidecar, id, 3, 99)).toBeNull();                          // a stale column index writes nothing
    expect(data).toBeTruthy();
  });
  it("the dismissal survives the bridge round-trip (the saved format is unchanged)", () => {
    const wb = { ...createWorkbook(), sheets: [{ ...createWorkbook().sheets[0], sheet: colWithOdd() }] };
    const { data, sidecar } = workbookToUniver(wb);
    const id = Object.keys(sidecar.sheets)[0];
    const key = dismissKey(sidecar, id, 3, 1);
    const back = univerToWorkbook(data, { sidecar: withDismissal(sidecar, id, key, true), activeSheetId: id }).workbook;
    expect(back.sheets[0].sheet.dismissedInconsistencies).toEqual({ [key]: true });
    expect(activeFlagsOf(back.sheets[0].sheet)).toEqual([]);
  });
  it("lookup + marker: a top-left corner triangle, two kinds, two colours", () => {
    const flags = activeFlagsOf(colWithOdd());
    const m = flagLookup(flags);
    expect(m.get("3:1").kind).toBe("hardcoded");
    expect(m.get("2:1")).toBeUndefined();
    expect(markerFor(flags[0])).toEqual({ tl: { color: expect.stringMatching(/^#/), size: 6 } });
    expect(markerFor({ kind: "shape-mismatch" }).tl.color).not.toBe(markerFor({ kind: "hardcoded" }).tl.color);
    expect(markerFor(null)).toBeNull();
  });
});

describe("colour convention — the old grid's classification, drawn only when nobody coloured the cell", () => {
  it("input blue, cross-sheet link green, ordinary formula untouched, empty untouched", () => {
    expect(colorKindOfRaw("1234", "Sheet1")).toBe("input");
    expect(colorKindOfRaw("hello", "Sheet1")).toBe("input");
    expect(colorKindOfRaw("=A1+1", "Sheet1")).toBe("formula");
    expect(colorKindOfRaw("=Sheet2!A1+1", "Sheet1")).toBe("cross-sheet");
    expect(colorKindOfRaw("=Sheet1!A1+1", "Sheet1")).toBe("formula");           // an explicit self-qualifier is not a link
    expect(colorKindOfRaw("", "Sheet1")).toBeNull();
    expect(colorKindOfRaw(null, "Sheet1")).toBeNull();
  });
  it("a colour the person set wins, and an error keeps the error colour", () => {
    expect(autoColorFor({ raw: "5", hasManualColor: false, isError: false, sheetName: "S" })).toBe(AUTO_COLORS.input);
    expect(autoColorFor({ raw: "5", hasManualColor: true, isError: false, sheetName: "S" })).toBeNull();
    expect(autoColorFor({ raw: "=1/0", hasManualColor: false, isError: true, sheetName: "S" })).toBeNull();
    expect(autoColorFor({ raw: "=A1", hasManualColor: false, isError: false, sheetName: "S" })).toBeNull();
    expect(autoColorFor({ raw: "=T!A1", hasManualColor: false, isError: false, sheetName: "S" })).toBe(AUTO_COLORS["cross-sheet"]);
  });
});

describe("trace — traceAudit + the engine's graph, turned into canvas shapes", () => {
  const wb = (() => {
    let sh = createWorkbook().sheets[0].sheet;
    [1, 2, 3].forEach((n, i) => { sh = setRaw(sh, i, 0, String(n)); });
    sh = setRaw(sh, 0, 2, "=SUM(A1:A3)"); sh = setRaw(sh, 1, 2, "=C1*2");
    const w = createWorkbook(); return { ...w, sheets: [{ ...w.sheets[0], sheet: sh }] };
  })();
  const graph = evaluateWorkbook(wb).graph;
  const id = wb.sheets[0].id;
  const rect = (r, c) => ({ x1: c * 100, y1: r * 20, x2: c * 100 + 100, y2: r * 20 + 20 });

  it("precedents of =SUM(A1:A3): one range arrow into C1, level by level", () => {
    const t1 = traceFor(null, "precedents", id, 0, 2, graph);
    const r1 = renderTrace(t1, graph, id);
    expect(r1.arrows).toHaveLength(1);
    expect(r1.arrows[0].fromRect).toEqual({ r1: 0, c1: 0, r2: 2, c2: 0 });
    expect(r1.arrows[0].toCell).toEqual({ row: 0, col: 2 });
    const t2 = traceFor(t1, "precedents", id, 0, 2, graph);
    expect(t2.noFurther).toBe(true);                                             // numbers have no precedents
  });
  it("dependents of A1: C1 then C2", () => {
    const t1 = traceFor(null, "dependents", id, 0, 0, graph);
    expect(renderTrace(t1, graph, id).level).toBe(1);
    const t2 = traceFor(t1, "dependents", id, 0, 0, graph);
    const r2 = renderTrace(t2, graph, id);
    expect(r2.level).toBe(2);
    expect(r2.arrows).toHaveLength(2);
  });
  it("shapes: dot at the source centre, line to the TARGET'S EDGE, an arrowhead there, a dashed box only for a range", () => {
    const r = renderTrace(traceFor(null, "precedents", id, 0, 2, graph), graph, id);
    const s = traceShapes(r, rect);
    expect(s.boxes).toEqual([{ x1: 0, y1: 0, x2: 100, y2: 60 }]);
    expect(s.dots).toEqual([{ x: 50, y: 30 }]);
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0].to.x).toBeCloseTo(200, 5);                                  // C1's left edge
    expect(s.heads[0].at).toEqual(s.lines[0].to);
    const single = renderTrace(traceFor(null, "dependents", id, 0, 0, graph), graph, id);
    expect(traceShapes(single, rect).boxes).toEqual([]);
    expect(traceShapes(null, rect)).toEqual({ lines: [], boxes: [], dots: [], heads: [], labels: [] });
  });
  it("edgePoint stops on the border, whichever way the arrow comes in", () => {
    const cell = { x1: 100, y1: 100, x2: 200, y2: 120 };
    expect(edgePoint({ x: 0, y: 110 }, cell)).toEqual({ x: 100, y: 110 });
    expect(edgePoint({ x: 150, y: 0 }, cell).y).toBeCloseTo(100, 5);
    expect(edgePoint({ x: 150, y: 110 }, cell)).toEqual({ x: 150, y: 110 });     // already inside: stays
  });
  it("an edge that leaves the sheet becomes a labelled marker, never a dropped arrow", () => {
    const other = { type: "x" };
    const rendered = { arrows: [], markers: [{ atCell: { row: 1, col: 1 }, label: "Rates!B2", direction: "in" }] };
    const s = traceShapes(rendered, rect);
    expect(s.labels).toHaveLength(1);
    expect(s.labels[0].text).toBe("← Rates!B2");
    expect(other).toBeTruthy();
  });
});

describe("names — Univer's defined-name call for a Planyr rect", () => {
  it("A1 references the way Univer reads them", () => {
    expect(colLetters(1)).toBe("A"); expect(colLetters(27)).toBe("AA");
    expect(refStringFor("Sheet1", { r1: 1, c1: 1, r2: 3, c2: 1 })).toBe("Sheet1!$A$1:$A$3");
    expect(refStringFor("Sheet1", { r1: 2, c1: 2, r2: 2, c2: 2 })).toBe("Sheet1!$B$2");
    expect(refStringFor("My Sheet", { r1: 1, c1: 1, r2: 1, c2: 2 })).toBe("'My Sheet'!$A$1:$B$1");
    expect(refStringFor("O'Neil", { r1: 1, c1: 1, r2: 1, c2: 1 })).toBe("'O''Neil'!$A$1");
  });
  it("a name is LOCAL to its sheet and uses the id the bridge gives a loaded one", () => {
    const p = definedNameParams("unit", "sheet1", "Sheet1", " Lots ", { r1: 1, c1: 1, r2: 3, c2: 1 });
    expect(p).toEqual({ unitId: "unit", id: "planyr-name:sheet1:lots", name: "Lots", formulaOrRefString: "Sheet1!$A$1:$A$3", localSheetId: "sheet1" });
    expect(nameIdFor("sheet1", "Lots")).toBe(p.id);
    // …which is exactly the id workbookToUniver mints for a stored name
    let sh = createWorkbook().sheets[0].sheet;
    sh = { ...sh, names: { lots: { name: "Lots", r1: 1, c1: 1, r2: 3, c2: 1 } } };
    const w = createWorkbook(); const { data } = workbookToUniver({ ...w, sheets: [{ ...w.sheets[0], sheet: sh }] });
    const ids = Object.keys(JSON.parse(data.resources[0].data));
    expect(ids).toEqual([nameIdFor(w.sheets[0].id, "Lots")]);
  });
});

describe("palette — every registry command is routed through ICommandService or NAMED as a gap", () => {
  // the plugin's action ids, read from its source (the one list the plugin registers `planyr.excel.<id>` from)
  const actionsSrc = read("src/workspaces/model/lib/univerExcelKeys/actions.js");
  const block = actionsSrc.slice(actionsSrc.indexOf("const A = {"), actionsSrc.indexOf("/** Run one action by id"));
  const pluginIds = new Set([...block.matchAll(/(?:^|[\s,{])(?:"([a-z0-9-]+)"|([a-z][a-z0-9]*))\s*:(?!:)/gm)].map((m) => m[1] || m[2]));
  const toolIds = new Set([...Object.values(TOOL_COMMAND), ...Object.values(TOOL_COMMAND_IDS)]);
  const has = (id) => toolIds.has(id) || (id.startsWith("planyr.excel.") && pluginIds.has(id.slice(13))) || Object.values(UNIVER_EXEC).some((u) => u.id === id) || EXTRA_UNIVER_COMMANDS.some((x) => x.exec.id === id);
  const calls = [];
  const exec = (id, params) => { calls.push([id, params]); return Promise.resolve(true); };

  it("the plugin's action list was read (vacuity guard)", () => {
    expect(pluginIds.size).toBeGreaterThan(30);
    expect(pluginIds.has("bold")).toBe(true);
  });
  it("no registry command is silently missing: routed, or named in PALETTE_UNAVAILABLE with a reason", () => {
    const { rows, unrouted } = buildPaletteRows({ commands: COMMANDS, has, exec, env: () => ({ unitId: "u", sheetId: "s", zoom: 1 }) });
    const stray = unrouted.filter((id) => !isNamedGap(id) && !EXTRA_UNIVER_COMMANDS.some((x) => x.id === id));
    expect(stray, `registry commands with no palette route and no named reason: ${stray.join(", ")}`).toEqual([]);
    for (const [id, why] of Object.entries(PALETTE_UNAVAILABLE)) expect(typeof why, id).toBe("string");
    expect(rows.length).toBeGreaterThan(50);
  });
  it("a named gap really is unrouted (the table cannot rot into a lie)", () => {
    const { rows } = buildPaletteRows({ commands: COMMANDS, has, exec, env: () => ({}) });
    const routed = new Set(rows.map((r) => r.id));
    for (const id of Object.keys(PALETTE_UNAVAILABLE)) expect(routed.has(id), `${id} is named a gap but is routed`).toBe(false);
  });
  it("Bold runs the plugin's command, a tool runs its own, zoom builds its params at RUN time", () => {
    calls.length = 0;
    let zoom = 1;
    const { rows } = buildPaletteRows({ commands: COMMANDS, has, exec, env: () => ({ unitId: "u", sheetId: "s", zoom }) });
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    by.bold.run(); by["trace-precedents"].run(); by["name-manager"].run();
    zoom = 1.5; by["zoom-in"].run();
    expect(calls[0]).toEqual(["planyr.excel.bold", undefined]);
    expect(calls[1][0]).toBe("planyr.tools.trace-precedents");
    expect(calls[2][0]).toBe("planyr.tools.toggle-name-manager");
    expect(calls[3]).toEqual(["sheet.command.set-zoom-ratio", { unitId: "u", subUnitId: "s", zoomRatio: 1.6 }]);
    // the registry's own label / group / shortcut ride along, so one palette reads the same on either grid
    expect(by.bold.label).toBe(COMMANDS.find((c) => c.id === "bold").label);
  });
  it("stepZoom keeps 10%–400%", () => {
    expect(stepZoom(1, 1)).toBe(1.1); expect(stepZoom(0.1, -1)).toBe(0.1); expect(stepZoom(4, 1)).toBe(4);
  });
});

describe("wiring guards", () => {
  it("lib/univerTools imports nothing from @univerjs (Univer arrives by injection from UniverSheet.jsx, the only importer)", () => {
    for (const f of walk("src/workspaces/model/lib/univerTools")) expect(read(f), f).not.toMatch(/(from|import)\s*\(?\s*["']@univerjs/);
    expect(read("src/workspaces/model/components/UniverTools.jsx")).not.toMatch(/(from|import)\s*\(?\s*["']@univerjs/);
    const sheet = read("src/workspaces/model/components/UniverSheet.jsx");
    expect(sheet).toMatch(/installUniverTools\(/);
    expect(sheet).toMatch(/SetDefinedNameCommand/);
  });
  it("the tools' mutating paths go through Univer commands, never a write behind Univer's back", () => {
    const src = read("src/workspaces/model/lib/univerTools/index.js").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(src).toMatch(/U\.SetDefinedNameCommand\.id/);
    expect(src).toMatch(/U\.RemoveDefinedNameCommand\.id/);
    expect(src).toMatch(/pushUndoRedo/);
    expect(src).not.toMatch(/fetch\(|XMLHttpRequest|localStorage/);               // the colour pref goes through sheetColorMode.js, the one owner of that key
  });
  it("Ctrl+K stays THE palette on the Univer grid, and the old grid's CommandPalette is the one component", () => {
    const src = read("src/workspaces/model/lib/univerTools/index.js");
    expect(src).toMatch(/toLowerCase\(\) === "k"/);
    expect(read("src/workspaces/model/components/UniverTools.jsx")).toMatch(/import CommandPalette from "\.\/CommandPalette\.jsx"/);
    expect(read("src/workspaces/model/components/CommandPalette.jsx")).toMatch(/commands = COMMANDS/);
  });
  it("the saved workbook format is untouched: sheetModel.js / SheetView.jsx never learn about the tools", () => {
    expect(read("src/workspaces/model/lib/sheetModel.js")).not.toMatch(/univerTools/);
    expect(read("src/workspaces/model/components/SheetView.jsx")).not.toMatch(/univerTools/);
  });
});
