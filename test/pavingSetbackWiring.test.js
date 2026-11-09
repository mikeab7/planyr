/* NEW-1 (2026-11-09) — PAVING SETBACK wiring guards: the places in the planner / panel that cannot be unit-run, asserted on the real source
 * (the same style as the other planner source guards). The behaviour itself is proven in test/pavingSetback.test.js and e2e/paving-setback.spec.js. */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { plannerSource } from "./helpers/plannerSource.js";

const src = plannerSource();
const panel = fs.readFileSync(new URL("../src/workspaces/site-planner/components/SetbackSections.jsx", import.meta.url), "utf8");
const palette = fs.readFileSync(new URL("../src/shared/theme/palette.js", import.meta.url), "utf8");

describe("paving setback wiring", () => {
  it("a corner inserted / deleted on a parcel carries the paving array with it (and only when the parcel has one)", () => {
    expect(src).toMatch(/hasPaving\(pc\) \? \{ pavingSetbacks: shiftPavingOnInsert\(pc\.pavingSetbacks, edgeIndex\) \} : \{\}/);
    expect(src).toMatch(/hasPaving\(pc\) \? \{ pavingSetbacks: shiftPavingOnDelete\(pc\.pavingSetbacks, index\) \} : \{\}/);
  });
  it("adding starts at zeros from newPaving — never from the building setback or the default", () => {
    const add = src.slice(src.indexOf("const pavingAdd = () =>"), src.indexOf("const pavingRemove = () =>"));
    expect(add).toContain("newPaving(p.points.length)");
    expect(add).not.toMatch(/settings\.setback|parcelSetbacks|\.setbacks/);
  });
  it("removing deletes the KEY (an add-then-remove parcel is byte-identical to one that never added)", () => {
    const rm = src.slice(src.indexOf("const pavingRemove = () =>"), src.indexOf("const pavingSectionValue2"));
    expect(rm).toMatch(/const \{ pavingSetbacks: _gone, \.\.\.rest \} = p; return rest;/);
    expect(rm).toContain('label: "Undo"');
  });
  it("the line is drawn only for a parcel that added paving, behind its own Show line, dotted, in its own token", () => {
    expect(src).toMatch(/settings\.showPaving !== false && !isHidden\(hiddenGroups, "parcels"\) && parcels\.filter\(\(pc\) => pc\.active !== false && hasPaving\(pc\)\)/);
    expect(src).toContain("paving: themePal.canvasPaving");
    expect(palette.match(/canvasPaving/g)).toHaveLength(2);
  });
  it("NO-PER-MOVE-WORK: the conflict scan is a trailing debounce that does nothing unless a parcel has paving", () => {
    const eff = src.slice(src.indexOf("const [pavingFlags, setPavingFlags]"), src.indexOf("const pavingFlagGeoms = useMemo"));
    expect(eff).toMatch(/const live = parcels\.some\(\(pc\) => pc\.active !== false && hasPaving\(pc\)\)/);
    expect(eff).toMatch(/setTimeout\(\(\) => \{[\s\S]*\}, 120\)/);
    expect(eff).toContain("clearTimeout(t)");
    expect(eff).toContain("elHidden(hiddenGroups, el)");
  });
  it("conflict marks are review chrome kept out of the export", () => {
    expect(src).toMatch(/data-testid="paving-conflicts" data-export="skip"/);
  });
  it("the panel: Building label, Add button, switch, both-number rows each labelled, trash", () => {
    for (const id of ["paving-add", "paving-all", "paving-show-line", "paving-remove", "setback-mode-", "setback-box-", "setback-col-heads"]) expect(panel).toContain(id);
    expect(panel).toContain("Building setback — ");
    expect(panel).toContain("Paving setback — ");
    expect(panel).toContain("Add paving setback");
  });
  it("the Reset-all and add wiring: Reset all zeroes paving (keeps it added), it never fills paving from the default", () => {
    expect(src).toMatch(/\.\.\.\(hasPaving\(p\) \? \{ pavingSetbacks: newPaving\(p\.points\.length\) \} : \{\}\)/);
  });
});
