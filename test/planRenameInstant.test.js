/* NEW-1 (B2671215, owner 2026-11-10) — "I renamed it and it took a second for it to go into effect. When I hit enter, it should
 * immediately change the name when I rename a concept or project."
 *
 * ROOT CAUSE (measured on the owner's Quiddity plan: the new name was in storage at once and still absent from the DOM 9 s later):
 * `usePlanName` (the crumb and the plan menu's current row) reads a 2 s id→name index that only the app's one "list moved" signal
 * clears, and `saveSite` raised that signal for a project-name / status / role / group change — NOT for the plan's own `name`. So a
 * plan rename wrote the device copy, announced nothing, and every reader kept the cached old name until the cache expired AND something
 * else happened to re-render the planner.
 *
 * THIS TEST DRIVES THE REAL PIECES TOGETHER (real `saveSite`, real names store, the real `onProjectsChanged` subscription, a window that
 * delivers the synthetic `storage` event the way a browser does): after a plan rename the very next read of the name is the new one,
 * with no timer, no second render and no refresh in between. Red on the pre-fix `saveSite` (the old name is served from the cache).
 */
import { describe, it, expect, beforeEach } from "vitest";

const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
  clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  key: (i) => Object.keys(store)[i] ?? null,
  get length() { return Object.keys(store).length; },
};
globalThis.StorageEvent = class StorageEvent { constructor(type, init) { this.type = type; this.key = init && init.key; } };
const listeners = new Set();
globalThis.window = {
  addEventListener: (type, fn) => { if (type === "storage") listeners.add(fn); },
  removeEventListener: (type, fn) => { if (type === "storage") listeners.delete(fn); },
  dispatchEvent: (e) => { for (const fn of [...listeners]) fn(e); return true; },
};

const { saveSite, renameSiteGroup } = await import("../src/workspaces/site-planner/lib/storage.js");
const names = await import("../src/shared/names/names.js");

const seed = () => {
  saveSite({ id: "p1", groupId: "g1", site: "Bain", name: "Concept A - Quiddity" });
  saveSite({ id: "p2", groupId: "g1", site: "Bain", name: "Concept B - Quiddity DIA" });
};

/* NOTE: the listeners are NOT cleared — `names.js` subscribed itself to the app's "list moved" signal when it was imported (above), and that
 * subscription is the very thing under test. */
beforeEach(() => { localStorage.clear(); names.invalidateNameIndex(); });

describe("a plan rename shows on the very next read (no waiting for a cache to expire)", () => {
  it("the names store serves the new plan name the instant the rename is saved", () => {
    seed();
    expect(names.planNameOf("p1")).toBe("Concept A - Quiddity");   // the reader has cached the old name (the crumb is on screen)
    saveSite({ id: "p1", name: "Renamed One" }, { planRename: true });   // Enter in the plan menu → renamePlan → saveSite({ id, name }, { planRename: true })
    expect(names.planNameOf("p1")).toBe("Renamed One");            // pre-fix: still "Concept A - Quiddity" for up to 2 s and until a re-render
  });

  it("renaming a plan that is NOT the current one is just as immediate, and leaves the sibling alone", () => {
    seed();
    expect(names.planNameOf("p2")).toBe("Concept B - Quiddity DIA");
    saveSite({ id: "p2", name: "Alt layout" }, { planRename: true });
    expect(names.planNameOf("p2")).toBe("Alt layout");
    expect(names.planNameOf("p1")).toBe("Concept A - Quiddity");
  });

  it("a second rename straight after the first is also immediate (the index is not left holding the first)", () => {
    seed();
    names.planNameOf("p1");
    saveSite({ id: "p1", name: "One" }, { planRename: true });
    expect(names.planNameOf("p1")).toBe("One");
    saveSite({ id: "p1", name: "Two" }, { planRename: true });
    expect(names.planNameOf("p1")).toBe("Two");
  });

  it("the PROJECT rename is immediate too (it already was — this pins it beside the plan)", () => {
    seed();
    expect(names.projectNameOf("g1")).toBe("Bain");
    renameSiteGroup("g1", "Bain Renamed");
    expect(names.projectNameOf("g1")).toBe("Bain Renamed");
  });

  it("the announcement is the shared sites-list event, and a plain content edit stays quiet", () => {
    seed();
    const seen = [];
    const spy = (e) => seen.push(e.key);
    listeners.add(spy);
    saveSite({ id: "p1", name: "Renamed" }, { planRename: true });
    expect(seen.filter((k) => k === "planarfit:sites:v1").length).toBe(1);
    seen.length = 0;
    saveSite({ id: "p1", name: "Renamed", els: [{ id: "b1", type: "building", cx: 0, cy: 0, w: 100, h: 100 }] }, { planRename: true });   // content only — the name did not move
    expect(seen.filter((k) => k === "planarfit:sites:v1").length).toBe(0);
    listeners.delete(spy);
  });
});

describe("an autosave can never put the OLD plan name back (the rename is not silently undone)", () => {
  /* The planner's autosave sends `...metaRef.current` — a copy of the plan name taken at render time. A payload built before the rename and
   * written after it (the 50 ms mirror write, the 400 ms settle tick, a flush on leaving) used to overwrite the new name. */
  it("a content save carrying the pre-rename name leaves the renamed plan renamed", () => {
    seed();
    saveSite({ id: "p1", name: "Scheme Z" }, { planRename: true });
    saveSite({ id: "p1", site: "Bain", name: "Concept A - Quiddity", groupId: "g1", els: [{ id: "b1", type: "building", cx: 0, cy: 0, w: 100, h: 100 }] });   // the stale autosave
    expect(JSON.parse(localStorage.getItem("planarfit:sites:v1:p:p1")).name).toBe("Scheme Z");   // red on the pre-fix funnel: back to the old name
    expect(names.planNameOf("p1")).toBe("Scheme Z");
  });

  it("…and that save still lands its CONTENT (only the name is held)", () => {
    seed();
    saveSite({ id: "p1", name: "Scheme Z" }, { planRename: true });
    saveSite({ id: "p1", name: "Concept A - Quiddity", els: [{ id: "b9", type: "building", cx: 5, cy: 5, w: 100, h: 100 }] });
    const rec = JSON.parse(localStorage.getItem("planarfit:sites:v1:p:p1"));
    expect(rec.els.map((e) => e.id)).toContain("b9");
    expect(rec.name).toBe("Scheme Z");
  });

  it("a brand-new plan still takes the name it is born with, and a deliberate rename still wins", () => {
    saveSite({ id: "fresh", groupId: "gx", site: "X", name: "Concept A" });
    expect(names.planNameOf("fresh")).toBe("Concept A");
    saveSite({ id: "fresh", name: "Concept A" });                       // an unchanged name is not a correction
    saveSite({ id: "fresh", name: "Phase II" }, { planRename: true });
    expect(names.planNameOf("fresh")).toBe("Phase II");
  });
});

describe("the Library file rename shows the new title before its save finishes (same rule, another door)", () => {
  /* `renameReviewTitle` loads the record and saves it — a network round trip each signed in — and the row used to keep the old title until
   * `refresh()` after both. Guarded by order in the source: the list is patched BEFORE the await, and a failed save puts the old title back. */
  it("commitRename patches the list first, awaits the save second, and restores on failure", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/workspaces/library/components/FileBrowser.jsx", import.meta.url), "utf8");
    const body = src.slice(src.indexOf("const commitRename = async"), src.indexOf("const openFileMenu"));
    const patch = body.indexOf("setReviews(");
    const wait = body.indexOf("await renameReviewTitle(");
    expect(patch, "the list is patched").toBeGreaterThan(-1);
    expect(wait, "the save is awaited").toBeGreaterThan(-1);
    expect(patch, "the list is patched BEFORE the save is awaited").toBeLessThan(wait);
    expect(body, "a failed save restores the old title and says so").toMatch(/undo\(\);\s*setMoveNotice\(`Couldn't rename/);
  });
});
