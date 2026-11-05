/* Site plans — NEW-2 (2026-10-29): one save quietly undid another. `updateOverlay` writes every column,
 * and the panel controls built the row from the copy captured when the action STARTED, so a background
 * site link (waiting on a lookup), a debounced opacity write, a rename or an eye toggle wrote the plan's
 * OLD position / rotation / flags back over a change made while it waited. These drive the shared write
 * path with a slow resolver and a fake store that applies writes exactly like the real one (whole row,
 * compare-and-swap on version). */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { writeOverlayPatch, rowBasis } from "../src/shared/sitePlans/lib/overlayPatchWrite.js";
import { createWriteSerializer } from "../src/shared/cloud/writeSerializer.js";

/** A server row + a local list the way SitePlansSection holds them (ref mirror, newest copy first). */
function makeWorld(initial) {
  const server = { ...initial };
  const local = { current: [{ ...initial }] };
  const versions = { [initial.id]: initial.version };
  const writes = [];
  const serialized = createWriteSerializer();
  const updateOverlay = async (id, row) => {
    await Promise.resolve();
    writes.push(row);
    if (row.version !== server.version) return { data: null, conflict: true, error: new Error("conflict") };
    Object.assign(server, row, { version: server.version + 1 }); // overlayToRow writes EVERY column
    return { data: { ...server }, error: null };
  };
  const fetchAll = async () => ({ data: [{ ...server }], error: null });
  const patch = (o, p) => serialized.run(o.id, async () => {
    const res = await writeOverlayPatch({
      id: o.id, captured: o, patch: p,
      getLatest: (id) => local.current.find((x) => x.id === id),
      getVersion: (id) => versions[id], noteVersion: (id, v) => { versions[id] = v; },
      update: updateOverlay, fetchAll,
    });
    if (res.data) { versions[o.id] = res.data.version; local.current = [{ ...res.data }]; }
    return res;
  });
  // A finished drag/rotate: the real commitPlacement applies locally at once, then writes through the same queue.
  const place = (id, placement) => serialized.run(id, async () => {
    local.current = local.current.map((o) => (o.id === id ? { ...o, ...placement } : o));
    await Promise.resolve();
    Object.assign(server, placement, { version: server.version + 1 });
    versions[id] = server.version;
    local.current = local.current.map((o) => (o.id === id ? { ...o, version: server.version } : o));
  });
  return { server, local, patch, place, writes };
}

const PLAN = { id: "p1", version: 3, centerLat: 29.7, centerLon: -95.3, rotationDeg: 0, opacity: 0.85, visible: true, locked: false, docTitle: "Plan", projectId: null };

describe("rowBasis", () => {
  it("lays only the patch over the latest copy, falling back to the captured one", () => {
    expect(rowBasis({ a: 2, b: 2 }, { a: 1, b: 1 }, { b: 9 }, 5)).toEqual({ a: 2, b: 9, version: 5 });
    expect(rowBasis(undefined, { a: 1 }, { b: 9 }, 5)).toEqual({ a: 1, b: 9, version: 5 });
  });
});

describe("a save never undoes another", () => {
  it("background site link that resolves AFTER a rotate keeps the rotation", async () => {
    const w = makeWorld(PLAN);
    const captured = { ...PLAN };                         // the copy the lookup was started with
    const lookup = new Promise((r) => setTimeout(() => r("site-9"), 20)); // the slow resolver
    const link = lookup.then((projectId) => w.patch(captured, { projectId }));
    await w.place("p1", { rotationDeg: 37, centerLat: 29.71 }); // person rotates / moves meanwhile
    await link;
    expect(w.server.projectId).toBe("site-9");
    expect(w.server.rotationDeg).toBe(37);
    expect(w.server.centerLat).toBe(29.71);
  });

  it("delayed opacity write does not undo a same-moment rotation", async () => {
    const w = makeWorld(PLAN);
    const captured = { ...PLAN };
    const op = w.patch(captured, { opacity: 0.4 });
    const rot = w.place("p1", { rotationDeg: 90 });
    await Promise.all([op, rot]);
    expect(w.server.opacity).toBe(0.4);
    expect(w.server.rotationDeg).toBe(90);
  });

  it("a rename right behind an eye toggle keeps the toggle", async () => {
    const w = makeWorld(PLAN);
    const stale = { ...PLAN };                            // both controls rendered from the same copy
    const a = w.patch(stale, { visible: false });
    const b = w.patch(stale, { docTitle: "Renamed" });
    await Promise.all([a, b]);
    expect(w.server.visible).toBe(false);
    expect(w.server.docTitle).toBe("Renamed");
  });

  it("lock then rename keeps the lock; the retry after a conflict re-reads the newest copy", async () => {
    const w = makeWorld(PLAN);
    await w.patch({ ...PLAN }, { locked: true });
    await w.patch({ ...PLAN }, { docTitle: "X" });
    expect(w.server.locked).toBe(true);
    // a foreign bump forces a conflict on the first try; the retry still carries the local move
    w.server.version += 1;
    const r = w.patch({ ...PLAN }, { opacity: 0.5 });
    w.local.current = w.local.current.map((o) => ({ ...o, rotationDeg: 12 }));
    await r;
    expect(w.server.opacity).toBe(0.5);
    expect(w.server.rotationDeg).toBe(12);
  });
});

describe("wiring (source guards)", () => {
  const src = fs.readFileSync("src/shared/sitePlans/components/SitePlansSection.jsx", "utf8");
  it("no panel write builds its row from a captured copy", () => {
    expect(src).not.toMatch(/updateOverlay\([^)]*\{\s*\.\.\.(o|overlay|existing)\b/);
    expect(src).not.toMatch(/\{\s*\.\.\.o,\s*\.\.\.patch/);
  });
  it("every updateOverlay call is the injected dependency of the one write path (none direct)", () => {
    expect(src).toContain("writeOverlayPatch(");
    expect(src.match(/updateOverlay\(/g) || []).toHaveLength(0);
  });
  it("local list changes all go through the synchronous mirror (one setOverlays, inside commitOverlays)", () => {
    expect(src).toContain("const commitOverlays");
    expect(src.match(/\bsetOverlays\(/g) || []).toHaveLength(1);
  });
});
