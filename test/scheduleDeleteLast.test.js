/* B2429233 — deleting an account's LAST schedule silently did nothing (the embedded app's
 * deleteProject refused to remove the only project; the shell had already closed its confirm).
 * These extract the REAL removal + prune functions from public/sequence/index.html (same pattern as
 * scheduleNoActiveProject.test.js) so the test is red on any build that refuses the last delete. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deleteStillPresent, deleteFailureMessage, DELETE_VERIFY_MS } from "../src/workspaces/scheduler/lib/scheduleDeleteVerify.js";

const SRC = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");
const grab = (startMarker, endMarker) => {
  const a = SRC.indexOf(startMarker);
  if (a < 0) throw new Error("marker not found in public/sequence/index.html: " + startMarker);
  return SRC.slice(a, SRC.indexOf(endMarker, a));
};
const code = [
  grab("function pruneOrphanScheduleRefs(", "// Everything a delete must clean up"),
  grab("function pruneScheduleRefs(", "// The one function every load path runs"),
  grab("function removeScheduleFromDoc(", "// (end removeScheduleFromDoc)"),
].join("\n");
const { removeScheduleFromDoc } = new Function(`${code}\nreturn { removeScheduleFromDoc };`)();

const P = (id, tasks = 3) => ({ id, name: `S${id}`, tasks: Array.from({ length: tasks }, (_, i) => ({ id: i + 1 })) });
const doc = (ids, aPid) => ({
  aPid, nPid: 99, nTid: Object.fromEntries(ids.map((i) => [i, 4])), lastActiveBySite: { siteA: ids[0] },
  projects: Object.fromEntries(ids.map((i) => [i, P(i)])),
});

describe("B2429233 — the last schedule is deletable", () => {
  it("deleting the ONLY schedule empties the document and leaves aPid null, not dangling", () => {
    const out = removeScheduleFromDoc(doc([60], 60), 60);
    expect(out.projects).toEqual({});
    expect(out.aPid).toBeNull();
    expect(out.nTid).toEqual({});
    expect(out.lastActiveBySite).toEqual({});
  });
  it("deleting a non-last schedule keeps the rest and re-points the active one", () => {
    const out = removeScheduleFromDoc(doc([1, 2, 3], 2), 2);
    expect(Object.keys(out.projects)).toEqual(["1", "3"]);
    expect(out.aPid).toBe(1);
    expect(out.nTid).toEqual({ 1: 4, 3: 4 });
  });
  it("deleting a schedule that is not the active one leaves aPid alone", () => {
    expect(removeScheduleFromDoc(doc([1, 2, 3], 3), 1).aPid).toBe(3);
  });
  it("an id that names no schedule is a no-op that returns the same document", () => {
    const d = doc([1, 2], 1);
    expect(removeScheduleFromDoc(d, 77)).toBe(d);
    expect(removeScheduleFromDoc(null, 1)).toBeNull();
  });
  it("source guard: deleteProject no longer refuses the last project, and the context menu offers Delete on it", () => {
    const fn = grab("const deleteProject = useCallback(", "// ── Embedded-mode bridge");
    expect(fn).not.toMatch(/length\s*<=\s*1/);
    expect(fn).toMatch(/removeScheduleFromDoc\(d, id\)/);
    expect(SRC).not.toMatch(/canDelete=\{Object\.keys\(data\.projects\)\.length > 1\}/);
  });
  it("source guard: the cloud soft-delete checks its own result instead of trusting a try/catch", () => {
    const loop = grab("for (const key of Object.keys(scheduleBase)) {", "if (anythingMerged) {");
    expect(loop).toMatch(/\.select\("id"\)/);
    expect(loop).toMatch(/sd\.error/);
    expect(loop).toMatch(/deleteRefused = true/);
    // a refused delete keeps its baseline so the next save retries it
    expect(loop.indexOf("continue;")).toBeLessThan(loop.indexOf("delete scheduleBase[key]"));
  });
});

describe("B2429233 — the shell verifies a delete against the next nav-state", () => {
  it("present until the list stops naming the id", () => {
    expect(deleteStillPresent([{ id: 5 }, { id: 6 }], 6)).toBe(true);
    expect(deleteStillPresent([{ id: 5 }], 6)).toBe(false);
    expect(deleteStillPresent([], 6)).toBe(false);
    expect(deleteStillPresent(null, 6)).toBe(false);
  });
  it("the failure copy names the schedule, with a fallback", () => {
    expect(deleteFailureMessage("Project 60")).toContain("“Project 60”");
    expect(deleteFailureMessage("")).toMatch(/^That schedule/);
    expect(DELETE_VERIFY_MS).toBeGreaterThan(1000);
  });
});
