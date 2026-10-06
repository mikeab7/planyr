/* NEW-3 (2026-10-05) — the VERDICT half of the width sweep, pinned against hand-built snapshots —
 * including the exact shapes of the owner's 2026-10-05 Schedule screenshot. The browser half is
 * `ui-audit/verify-width-sweep.mjs`. */
import { describe, it, expect } from "vitest";
import { auditSnapshot, auditMenu } from "../ui-audit/lib/widthSweep.mjs";

const box = (x, y, w, h) => ({ x, y, w, h });
const ctl = (label, b, o = {}) => ({ label, tag: "button", box: b, eff: o.eff || b, exempt: null, row: o.row ?? "2", itemId: null });
const clean = () => ({
  vw: 960, vh: 450, docScrollW: 960, docClientW: 960, docScrollH: 450, docClientH: 450, bodyScrollW: 960, bodyClientW: 960, bodyScrollH: 450, bodyClientH: 450,
  scrollX: 0, scrollY: 0, exemptions: [],
  controls: [ctl("Site", box(10, 50, 60, 30)), ctl("Settings", box(900, 50, 30, 30))],
  rows: [{ row: "1", box: box(0, 0, 960, 40) }, { row: "2", box: box(0, 40, 960, 40) }],
  toolbars: [],
});
const kinds = (s) => auditSnapshot(s).map((v) => v.kind);

describe("auditSnapshot", () => {
  it("a clean frame has no violations", () => { expect(kinds(clean())).toEqual([]); });

  it("OWNER'S SCREENSHOT #1 — a row-2 toolbar that wrapped onto a second line is caught twice over", () => {
    const s = clean();
    s.rows[1] = { row: "2", box: box(0, 40, 960, 82) };
    s.controls.push(ctl("Automation", box(700, 90, 90, 30)));
    expect(kinds(s)).toEqual(expect.arrayContaining(["row-wrapped", "row-two-lines"]));
  });
  it("OWNER'S SCREENSHOT #2 — a control cut off at the window edge is caught (clipped AND outside the viewport)", () => {
    const s = clean();
    s.controls.push(ctl("Columns menu", box(940, 200, 30, 30), { eff: box(940, 200, 20, 30) }));
    expect(kinds(s)).toEqual(expect.arrayContaining(["outside-viewport", "clipped"]));
  });
  it("a page-level scrollbar in either direction is caught", () => {
    const x = clean(); x.docScrollW = 1010; expect(kinds(x)).toContain("page-scroll-x");
    const y = clean(); y.docScrollH = 520; expect(kinds(y)).toContain("page-scroll-y");
    const b = clean(); b.bodyScrollW = 1100; expect(kinds(b)).toContain("page-scroll-x");
    const w = clean(); w.scrollY = 40; expect(kinds(w)).toContain("page-scrolled");
  });
  it("sub-pixel scroll slack is not a failure", () => {
    const s = clean(); s.docScrollW = 961; expect(kinds(s)).toEqual([]);
  });
  it("two chrome controls whose boxes intersect are caught; touching borders are not", () => {
    const hit = clean(); hit.controls.push(ctl("Help", box(890, 50, 30, 30)));
    expect(kinds(hit)).toContain("overlap");
    const touch = clean(); touch.controls.push(ctl("Neighbour", box(930, 50, 30, 30)));
    expect(kinds(touch)).not.toContain("overlap");
    const edge = clean(); edge.controls.push(ctl("Overlap by one px", box(929, 50, 30, 30)));
    expect(kinds(edge)).not.toContain("overlap");
  });
  it("a nested control is not a collision with its container", () => {
    const s = clean(); s.controls.push(ctl("wrapper", box(895, 45, 40, 40)));
    expect(kinds(s)).not.toContain("overlap");
  });
  it("an exempt scroll strip is skipped — but an exemption with no reason is itself a violation", () => {
    const s = clean(); s.controls.push({ ...ctl("tab", box(2000, 50, 60, 30)), exempt: "file tabs scroll on purpose" });
    expect(kinds(s)).toEqual([]);
    s.exemptions = [""]; expect(kinds(s)).toContain("exemption-without-reason");
  });
  it("a shared toolbar that is taller than one row is caught", () => {
    const s = clean(); s.toolbars = [{ name: "t", box: box(0, 40, 400, 80), allIds: ["a"], menuIds: [], iconIds: [], barIds: ["a"], hasMore: false }];
    expect(kinds(s)).toContain("toolbar-wrapped");
  });
  it("a GHOST item (absent from bar and menu by contract) is not 'dropped' — but a visible one still is", () => {
    const s = clean(); s.toolbars = [{ name: "t", box: box(0, 40, 400, 40), allIds: ["a", "g", "b"], menuIds: [], iconIds: [], ghostIds: ["g"], barIds: ["a"], hasMore: false }];
    const dropped = auditSnapshot(s).filter((v) => v.kind === "item-dropped");
    expect(dropped).toHaveLength(1);
    expect(dropped[0].detail).toMatch(/"b"/);        // the visible item still counts; the ghost does not
  });
  it("NOTHING IS DROPPED — an item neither on the bar nor in the menu is caught", () => {
    const s = clean(); s.toolbars = [{ name: "t", box: box(0, 40, 400, 40), allIds: ["a", "b", "c"], menuIds: ["c"], iconIds: [], barIds: ["a"], hasMore: true }];
    expect(auditSnapshot(s).find((v) => v.kind === "item-dropped").detail).toMatch(/"b"/);
  });
  it("items in a menu with no More button to open it are caught", () => {
    const s = clean(); s.toolbars = [{ name: "t", box: box(0, 40, 400, 40), allIds: ["a", "b"], menuIds: ["b"], iconIds: [], barIds: ["a"], hasMore: false }];
    expect(kinds(s)).toContain("no-more-button");
  });
});

describe("auditMenu", () => {
  const t = { name: "t", menuIds: ["b", "c"] };
  it("passes when the opened menu lists every promised item", () => { expect(auditMenu(t, ["b", "c"])).toEqual([]); });
  it("fails naming the missing item", () => { expect(auditMenu(t, ["b"])[0].detail).toMatch(/"c"/); });
});
