import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { withGradingTab, panelIdAllowed, GRADING_TAB } from "../src/workspaces/site-planner/lib/gradingDock.js";
import { gradingPanelView, EMPTY_LINE } from "../src/workspaces/site-planner/lib/gradingPanelModel.js";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const TABS = [{ id: "parcel", label: "Land" }, { id: "analysis", label: "Analysis" }, { id: "drainage", label: "Drainage" }, { id: "yield", label: "Yield" }, { id: "properties", label: "Properties" }];
const ids = (t) => t.map((x) => x.id);

describe("the Grading dock item (NEW-1, amends B2315856)", () => {
  it("is absent for everyone the gate refuses — the very same array comes back", () => {
    expect(withGradingTab(TABS, false)).toBe(TABS);
    expect(withGradingTab(TABS, undefined)).toBe(TABS);
    expect(ids(withGradingTab(TABS, false))).not.toContain("grading");
  });
  it("sits between Drainage and Yield when the gate says yes, and never mutates the input", () => {
    const out = withGradingTab(TABS, true);
    expect(ids(out)).toEqual(["parcel", "analysis", "drainage", "grading", "yield", "properties"]);
    expect(ids(TABS)).not.toContain("grading");
    expect(out.find((t) => t.id === "grading").label).toBe("Grading");
    expect(GRADING_TAB.label).toBe("Grading");
  });
  it("is added once, not twice", () => {
    const once = withGradingTab(TABS, true);
    expect(withGradingTab(once, true)).toBe(once);
  });
  it("only the grading panel id is refused by the gate", () => {
    expect(panelIdAllowed("grading", false)).toBe(false);
    expect(panelIdAllowed("grading", true)).toBe(true);
    for (const id of ["parcel", "analysis", "drainage", "yield"]) expect(panelIdAllowed(id, false)).toBe(true);
  });
  it("the planner wires it through the gate's answer, a header title and its own icon", () => {
    const sp = read("../src/workspaces/site-planner/SitePlanner.jsx");
    expect(sp).toMatch(/grading: "Grading"/);
    expect(sp).toMatch(/\n  grading: <>/);
    expect(sp).toMatch(/panelIdAllowed\("grading", gradingOn\)/);
  });
});

describe("the Grading panel's view model", () => {
  const card = (id) => ({ id, name: id });
  it("no model yet => loading, never blank", () => {
    expect(gradingPanelView(null).state).toBe("loading");
    expect(gradingPanelView(undefined).line).toMatch(/Reading the ground/);
  });
  it("a model with no building => the one empty line", () => {
    const v = gradingPanelView({ cards: [] });
    expect(v).toMatchObject({ state: "empty", line: EMPTY_LINE });
    expect(EMPTY_LINE).toBe("Place a building to grade it.");
    expect(gradingPanelView({}).state).toBe("empty");
  });
  it("buildings => the cards in the controller's order, and the property-line setback note flag", () => {
    const v = gradingPanelView({ cards: [card("b2"), card("b1")], setback: { usingPropertyLine: true } });
    expect(v.state).toBe("cards");
    expect(v.cards.map((c) => c.id)).toEqual(["b2", "b1"]);
    expect(v.noSetback).toBe(true);
  });
  it("reads only — it does not call into the model", () => {
    const model = new Proxy({ cards: [] }, { get: (t, k) => { if (k !== "cards" && k !== "setback") throw new Error("touched " + String(k)); return t[k]; } });
    expect(() => gradingPanelView(model)).not.toThrow();
  });
});
