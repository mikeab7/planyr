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
  it("sees a peer that opens the SAME project, and clears it when that peer leaves", async () => {
    if (typeof BroadcastChannel === "undefined") return; // environment without BroadcastChannel: pure helpers above cover the logic
    const channel = "planyr-presence-test-" + Math.random().toString(36).slice(2);
    const settle = () => new Promise((r) => setTimeout(r, 40));
    let aState = { conflictRisk: false };
    const A = createMultiTabPresence({ channel, project: "P1", heartbeat: 1e7 });
    const B = createMultiTabPresence({ channel, project: "P1", heartbeat: 1e7 });
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
    const A = createMultiTabPresence({ channel, project: "P1", heartbeat: 1e7 });
    const B = createMultiTabPresence({ channel, project: "P2", heartbeat: 1e7 });
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
});
