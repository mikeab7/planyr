/* THE ONE CLICK CARD FOR COUNTIES & CITIES (NEW-1, owner 2026-11-05: "Click on any shape shows a clean card: city, limits or ETJ, county"). Pure — no React, no Leaflet.
 *
 * The merged row draws up to three layers over the same ground (county lines, city limits, ETJ); a click used to answer with ONE of them (the planner's canvas with none at
 * all). Here every member's answer at the click point is folded into ONE card, so a person clicking Sugar Land ground reads "Sugar Land — city limits · City of Sugar Land,
 * inside the city limits · Fort Bend County" and never has to guess which line they hit. Rules:
 *   • limits outrank ETJ (root constraint #38): where both answer, the city's limits are the answer and the ETJ is not printed;
 *   • a place that is only in an ETJ says so in words ("outside its limits"), never the bare word "ETJ";
 *   • the county always rides along when its layer answered;
 *   • nothing is said about a layer that did not answer (no "unincorporated" off a silence — empty never means zero).
 * A hit is { sourceId, title, name, rows, note, sourceName, highlight } as `vectorOverlay.identifyPayload` returns it. */
import { isCountyLinesId, isCityLimitsId } from "./vectorLayers.js";

export const COUNTIES_CITIES_GROUP = "counties_cities";

/* What a boundary layer's feature IS: { role: "county" | "city" | "etj", word } or null for a layer that is not part of the merged row. */
export function boundaryRoleOf(sourceId) {
  if (isCountyLinesId(sourceId)) return { role: "county", word: "County" };
  if (sourceId === "jur_etj") return { role: "etj", word: "ETJ" };
  if (isCityLimitsId(sourceId)) return { role: "city", word: sourceId === "ny_town" ? "Town" : sourceId === "ny_village" ? "Village" : sourceId === "nj_city" ? "Municipality" : "City" };
  return null;
}

const NARROW = { Village: 0, Town: 1, City: 2, Municipality: 2 }; // the narrowest tier reads first
const placeWords = (word, name) => (word === "Municipality" ? `${name} (municipality)` : `${word} of ${name}`);
const limitsWord = (word) => (word === "Town" ? "town" : word === "Village" ? "village" : word === "Municipality" ? "municipality" : "city");

/* Fold the hits at one point into one card item, or null when none of them is a Counties & Cities answer. */
export function combineJurisdictionHits(hits) {
  const mine = (hits || []).map((h) => ({ h, r: boundaryRoleOf(h && h.sourceId) })).filter((x) => x.r);
  if (!mine.length) return null;
  const places = mine.filter((x) => x.r.role === "city").sort((a, b) => (NARROW[a.r.word] ?? 9) - (NARROW[b.r.word] ?? 9));
  const etjs = mine.filter((x) => x.r.role === "etj");
  const county = mine.find((x) => x.r.role === "county");
  const rows = [];
  if (places.length) {
    rows.push({ label: "Jurisdiction", text: places.map((p) => `${placeWords(p.r.word, p.h.name || p.h.title)} — inside the ${limitsWord(p.r.word)} limits`).join("; ") });
  } else if (etjs.length) {
    const names = etjs.map((e) => placeWords("City", String(e.h.name || e.h.title).replace(/\s+ETJ$/i, "")));
    rows.push({ label: "Jurisdiction", text: etjs.length > 1 ? `In the ETJ of ${names.join(" and ")} — overlapping claims, outside both cities' limits` : `In the ETJ of ${names[0]} — outside its limits` });
  }
  if (county) rows.push({ label: "County", text: county.h.title || county.h.name });
  const primary = (places[0] || etjs[0] || county).h;
  const sources = [...new Set(mine.map((x) => x.h.sourceName).filter(Boolean))];
  return {
    id: COUNTIES_CITIES_GROUP, layerLabel: "Counties & Cities", sourceId: primary.sourceId || null,
    title: primary.title, rows,
    note: primary.note || null, sourceName: sources.length ? sources.join(" · ") : null,
    ...(primary.highlight ? { highlight: primary.highlight } : {}),
  };
}

/* In a list of identify items (layers.identifyOverlaysAt's), replace every Counties & Cities member by ONE combined item at the first member's place. */
export function foldBoundaryItems(items) {
  const members = (items || []).filter((it) => boundaryRoleOf(it && it.sourceId));
  if (members.length < 1) return items || [];
  const combined = combineJurisdictionHits(members);
  if (!combined) return items;
  const out = [];
  let placed = false;
  for (const it of items) {
    if (boundaryRoleOf(it && it.sourceId)) { if (!placed) { out.push({ ...combined, about: members[0].about || null }); placed = true; } continue; }
    out.push(it);
  }
  return out;
}
