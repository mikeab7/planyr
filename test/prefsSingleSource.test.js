// B1953793 — account prefs / rule tables / pinned-folder label: ONE source, no stale copies.
// Red-proof: on the pre-fix tree `updatePrefs` / `getPrefsSnapshot` / `subscribePrefs` /
// `patchFloodplainRule` / `patchEasementRule` / `pinnedFolderLabel` do not exist, and the
// stale-bag scenario below (the real defect) reverts the other surface's key.
import { describe, it, expect, beforeEach, vi } from "vitest";

// ---- in-memory localStorage + a tiny window (storage event) for the node environment
function installBrowser() {
  const m = new Map();
  const ls = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
  const listeners = {};
  globalThis.localStorage = ls;
  globalThis.window = {
    addEventListener: (t, f) => { (listeners[t] ||= new Set()).add(f); },
    removeEventListener: (t, f) => { listeners[t]?.delete(f); },
    dispatchEvent: (e) => { (listeners[e.type] || []).forEach((f) => f(e)); return true; },
  };
  globalThis.Event = globalThis.Event || class { constructor(t) { this.type = t; } };
  return { ls, fire: (type, ev) => (listeners[type] || new Set()).forEach((f) => f(ev)) };
}

// ---- fake supabase: one profiles row
const db = { row: null, upserts: 0 };
vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: db.row ? { ...db.row } : null, error: null }) }) }),
      upsert: async (r) => { db.upserts++; db.row = JSON.parse(JSON.stringify(r)); return { error: null }; },
    }),
  },
}));

let browser;
beforeEach(() => { browser = installBrowser(); db.row = null; db.upserts = 0; });

describe("account prefs — shared store + fresh read-modify-write (B1953793 fix 1)", () => {
  it("a stale whole-bag save REVERTS another surface's key (the old defect) — updatePrefs does not", async () => {
    const store = await import("../src/workspaces/site-planner/lib/userPrefsStore.js");
    db.row = { id: "u1", prefs: { sitesPanel: { pinned: [] }, dashboardLayout: { a: 1 } } };
    // Map view loaded its bag early (pinned = []), then the header pins "p1" via the patch API.
    const staleBag = (await store.loadPrefsRaw("u1")).prefs;
    await store.updatePrefs("u1", (p) => store.setSitesPanelPref(p, { pinned: ["p1"] }));
    // The Map view now collapses a group. Legacy path: whole stale bag.
    const legacy = store.setSitesPanelPref(staleBag, { collapsed: { live: true } });
    await store.savePrefsRaw("u1", legacy);
    expect(db.row.prefs.sitesPanel.pinned).toEqual([]); // the lost update (documents the bug)
    // Fixed path from the same starting state:
    db.row = { id: "u1", prefs: { sitesPanel: { pinned: [] }, dashboardLayout: { a: 1 } } };
    await store.updatePrefs("u1", (p) => store.setSitesPanelPref(p, { pinned: ["p1"] }));
    await store.updatePrefs("u1", (p) => store.setSitesPanelPref(p, { collapsed: { live: true } }));
    expect(db.row.prefs.sitesPanel.pinned).toEqual(["p1"]);
    expect(db.row.prefs.sitesPanel.collapsed).toEqual({ live: true });
    expect(db.row.prefs.dashboardLayout).toEqual({ a: 1 }); // untouched key carried through
  });

  it("the cloud write reads the account row FRESH, so an edit made elsewhere between load and save survives", async () => {
    const store = await import("../src/workspaces/site-planner/lib/userPrefsStore.js");
    db.row = { id: "u1", prefs: { sitesPanel: { pinned: [] } } };
    await store.loadPrefsRaw("u1");
    db.row.prefs.dashboardDismissedCards = ["x"]; // another device/tab writes this key
    await store.updatePrefs("u1", (p) => store.setSitesPanelPref(p, { pinned: ["p2"] }));
    expect(db.row.prefs.dashboardDismissedCards).toEqual(["x"]);
    expect(db.row.prefs.sitesPanel.pinned).toEqual(["p2"]);
  });

  it("two readers already mounted both see a writer's change with no reload, and after reload", async () => {
    const store = await import("../src/workspaces/site-planner/lib/userPrefsStore.js");
    const seenMap = [], seenSitePlanner = [];
    const offA = store.subscribePrefs(() => seenMap.push(store.getPrefsSnapshot().sitesPanel.pinned.slice()));
    const offB = store.subscribePrefs(() => seenSitePlanner.push(store.getPrefsSnapshot().sitesPanel.pinned.slice()));
    const before = store.getPrefsSnapshot();
    expect(store.getPrefsSnapshot()).toBe(before); // stable identity when nothing changed
    await store.updatePrefs("u1", (p) => store.setSitesPanelPref(p, { pinned: ["hdr"] }));
    expect(seenMap.at(-1)).toEqual(["hdr"]);
    expect(seenSitePlanner.at(-1)).toEqual(["hdr"]);
    offA(); offB();
    // "reload": fresh module state reads the mirror
    vi.resetModules();
    const again = await import("../src/workspaces/site-planner/lib/userPrefsStore.js");
    expect(again.getPrefsSnapshot().sitesPanel.pinned).toEqual(["hdr"]);
  });

  it("another tab's mirror write (storage event) reaches subscribers", async () => {
    const store = await import("../src/workspaces/site-planner/lib/userPrefsStore.js");
    const seen = [];
    const off = store.subscribePrefs(() => seen.push(store.getPrefsSnapshot().sitesPanel.pinned.slice()));
    store.getPrefsSnapshot();
    browser.ls.setItem("planyr:userPrefs:v1", JSON.stringify({ sitesPanel: { pinned: ["other-tab"] } }));
    browser.fire("storage", { key: "planyr:userPrefs:v1" });
    expect(seen.at(-1)).toEqual(["other-tab"]);
    off();
  });

  it("the breadcrumb's window event fires on a same-tab write (header follows the store without importing it)", async () => {
    const store = await import("../src/workspaces/site-planner/lib/userPrefsStore.js");
    let n = 0;
    window.addEventListener(store.PREFS_CHANGED_EVENT, () => { n++; });
    await store.updatePrefs("u1", (p) => store.setSitesPanelPref(p, { pinned: ["z"] }));
    expect(n).toBeGreaterThan(0);
  });

  it("a failed cloud write is reported (LOUD) and the failure is not a false ok", async () => {
    vi.resetModules();
    vi.doMock("../src/workspaces/site-planner/lib/supabase.js", () => ({
      supabase: { from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        upsert: async () => ({ error: { message: "boom" } }),
      }) },
    }));
    const store = await import("../src/workspaces/site-planner/lib/userPrefsStore.js");
    const r = await store.updatePrefs("u1", (p) => store.setSitesPanelPref(p, { pinned: ["q"] }));
    expect(r.ok).toBe(false);
    expect(r.error).toBe("boom");
    vi.doUnmock("../src/workspaces/site-planner/lib/supabase.js");
  });
});

describe("rule tables — per-jurisdiction read-modify-write (B1953793 fix 2)", () => {
  it("tab B's 'verified' tick on Fort Bend does not revert tab A's Harris ratio", async () => {
    const fp = await import("../src/workspaces/site-planner/lib/floodplainRules.js");
    // Tab B opened earlier and holds a stale full map.
    const staleB = fp.loadFloodplainRules();
    // Tab A sets Harris ratio 1.5
    fp.patchFloodplainRule("harris", { ratio: 1.5 });
    // Tab B ticks verified on Fort Bend — legacy whole-map save from its stale copy would revert Harris.
    fp.saveFloodplainRules({ ...staleB, fortbend: { ...staleB.fortbend, verified: true } });
    expect(fp.loadFloodplainRules().harris.ratio).not.toBe(1.5); // documents the old defect
    // Fixed path:
    fp.saveFloodplainRules({}); // reset storage
    fp.patchFloodplainRule("harris", { ratio: 1.5 });
    fp.patchFloodplainRule("fortbend", { verified: true });
    const now = fp.loadFloodplainRules();
    expect(now.harris.ratio).toBe(1.5);
    expect(now.fortbend.verified).toBe(true);
  });

  it("open tabs are notified (same tab + storage event) and see the new value", async () => {
    const fp = await import("../src/workspaces/site-planner/lib/floodplainRules.js");
    const seen = [];
    const off = fp.subscribeFloodplainRules(() => seen.push(fp.loadFloodplainRules().harris.ratio));
    fp.patchFloodplainRule("harris", { ratio: 2.25 });
    expect(seen.at(-1)).toBe(2.25);
    localStorage.setItem("planarfit:floodplainRules:v1", JSON.stringify({ harris: { ratio: 3.5 } }));
    browser.fire("storage", { key: "planarfit:floodplainRules:v1" });
    expect(seen.at(-1)).toBe(3.5);
    off();
  });

  it("easement rules: patch keeps the seed's label, other jurisdictions untouched, subscribers notified", async () => {
    const er = await import("../src/workspaces/site-planner/lib/easementRules.js");
    const seen = [];
    const off = er.subscribeEasementRules(() => seen.push(er.loadEasementRules().coh.waterWidth));
    er.patchEasementRule("coh", { waterWidth: 30 });
    er.patchEasementRule("katy", { verified: true });
    const now = er.loadEasementRules();
    expect(now.coh.waterWidth).toBe(30);
    expect(now.coh.label).toBe("City of Houston");
    expect(now.katy.verified).toBe(true);
    expect(seen.at(-1)).toBe(30);
    off();
  });
});

describe("pinned folder label (B1953793 fix 3)", () => {
  it("shows the LIVE folder name after a rename; the snapshot is only the fallback", async () => {
    const { pinnedFolderLabel } = await import("../src/shared/pins/pinStore.js");
    const pin = { type: "folder", id: "f1", projectId: "p", label: "Old name" };
    expect(pinnedFolderLabel(pin, new Map([["f1", { id: "f1", name: "New name", trashed: false }]]))).toBe("New name");
    expect(pinnedFolderLabel(pin, new Map())).toBe("Old name");
    expect(pinnedFolderLabel(pin, new Map([["f1", { id: "f1", name: "Gone", trashed: true }]]))).toBe("Old name");
    expect(pinnedFolderLabel({ ...pin, label: "" }, null)).toBe("Folder");
  });

  it("LibraryHome routes FolderCard's text through the resolver, not pin.label alone", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../src/workspaces/library/components/LibraryHome.jsx", import.meta.url), "utf8");
    expect(src).toMatch(/pinnedFolderLabel\(p, folderNames\)/);
    expect(src).toMatch(/\{label \|\| pin\.label \|\| "Folder"\}/);
  });
});

describe("no view keeps its own copy of the account prefs (source guard)", () => {
  it("MapFinder / SitePlanner / ProjectBreadcrumb read the shared store and write via updatePrefs", async () => {
    const fs = await import("node:fs");
    const rd = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
    const mf = rd("../src/workspaces/site-planner/MapFinder.jsx");
    const sp = rd("../src/workspaces/site-planner/SitePlanner.jsx");
    const bc = rd("../src/shared/ui/ProjectBreadcrumb.jsx");
    expect(mf).not.toMatch(/useState\(\(\) => readMirror\(\)\)/);
    expect(mf).toMatch(/useSyncExternalStore\(subscribePrefs/);
    expect(sp).toMatch(/useSyncExternalStore\(subscribePrefs/);
    expect(sp).not.toMatch(/saveUserPrefs\(/);
    expect(bc).not.toMatch(/savePrefsRaw/);
    expect(bc).not.toMatch(/acctPrefsRef\.current/);
  });
});
