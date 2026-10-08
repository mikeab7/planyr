/* foodDraftStore — the CI-runnable half of "rotating the phone must not wipe a half-typed Food form" (V1476080 step 6, found on live
 * planyr.io 2026-10-08, iPhone 15 + SE). The browser half is ui-audit/verify-food-visit-phone.mjs arm 6 (RED on main: every field came
 * back empty; green with the fix) and ui-audit/verify-food-signed-in-live.mjs (the same on the deployed site, signed in).
 * `VisitPanel` returns a different parent per layout (SideDock / BottomSheet / the desktop rail); a parent swap remounts the form, so
 * state kept only in `useState` is lost. The panel owns a draft store that outlives the swap; fields read it on mount and write back. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createDraftStore, DraftStoreContext, useDraftField } from "../src/workspaces/food/lib/draftStore.js";

const FOOD = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "src", "workspaces", "food");
const read = (rel) => readFileSync(join(FOOD, rel), "utf8");

function Probe({ k = "new", field = "notes", init = "blank" }) {
  const [v] = useDraftField(k, field, init);
  return createElement("span", null, `v=${v}`);
}
const under = (store, props) => renderToStaticMarkup(createElement(DraftStoreContext.Provider, { value: store }, createElement(Probe, props)));

describe("draftStore", () => {
  it("reads back what was written, per form key and per field, and forgets on clear", () => {
    const s = createDraftStore();
    expect(s.read("new", "notes")).toBeUndefined();
    s.write("new", "notes", "great smoke ring"); s.write("edit:1", "notes", "other");
    expect(s.read("new", "notes")).toBe("great smoke ring");
    expect(s.read("edit:1", "notes")).toBe("other");
    s.clear("new");
    expect(s.read("new", "notes")).toBeUndefined();
    expect(s.read("edit:1", "notes")).toBe("other");
  });
  it("keeps falsy values (an empty string and null are drafts too, not 'nothing kept')", () => {
    const s = createDraftStore();
    s.write("new", "cost", ""); s.write("new", "rating", null);
    expect(s.read("new", "cost")).toBe("");
    expect(s.read("new", "rating")).toBeNull();
  });
});

describe("useDraftField — a FRESH MOUNT under the same store gets the kept value (the remount a rotation causes)", () => {
  it("uses the kept value when the store has one", () => {
    const s = createDraftStore(); s.write("new", "notes", "great smoke ring");
    expect(under(s, {})).toContain("v=great smoke ring");
  });
  it("uses the initial value when nothing is kept (and an init FUNCTION is called lazily)", () => {
    expect(under(createDraftStore(), {})).toContain("v=blank");
    expect(under(createDraftStore(), { init: () => "from-fn" })).toContain("v=from-fn");
  });
  it("is plain useState outside a provider (fixtures, other callers)", () => {
    expect(renderToStaticMarkup(createElement(Probe, {}))).toContain("v=blank");
  });
  it("never leaks between forms: another key stays at its own initial value", () => {
    const s = createDraftStore(); s.write("new", "notes", "x");
    expect(under(s, { k: "edit:7" })).toContain("v=blank");
  });
});

describe("the Food forms actually use it (a refactor back to bare useState would silently reintroduce the loss)", () => {
  const panel = read("components/VisitPanel.jsx"), dishes = read("components/DishesSection.jsx");
  it("VisitForm keeps every typed field in the draft store", () => {
    for (const f of ["rating", "ratingAmbiance", "cost", "visitedOn", "dishRows", "whatWasGood", "notes", "wouldReturn"]) {
      expect(panel, `VisitForm field ${f}`).toMatch(new RegExp(`\\[${f}, set\\w+\\] = useDraftField\\(draftKey, "${f}"`));
    }
  });
  it("the add-a-dish editor and which dish row is open are kept too", () => {
    for (const f of ["name", "course", "score", "orderAgain", "price", "note"]) expect(dishes, `DishEditRow field ${f}`).toMatch(new RegExp(`\\[${f}, set\\w+\\] = useDraftField\\(draftKey, "${f}"`));
    expect(dishes).toMatch(/\[addingNew, setAddingNew\] = useDraftField\(/);
    expect(dishes).toMatch(/\[editingKey, setEditingKey\] = useDraftField\(/);
  });
  it("VisitPanel provides ONE store above all three layouts (side dock, bottom sheet, desktop rail)", () => {
    expect((panel.match(/<DraftStoreContext\.Provider value=\{drafts\}>/g) || []).length).toBe(3);
    expect(panel).toMatch(/const \[drafts\] = useState\(createDraftStore\)/);
  });
  it("an explicit Cancel and opening a form clear the draft — a draft never outlives a Cancel (the panel's own 'starts from the CURRENT saved row' contract)", () => {
    expect(panel).toMatch(/const cancel = \(\) => \{ drafts\?\.clear\(draftKey\); onCancel\?\.\(\); \}/);
    expect(panel).toMatch(/drafts\.clear\("new"\); drafts\.clear\(`edit:\$\{id\}`\)/);
    expect(dishes).toMatch(/const onCancel = \(\) => \{ drafts\?\.clear\(draftKey\); onCancelRaw\(\); \}/);
  });
  it("the place-wide Dishes section and the one inside an editing visit are scoped apart", () => {
    expect(panel).toMatch(/scope=\{`visit:\$\{visit\.id\}`\}/);
    expect(dishes).toMatch(/scope = "place"/);
  });
});
