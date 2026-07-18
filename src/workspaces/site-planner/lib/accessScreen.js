/* Access-tier screening — public-data screening PHASE 6.
 * Pure. Turns three "how good is the access here" public datasets near the parcel into
 * screening findings — all INFO facts (context for a deal), not pass/fail constraints:
 *
 *   • TRAFFIC (TxDOT AADT points): the average daily traffic on the nearest counted road —
 *     an access / visibility proxy. `summarizeAadt`.
 *   • RAIL (BTS/FRA rail lines): distance to the nearest rail line + its owner — a rail
 *     line adjacent or crossing the site is a potential rail-served siding (an industrial
 *     plus). `summarizeRail`.
 *   • AIRPORTS (FAA airports): distance to the nearest airport — a PROXY for FAA Part 77
 *     height-restriction surfaces (a site close to a public-use airport may fall under Part
 *     77 imaginary surfaces that cap structure height, and can require an FAA Form 7460
 *     determination). `summarizeAirports`. This is a proximity PROXY, not the computed
 *     Part 77 surfaces — a real determination needs the airport's runway geometry + an FAA study.
 *
 * Screening only — every finding carries its own caveat; none is a legal/engineering
 * determination.
 */
import { fmtDistFt } from "./proximityScreen.js";

// A railroad reporting-mark → the plain carrier name (Houston-area + Class-I marks). The
// BTS RROWNER1 field is a terse reporting mark ("UP", "PTRA"); expand the common ones and
// fall back to the raw mark. Pure.
const RR_NAMES = {
  UP: "Union Pacific", UPRR: "Union Pacific",
  BNSF: "BNSF Railway",
  KCS: "Kansas City Southern", KCSM: "KCS de México",
  NS: "Norfolk Southern", CSXT: "CSX Transportation",
  CN: "Canadian National", CP: "Canadian Pacific", CPKC: "CPKC",
  PTRA: "Port Terminal Railroad Association", HBT: "Houston Belt & Terminal",
  TXPF: "Texas Pacifico", TNMR: "Texas & Northern",
};
export function railroadName(mark) {
  const m = String(mark == null ? "" : mark).trim().toUpperCase();
  if (!m) return "";
  return RR_NAMES[m] || m;
}

// FAA airport TYPE_CODE → a plain label. AD = airport, HP = heliport, others rare. Pure.
export function airportTypeLabel(code) {
  const c = String(code == null ? "" : code).trim().toUpperCase();
  if (c === "AD") return "airport";
  if (c === "HP") return "heliport";
  if (c === "SP") return "seaplane base";
  if (c === "GL") return "glider port";
  if (c === "BA") return "balloonport";
  if (c === "UL") return "ultralight";
  return "airfield";
}
const isRunwayAirport = (attrs) => String(attrs && attrs.TYPE_CODE || "").trim().toUpperCase() === "AD";

/* Traffic (TxDOT AADT) — the average daily traffic on the nearest counted road, an access /
 * visibility proxy. Info fact. `scr` = screenProximity over the AADT points. Pure. */
export function summarizeAadt(scr, { total = null, bufferMi = 0.5 } = {}) {
  const ranked = (scr && scr.ranked) || [];
  const n = total != null ? total : ranked.length;
  if (n === 0) {
    return { status: "info", summary: `No TxDOT traffic-count station within ${bufferMi} mi of the site.`, detail: [] };
  }
  const near = scr.nearest;
  const aadt = near && near.attrs.AADT_PRELIM != null ? Number(near.attrs.AADT_PRELIM) : null;
  const road = near ? String(near.attrs.Located_On || "").trim() : "";
  const roadLabel = road && road !== "-" ? road : "the nearest counted road";
  const aadtStr = aadt != null && Number.isFinite(aadt) ? `~${aadt.toLocaleString("en-US")} vehicles/day` : "count unavailable";
  const summary = `Nearest traffic count ${fmtDistFt(near.distFt)}: ${aadtStr} on ${roadLabel}`;
  const detail = ranked.slice(0, 6).map((f) => {
    const a = f.attrs.AADT_PRELIM != null ? Number(f.attrs.AADT_PRELIM) : null;
    const r = String(f.attrs.Located_On || "").trim();
    const rl = r && r !== "-" ? r : "counted road";
    return `${rl} · ${a != null && Number.isFinite(a) ? "~" + a.toLocaleString("en-US") + "/day" : "n/a"} · ${fmtDistFt(f.distFt)}`;
  });
  return { status: "info", summary, detail };
}

/* Rail access (BTS/FRA rail lines) — distance to the nearest rail line + its owner. A line
 * crossing or adjacent to the site is a potential rail-served siding (industrial plus). Info
 * fact. `scr` = screenProximity over the rail polylines. Pure. */
export function summarizeRail(scr, { total = null, bufferMi = 0.5 } = {}) {
  const ranked = (scr && scr.ranked) || [];
  const n = total != null ? total : ranked.length;
  if (n === 0) {
    return { status: "info", summary: `No rail line within ${bufferMi} mi — not a rail-served location (screening only).`, detail: [] };
  }
  const near = scr.nearest;
  const owner = near ? railroadName(near.attrs.RROWNER1) : "";
  const onSite = near && near.distFt != null && near.distFt <= 25;
  const where = onSite ? "crosses/abuts the site" : `nearest ${fmtDistFt(near.distFt)}`;
  const summary = `Rail line ${where}${owner ? `: ${owner}` : ""}` +
    (onSite ? " — potential rail-served siding (confirm with the railroad)" : "");
  const detail = ranked.slice(0, 6).map((f) => {
    const o = railroadName(f.attrs.RROWNER1) || "rail line";
    const d = f.distFt != null && f.distFt <= 25 ? "crosses/abuts the site" : fmtDistFt(f.distFt);
    return `${o}${d ? " · " + d : ""}`;
  });
  return { status: "info", summary, detail };
}

/* Airport proximity (FAA airports) — distance to the nearest airport as a PROXY for FAA Part
 * 77 height-restriction surfaces. Raises a Part 77 CAUTION when a public-use airport (an
 * AD-type, runway airport) is within the caution radius. Info fact (a caution, never a hard
 * constraint). `scr` = screenProximity over the airport points. Pure. */
export function summarizeAirports(scr, { total = null, bufferMi = 3, cautionFt = 10560 } = {}) {
  const ranked = (scr && scr.ranked) || [];
  const n = total != null ? total : ranked.length;
  if (n === 0) {
    return { status: "info", summary: `No airport within ${bufferMi} mi — outside the likely FAA Part 77 neighborhood (screening only).`, detail: [] };
  }
  // Headline on the nearest RUNWAY airport if any (the Part 77 concern), else the nearest of any type.
  const runwayNearest = ranked.find((f) => isRunwayAirport(f.attrs));
  const head = runwayNearest || scr.nearest;
  const name = head ? String(head.attrs.NAME || head.attrs.IDENT || "unnamed").trim() : "";
  const kind = head ? airportTypeLabel(head.attrs.TYPE_CODE) : "airfield";
  const caution = runwayNearest && runwayNearest.distFt != null && runwayNearest.distFt <= cautionFt;
  let summary = `Nearest ${kind} ${fmtDistFt(head.distFt)}: ${name}`;
  if (caution) summary += ` — ⚑ may fall under FAA Part 77 height-restriction surfaces (an FAA Form 7460 determination may be required)`;
  const detail = ranked.slice(0, 6).map((f) => {
    const nm = String(f.attrs.NAME || f.attrs.IDENT || "unnamed").trim();
    return `${nm} (${airportTypeLabel(f.attrs.TYPE_CODE)}) · ${fmtDistFt(f.distFt)}`;
  });
  return { status: "info", summary, detail };
}
