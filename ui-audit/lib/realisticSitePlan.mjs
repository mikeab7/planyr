/* realisticSitePlan — the "shaped like a real plan" fixture for the editable-PDF site-element export (NEW-1, 2026-10-20).
 *
 * Why it exists: B2326896 / B2352496 passed their own harness on a throwaway plan (one square building, a rectangle, a
 * line) while the owner's real file still came out with every building burned into the page — on a real plan the
 * buildings and their truck courts are ROTATED, and the old pin test compared square bounding boxes. A fixture that
 * cannot show that difference cannot catch it (WRONG-CASE). So this starts from the owner's own Bain plan
 * (ui-audit/fixtures/bain-concept-original.json, his coordinates verbatim: rotated buildings with corner bump-outs,
 * dock doors, truck courts, trailer + car parking, sidewalks, roads incl. a two-road network, a detention pond, five
 * parcels) and adds what the brief lists that his plan lacks: a reference drawing promoted ABOVE the plan (laid over the middle of one
 * car-parking field — the one legitimate pin, so its reason is exercised), a GIS layer switched on, a markup sent BEHIND
 * the plan under a building, a line + cloud markup, a callout, and every measurement kind.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const PNG1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const ST = { stroke: "#dc2626", weight: 2, dash: "solid" };

export function realisticSitePlan(id, { name = "Plan 1", site = "zz realistic export check" } = {}) {
  const src = JSON.parse(readFileSync(join(here, "..", "fixtures", "bain-concept-original.json"), "utf8"));
  const rec = { ...src };
  for (const k of Object.keys(rec)) if (k.startsWith("_")) delete rec[k];
  const els = rec.els;
  const building = els.find((e) => e.id === "e79384lfxyni"); // Building 3: rotated 201°, its truck court overlaps it by bounding box
  const parking = els.find((e) => e.type === "parking" && e.attachedTo === "e79436amgdfs") || els.find((e) => e.type === "parking");
  const pond = els.find((e) => e.type === "pond");
  const pc = pond.points.reduce((a, p) => ({ x: a.x + p.x / pond.points.length, y: a.y + p.y / pond.points.length }), { x: 0, y: 0 });
  const z = (i) => 900000 + i;
  return {
    ...rec, schemaVersion: rec.schemaVersion, id, groupId: id, site, name, updatedAt: Date.now(), status: "active", data: { status: "active" },
    layerOverrides: { ...(rec.layerOverrides || {}), fema: true },
    sheetOverlays: [{ id: "refAbove", name: "Civil sheet (above the plan)", src: PNG1, x: parking.cx - 20, y: parking.cy - 20, imgW: 10, imgH: 10, ftPerPx: 4, rotation: 0, opacity: 0.85, visible: true, locked: false, aboveParcel: true, page: 1 }],
    markups: [
      { id: "mkBehind", kind: "rect", cx: building.cx, cy: building.cy, w: 120, h: 80, rot: 0, ...ST, fill: "#dc2626", fillOpacity: 0.3, behindEls: true, z: z(1), comment: "BEHIND" },
      { id: "mkLine", kind: "line", a: { x: -900, y: 1300 }, b: { x: -500, y: 1420 }, ...ST, z: z(2), comment: "pull this back" },
      { id: "mkCloud", kind: "cloud", pts: [{ x: 600, y: 1250 }, { x: 900, y: 1250 }, { x: 900, y: 1420 }, { x: 600, y: 1420 }], arcFt: 25, ...ST, z: z(3), comment: "revise per RFI 12" },
    ],
    callouts: [{ id: "coLeader", box: { x: 200, y: 1350 }, tip: { x: building.cx, y: building.cy }, text: "Check dock count", z: z(4) }],
    measures: [
      { id: "meArea", mode: "area", pts: [{ x: pc.x - 60, y: pc.y - 40 }, { x: pc.x + 60, y: pc.y - 40 }, { x: pc.x + 50, y: pc.y + 50 }, { x: pc.x - 50, y: pc.y + 50 }], z: z(5) },
      { id: "meLine", mode: "line", pts: [{ x: -950, y: 1150 }, { x: -650, y: 1150 }], z: z(6) },
      { id: "mePoly", mode: "polyline", pts: [{ x: -950, y: 1050 }, { x: -800, y: 1000 }, { x: -650, y: 1060 }], z: z(7) },
      { id: "meCount", mode: "count", pts: [{ x: 300, y: 1450 }, { x: 350, y: 1450 }, { x: 400, y: 1450 }], z: z(8) },
    ],
  };
}

/* The element types the brief lists, as the export's Subjects — every one must come out as an annotation. */
export const REQUIRED_SUBJECTS = ["Building", "Truck court", "Trailer parking", "Car parking", "Sidewalk", "Road", "Detention pond"];
export const PINNED_BY_DESIGN = "refAbove"; // the reference laid over one car-parking field
