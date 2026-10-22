import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  planParcelDelete, deleteToastText, PARCEL_DELETE_ENTRIES, STALE_MESSAGE, NOTHING_MESSAGE,
} from "../src/workspaces/site-planner/lib/parcelDelete.js";
import { parcelMenuItems, isRenameable, combinedLotCount } from "../src/workspaces/site-planner/lib/parcelMenu.js";
import { DELETE_ENTRIES } from "../src/workspaces/site-planner/lib/deletePlan.js";
import { buildParcelRows } from "../src/workspaces/site-planner/lib/parcelOps.js";

/* NEW-1 (2026-10-22) — parcel delete: ONE path, ONE menu, Undo everywhere.
 *
 * Two halves, deliberately (the same shape as parcelActions.test.js): the PURE decision (planParcelDelete / parcelMenuItems — one id,
 * many ids, a stale id, a locked parcel) and a SOURCE GUARD on the wiring, because a perfect plan reached by only some of the doors
 * is exactly the bug — three of five doors used to delete silently with no Undo. */
const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const strip = (t) => t.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
const src = strip(read("../src/workspaces/site-planner/SitePlanner.jsx"));
const panel = strip(read("../src/workspaces/site-planner/components/ParcelsPanel.jsx"));
const menuUi = strip(read("../src/workspaces/site-planner/components/ParcelContextMenu.jsx"));

const sq = (id, extra = {}) => ({ id, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], ...extra });
const PARCELS = [sq("a"), sq("b", { locked: true }), sq("c", { active: false, setbacks: [10, 10, 10, 10] })];
const nameOf = (id) => ({ a: "Parcel 1", b: "Tract A", c: "Parcel 3" }[id]);

describe("planParcelDelete — one id, many ids, a stale id", () => {
  it("one id: a real parcel is planned, named, and the toast says its name", () => {
    const p = planParcelDelete(PARCELS, "a", { nameOf });
    expect(p).toMatchObject({ ok: true, ids: ["a"], names: ["Parcel 1"], toast: "Deleted Parcel 1", stale: [] });
  });
  it("many ids: ONE plan carries every id (so one history step, one tombstone set) and the toast counts them", () => {
    const p = planParcelDelete(PARCELS, ["a", "c", "b"], { nameOf });
    expect(p.ok).toBe(true);
    expect(p.ids).toEqual(["a", "c", "b"]);
    expect(p.toast).toBe("Deleted 3 parcels");
  });
  it("duplicates and falsy ids are ignored, not double-counted", () => {
    const p = planParcelDelete(PARCELS, ["a", "a", null, "", undefined], { nameOf });
    expect(p.ids).toEqual(["a"]);
    expect(p.toast).toBe("Deleted Parcel 1");
  });
  it("a stale id among real ones is REPORTED (stale) and the real ones still go", () => {
    const p = planParcelDelete(PARCELS, ["a", "gone"], { nameOf });
    expect(p.ok).toBe(true);
    expect(p.ids).toEqual(["a"]);
    expect(p.stale).toEqual(["gone"]);
  });
  it("only stale ids → a LOUD refusal with a message to show, never a silent no-op", () => {
    const p = planParcelDelete(PARCELS, ["gone", "also-gone"], { nameOf });
    expect(p).toMatchObject({ ok: false, code: "stale", message: STALE_MESSAGE, stale: ["gone", "also-gone"] });
    expect(p.message).toMatch(/already gone/);
  });
  it("no ids at all → a LOUD refusal too", () => {
    for (const none of [[], null, undefined, "", [null]]) {
      expect(planParcelDelete(PARCELS, none, { nameOf })).toMatchObject({ ok: false, code: "none", message: NOTHING_MESSAGE });
    }
  });
  it("a LOCKED parcel deletes exactly like any other — lock never refuses it (it only rides in lockedCount for telemetry)", () => {
    const p = planParcelDelete(PARCELS, ["b"], { nameOf });
    expect(p.ok).toBe(true);
    expect(p.ids).toEqual(["b"]);
    expect(p.lockedCount).toBe(1);
  });
  it("the last parcel on a plan can be deleted (an empty plan is a valid result)", () => {
    expect(planParcelDelete([sq("only")], "only").ok).toBe(true);
  });
  it("the default name is 'Parcel' when none is supplied", () => {
    expect(planParcelDelete(PARCELS, "a").toast).toBe("Deleted Parcel");
    expect(deleteToastText(["x"])).toBe("Deleted x");
    expect(deleteToastText(["x", "y"])).toBe("Deleted 2 parcels");
  });
});

describe("the doors are registered for telemetry", () => {
  it("every parcel-delete entry is a registered DELETE_ENTRY (deletePlan.test greps the source for entry: strings)", () => {
    for (const e of PARCEL_DELETE_ENTRIES) expect(DELETE_ENTRIES, e).toContain(e);
  });
});

describe("ONE delete function — no second implementation can grow back", () => {
  it("removeParcelById / deleteParcelById / startRemoveParcels no longer exist", () => {
    expect(src).not.toMatch(/removeParcelById|deleteParcelById|startRemoveParcels/);
  });
  it("deleteParcels is the only thing that filters parcels out for a delete, via planParcelDelete", () => {
    expect(src.match(/const deleteParcels = /g)).toHaveLength(1);
    expect(src).toMatch(/planParcelDelete\(/);
    const body = src.slice(src.indexOf("const deleteParcels = "));
    const fn = body.slice(0, body.indexOf("\n  };"));
    expect(fn).toMatch(/pushHistory\("delete"\)/);                       // ONE history step for however many
    expect(fn).toMatch(/tombstone\(plan\.ids\)/);                        // TOMBSTONE-DELETES, all of them
    expect(fn).toMatch(/pushToast\(\{ text: plan\.toast, action: \{ label: "Undo"/); // toast + Undo on EVERY route
    expect(fn).toMatch(/reportClientEvent\("delete-outcome"/);           // the event stays on every route
    expect(fn).toMatch(/flashWarn\(plan\.message/);                      // stale / empty → loud
    expect(fn).toMatch(/setParcelPageId\(null\)/);                       // the Properties page of a deleted parcel closes
    expect(fn).not.toMatch(/\.locked\b/);                                  // lock never gates a delete
  });
  const door = (re, why) => it(`door: ${why}`, () => expect(src + panel).toMatch(re));
  door(/onDelete: \(id, entry\) => \{ deleteParcels\(\[id\], entry \|\| "panel:parcel"\)/, "the parcel page, the row ⋯ and the row's Delete key (handlers.onDelete)");
  door(/onDeleteMany: \(ids, entry\) => \{ deleteParcels\(ids, entry \|\| "bar:parcel"\)/, "the checked bar (handlers.onDeleteMany)");
  door(/deleteSelected: \(\) => \{ if \(pcm\) deleteParcels\(\[pcm\.id\], "rail:parcel"\)/, "the rail's Parcel tools → Delete parcel");
  door(/else if \(what === "delete"\) deleteParcels\(\[id\], "menu:parcel"\)/, "the map right-click menu");
  door(/return deleteParcels\(pcIds, entry === "unknown" \? "menu:parcel" : entry\)/, "the Delete key (deleteSel hands a parcels-only selection over)");
  door(/handlers\.onDelete\(row\.id, "row:key"\)/, "Delete on a focused panel row");
  door(/handlers\.onDelete\(pid, "row:menu"\)/, "the panel row's ⋯ menu / right-click");
  door(/handlers\.onDeleteMany\(checkedIds, "bar:parcel"\)/, "the bar's Delete button hands over the checked ids");
});

describe("no 'are you sure' step", () => {
  it("the row menu has no arm-then-confirm: no 'Delete…', no 'Delete <name>?', no armed state", () => {
    expect(panel).not.toMatch(/Delete…|armed|parcel-row-delete-confirm|parcel-row-delete-yes|setMenu\("confirm"\)/);
    expect(menuUi).not.toMatch(/confirm|Are you sure/i);
  });
  it("Undo is the net: the toast text 'Delete parcel' is a single click away from gone, with an Undo action", () => {
    expect(src).toMatch(/action: \{ label: "Undo", onClick: undo \}/);
  });
});

describe("Remove (click-to-delete) mode is retired", () => {
  it("no Remove pill, no parcelMode state, no remove cursor mode", () => {
    expect(src).not.toMatch(/✕ Remove/);
    expect(src).not.toMatch(/setParcelMode|parcelMode ===|parcelRemoveHoverId/);
    expect(src).not.toMatch(/Click a parcel to delete it/);
    expect(src).not.toMatch(/\?\s*"remove"\s*$/m);
  });
});

describe("right-clicking a parcel on the map only selects it and opens the menu", () => {
  it("onParcelContext no longer adds the parcel to the merge set (combineSel)", () => {
    const at = src.indexOf("const onParcelContext = ");
    const fn = src.slice(at, src.indexOf("\n  };", at));
    expect(fn).toMatch(/setSel\(\{ kind: "parcel", id \}\)/);
    expect(fn).toMatch(/setParcelMenu\(/);
    expect(fn).not.toMatch(/combineSel|setCombineSel/);
  });
});

describe("ONE menu — the same items in the same order on all three surfaces", () => {
  const plain = sq("p");
  const ids = (pc, o) => parcelMenuItems(pc, o).map((i) => i.id);

  it("plain parcel: Properties · Zoom to · Lock · Hide label · rule · Delete", () => {
    expect(ids(plain)).toEqual(["properties", "zoom", "lock", "chip", "divider", "delete"]);
  });
  it("a renameable row (combined tract / split piece) gets Rename directly above Zoom to", () => {
    expect(ids(plain, { renameable: true })).toEqual(["properties", "rename", "zoom", "lock", "chip", "divider", "delete"]);
  });
  it("Lock reads Unlock on a locked parcel; the label row reads Show/Hide from chipHidden", () => {
    const m = parcelMenuItems(sq("p", { locked: true, chipHidden: true }));
    expect(m.find((i) => i.id === "lock").label).toBe("Unlock");
    expect(m.find((i) => i.id === "chip").label).toBe("Show acreage label");
    expect(parcelMenuItems(plain).find((i) => i.id === "chip").label).toBe("Hide acreage label");
  });
  it("Reset label position appears only once the label was dragged (and only while the label is shown)", () => {
    expect(ids(sq("p", { labelOffset: { x: 4, y: 2 } }))).toContain("chipReset");
    expect(ids(plain)).not.toContain("chipReset");
    expect(ids(sq("p", { labelOffset: { x: 4, y: 2 }, chipHidden: true }))).not.toContain("chipReset");
  });
  it("Un-combine exists only on a combined tract, says how many lots come back, and sits between the rule and Delete", () => {
    const tract = sq("t", { combined: { from: [{ id: "x" }, { id: "y" }, { id: "z" }] } });
    const m = parcelMenuItems(tract);
    expect(m.map((i) => i.id)).toEqual(["properties", "zoom", "lock", "chip", "divider", "uncombine", "delete"]);
    expect(m.find((i) => i.id === "uncombine").sub).toBe("Brings back the 3 lots");
    expect(combinedLotCount(plain)).toBe(0);
    expect(ids(plain)).not.toContain("uncombine");
  });
  it("Delete is last, red, carries the 'Del' hint — and is NEVER hidden or changed by a locked parcel", () => {
    for (const pc of [plain, sq("l", { locked: true }), sq("t", { combined: { from: [{}, {}] }, locked: true })]) {
      const m = parcelMenuItems(pc, { renameable: true, mergeCount: 3 });
      const d = m[m.length - 1];
      expect(d).toMatchObject({ id: "delete", label: "Delete parcel", danger: true, hint: "Del" });
      expect(d.disabled).toBeUndefined();
      expect(JSON.stringify(m)).not.toMatch(/Unlock to delete/i);
    }
  });
  it("map-only extras: Merge parcels (n) / Clear selection show only with 2+ shift-picked, ABOVE the rule", () => {
    expect(ids(plain, { mergeCount: 1 })).not.toContain("merge");
    const m = ids(plain, { mergeCount: 2 });
    expect(m).toEqual(["properties", "zoom", "lock", "chip", "merge", "clearSel", "divider", "delete"]);
    expect(parcelMenuItems(plain, { mergeCount: 2 }).find((i) => i.id === "merge").label).toBe("Merge parcels (2)");
  });
  it("isRenameable matches the panel's old test: a combined tract or a split piece", () => {
    const rows = buildParcelRows([sq("plain"), sq("tract", { combined: { from: [{ id: "x", points: sq("x").points }] } })]);
    expect(isRenameable(rows.find((r) => r.id === "plain"))).toBe(false);
    expect(isRenameable(rows.find((r) => r.id === "tract"))).toBe(true);
    expect(isRenameable(null)).toBe(false);
  });

  it("all three surfaces draw it through the one component with the one model", () => {
    expect(panel).toMatch(/<ParcelContextMenu /);
    expect(src).toMatch(/<ParcelContextMenu /);
    expect(menuUi).toMatch(/parcelMenuItems\(pc/);
    // …and neither host keeps a private item list any more
    expect(panel).not.toMatch(/"Zoom to"|"Rename"|Rename</);
    expect(src).not.toMatch(/Hide acreage label|Show acreage label|Reset label position/);
  });
  it("a right-click on a panel row opens the menu, and the ⋯ is always visible (no hover-only class)", () => {
    expect(panel).toMatch(/onContextMenu=\{\(e\) => \{ if \(!e\.currentTarget\.contains\(e\.target\)\) return;/);
    expect(panel).not.toMatch(/land-row-hover/);
  });
});

describe("the checked bar", () => {
  it("shows Delete (in the danger colour) beside Combine, for 2+ checked, and clears the checks", () => {
    expect(panel).toMatch(/parcels-bar-delete/);
    expect(panel).toMatch(/var\(--danger-text\)/);
    expect(panel).toMatch(/checkedIds\.length >= 2/);
    expect(panel).toMatch(/handlers\.onDeleteMany\(checkedIds, "bar:parcel"\); setChecked\(new Set\(\)\)/);
  });
});
