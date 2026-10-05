/* V537648 — a DIVERGENT local Model workbook was silently pushed over the cloud copy on reload,
 * with no edit by the user; the "Sync problem" badge flashed for under a second and was gone.
 * See src/workspaces/model/lib/modelPushGate.js's header for the exact sequence.
 *
 * Two halves, the same shape the other ModelApp suites use (a full render would need jsdom plus
 * mocks of Supabase/AppHeader/the grid stack, and this repo's vitest runs in "node"):
 *   1. BEHAVIOUR — the reload sequence (schedule the debounced push → cloud load resolves as
 *      diverged → timer fires) is driven against the real push body, with a KNOWN-BAD control
 *      arm: the pre-fix inline timer body must reproduce the overwrite, or the harness is blind.
 *   2. WIRING — ModelApp.jsx's timer delegates to that body, reads the gate from refs at FIRE
 *      time, latches the hold where divergence is detected, and only the user's resolution
 *      releases it.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { cloudPushVerdict, runCloudPush, shownModelStatus } from "../src/workspaces/model/lib/modelPushGate.js";

/* A tiny model of ModelApp's refs + the cloud row, enough to replay the reload sequence. */
function makeWorld({ cloudContent = "A", cloudVersion = 3 } = {}) {
  const w = {
    cloud: { content: cloudContent, version: cloudVersion },
    statusRef: { current: "idle" }, divergedRef: { current: false }, cloudVersionRef: { current: null },
    statusLog: [], writes: [],
  };
  w.setStatus = (s) => { w.statusRef.current = s; w.statusLog.push(s); };
  // casUpsert's contract: expected null → INSERT (refused if the row exists); else CAS on version.
  w.save = async (content, expected) => {
    w.writes.push({ content, expected });
    if (expected == null) return w.cloud ? { ok: false, reason: "conflict" } : (w.cloud = { content, version: 1 }, { ok: true, version: 1 });
    if (expected !== w.cloud.version) return { ok: false, reason: "conflict" };
    w.cloud = { content, version: expected + 1 };
    return { ok: true, version: w.cloud.version };
  };
  // The load effect's cloud half (ModelApp.jsx): local exists AND differs → diverged.
  w.cloudLoadResolves = (localContent) => {
    w.cloudVersionRef.current = w.cloud.version;
    if (localContent !== w.cloud.content) { w.divergedRef.current = true; w.setStatus("diverged"); }
  };
  return w;
}

/* The PRE-FIX timer body, verbatim in behaviour (ModelApp.jsx before V537648): it checked
 * "not-provisioned" only at schedule time, never "diverged", and never at fire time. */
async function legacyTimerBody(w, content) {
  w.setStatus("saving");
  const r = await w.save(content, w.cloudVersionRef.current);
  if (r.ok) { w.cloudVersionRef.current = r.version; w.setStatus("saved"); }
  else if (r.reason === "not-provisioned") w.setStatus("not-provisioned");
  else if (r.reason === "conflict") w.setStatus("conflict");
  else if (r.reason === "unavailable") w.setStatus("idle");
  else w.setStatus("error");
}

const fixedTimerBody = (w, content) => runCloudPush({
  readGate: () => ({ status: w.statusRef.current, diverged: w.divergedRef.current }),
  save: () => w.save(content, w.cloudVersionRef.current),
  setStatus: w.setStatus,
  onSaved: (v) => { w.cloudVersionRef.current = v; },
});

/* Reload with a divergent local copy and NO user edit: the push was scheduled at mount (before
 * the cloud answered), the cloud load resolves as diverged, then the 800 ms timer fires. */
async function reloadDiverged(body) {
  const w = makeWorld({ cloudContent: "cloud work from device A", cloudVersion: 3 });
  const local = "stale copy on device B";
  // t=0: effect schedules the timer (captures `local`); t≈200ms: cloud load resolves.
  w.cloudLoadResolves(local);
  // t=800ms: the timer fires.
  await body(w, local);
  return w;
}

describe("V537648 — the reload sequence (schedule → diverged → fire)", () => {
  it("KNOWN-BAD ARM: the pre-fix timer body overwrites the cloud copy and clears the warning", async () => {
    const w = await reloadDiverged(legacyTimerBody);
    // If this arm ever stops reproducing, the harness can no longer see the bug — fail loudly.
    expect(w.cloud.content).toBe("stale copy on device B");
    expect(w.cloud.version).toBe(4);
    expect(w.statusLog).toEqual(["diverged", "saving", "saved"]);
  });

  it("the fixed push body NEVER writes while diverged, and the warning stays on screen", async () => {
    const w = await reloadDiverged(fixedTimerBody);
    expect(w.writes).toEqual([]);
    expect(w.cloud).toEqual({ content: "cloud work from device A", version: 3 });
    expect(w.statusRef.current).toBe("diverged");
    expect(w.statusLog).toEqual(["diverged"]);
  });

  it("…and a later edit's push (still unresolved) is held too — every fire re-asks", async () => {
    const w = await reloadDiverged(fixedTimerBody);
    expect(await fixedTimerBody(w, "an edit on device B")).toBe("hold-diverged");
    expect(w.writes).toEqual([]);
    expect(w.statusRef.current).toBe("diverged");
  });

  it("the HOLD is the authority, not the status string: a later status write cannot re-arm the push", async () => {
    const w = await reloadDiverged(fixedTimerBody);
    w.setStatus("idle"); // e.g. any stray status write
    expect(await fixedTimerBody(w, "x")).toBe("hold-diverged");
    expect(w.writes).toEqual([]);
  });

  it("a push in flight when divergence is detected cannot replace the warning with its own result", async () => {
    const w = makeWorld({ cloudContent: "A", cloudVersion: 3 });
    // Slow cloud load: the timer fires first, with expected=null (an INSERT, refused by the row).
    const p = runCloudPush({
      readGate: () => ({ status: w.statusRef.current, diverged: w.divergedRef.current }),
      save: async () => { const r = await w.save("B", w.cloudVersionRef.current); w.cloudLoadResolves("B"); return r; },
      setStatus: w.setStatus, onSaved: (v) => { w.cloudVersionRef.current = v; },
    });
    await p;
    expect(w.cloud).toEqual({ content: "A", version: 3 });
    expect(w.statusRef.current).toBe("diverged"); // not "conflict"
  });

  it("after the USER resolves (releases the hold), the push runs normally at the current version", async () => {
    const w = await reloadDiverged(fixedTimerBody);
    w.divergedRef.current = false; w.setStatus("idle"); // what onKeepDeviceCopy does
    expect(await fixedTimerBody(w, "stale copy on device B")).toBe("push");
    expect(w.cloud).toEqual({ content: "stale copy on device B", version: 4 });
    expect(w.statusRef.current).toBe("saved");
  });
});

describe("V537648 — the non-diverged path is unchanged", () => {
  for (const [name, setup, expectedLog] of [
    ["same content → saved", (w) => w.cloudLoadResolves("A"), ["saving", "saved"]],
    ["stale version → conflict", (w) => { w.cloudLoadResolves("A"); w.cloudVersionRef.current = 1; }, ["saving", "conflict"]],
  ]) {
    it(`${name}: identical status sequence and writes to the pre-fix body`, async () => {
      const a = makeWorld({ cloudContent: "A" }); setup(a); await legacyTimerBody(a, "A");
      const b = makeWorld({ cloudContent: "A" }); setup(b); await fixedTimerBody(b, "A");
      expect(b.statusLog).toEqual(a.statusLog);
      expect(b.statusLog).toEqual(expectedLog);
      expect(b.writes).toEqual(a.writes);
      expect(b.cloud).toEqual(a.cloud);
    });
  }

  it("every save reason maps to the same status as before", async () => {
    for (const [reason, want] of [["not-provisioned", "not-provisioned"], ["conflict", "conflict"], ["unavailable", "idle"], ["error", "error"]]) {
      const log = [];
      await runCloudPush({ readGate: () => ({ status: "idle", diverged: false }), save: async () => ({ ok: false, reason }), setStatus: (s) => log.push(s) });
      expect(log).toEqual(["saving", want]);
    }
  });

  it("cloudPushVerdict: push / skip-not-provisioned / hold-diverged", () => {
    expect(cloudPushVerdict({ status: "idle", diverged: false })).toBe("push");
    expect(cloudPushVerdict({ status: "saved", diverged: false })).toBe("push");
    expect(cloudPushVerdict({ status: "conflict", diverged: false })).toBe("push"); // CAS still guards; unchanged
    expect(cloudPushVerdict({ status: "not-provisioned", diverged: false })).toBe("skip-not-provisioned");
    expect(cloudPushVerdict({ status: "diverged", diverged: false })).toBe("hold-diverged");
    expect(cloudPushVerdict({ status: "saved", diverged: true })).toBe("hold-diverged");
  });

  it("shownModelStatus: the hold outranks everything but a failed local write", () => {
    expect(shownModelStatus("saved", true)).toBe("diverged");
    expect(shownModelStatus("idle", true)).toBe("diverged");
    expect(shownModelStatus("error", true)).toBe("error");
    expect(shownModelStatus("saved", false)).toBe("saved");
  });
});

const SRC = fs.readFileSync(path.join(process.cwd(), "src/workspaces/model/ModelApp.jsx"), "utf8");

describe("V537648 — ModelApp.jsx wiring", () => {
  const pushStart = SRC.indexOf("/* Best-effort, debounced cloud push");
  const pushBody = SRC.slice(pushStart, SRC.indexOf("// Ctrl/Cmd+Z", pushStart));
  const loadStart = SRC.indexOf("/* ---- load: local first");
  const loadBody = SRC.slice(loadStart, SRC.indexOf("/* Write-through local save", loadStart));

  it("the debounced timer delegates to runCloudPush and reads the gate from REFS (fire time), never the render closure", () => {
    expect(pushStart).toBeGreaterThan(-1);
    const timer = pushBody.slice(pushBody.indexOf("setTimeout("));
    expect(timer).toMatch(/runCloudPush\(\{/);
    expect(timer).toMatch(/readGate: \(\) => \(\{ status: statusRef\.current, diverged: divergedRef\.current \}\)/);
    // the old inline body's unconditional "saving" write must be gone from the timer
    expect(timer.slice(0, timer.indexOf("runCloudPush"))).not.toMatch(/setStatus\("saving"\)/);
  });

  it("the push effect does not even schedule while the hold is set", () => {
    expect(pushBody).toMatch(/if \(divergedRef\.current\) return undefined;/);
  });

  it("every place the load detects divergence latches the hold synchronously, and a fresh load clears it", () => {
    const marks = loadBody.match(/markDiverged\(/g) || [];
    expect(marks.length).toBe(2);
    expect(loadBody).not.toMatch(/setStatus\("diverged"\)/); // only via markDiverged (latch + status together)
    expect(loadBody).toMatch(/divergedRef\.current = false;/);
  });

  it("only the user's resolution handlers release the hold outside a fresh load", () => {
    const releases = SRC.match(/divergedRef\.current = false/g) || [];
    // one in the load effect + one in the shared release used by both resolution buttons
    expect(releases.length).toBe(2);
    expect(SRC).toMatch(/data-testid="model-diverged-keep-device"/);
    expect(SRC).toMatch(/data-testid="model-diverged-use-cloud"/);
  });

  it("the badge reads the shown status (hold outranks), so a later render cannot clear the warning", () => {
    expect(SRC).toMatch(/modelSaveState\(shownStatus, accountActive, cloudConfirmed\)/);
    expect(SRC).toMatch(/const shownStatus = shownModelStatus\(status, diverged\);/);
  });
});
