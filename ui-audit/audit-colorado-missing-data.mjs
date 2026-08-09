/* COLORADO AUDIT — "what does the app say when it does not know?"
 *
 * A PURE-MODULE probe across all nine wired Colorado counties. It is deliberately NOT a pass/fail
 * gate: it is an INSTRUMENT that prints, per county, every answer the Colorado tier produces —
 * state, regime, state-plane zone, capability verdicts, the detention carrier, and the statutory
 * drawdown verdict at three volume states. The whole point of this audit family is that a number
 * computed is not a number SHOWN, so this half answers "what is computed"; the browser half
 * (audit-colorado-surfaces.mjs) answers "what reaches the screen".
 *
 * Run: node ui-audit/audit-colorado-missing-data.mjs
 */
import { siteState } from "../src/workspaces/site-planner/lib/siteRegion.js";
import { coloradoRegimeFor, capabilityFor, CAPABILITIES } from "../src/workspaces/site-planner/lib/coloradoRegions.js";
import { resolveZone, zoneForCounty } from "../src/shared/coordinates/statePlane.js";
import { computeRequiredDetention } from "../src/workspaces/site-planner/lib/detentionRules.js";
import { assessStatutoryDrawdown } from "../src/workspaces/site-planner/lib/drawdownStatute.js";
import { assessDrawdown, allowableReleaseCfs } from "../src/workspaces/site-planner/lib/drawdownTime.js";
import { criteriaFor } from "../src/workspaces/site-planner/lib/detentionCriteria.js";

/* A representative point inside each of the nine target counties, plus the owner's own ground.
 * Coordinates are county-interior, chosen so `siteState` and the zone envelopes both answer
 * without ambiguity. */
const SITES = [
  { key: "weld_johnstown", label: "Johnstown (owner's ground, Weld side)", lat: 40.337, lon: -104.912, county: "co_weld" },
  { key: "larimer_johnstown", label: "Johnstown (Larimer side)", lat: 40.352, lon: -105.012, county: "co_larimer" },
  { key: "adams", label: "Adams", lat: 39.87, lon: -104.34, county: "co_adams" },
  { key: "denver", label: "Denver", lat: 39.74, lon: -104.99, county: "co_denver" },
  { key: "arapahoe", label: "Arapahoe", lat: 39.65, lon: -104.34, county: "co_arapahoe" },
  { key: "larimer", label: "Larimer", lat: 40.63, lon: -105.57, county: "co_larimer" },
  { key: "weld", label: "Weld", lat: 40.50, lon: -104.32, county: "co_weld" },
  { key: "jefferson", label: "Jefferson", lat: 39.52, lon: -105.22, county: "co_jefferson" },
  { key: "elpaso", label: "El Paso", lat: 38.83, lon: -104.56, county: "co_elpaso" },
  { key: "boulder", label: "Boulder", lat: 40.08, lon: -105.37, county: "co_boulder" },
  { key: "broomfield", label: "Broomfield", lat: 39.95, lon: -105.06, county: "co_broomfield" },
  { key: "harris_control", label: "Harris TX (control)", lat: 29.78, lon: -95.8, county: "harris" },
];

const bare = (c) => String(c || "").replace(/^co_/, "");

console.log("\n=== 1. STATE · REGIME · ZONE, per county ===\n");
for (const s of SITES) {
  const st = siteState({ lat: s.lat, lng: s.lon });
  const reg = coloradoRegimeFor(s.county);
  const zone = resolveZone({ state: st, county: bare(s.county), lat: s.lat, lon: s.lon });
  console.log(
    `${s.label.padEnd(36)} state=${String(st).padEnd(5)} regime=${String(reg && reg.id).padEnd(8)} ` +
    `zone=${String(zone && zone.short).padEnd(14)} epsg=${String(zone && zone.epsg).padEnd(6)} ` +
    `via=${String(zone && zone.via).padEnd(8)}${zone && zone.decided ? " DECIDED" : ""}${zone && zone.coarse ? " COARSE" : ""}`,
  );
}

console.log("\n=== 2. CAPABILITY MATRIX, per Colorado county ===\n");
const capIds = Object.keys(CAPABILITIES);
for (const s of SITES.filter((x) => x.key !== "harris_control")) {
  const reg = coloradoRegimeFor(s.county);
  const row = capIds.map((id) => {
    const c = capabilityFor(id, "CO", { regime: reg ? reg.id : null });
    return `${id}=${c.wired === true ? "ON" : c.wired === "partial" ? "PART" : "OFF"}`;
  });
  console.log(`${s.label.padEnd(36)} ${row.join(" · ")}`);
}

console.log("\n=== 3. DETENTION CARRIER, per county (80 ac, 70% impervious) ===\n");
for (const s of SITES) {
  const st = siteState({ lat: s.lat, lng: s.lon });
  const reg = coloradoRegimeFor(s.county);
  const r = computeRequiredDetention({
    acres: 80, impPct: 70, authorityId: st === "CO" ? null : "hcfcd",
    siteState: st, coRegime: reg ? reg.id : null, coDetention: null,
  });
  console.log(`${s.label.padEnd(36)} kind=${String(r.kind).padEnd(12)} req=${String(r.requiredAcFt)} headline=${r.headline || r.basis}`);
}

console.log("\n=== 4. THE DRAWDOWN GATE at three volume states (H2) ===\n");
/* The statute is a PASS/FAIL that needs a VOLUME to evaluate. Three inputs:
 *   (a) no release rate resolved  — the Colorado default, since no CO authority is modeled
 *   (b) release rate present, ZERO stored volume — a site with no ponds drawn
 *   (c) release rate present, a real volume */
const rate = allowableReleaseCfs({ rateCfsPerAc: 0.125, acres: 80 });
const cases = [
  ["no release rate (Colorado default)", assessDrawdown({ ponds: [], siteVolumeCf: 100 * 43560, release: null })],
  ["release set · ZERO stored volume", assessDrawdown({ ponds: [], siteVolumeCf: 0, release: rate })],
  ["release set · no ponds, null volume", assessDrawdown({ ponds: [], siteVolumeCf: null, release: rate })],
  ["release set · 20 ac-ft", assessDrawdown({ ponds: [{ id: "p", name: "Pond", volumeCf: 20 * 43560 }], siteVolumeCf: 20 * 43560, release: rate })],
  ["release set · 400 ac-ft", assessDrawdown({ ponds: [{ id: "p", name: "Pond", volumeCf: 400 * 43560 }], siteVolumeCf: 400 * 43560, release: rate })],
];
for (const [label, dd] of cases) {
  const a = assessStatutoryDrawdown({ state: "CO", drawdown: dd });
  console.log(
    `${label.padEnd(38)} known=${String(dd.known).padEnd(6)} siteHours=${String(dd.site ? dd.site.hours : null).padEnd(10)} ` +
    `→ verdict=${String(a.verdict).padEnd(14)} "${a.headline}"`,
  );
}

console.log("\n=== 5. WHICH CRITERIA RECORD a Colorado site is priced against ===\n");
/* `critJurKey` on a Colorado site resolves through defaultFloodJurForCounty → "generic". Print
 * every value that record hands the pond engines, so a Texas-shaped default is visible. */
const gen = criteriaFor("generic");
for (const k of ["label", "postLePre"]) console.log(`  ${k}: ${JSON.stringify(gen[k])}`);
for (const [k, v] of Object.entries(gen)) {
  if (v && typeof v === "object" && "value" in v) {
    console.log(`  ${k.padEnd(28)} = ${JSON.stringify(v.value)}   verified=${v.verified}   src=${String(v.source).slice(0, 70)}`);
  }
}
console.log(`  requiredStorms = ${JSON.stringify(gen.requiredStorms)}`);

console.log("\n=== 6. CAPABILITY MATRIX PRODUCTION CALL SITES ===\n");
console.log("  (grep for capabilityFor / CO_STATE_FLOOD_STANDARD outside test/ and coloradoRegions.js)");
