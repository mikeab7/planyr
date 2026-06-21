/* STRESS TEST (different angle) — DURABILITY of a marked-up review across save +
 * restore. Angle 1 proved the tool behaves in-session; this proves the work SURVIVES
 * the trip to storage and back — the thing a developer actually cares about: the
 * measured acreage is still there after a refresh.
 *
 * The markup work layer is mirrored to localStorage as JSON (reviewStore.writeDraft)
 * and a refresh restores it (readDraft), preferring whichever copy is newer
 * (reconcile). This suite hammers that path with realistic-but-extreme work layers
 * (hundreds of markups, full-precision floats, unicode text notes, huge count groups)
 * and asserts a lossless round-trip, plus reconcile's "newest wins" rule across the
 * edge cases (missing timestamps, cloud-only, draft-only, exact ties).
 *
 * Pure-node test env has no DOM, so we install a minimal in-memory localStorage. */
import { describe, it, expect, beforeEach } from "vitest";

// In-memory localStorage stub — installed BEFORE importing the store module so its
// try/catch writes/reads actually persist here. (Top-level runs after ESM imports,
// but writeDraft/readDraft only touch localStorage when called, so this is in time.)
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
};

const { writeDraft, readDraft, clearDraft, reconcile } = await import("../src/workspaces/doc-review/lib/reviewStore.js");

function makeRng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

// Build a realistic, extreme single-sheet review work layer.
function bigReview(rand, id = "rv-stress") {
  const kinds = ["distance", "perimeter", "area", "count", "rect", "cloud", "text"];
  const markups = [];
  for (let i = 0; i < 600; i++) {
    const kind = kinds[i % kinds.length];
    const n = kind === "count" ? 1 + Math.floor(rand() * 40) : kind === "area" || kind === "perimeter" ? 3 + Math.floor(rand() * 8) : 2;
    const pts = [];
    for (let k = 0; k < n; k++) pts.push({ x: (rand() - 0.5) * 1e6, y: (rand() - 0.5) * 1e6 }); // full-precision floats
    const m = { id: `m${i}`, page: 1 + (i % 4), kind, pts };
    if (kind === "text") m.text = `Note ${i} — survey ✓ 38'-7" • π≈3.14159 — 中文 — 📏`; // unicode + emoji + quotes
    markups.push(m);
  }
  return {
    id, kind: "single", title: "Stress - ALTA - 2026.06.21",
    project: "Katy Logistics", discipline: "Survey",
    calByPage: { 1: 12.3456789, 2: 1 / 12, 3: 240, 4: 0 }, // incl. an uncalibrated page
    calInfo: { 1: { src: "manual", label: "1\" = 100'" }, 2: { src: "auto", label: "scale from sheet" } },
    markups,
    updatedAt: Date.now(),
  };
}

beforeEach(() => mem.clear());

describe("markup work layer survives the localStorage mirror round-trip", () => {
  it("restores a 600-markup review byte-for-byte (precision, unicode, structure)", () => {
    const rand = makeRng(1);
    const snap = bigReview(rand);
    writeDraft("anon", snap);                 // logged-out path uses the "anon" bucket
    const back = readDraft("anon", snap.id);

    expect(back).toBeTruthy();
    // The mirror adds a _localAt stamp; everything else must be identical.
    const { _localAt, ...restored } = back;
    expect(typeof _localAt).toBe("number");
    expect(restored).toEqual(snap);           // deep, exact — no dropped fields, no precision loss
    expect(restored.markups.length).toBe(600);
    // Spot-check the hostile bits explicitly.
    const txt = restored.markups.find((m) => m.kind === "text");
    expect(txt.text).toContain("中文");
    expect(txt.text).toContain("38'-7\"");
    expect(txt.text).toContain("📏");
  });

  it("preserves exact double precision on coordinates and calibration", () => {
    const snap = {
      id: "rv-prec", markups: [{ id: "m", page: 1, kind: "distance", pts: [{ x: 0.1 + 0.2, y: 1 / 3 }, { x: Math.PI, y: Number.MAX_SAFE_INTEGER }] }],
      calByPage: { 1: 0.000123456789012345 }, updatedAt: 5,
    };
    const { _localAt, ...back } = readDraft("anon", (writeDraft("anon", snap), snap.id));
    expect(back.markups[0].pts[0].x).toBe(0.30000000000000004); // 0.1+0.2, not rounded
    expect(back.markups[0].pts[0].y).toBe(1 / 3);
    expect(back.markups[0].pts[1].y).toBe(Number.MAX_SAFE_INTEGER);
    expect(back.calByPage[1]).toBe(0.000123456789012345);
  });

  it("is idempotent — re-writing the restored snapshot yields the same payload", () => {
    const rand = makeRng(2);
    const snap = bigReview(rand, "rv-idem");
    writeDraft("anon", snap);
    const a = readDraft("anon", "rv-idem");
    const { _localAt: _a, ...aBody } = a;
    writeDraft("anon", aBody);
    const b = readDraft("anon", "rv-idem");
    const { _localAt: _b, ...bBody } = b;
    expect(bBody).toEqual(aBody);
  });

  it("DOCUMENTS the corruption hazard: a non-finite coordinate would save as null", () => {
    // This is WHY the viewport hardening matters — JSON can't represent NaN/Infinity,
    // so if a bad gesture ever produced one, the mirror would silently drop it to null.
    // (viewportRobustness.test.js proves the transform can no longer emit such a value.)
    const snap = { id: "rv-nan", markups: [{ id: "m", page: 1, kind: "distance", pts: [{ x: NaN, y: Infinity }, { x: 1, y: 2 }] }], updatedAt: 1 };
    writeDraft("anon", snap);
    const back = readDraft("anon", "rv-nan");
    expect(back.markups[0].pts[0].x).toBeNull();   // NaN -> null (the silent loss we prevent upstream)
    expect(back.markups[0].pts[0].y).toBeNull();   // Infinity -> null
  });

  it("clearDraft removes the mirror", () => {
    writeDraft("anon", { id: "rv-del", markups: [], updatedAt: 1 });
    expect(readDraft("anon", "rv-del")).toBeTruthy();
    clearDraft("anon", "rv-del");
    expect(readDraft("anon", "rv-del")).toBeNull();
  });

  it("write/read are keyed by uid AND id (no cross-bleak between users or reviews)", () => {
    writeDraft("anon", { id: "rvA", markups: [{ id: "a" }], updatedAt: 1 });
    writeDraft("user-123", { id: "rvA", markups: [{ id: "b" }], updatedAt: 1 });
    expect(readDraft("anon", "rvA").markups[0].id).toBe("a");
    expect(readDraft("user-123", "rvA").markups[0].id).toBe("b");
    expect(readDraft("anon", "rvB")).toBeNull();
  });
});

describe("reconcile picks the right copy (refresh-after-edit safety)", () => {
  const mk = (at, localAt) => ({ id: "r", marker: localAt ? "draft" : "cloud", updatedAt: at, ...(localAt ? { _localAt: localAt } : {}) });

  it("prefers a draft strictly newer than the cloud copy", () => {
    const cloud = { id: "r", marker: "cloud", updatedAt: 1000 };
    const draft = { id: "r", marker: "draft", updatedAt: 1000, _localAt: 2000 };
    expect(reconcile(cloud, draft).marker).toBe("draft");
  });

  it("keeps the cloud copy when it is newer or tied", () => {
    const cloud = { id: "r", marker: "cloud", updatedAt: 5000 };
    const draft = { id: "r", marker: "draft", updatedAt: 0, _localAt: 5000 }; // tie → cloud wins
    expect(reconcile(cloud, draft).marker).toBe("cloud");
    const olderDraft = { id: "r", marker: "draft", updatedAt: 0, _localAt: 4000 };
    expect(reconcile(cloud, olderDraft).marker).toBe("cloud");
  });

  it("handles cloud-only, draft-only, and missing timestamps", () => {
    const cloud = { id: "r", marker: "cloud", updatedAt: 1000 };
    const draft = { id: "r", marker: "draft", updatedAt: 0, _localAt: 9999 };
    expect(reconcile(cloud, null).marker).toBe("cloud");      // no draft
    expect(reconcile(null, draft).marker).toBe("draft");      // first-ever local edit, never synced
    expect(reconcile(null, null)).toBeNull();
    // A draft with no _localAt stamp must not beat a real cloud timestamp.
    expect(reconcile(cloud, { id: "r", marker: "draft" }).marker).toBe("cloud");
  });

  it("fuzz: reconcile always returns one of its two inputs and never a newer-than-both", () => {
    const rand = makeRng(99);
    for (let i = 0; i < 5000; i++) {
      const cloud = rand() < 0.2 ? null : { id: "r", k: "cloud", updatedAt: Math.floor(rand() * 1e6) };
      const draft = rand() < 0.2 ? null : { id: "r", k: "draft", updatedAt: 0, _localAt: Math.floor(rand() * 1e6) };
      const out = reconcile(cloud, draft);
      if (!cloud && !draft) { expect(out).toBeNull(); continue; }
      expect(out === cloud || out === draft).toBe(true);
      if (cloud && draft) {
        const cAt = cloud.updatedAt, dAt = draft._localAt || 0;
        expect(out.k).toBe(dAt > cAt ? "draft" : "cloud");   // strictly-newer draft wins, else cloud
      }
    }
  });
});
