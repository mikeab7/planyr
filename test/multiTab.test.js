import { describe, it, expect } from "vitest";
import { summarizePresence, pruneStale, createMultiTabPresence } from "../src/shared/presence/multiTab.js";

// B313 — detect the same project open in another same-browser tab so we can warn about it.

describe("summarizePresence — banner state from this tab's POV", () => {
  const now = 1000;
  it("no peers → nothing to warn about", () => {
    expect(summarizePresence(new Map(), "self", "P1", now)).toEqual({ otherCount: 0, sameProjectTabs: 0, conflictRisk: false });
  });
  it("another tab on the SAME project → conflict risk", () => {
    const peers = new Map([["other", { project: "P1", at: now }]]);
    expect(summarizePresence(peers, "self", "P1", now)).toEqual({ otherCount: 1, sameProjectTabs: 1, conflictRisk: true });
  });
  it("another tab on a DIFFERENT project → present but no conflict", () => {
    const peers = new Map([["other", { project: "P2", at: now }]]);
    expect(summarizePresence(peers, "self", "P1", now)).toEqual({ otherCount: 1, sameProjectTabs: 0, conflictRisk: false });
  });
  it("ignores our own tab id", () => {
    const peers = new Map([["self", { project: "P1", at: now }]]);
    expect(summarizePresence(peers, "self", "P1", now).otherCount).toBe(0);
  });
  it("ignores stale peers (no heartbeat within the TTL)", () => {
    const peers = new Map([["other", { project: "P1", at: now - 99999 }]]);
    expect(summarizePresence(peers, "self", "P1", now, 8000).conflictRisk).toBe(false);
  });
  it("a tab with no project yet never counts as a same-project conflict", () => {
    const peers = new Map([["other", { project: null, at: now }]]);
    const s = summarizePresence(peers, "self", "P1", now);
    expect(s.otherCount).toBe(1); expect(s.conflictRisk).toBe(false);
  });
  it("self with no project open never matches", () => {
    const peers = new Map([["other", { project: "P1", at: now }]]);
    expect(summarizePresence(peers, "self", null, now).conflictRisk).toBe(false);
  });
});

describe("pruneStale — drop peers that stopped heart-beating", () => {
  it("removes stale, keeps fresh, reports whether it changed", () => {
    const peers = new Map([["a", { at: 1000 }], ["b", { at: 9000 }]]);
    expect(pruneStale(peers, 9500, 1000)).toBe(true); // 'a' is stale
    expect([...peers.keys()]).toEqual(["b"]);
    expect(pruneStale(peers, 9600, 1000)).toBe(false); // nothing newly stale
  });
});

describe("createMultiTabPresence — two tabs over a real BroadcastChannel", () => {
  // Two REAL tabs = two documents = two distinct identities. In one test realm we simulate that by
  // passing explicit distinct tabIds (a real second tab is a fresh realm with its own auto id).
  it("sees a peer that opens the SAME project, and clears it when that peer leaves", async () => {
    if (typeof BroadcastChannel === "undefined") return; // environment without BroadcastChannel: pure helpers above cover the logic
    const channel = "planyr-presence-test-" + Math.random().toString(36).slice(2);
    const settle = () => new Promise((r) => setTimeout(r, 40));
    let aState = { conflictRisk: false };
    const A = createMultiTabPresence({ channel, project: "P1", heartbeat: 1e7, tabId: "tab-A" });
    const B = createMultiTabPresence({ channel, project: "P1", heartbeat: 1e7, tabId: "tab-B" });
    try {
      A.onChange((s) => { aState = s; });
      A.start();
      B.start();          // B announces 'hello'; A should welcome + register it
      await settle();
      expect(aState.conflictRisk).toBe(true); // A sees B on the same project
      expect(aState.sameProjectTabs).toBe(1);
      B.stop();           // B says 'bye'
      await settle();
      expect(aState.conflictRisk).toBe(false); // A cleared it
    } finally {
      A.stop();
      try { B.stop(); } catch (_) {}
    }
  });

  it("does NOT flag a conflict when the other tab is on a different project", async () => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = "planyr-presence-test-" + Math.random().toString(36).slice(2);
    const settle = () => new Promise((r) => setTimeout(r, 40));
    let aState = { conflictRisk: false, otherCount: 0 };
    const A = createMultiTabPresence({ channel, project: "P1", heartbeat: 1e7, tabId: "tab-A" });
    const B = createMultiTabPresence({ channel, project: "P2", heartbeat: 1e7, tabId: "tab-B" });
    try {
      A.onChange((s) => { aState = s; });
      A.start(); B.start();
      await settle();
      expect(aState.otherCount).toBe(1);     // B is present
      expect(aState.conflictRisk).toBe(false); // but a different project → no conflict
    } finally {
      A.stop(); try { B.stop(); } catch (_) {}
    }
  });

  // Regression (owner report 2026-07-13): the Shell keeps every visited workspace mounted, so a
  // SINGLE tab can have several AppHeaders each running their own presence instance. Those same-tab
  // instances share one per-document identity (no explicit tabId → auto-assigned singleton), so they
  // must NOT see each other as a second tab — otherwise a false "open in another tab" banner fires
  // with only one tab open.
  it("two instances in the SAME document (no explicit tabId) never mistake each other for a second tab", async () => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = "planyr-presence-test-" + Math.random().toString(36).slice(2);
    const settle = () => new Promise((r) => setTimeout(r, 40));
    let aState = { conflictRisk: false, otherCount: 0 };
    // Same document/realm, same project — like the Library header + a kept-alive Review header.
    const A = createMultiTabPresence({ channel, project: "P1", heartbeat: 1e7 });
    const B = createMultiTabPresence({ channel, project: "P1", heartbeat: 1e7 });
    try {
      A.onChange((s) => { aState = s; });
      A.start(); B.start();
      await settle();
      expect(aState.otherCount).toBe(0);       // same-tab sibling, not another tab
      expect(aState.conflictRisk).toBe(false); // → no false banner
    } finally {
      A.stop(); try { B.stop(); } catch (_) {}
    }
  });
});
