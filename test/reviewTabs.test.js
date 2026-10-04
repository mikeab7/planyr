// Review TABS (NEW-1, 2026-10-04) — the pure model + the account sync (two devices, one account).
import { describe, it, expect } from "vitest";
import { upsertTab, findOpenTab, closeTab, moveTab, serializeTabs, parseTabs, mergeRestored, droppedNotice, mergeLiveRecord, withKnownKeys, syncSig, parseSyncDoc, applyRemote, tabTitle, srcKeyOf } from "../src/workspaces/doc-review/lib/reviewTabs.js";
import { createTabSync } from "../src/workspaces/doc-review/lib/tabSync.js";

const T = (id, extra = {}) => ({ id, name: `${id}.pdf`, projectId: null, project: "", kind: "pdf", srcKey: "", ...extra });
const ids = (tabs) => tabs.map((t) => t.id);

describe("tab list model", () => {
  it("upsert appends once and refreshes in place; a no-op refresh returns the same array", () => {
    let tabs = upsertTab([], T("a")); tabs = upsertTab(tabs, T("b")); tabs = upsertTab(tabs, T("c"));
    expect(ids(tabs)).toEqual(["a", "b", "c"]);
    const again = upsertTab(tabs, T("b"));
    expect(again).toBe(tabs);
    expect(ids(upsertTab(tabs, T("b", { name: "renamed.pdf" })))).toEqual(["a", "b", "c"]);
  });
  it("an already-open file is found by id, and a disk pick by name+size+project — the same name in two projects stays two tabs", () => {
    const tabs = [T("a", { name: "plan.pdf", projectId: "p1", srcKey: srcKeyOf("plan.pdf", 10) }), T("b", { name: "plan.pdf", projectId: "p2", srcKey: srcKeyOf("plan.pdf", 10) })];
    expect(findOpenTab(tabs, { id: "b" }).id).toBe("b");
    expect(findOpenTab(tabs, { name: "plan.pdf", size: 10, projectId: "p2" }).id).toBe("b");
    expect(findOpenTab(tabs, { name: "plan.pdf", size: 10, projectId: "p3" })).toBe(null);
    expect(findOpenTab(tabs, { name: "plan.pdf", size: 11, projectId: "p1" })).toBe(null);
  });
  it("closing the active tab shows its right neighbour, or the left one when it was last, or nothing", () => {
    const tabs = [T("a"), T("b"), T("c")];
    expect(closeTab(tabs, "b", "b").next).toBe("c");
    expect(closeTab(tabs, "c", "c").next).toBe("b");
    expect(closeTab([T("a")], "a", "a")).toEqual({ tabs: [], next: null });
    expect(closeTab(tabs, "a", "c").next).toBe("c"); // closing a background tab leaves the active one alone
  });
  it("drag reorder", () => {
    const tabs = [T("a"), T("b"), T("c")];
    expect(ids(moveTab(tabs, "c", "a"))).toEqual(["c", "a", "b"]);
    expect(ids(moveTab(tabs, "a", null))).toEqual(["b", "c", "a"]);
    expect(moveTab(tabs, "a", "a")).toBe(tabs);
  });
  it("hover title carries the project", () => { expect(tabTitle(T("a", { name: "x.pdf", project: "Goose Creek" }))).toBe("x.pdf — Goose Creek"); expect(tabTitle(T("a", { name: "x.pdf" }))).toBe("x.pdf"); });
});

describe("local copy (the signed-out / offline fallback)", () => {
  const tabs = [T("a"), T("b", { kind: "doc", name: "b.docx" })];
  const states = { a: { page: 3, view: { scale: 1.5, tx: 10, ty: 20 }, tool: "pan" }, b: { page: 1 } };
  it("round-trips order, active tab, page and zoom", () => {
    const back = parseTabs(serializeTabs({ uid: "u1", tabs, activeId: "b", states, at: 5 }), "u1");
    expect(ids(back.tabs)).toEqual(["a", "b"]);
    expect(back.active).toBe("b"); expect(back.at).toBe(5);
    expect(back.tabs[0].state).toMatchObject({ page: 3, view: { scale: 1.5, tx: 10, ty: 20 }, tool: "pan", scale: 1.5 });
  });
  it("another account's tabs are never reopened; garbage and empty stores are null", () => {
    const raw = serializeTabs({ uid: "u1", tabs, activeId: "a", states });
    expect(parseTabs(raw, "u2")).toBe(null); expect(parseTabs("nope", "u1")).toBe(null); expect(parseTabs(null, null)).toBe(null);
    expect(parseTabs(serializeTabs({ uid: null, tabs: [], activeId: null, states }), null)).toBe(null);
  });
  it("a bad active id falls back to the first tab; duplicate ids collapse", () => {
    const raw = JSON.stringify({ v: 1, uid: null, active: "zzz", tabs: [{ id: "a", name: "a" }, { id: "a", name: "dup" }, { id: "b", name: "b" }] });
    const p = parseTabs(raw, null);
    expect(ids(p.tabs)).toEqual(["a", "b"]); expect(p.active).toBe("a");
  });
  it("a restore keeps a tab opened while it was validating", () => {
    expect(ids(mergeRestored([T("a"), T("b")], [T("z")]))).toEqual(["a", "b", "z"]);
  });
  it("names dropped tabs in one line", () => {
    expect(droppedNotice(["x.pdf"])).toMatch(/“x.pdf” couldn’t be reopened/);
    expect(droppedNotice(["a", "b", "c", "d"])).toMatch(/^4 files/);
    expect(droppedNotice([])).toBe("");
  });
});

describe("a tab only in memory reopens from memory", () => {
  const live = { id: "r1", updatedAt: 200, single: { page: 3 }, sources: [{ srcId: "s1", name: "a.pdf" }] };
  it("a keyless source is not lost when the stored copy has none", () => {
    const m = mergeLiveRecord({ id: "r1", updatedAt: 100, sources: [] }, live);
    expect(m.sources).toEqual([{ srcId: "s1", name: "a.pdf" }]); expect(m.single.page).toBe(3);
  });
  it("keys the stored copy (or the upload bookkeeping) learned are kept", () => {
    expect(mergeLiveRecord({ id: "r1", updatedAt: 100, sources: [{ srcId: "s1", driveKey: "k" }] }, live).sources[0].driveKey).toBe("k");
    expect(withKnownKeys({ srcId: "s1" }, { s1: { driveKey: "k2" } }).driveKey).toBe("k2");
  });
  it("a stored copy saved AFTER we left wins; no stored copy → the live one", () => {
    const stored = { id: "r1", updatedAt: 999, sources: [] };
    expect(mergeLiveRecord(stored, live)).toBe(stored); expect(mergeLiveRecord(null, live)).toBe(live); expect(mergeLiveRecord(stored, null)).toBe(stored);
  });
});

/* ---------- two devices, one account ---------- */
function account() { // the account's single stored copy, with an on/off switch per device
  const a = { doc: null, down: new Set() };
  a.backendFor = (dev) => ({
    read: async () => { if (a.down.has(dev)) throw new Error("offline"); return a.doc; },
    write: async (_u, d) => { if (a.down.has(dev)) throw new Error("offline"); a.doc = d; },
  });
  return a;
}
function device(name, acct, clock) {
  const d = { name, tabs: [], activeId: null, states: {}, at: 0, dirty: new Set(), sync: createTabSync({ backend: acct.backendFor(name), uid: "u1", now: () => clock.t }) };
  d.snap = () => ({ tabs: d.tabs, activeId: d.activeId, states: d.states, at: d.at });
  d.change = (fn) => { fn(d); clock.t += 10; d.at = clock.t; };
  d.open = (id, extra = {}) => d.change(() => { d.tabs = upsertTab(d.tabs, T(id, extra)); d.activeId = id; });
  d.close = (id) => d.change(() => { const r = closeTab(d.tabs, id, d.activeId); d.tabs = r.tabs; d.activeId = r.next; delete d.states[id]; });
  d.go = (id, st) => d.change(() => { d.activeId = id; d.states[id] = { ...(d.states[id] || {}), ...st }; });
  d.push = () => d.sync.push(d.snap());
  d.pull = async (opts) => { const r = await d.sync.pull(d.snap(), { isDirty: (id) => d.dirty.has(id), ...opts }); if (r.changed) { d.tabs = r.tabs; d.activeId = r.activeId; d.states = r.states; d.at = r.at; } return r; };
  return d;
}

describe("tabs follow the account (two devices, one account)", () => {
  it("tabs opened on device A appear on device B — same files, order, active tab, page and zoom", async () => {
    const acct = account(), clock = { t: 1000 }, A = device("A", acct, clock), B = device("B", acct, clock);
    A.open("r1", { name: "site.pdf" }); A.open("r2", { name: "grading.pdf" }); A.open("r3", { name: "scope.docx", kind: "doc" });
    A.go("r1", { page: 3, view: { scale: 1.25, tx: 5, ty: 6 }, tool: "pan" });
    expect((await A.push()).ok).toBe(true);
    const r = await B.pull({ adoptActive: true });
    expect(r.changed).toBe(true);
    expect(ids(B.tabs)).toEqual(["r1", "r2", "r3"]); expect(B.activeId).toBe("r1");
    expect(B.tabs[2].kind).toBe("doc");
    expect(B.states.r1).toMatchObject({ page: 3, scale: 1.25 }); // B was not showing anything, so it opens at A's page and zoom
  });
  it("page and zoom travel for a background tab; pan position and tool do not", async () => {
    const acct = account(), clock = { t: 1000 }, A = device("A", acct, clock), B = device("B", acct, clock);
    A.open("r1"); A.open("r2"); A.go("r1", { page: 3, view: { scale: 1.25, tx: 5, ty: 6 }, tool: "pan" }); A.go("r2", { page: 2 });
    await A.push();
    await B.pull({ adoptActive: true });
    expect(B.activeId).toBe("r2");
    expect(B.states.r1).toMatchObject({ page: 3, scale: 1.25 });
    expect(B.states.r1.view).toBeUndefined(); expect(B.states.r1.tool).toBeUndefined();
  });
  it("closing on B removes it on A at A's next focus — and edits made on both devices converge (last change wins)", async () => {
    const acct = account(), clock = { t: 1000 }, A = device("A", acct, clock), B = device("B", acct, clock);
    A.open("r1"); A.open("r2"); await A.push(); await B.pull({ adoptActive: true });
    B.close("r2"); expect((await B.push()).ok).toBe(true);
    expect(ids(A.tabs)).toEqual(["r1", "r2"]); // nothing changes until A looks
    const r = await A.pull();
    expect(r.changed).toBe(true); expect(ids(A.tabs)).toEqual(["r1"]); expect(A.activeId).toBe("r1");
    A.open("r9"); await A.push(); await B.pull();
    expect(ids(B.tabs)).toEqual(["r1", "r9"]);
  });
  it("an unsaved Word tab on A survives B closing it", async () => {
    const acct = account(), clock = { t: 1000 }, A = device("A", acct, clock), B = device("B", acct, clock);
    A.open("r1"); A.open("w1", { name: "scope.docx", kind: "doc" }); await A.push(); await B.pull({ adoptActive: true });
    B.close("w1"); await B.push();
    A.dirty.add("w1");
    await A.pull();
    expect(ids(A.tabs)).toContain("w1"); expect(A.activeId).toBe("w1"); // kept, and still the one being edited
    A.dirty.delete("w1"); // saved/discarded here → the next pull lets it go
    await A.pull({ adoptActive: false });
  });
  it("the tab being looked at is not swapped by a pull, unless Review is just opening", async () => {
    const acct = account(), clock = { t: 1000 }, A = device("A", acct, clock), B = device("B", acct, clock);
    A.open("r1"); A.open("r2"); await A.push(); await B.pull({ adoptActive: true });
    B.go("r1", {}); await B.push(); // B now has r1 active
    const r = await A.pull(); // A is looking at r2
    expect(A.activeId).toBe("r2"); expect(r.changed === false || A.activeId === "r2").toBe(true);
    await A.pull({ adoptActive: true });
    expect(A.activeId).toBe("r1");
  });
  it("a pull that finds nothing new changes nothing and does not echo a write", async () => {
    const acct = account(), clock = { t: 1000 }, A = device("A", acct, clock), B = device("B", acct, clock);
    A.open("r1"); await A.push(); await B.pull({ adoptActive: true });
    const before = acct.doc;
    expect((await B.pull()).changed).toBe(false);
    expect((await B.push()).skipped).toBe(true);
    expect(acct.doc).toBe(before);
  });
  it("offline: pushes fail loudly and the local copy stays the source; back online the newer local copy wins and syncs", async () => {
    const acct = account(), clock = { t: 1000 }, A = device("A", acct, clock), B = device("B", acct, clock);
    A.open("r1"); await A.push(); await B.pull({ adoptActive: true });
    acct.down.add("B");
    B.open("r2");
    const off = await B.push();
    expect(off.ok).toBe(false); expect(off.error).toMatch(/offline/);
    expect((await B.pull()).ok).toBe(false); // an offline read is an ERROR, never "the account has no tabs"
    expect(ids(B.tabs)).toEqual(["r1", "r2"]); // local copy intact
    acct.down.delete("B");
    const back = await B.pull();
    expect(back.pushedNewerLocal).toBe(true);
    await A.pull();
    expect(ids(A.tabs)).toEqual(["r1", "r2"]);
  });
  it("signed out: a brand-new account copy is seeded from the local tabs on first sync", async () => {
    const acct = account(), clock = { t: 1000 }, A = device("A", acct, clock);
    A.open("r1"); const r = await A.pull();
    expect(r.ok).toBe(true); expect(parseSyncDoc(acct.doc).tabs.map((t) => t.id)).toEqual(["r1"]);
  });
  it("applyRemote is a no-op for an identical set, and syncSig ignores pan/tool", () => {
    const local = { tabs: [T("a")], activeId: "a", states: { a: { page: 2, view: { scale: 1, tx: 1, ty: 1 } } } };
    const sameWithPan = { ...local, states: { a: { page: 2, view: { scale: 1, tx: 99, ty: 99 }, tool: "x" } } };
    expect(syncSig(local)).toBe(syncSig(sameWithPan));
    const remote = parseSyncDoc({ v: 1, at: 5, active: "a", tabs: [{ id: "a", name: "a.pdf", page: 2, scale: 1 }] });
    expect(applyRemote(local, remote).changed).toBe(false);
  });
});
