import { describe, it, expect } from "vitest";
import { ensureFeatureIds } from "../src/workspaces/site-planner/lib/parcelFeatureIds.js";

/* NEW-1 (2026-10-22, work-laptop report) — the half-drawn Epps Mill lot. Rutherford County TN's hosted FeatureServer answers f=geojson
 * with NO top-level `id` (the object id is only in `properties`), so every lot keyed to `undefined` and the Select-parcels layer held ONE
 * lot (`__mapParcelDisplay().held === 1`) over a whole view — a different lot each time. The first fixture is that server's real answer
 * shape, recorded live 2026-10-22 (ParcelsCAMA1, parcel 156-026.00-000). */
const real = () => ({ type: "Feature", geometry: { type: "Polygon", coordinates: [[[-86.318709, 35.723764], [-86.319192, 35.723402], [-86.320761, 35.723555], [-86.321299, 35.723757], [-86.318709, 35.723764]]] }, properties: { OBJECTID: 88324, ParcelID: "156-026.00-000" } });

describe("ensureFeatureIds", () => {
  it("RED PROOF — the pre-fix keying (feature.id) collapses a real answer onto one key; the fix gives every lot its own", () => {
    const answer = [0, 1, 2, 3, 4, 5].map((i) => { const f = real(); f.properties = { OBJECTID: 88324 + i, ParcelID: `156-02${i}.00-000` }; f.geometry.coordinates[0][0][0] += i * 0.001; return f; });
    expect(new Set(answer.map((f) => f.id)).size).toBe(1);   // pre-fix: six lots, ONE key (undefined) — the layer held one lot
    ensureFeatureIds(answer, "OBJECTID");
    expect(new Set(answer.map((f) => f.id)).size).toBe(6);    // post-fix: six lots, six keys
    expect(answer[0].id).toBe(88324);
  });
  it("uses the layer's own id field first, then the usual object-id names", () => {
    const a = real(); a.properties = { FID: 7, OBJECTID: 9 };
    ensureFeatureIds([a], "FID"); expect(a.id).toBe(7);
    const b = real(); b.properties = { FID: 7, X: 1 };
    ensureFeatureIds([b], undefined); expect(b.id).toBe(7);
  });
  it("never overwrites an id the server did send (the usual case is untouched)", () => {
    const a = real(); a.id = 5;
    ensureFeatureIds([a], "OBJECTID"); expect(a.id).toBe(5);
    const z = real(); z.id = 0;                                // 0 is a real id
    ensureFeatureIds([z], "OBJECTID"); expect(z.id).toBe(0);
  });
  it("with no id anywhere it keys on the geometry — stable, distinct per lot, never a shared undefined", () => {
    const a = real(); a.properties = {}; const b = real(); b.properties = {}; b.geometry.coordinates[0][0][0] += 0.01;
    const a2 = real(); a2.properties = {};
    ensureFeatureIds([a, b, a2], undefined);
    expect(a.id).toBeDefined(); expect(a.id).not.toBe(b.id); expect(a.id).toBe(a2.id);
  });
  it("tolerates garbage without throwing", () => {
    expect(ensureFeatureIds(undefined, "OBJECTID")).toBeUndefined();
    expect(() => ensureFeatureIds([null, {}, { geometry: null }], "OBJECTID")).not.toThrow();
  });
});
