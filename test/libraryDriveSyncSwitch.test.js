/* Library › folder rail — NEW-5 (2026-10-29): project A's Google Drive sync status showed under project B
 * after a switch. The sync cannot be aborted, so its reports are filtered by project. */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { runDriveSync } from "../src/workspaces/library/lib/driveSyncRun.js";

function rig() {
  let shown = "A";
  const log = []; const remembered = [];
  let release; const gate = new Promise((r) => { release = r; });
  let progress;
  const run = (projectId, result) => runDriveSync({
    projectId, isShown: (id) => id === shown, setDrive: (s) => log.push({ id: projectId, ...s }),
    sync: async (id, { onProgress }) => { progress = onProgress; await gate; return result; },
    now: () => 1000, remember: (id, at) => remembered.push([id, at]),
  });
  return { run, log, remembered, release, getProgress: () => progress, switchTo: (id) => { shown = id; } };
}

describe("runDriveSync", () => {
  it("while the project is shown: syncing → progress → ok", async () => {
    const t = rig(); const p = t.run("A", { ok: true });
    t.getProgress()({ done: 3, total: 12 });
    t.release(); await p;
    expect(t.log.map((l) => l.msg || l.state)).toEqual(["Mirroring to Google Drive…", "Mirroring to Google Drive… 3 of 12", "ok"]);
    expect(t.remembered).toEqual([["A", 1000]]);
  });
  it("progress and a SUCCESS for A after switching to B never reach the screen (but A's confirmation is remembered)", async () => {
    const t = rig(); const p = t.run("A", { ok: true });
    t.switchTo("B");
    t.getProgress()({ done: 3, total: 12 });
    t.release(); await p;
    expect(t.log).toHaveLength(1); // only the "syncing" line shown BEFORE the switch
    expect(t.log[0].id).toBe("A");
    expect(t.remembered).toEqual([["A", 1000]]);
  });
  it("A's error / skipped verdict after the switch is dropped too", async () => {
    for (const result of [{ ok: false, error: "boom" }, { skipped: true }]) {
      const t = rig(); const p = t.run("A", result);
      t.switchTo("B"); t.release(); await p;
      expect(t.log).toHaveLength(1);
      expect(t.remembered).toEqual([]);
    }
  });
  it("a throwing sync is a red status for the shown project, never a stuck 'Mirroring…'", async () => {
    const log = [];
    await runDriveSync({ projectId: "A", isShown: () => true, setDrive: (s) => log.push(s), sync: async () => { throw new Error("net down"); } });
    expect(log[log.length - 1]).toMatchObject({ state: "error", msg: "net down" });
  });
});

describe("wiring (source guards)", () => {
  const src = fs.readFileSync("src/workspaces/library/components/FolderTree.jsx", "utf8");
  it("the rail runs syncs through the tagged runner and clears the pending timer on a project change", () => {
    expect(src).toContain("runDriveSync(");
    expect(src).not.toMatch(/setDrive\(\{ state: "syncing"/);
    expect(src).toMatch(/shownProjectRef\.current = projectId/);
    const eff = src.slice(src.indexOf("expandedLoadedFor.current = null;"), src.indexOf("expandedLoadedFor.current = null;") + 600);
    expect(eff).toContain("clearTimeout(syncTimer.current)");
  });
});
