import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  PARCEL_SURFACES, PARCEL_GROUPS, PARCEL_ACTIONS, parcelMenuModel, boundaryEditHint,
} from "../src/workspaces/site-planner/lib/parcelActions.js";

/* The module ships no id lookup and no flattener — both were test-only, and string data with no
 * runtime consumer costs real bytes in the Site route's bundle (this change had to pay a budget
 * breach back). They live here instead, where they belong. */
const parcelAction = (id) => PARCEL_ACTIONS.find((a) => a.id === id) || null;
const parcelMenuIds = (state) => parcelMenuModel(state).flatMap((g) => g.rows.map((r) => r.id));

/* WHICH ACTIONS ARE GESTURE- OR RIGHT-CLICK-ONLY without this menu. The owner's rule is that a
 * gesture stays as the FAST path but may never be the ONLY path, so this list is the requirement
 * stated independently of the code — which is stronger than reading it back out of the module. */
const GESTURE_OR_RIGHT_CLICK_ONLY = ["boundary", "chip", "chipReset", "deleteSelected"];

/* NEW-1 — "every parcel action belongs in the right-hand Parcel menu."
 *
 * The owner opened the planner and found the right rail's Parcel flyout carried THREE of the parcel
 * actions the app has (Draw / Deed / Split). Remove had no rail entry at all, Combine had none,
 * setbacks lived in the LEFT rail, and boundary editing existed only as prose inside the Select
 * tool's hint string. This suite is what stops that drifting back: the inventory is the contract,
 * the menu model must render every entry in it, and the render site must wire a handler for each.
 *
 * Two halves, deliberately:
 *   • PROPERTY  — parcelMenuModel's decisions (ordering, gating, active state, contextual rows)
 *   • WIRING    — a source guard on SitePlanner.jsx, because a perfect model reached by nothing is
 *                 exactly the failure mode this item is about.
 */
const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const src = read("../src/workspaces/site-planner/SitePlanner.jsx");
const menuSrc = read("../src/workspaces/site-planner/components/RailMenus.jsx"); // NEW-1: the menu's render half

/* A plan with plenty of everything, so nothing is gated off by accident. */
const rich = {
  parcelCount: 3, activeCount: 3, hasOrigin: true,
  selected: { locked: false, active: true, chipHidden: false, labelOffset: { x: 20, y: 5 }, name: "Parcel 1", acres: 12.345, color: "#2563eb" },
  tool: "select", parcelMode: "add", mergePick: false, boundaryEdit: false,
};

describe("the inventory is the contract", () => {
  it("every action carries an id, a group that exists, and a label", () => {
    const groupIds = PARCEL_GROUPS.map((g) => g.id);
    for (const a of PARCEL_ACTIONS) {
      expect(a.id, JSON.stringify(a)).toBeTruthy();
      expect(groupIds, `${a.id} names an unknown group`).toContain(a.group);
      expect(typeof a.label, `${a.id}'s label`).toBe("string");
      // a toggling row needs BOTH halves or it can say the wrong thing
      expect(!!a.altLabel, `${a.id} altLabel/altWhen must come as a pair`).toBe(typeof a.altWhen === "function");
    }
  });

  it("ids are unique", () => {
    const ids = PARCEL_ACTIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("carries the actions the report named as MISSING from the rail", () => {
    // The report, verbatim: Remove, Combine/Merge, setbacks, boundary editing. "Remove parcels —
    // click to delete" was dropped from the menu by the owner (2026-10-11): Delete parcel on a
    // selected parcel is the menu's way to remove one, and the Parcel tool's own banner keeps the
    // click-to-delete mode.
    for (const id of ["deleteSelected", "combine", "setbacks", "boundary"]) {
      expect(parcelAction(id), `${id} is not in the inventory`).toBeTruthy();
    }
  });

  it("keeps the three that were already there", () => {
    for (const id of ["draw", "deed", "split"]) expect(parcelAction(id)).toBeTruthy();
  });

  it("every action reachable ONLY by a gesture or a right-click now has a menu row", () => {
    const ids = parcelMenuIds(rich);
    for (const id of GESTURE_OR_RIGHT_CLICK_ONLY) {
      expect(parcelAction(id), `${id} is not in the inventory`).toBeTruthy();
      expect(ids, `${id} has no menu row`).toContain(id);
    }
  });

  it("renders EVERY inventory entry on a plan where nothing is gated off", () => {
    expect(parcelMenuIds(rich).sort()).toEqual(PARCEL_ACTIONS.map((a) => a.id).sort());
  });
});

describe("the menu reads in the order the work happens", () => {
  it("groups come out add land → edit → this parcel → delete", () => {
    expect(parcelMenuModel(rich).map((g) => g.id)).toEqual(["create", "modify", "this", "remove"]);
    expect(parcelMenuModel(rich).map((g) => g.label)).toEqual(["Add land", "Edit", "This parcel", ""]);
  });

  it("Add land is Draw · Pick county lots · From a deed · Find by address, in that order, with the owner's hints", () => {
    const g = parcelMenuModel(rich).find((x) => x.id === "create");
    expect(g.rows.map((r) => [r.id, r.label, r.hint])).toEqual([
      ["draw", "Draw a parcel", "Click its corners on the map"],
      ["identify", "Pick county lots", "Click lots to add them"],
      ["deed", "From a deed", "Type the metes and bounds calls"],
      ["address", "Find by address", null],
    ]);
  });

  it("Edit holds exactly Split, Combine, Edit corners; Delete parcel stands alone, last, with no heading", () => {
    const g = Object.fromEntries(parcelMenuModel(rich).map((x) => [x.id, x]));
    expect(g.modify.rows.map((r) => r.label)).toEqual(["Split", "Combine", "Edit corners"]);
    expect(g.remove.rows.map((r) => r.id)).toEqual(["deleteSelected"]);
    expect(g.remove.label).toBe("");
    expect(g.remove.rows[0].label).toBe("Delete parcel");
    expect(g.remove.rows[0].detail).toBe("Del");
    expect(PARCEL_ACTIONS.find((a) => a.id === "removeMode")).toBeUndefined(); // owner decision 2026-10-11
  });

  it("every row has an icon (16px stroke set) except the switches/Land link, which the header+switch carry", () => {
    for (const r of parcelMenuModel(rich).flatMap((g) => g.rows).filter((x) => x.kind !== "switch" && x.id !== "setbacks" && x.id !== "chipReset")) {
      expect(r.icon, `${r.id} has no icon`).toBeTruthy();
    }
  });

  it("drops an empty group rather than rendering a bare header", () => {
    const groups = parcelMenuModel({ ...rich, selected: null, parcelCount: 0, activeCount: 0 });
    for (const g of groups) expect(g.rows.length).toBeGreaterThan(0);
  });
});

describe("gating: a row a plan can't use is VISIBLE and disabled, with the reason", () => {
  const rowIn = (state, id) => parcelMenuModel(state).flatMap((g) => g.rows).find((r) => r.id === id);

  it("an empty plan still SHOWS Split / Combine / boundary / Remove — disabled, never hidden", () => {
    const empty = { ...rich, parcelCount: 0, activeCount: 0, selected: null };
    for (const id of ["split", "combine", "boundary", "deleteSelected"]) {
      const r = rowIn(empty, id);
      expect(r, `${id} vanished on an empty plan`).toBeTruthy();
      expect(r.enabled).toBe(false);
      expect(r.disabledReason, `${id} is disabled with no reason`).toBeTruthy();
    }
  });

  it("Combine needs two parcels — active or not (NEW-1, B1239328)", () => {
    // Gated on parcelCount, not activeCount: startMergePick itself has no active-count
    // requirement, and gating entry on active count would make the B966626 refusal flow
    // (pick an INACTIVE parcel while merge-picking → a named "reactivate it first" warning)
    // unreachable the moment fewer than two parcels are active — exactly the owner's Bain report.
    expect(rowIn({ ...rich, parcelCount: 1, activeCount: 1 }, "combine").enabled).toBe(false);
    expect(rowIn({ ...rich, parcelCount: 2, activeCount: 1 }, "combine").enabled).toBe(true);
    expect(rowIn({ ...rich, parcelCount: 2, activeCount: 0 }, "combine").enabled).toBe(true);
  });

  it("county identify and address lookup need a georeferenced plan", () => {
    const off = { ...rich, hasOrigin: false };
    expect(rowIn(off, "identify").enabled).toBe(false);
    expect(rowIn(off, "address").enabled).toBe(false);
    expect(rowIn(off, "identify").disabledReason).toMatch(/map/i);
    expect(rowIn(rich, "identify").enabled).toBe(true);
  });

  it("Draw and Deed are ALWAYS available — an empty, un-georeferenced plan can still start one", () => {
    const bare = { parcelCount: 0, activeCount: 0, hasOrigin: false, selected: null };
    expect(rowIn(bare, "draw").enabled).toBe(true);
    expect(rowIn(bare, "deed").enabled).toBe(true);
  });

  it("THIS PARCEL is absent with nothing selected; Delete parcel stays, disabled with its reason", () => {
    const none = { ...rich, selected: null };
    const groups = parcelMenuModel(none);
    expect(groups.map((g) => g.id)).not.toContain("this");
    for (const id of ["lock", "active", "chip", "chipReset", "setbacks"]) expect(rowIn(none, id), `${id} should be absent`).toBeUndefined();
    const del = rowIn(none, "deleteSelected");
    expect(del, "Delete parcel vanished").toBeTruthy();
    expect(del.enabled).toBe(false);
    expect(del.disabledReason).toMatch(/select a parcel/i);
  });

  it("a plan's only lot still lets Delete reach it unselected (canDelete), without opening THIS PARCEL", () => {
    const one = { ...rich, selected: null, parcelCount: 1, canDelete: true };
    expect(rowIn(one, "deleteSelected").enabled).toBe(true);
    expect(parcelMenuModel(one).map((g) => g.id)).not.toContain("this");
  });

  it("THIS PARCEL carries the selected parcel's colour swatch, name and acreage", () => {
    const g = parcelMenuModel(rich).find((x) => x.id === "this");
    expect(g.header).toEqual({ name: "Parcel 1", acres: 12.345, color: "#2563eb" });
    expect(g.rows.map((r) => r.id)).toEqual(["lock", "active", "chip", "chipReset", "setbacks"]);
    expect(g.rows.find((r) => r.id === "setbacks").detail).toBe("Land ›");
  });

  it("Reset label position is the ONE row that hides — it means nothing until the label was dragged", () => {
    expect(rowIn({ ...rich, selected: { ...rich.selected, labelOffset: null } }, "chipReset")).toBeUndefined();
    expect(rowIn(rich, "chipReset")).toBeTruthy();
  });

  it("the delete row reads as dangerous", () => {
    expect(rowIn(rich, "deleteSelected").danger).toBe(true);
    expect(rowIn(rich, "deleteSelected").label).toBe("Delete parcel");
    expect(rowIn(rich, "draw").danger).toBe(false);
  });
});

describe("a row reads as the mode you are IN", () => {
  const active = (state) => parcelMenuModel(state).flatMap((g) => g.rows).filter((r) => r.active).map((r) => r.id);

  it("Draw mode lights Draw, not Remove", () => {
    expect(active({ ...rich, tool: "parcel", parcelMode: "add" })).toEqual(["draw"]);
  });
  it("the Parcel tool's click-to-delete sub-mode lights nothing — it has no menu row any more", () => {
    expect(active({ ...rich, tool: "parcel", parcelMode: "remove" })).toEqual([]);
  });
  it("the cut tool lights Split; merge pick lights Combine; boundary edit lights Edit boundary", () => {
    expect(active({ ...rich, tool: "split" })).toEqual(["split"]);
    expect(active({ ...rich, mergePick: true })).toEqual(["combine"]);
    expect(active({ ...rich, boundaryEdit: true })).toEqual(["boundary"]);
  });
  it("plain Select lights nothing", () => {
    expect(active(rich)).toEqual([]);
  });
});

describe("the three SWITCHES carry one fixed label and their state in the switch", () => {
  const row = (state, id) => parcelMenuModel(state).flatMap((g) => g.rows).find((r) => r.id === id);
  const withSel = (patch) => ({ ...rich, selected: { ...rich.selected, ...patch } });

  it("Lock boundary: ON = locked", () => {
    expect(row(withSel({ locked: false }), "lock")).toMatchObject({ label: "Lock boundary", kind: "switch", checked: false });
    expect(row(withSel({ locked: true }), "lock")).toMatchObject({ label: "Lock boundary", checked: true });
  });
  it("Count in yield totals: ON = included — today's 'Exclude from yield totals' INVERTED, same stored flag", () => {
    expect(row(withSel({ active: true }), "active")).toMatchObject({ label: "Count in yield totals", kind: "switch", checked: true });
    expect(row(withSel({ active: undefined }), "active").checked).toBe(true); // missing = active
    expect(row(withSel({ active: false }), "active").checked).toBe(false);
  });
  it("Show acreage label: ON = visible — the inverse of chipHidden", () => {
    expect(row(withSel({ chipHidden: false }), "chip")).toMatchObject({ label: "Show acreage label", kind: "switch", checked: true });
    expect(row(withSel({ chipHidden: true }), "chip").checked).toBe(false);
  });
  it("toggling a switch leaves the menu OPEN (its handler never calls setToolMenu(false))", () => {
    const run = (src.match(/const run = \{[\s\S]*?\n\s*\};/) || [""])[0];
    for (const id of ["lock", "active", "chip"]) {
      const line = (run.match(new RegExp(`\\b${id}:[^\\n]*`)) || [""])[0];
      expect(line, `${id} handler missing`).toBeTruthy();
      expect(line, `${id} must not close the menu`).not.toMatch(/setToolMenu\(false\)/);
    }
  });
});

describe("the two-sided 'Parcel' collision is resolved", () => {
  it("the rail and the panel have DIFFERENT names, and neither is bare 'Parcel'", () => {
    const rail = PARCEL_SURFACES.rail.name, panel = PARCEL_SURFACES.panel.name;
    expect(rail).not.toBe(panel);
    expect(rail).not.toBe("Parcel");
    expect(panel).not.toBe("Parcel");
    // and not merely a plural/suffix of each other — "at a glance" was the owner's bar
    expect(panel.toLowerCase()).not.toContain("parcel");
  });

  it("the right rail owns ACTIONS and the left panel owns ATTRIBUTES", () => {
    expect(PARCEL_SURFACES.rail.owns).toBe("actions");
    expect(PARCEL_SURFACES.panel.owns).toBe("attributes");
  });

  it("the panel name doesn't collide with another left tab", () => {
    // The element inspector is "Properties" — "Property" would have swapped one collision for another.
    const tabs = (src.match(/const leftTabs = (?:withGradingTab\()?\[[\s\S]*?\],? ?(?:gradingOn\))?;/) || [""])[0];
    const labels = [...tabs.matchAll(/label:\s*"([^"]+)"/g)].map((m) => m[1]);
    for (const l of labels) expect(l).not.toBe(PARCEL_SURFACES.panel.name);
    expect(tabs).toMatch(/PARCEL_SURFACES\.panel\.name/); // the Land tab reads its name from the model
  });

  it("each side carries a one-click path to the other", () => {
    // Parcels rework (NEW-1): the "Draw, split, combine… Parcel tools →" line is gone; the panel carries its own Add / Edit buttons.
    expect(src).not.toMatch(/data-testid="land-to-parcel-tools"/);
    expect(src).toMatch(/data-testid="land-add-btn"/);                // panel → add flows
    // rail → panel: the "This parcel" row opens THAT parcel's page in the Land panel (NEW-1, 2026-10-14 —
    // it used to open the LIST, which is half of why the owner could not find setbacks); the bare panel
    // is still the fallback when nothing is selected.
    expect(src).toMatch(/setbacks:\s*\(\)\s*=>\s*\{\s*if \(selPc\) openParcelPage\(selPc\.id\);\s*else openLandPanel\(\);\s*\}/);
  });
});

describe("wiring: the render site reaches every row (a model nothing calls is worse than no model)", () => {
  const menu = (src.match(/const run = \{[\s\S]*?\n\s*\};/) || [""])[0];

  it("SitePlanner builds the flyout from parcelMenuModel — not from a hand-written list", () => {
    expect(src).toMatch(/parcelMenuModel\(\{/);
    expect(menuSrc).toMatch(/"data-parcel-action": r\.id/);
    expect(src).toMatch(/<ParcelToolsMenu groups=\{groups\}/);
  });

  it("every inventory id has a handler in the render site's `run` map", () => {
    expect(menu).toBeTruthy();
    for (const a of PARCEL_ACTIONS) {
      expect(menu, `no handler wired for "${a.id}"`).toMatch(new RegExp(`\\b${a.id}:\\s`));
    }
  });

  it("the handlers arm the EXISTING paths rather than reimplementing them", () => {
    expect(menu).toMatch(/combine:[^\n]*startMergePick\(\)/);
    // Click-to-delete mode is no longer a menu row, but it must stay reachable from the Parcel tool's banner.
    expect(src).toMatch(/onClick=\{\(\) => \{ setDraftPoly\(null\); setParcelMode\("remove"\); \}\}/);
    expect(src).toMatch(/const startRemoveParcels = /);
    expect(menu).toMatch(/deleteSelected:[^\n]*removeParcelById/);
    expect(menu).toMatch(/boundary:[^\n]*startBoundaryEdit\(\)/);
    expect(menu).toMatch(/chip:[^\n]*setParcelChipHidden/);
    expect(menu).toMatch(/lock:[^\n]*toggleParcelLock/);
    expect(menu).toMatch(/active:[^\n]*toggleParcelActive/);
  });

  it("Remove mode sets the sub-mode AFTER the tool switch (selectTool resets it to 'add' — B598)", () => {
    const fn = (src.match(/const startRemoveParcels = [^\n]*\n?/) || [""])[0];
    expect(fn.indexOf("selectTool(\"parcel\")")).toBeGreaterThan(-1);
    expect(fn.indexOf("selectTool(\"parcel\")")).toBeLessThan(fn.indexOf("setParcelMode(\"remove\")"));
  });

  it("a disabled row has no click handler at all (it explains itself instead)", () => {
    expect(menuSrc).toMatch(/onClick=\{r\.enabled \? run\[r\.id\] : undefined\}/);
    expect(menuSrc).toMatch(/title: r\.enabled \? undefined : r\.disabledReason/);
  });

  it("the Deed row keeps the testid two ui-audit harnesses click it by", () => {
    expect(menuSrc).toMatch(/r\.id === "deed" \? "boundary-menu-mb"/);
  });
});

describe("boundary editing gets a visible home", () => {
  it("the hint teaches all three gestures once a parcel is in hand", () => {
    const h = boundaryEditHint({ hasSelection: true });
    expect(h).toMatch(/drag a corner/i);
    expect(h).toMatch(/add a corner/i);
    expect(h).toMatch(/shift-click/i);
  });

  it("and asks for a parcel first when there is none", () => {
    expect(boundaryEditHint({})).toMatch(/click a parcel/i);
  });

  it("a LOCKED parcel says so instead of teaching gestures that would silently do nothing", () => {
    // A freshly drawn parcel arrives locked and `editablePath()` refuses a locked parcel, so
    // without this branch the mode armed and every gesture it taught was swallowed.
    const h = boundaryEditHint({ hasSelection: true, locked: true });
    expect(h).toMatch(/locked/i);
    expect(h).toMatch(/unlock/i);
    expect(h).not.toMatch(/drag a corner/i);
  });

  it("the banner renders from that ONE sentence, offers Unlock when locked, and exits on Done", () => {
    expect(src).toMatch(/data-testid="boundary-edit-banner"/);
    expect(src).toMatch(/boundaryEditHint\(\{ hasSelection: !!bp, locked: !!\(bp && bp\.locked\) \}\)/);
    expect(src).toMatch(/data-testid="boundary-edit-unlock"/);
    expect(src).toMatch(/onClick=\{exitBoundaryEdit\}/);
  });

  it("it is a MODE over the existing Select gestures, not a new tool", () => {
    // A new tool id would need its own hit-testing, drafting and Esc handling. It has none of
    // that on purpose: the reshape gestures already work in Select with a parcel selected.
    expect(src).not.toMatch(/selectTool\("boundary"\)/);
    expect(src).toMatch(/boundaryEdit && tool === "select"/);
  });

  it("Esc and any tool switch leave it (no mode you can get stuck in)", () => {
    expect(src).toMatch(/if \(id !== "select"\) setBoundaryEdit\(false\)/); // selectTool
    const esc = (src.match(/if \(e\.key === "Escape"\)[\s\S]{0,3000}?\n/) || [""])[0];
    expect(esc).toMatch(/setBoundaryEdit\(false\)/);
  });

  it("only one top-center banner is ever armed at a time", () => {
    const bEdit = (src.match(/const startBoundaryEdit = \(\) => \{[\s\S]*?\n  \};/) || [""])[0];
    expect(bEdit).toMatch(/setMergePick\(false\)/);
    const mPick = (src.match(/const startMergePick = \(\) => \{[\s\S]*?\n  \};/) || [""])[0];
    expect(mPick).toMatch(/setBoundaryEdit\(false\)/);
  });
});
