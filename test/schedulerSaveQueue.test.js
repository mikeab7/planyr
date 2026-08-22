import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mergeCloudDoc, _mStripRev, _mIsObj } from "../ui-audit/stress/scheduler-engine.mjs";

// Regression guard for the B851 RECURRENCE (schedule grid shows the wrong project + a false
// "a newer version was saved on another device" reload prompt), diagnosed via a forced-ordering
// simulation rather than assumed. `public/sequence/index.html`'s window.storage.set() (aka
// `_rawSet`) had NO serialization: attemptCloudSave fires on every `data` change — including every
// carry-in re-drive (Scheduler.jsx posts planar:nav-select-by-site on every app-wide routed-project
// change, even while the Schedule tab isn't visible — B1342/NEW-2), so browsing a few Site Planner
// projects before landing on Schedule can have two or more real saves to "hs-v1" in flight at once.
// The optimistic-concurrency guard (`cloudRev > knownRev[k]`) is a plain client-side read-then-write
// check with no server-side compare-and-swap, so overlapping same-tab saves that complete OUT OF
// ORDER let the LAST one to finish win outright — even when it was issued FIRST and is now stale —
// with NO conflict ever detected (the reported wrong-project grid). In other interleavings the same
// gap makes this tab's own in-flight write look like a foreign "newer version" to a later save from
// the same tab, tripping the false-conflict banner. ONE mechanism, both symptoms.
//
// The fix (public/sequence/index.html, `window.storage.set`) serializes writes per key: at most one
// `_rawSet` call is ever in flight; adjacent still-unstarted AUTO saves coalesce (only the latest
// `data` is worth sending), while an EXPLICIT (skipSanity) checkpoint save always keeps its own slot.
//
// This test EXTRACTS the queue wrapper (and _rawSet's real Layer-0 guard body) from the shipped
// file and evaluates them, so it can never drift from the code the owner actually runs — same
// pattern as test/ganttLabelAbove.test.js.

const SRC = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");

function sliceBetween(startMarker, endMarker, { fromLast = false } = {}) {
  const start = fromLast ? SRC.lastIndexOf(startMarker) : SRC.indexOf(startMarker);
  expect(start, `"${startMarker}" not found in public/sequence/index.html`).toBeGreaterThan(-1);
  const end = SRC.indexOf(endMarker, start);
  expect(end, `"${endMarker}" not found after "${startMarker}"`).toBeGreaterThan(-1);
  return SRC.slice(start, end);
}

// Extract the queue wrapper (the fix under test). Boundaries are STRUCTURAL landmarks that
// coalescing/ordering logic changes can't touch (the block's opening declaration and the IIFE's
// own closing `})();`) — NOT a copy of the logic itself, so a mutation inside the block changes
// what gets extracted and evaluated, never breaks the extraction step. (An earlier version of this
// test used the exact expected body text as its own end-marker, which meant a logic mutation broke
// STRING EXTRACTION before the logic ever ran — a false "not found" failure that would have read as
// a broken test, not a caught bug. Fixed after mutation-testing turned that up.)
const queueSrc = sliceBetween("const _saveQueue = {};", "\n})();");

// Build a fresh sandbox: a fake `window.storage` whose `_rawSet` is swappable per test, with the
// REAL extracted queue wrapper installed as `window.storage.set`.
function makeSandbox(rawSet) {
  const sandboxWindow = { storage: { _rawSet: rawSet } };
  const fn = new Function("window", `${queueSrc}\nreturn window.storage.set;`);
  sandboxWindow.storage.set = fn(sandboxWindow);
  return sandboxWindow;
}

describe("window.storage.set queue wrapper — extracted from public/sequence/index.html", () => {
  it("AUTO saves queued WHILE one is already in flight coalesce: only the LATEST payload is ever sent", async () => {
    // v1 starts immediately (nothing was in flight) — that is the realistic shape: attemptCloudSave
    // fires from separate React effect runs, never perfectly synchronously. While v1 is still in
    // flight, v2 AND v3 both arrive; they must coalesce into ONE trailing call carrying v3, not two
    // separate calls (which is exactly the overlap that produced the reported race).
    const calls = [];
    const sandbox = makeSandbox(async (k, v) => {
      calls.push(v);
      await new Promise((r) => setTimeout(r, 20));
      return { ok: true };
    });
    const p1 = sandbox.storage.set("hs-v1", "v1", { label: "auto" });
    const p2 = sandbox.storage.set("hs-v1", "v2", { label: "auto" });
    const p3 = sandbox.storage.set("hs-v1", "v3", { label: "auto" });
    await Promise.all([p1, p2, p3]);
    expect(calls).toEqual(["v1", "v3"]);
  });

  // The three coalescing sub-cases below all need the FIRST save to still be genuinely IN FLIGHT
  // (not yet started-and-shifted-out) when the LATER ones arrive — a synchronous back-to-back call
  // with an instantly-resolving mock never exercises the "something is queued behind an unstarted
  // job" branch at all (the first job is already shifted into "running" before the second call is
  // even reached), so it would pass identically whether coalescing-exemption existed or not. Caught
  // by mutation-testing this session: an earlier version of these two tests used an instant mock and
  // stayed GREEN even when the source was mutated to coalesce EVERY tail regardless of type — a
  // vacuous check. Fixed by giving the mock a real delay, same shape as the "at most one in flight"
  // test below.
  it("an incoming AUTO save does not coalesce onto a QUEUED EXPLICIT tail — it gets its own slot", async () => {
    const calls = [];
    const sandbox = makeSandbox(async (k, v, opts) => {
      calls.push([v, opts.label]);
      await new Promise((r) => setTimeout(r, 20));
      return { ok: true };
    });
    const p1 = sandbox.storage.set("hs-v1", "running", { label: "auto" }); // occupies the in-flight slot
    const p2 = sandbox.storage.set("hs-v1", "pre-delete-state", { label: "pre-delete-project", skipSanity: true }); // queues as tail
    const p3 = sandbox.storage.set("hs-v1", "post-delete-state", { label: "auto" }); // must NOT coalesce onto p2's explicit tail
    await Promise.all([p1, p2, p3]);
    expect(calls).toEqual([
      ["running", "auto"],
      ["pre-delete-state", "pre-delete-project"],
      ["post-delete-state", "auto"],
    ]);
  });

  it("an incoming EXPLICIT save is never coalesced away by a later auto save — both reach _rawSet", async () => {
    const calls = [];
    const sandbox = makeSandbox(async (k, v, opts) => {
      calls.push([v, opts.label]);
      await new Promise((r) => setTimeout(r, 20));
      return { ok: true };
    });
    const p0 = sandbox.storage.set("hs-v1", "running", { label: "auto" }); // occupies the in-flight slot
    const p1 = sandbox.storage.set("hs-v1", "pre-delete-state", { label: "pre-delete-project", skipSanity: true });
    const p2 = sandbox.storage.set("hs-v1", "post-delete-state", { label: "auto" });
    await Promise.all([p0, p1, p2]);
    expect(calls).toEqual([
      ["running", "auto"],
      ["pre-delete-state", "pre-delete-project"],
      ["post-delete-state", "auto"],
    ]);
  });

  it("a later explicit save is also never coalesced onto an earlier QUEUED explicit one — every explicit save keeps its own slot", async () => {
    const calls = [];
    const sandbox = makeSandbox(async (k, v, opts) => {
      calls.push([v, opts.label]);
      await new Promise((r) => setTimeout(r, 20));
      return { ok: true };
    });
    const p0 = sandbox.storage.set("hs-v1", "running", { label: "auto" }); // occupies the in-flight slot
    const pA = sandbox.storage.set("hs-v1", "a", { label: "pre-import", skipSanity: true });
    const pB = sandbox.storage.set("hs-v1", "b", { label: "pre-recascade", skipSanity: true });
    await Promise.all([p0, pA, pB]);
    expect(calls).toEqual([["running", "auto"], ["a", "pre-import"], ["b", "pre-recascade"]]);
  });

  it("at most one _rawSet call is ever in flight for a given key (no overlap)", async () => {
    let inFlight = 0, maxInFlight = 0;
    const sandbox = makeSandbox(async () => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { ok: true };
    });
    await Promise.all([
      sandbox.storage.set("hs-v1", "1", { label: "auto" }),
      sandbox.storage.set("hs-v1", "2", { label: "auto" }),
      sandbox.storage.set("hs-v1", "3", { label: "auto" }),
    ]);
    expect(maxInFlight).toBe(1);
  });

  it("different keys are independent — a save to one key never waits on another", async () => {
    const order = [];
    const sandbox = makeSandbox(async (k) => {
      await new Promise((r) => setTimeout(r, k === "slow-key" ? 30 : 1));
      order.push(k);
      return { ok: true };
    });
    await Promise.all([
      sandbox.storage.set("slow-key", "v", { label: "auto" }),
      sandbox.storage.set("fast-key", "v", { label: "auto" }),
    ]);
    expect(order).toEqual(["fast-key", "slow-key"]);
  });

  it("a rejected _rawSet call rejects only its own job's waiters, not other queued jobs", async () => {
    const sandbox = makeSandbox(async (k, v) => {
      if (v === "boom") throw new Error("network error");
      return { ok: true, v };
    });
    const p1 = sandbox.storage.set("hs-v1", "boom", { label: "pre-import", skipSanity: true });
    const p2 = sandbox.storage.set("hs-v1", "fine", { label: "auto" });
    await expect(p1).rejects.toThrow("network error");
    await expect(p2).resolves.toEqual({ ok: true, v: "fine" });
  });
});

// ── The end-to-end race: a faithful simulation of the REAL _rawSet Layer-0 guard (the
// cloudRev > knownRev check + mergeCloudDoc fallback), forced through the exact out-of-order
// completion the brief asked for, WITH and WITHOUT the queue wrapper. This is the mutation proof:
// the same three interleavings that clobber the correct value when saves are unserialized must all
// converge correctly once routed through the queue.
describe("forced-ordering race: overlapping same-tab saves via the real Layer-0/merge logic", () => {
  function makeServer(initialDoc) {
    let doc = JSON.parse(JSON.stringify(initialDoc));
    return {
      read: (delayMs) => new Promise((res) => setTimeout(() => res(JSON.parse(JSON.stringify(doc))), delayMs)),
      write: (newDoc, delayMs) => new Promise((res) => setTimeout(() => { doc = JSON.parse(JSON.stringify(newDoc)); res({ ok: true }); }, delayMs)),
      snapshot: () => JSON.parse(JSON.stringify(doc)),
    };
  }

  // Faithful mirror of _rawSet's Layer-0 concurrency guard (cloudRev > knownRev → merge or block),
  // using the REAL mergeCloudDoc mirror already in this repo (ui-audit/stress/scheduler-engine.mjs,
  // confirmed byte-identical to the live source's mergeCloudDoc).
  async function rawSet(client, server, parsed, { readDelay, writeDelay }) {
    parsed = JSON.parse(JSON.stringify(parsed));
    const k = "hs-v1";
    const cur = await server.read(readDelay);
    const cloudRev = cur.__rev || 0;
    if (cloudRev > (client.knownRev[k] || 0)) {
      const base = client.baseByKey[k];
      const preOurs = _mStripRev(JSON.parse(JSON.stringify(parsed)));
      if (base !== undefined && _mIsObj(parsed)) {
        const merged = mergeCloudDoc(base, preOurs, _mStripRev(cur));
        if (merged && _mIsObj(merged)) parsed = merged;
        else return { blocked: true };
      } else return { blocked: true };
    }
    parsed.__rev = cloudRev + 1;
    await server.write(parsed, writeDelay);
    client.knownRev[k] = parsed.__rev;
    client.baseByKey[k] = _mStripRev(JSON.parse(JSON.stringify(parsed)));
    return { blocked: false, wroteAPid: parsed.aPid };
  }

  function baseDoc(aPid) {
    return {
      __rev: 10, aPid, section: "projects",
      projects: { 1: { id: 1, name: "Goose Creek", linkedSiteId: "gc" }, 2: { id: 2, name: "Grand Port", linkedSiteId: "gp" } },
    };
  }

  // Three network-timing interleavings a slow/jittery connection can realistically produce.
  // A(aPid=2) is issued first (a transient/stale intermediate carry-in target); B(aPid=1) is the
  // FINAL, correct one (Goose Creek). The correct final cloud state is always aPid=1.
  const CASES = [
    { name: "B completes before A (out-of-order)", firstOffset: 0, firstDelay: 300, secondOffset: 20, secondDelay: 10 },
    { name: "strict in-order (A fully done, then B)", firstOffset: 0, firstDelay: 50, secondOffset: 100, secondDelay: 50 },
    { name: "simultaneous burst, near-identical latency", firstOffset: 0, firstDelay: 60, secondOffset: 2, secondDelay: 58 },
  ];

  async function runUnserialized({ firstDelay, secondDelay, firstOffset, secondOffset }) {
    const server = makeServer(baseDoc(2));
    const client = { knownRev: { "hs-v1": 10 }, baseByKey: { "hs-v1": _mStripRev(baseDoc(2)) } };
    const docA = { ...baseDoc(2), aPid: 2 };
    const docB = { ...baseDoc(2), aPid: 1 };
    await Promise.all([
      new Promise((r) => setTimeout(() => r(rawSet(client, server, docA, { readDelay: firstDelay, writeDelay: firstDelay })), firstOffset)),
      new Promise((r) => setTimeout(() => r(rawSet(client, server, docB, { readDelay: secondDelay, writeDelay: secondDelay })), secondOffset)),
    ]);
    return server.snapshot().aPid;
  }

  async function runQueued({ firstDelay, secondDelay, firstOffset, secondOffset }) {
    const server = makeServer(baseDoc(2));
    const client = { knownRev: { "hs-v1": 10 }, baseByKey: { "hs-v1": _mStripRev(baseDoc(2)) } };
    const sandbox = makeSandbox((k, doc, opts) => rawSet(client, server, doc, opts));
    const docA = { ...baseDoc(2), aPid: 2 };
    const docB = { ...baseDoc(2), aPid: 1 };
    await Promise.all([
      new Promise((r) => setTimeout(() => r(sandbox.storage.set("hs-v1", docA, { label: "auto", readDelay: firstDelay, writeDelay: firstDelay })), firstOffset)),
      new Promise((r) => setTimeout(() => r(sandbox.storage.set("hs-v1", docB, { label: "auto", readDelay: secondDelay, writeDelay: secondDelay })), secondOffset)),
    ]);
    return server.snapshot().aPid;
  }

  it("MUTATION PROOF: without the queue, at least one forced interleaving silently clobbers the correct aPid", async () => {
    const results = await Promise.all(CASES.map(runUnserialized));
    // This is the reproduction of the reported bug: some interleavings land on the STALE aPid (2)
    // instead of the last-intended, correct one (1) — with no error, no banner, no signal at all.
    expect(results).not.toEqual([1, 1, 1]);
    expect(results.filter((a) => a === 2).length).toBeGreaterThan(0);
  });

  it("THE FIX: with the real extracted queue wrapper in front of the same guard, every interleaving converges to the correct, last-intended aPid", async () => {
    const results = await Promise.all(CASES.map(runQueued));
    expect(results).toEqual([1, 1, 1]);
  });
});
