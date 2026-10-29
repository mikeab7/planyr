/* DeSoto County MS zoning (B2507058) — the pure half: how a zoning polygon is classed, painted, worded and linked.
 *
 * SOURCE: gis.desotocountyms.gov CountyWebMap/Zoning/MapServer/20 — ONE table holding the zoning of several DeSoto jurisdictions (the unincorporated
 * county AND Olive Branch's own city zoning, whose rezoning cases and Municode ordinance links are in it) with NO jurisdiction field. So the layer is
 * never labelled as one government's zoning: an identify result is labelled by the jurisdiction the SITE falls in, decided by `municipalityAt`
 * (desotoJurisdiction.js) over the county's municipal limits — "Olive Branch" inside the limits, "Unincorporated DeSoto County" outside.
 *
 * Pure: no network, no React, no Leaflet — unit-tested in test/desotoZoning.test.js. */

import { zoneWithName } from "./desotoZoningNames.js";

/* Zone code → class. The codes are DeSoto County's ordinance plus Olive Branch's: A / A-R (agricultural, rural residential), R-x residential, C-1…C-5
 * commercial, M-1…M-3 industrial, PUD planned unit development; anything else (overlays, MU, a typo) is "other" and drawn neutral, never guessed. */
export function zoneClass(code) {
  const z = String(code == null ? "" : code).trim().toUpperCase();
  if (!z) return "other";
  if (/OVERLAY/.test(z)) return "overlay";                 // "R-15 OVERLAY", "HISTORIC DISTRICT OVERLAY", "PUD OVERLAY" — a layer on top of a base zone, never the base zone itself
  if (/^M(-|\s|\d|$)/.test(z)) return "industrial";        // M-1, M-2
  if (/PUD/.test(z)) return "pud";
  if (/^C(-|\s|\d|$)/.test(z) || /^(O|PO|RO|PB|PBP)$/.test(z)) return "commercial"; // commercial + the office / business-park districts (O, PO, RO, PB, PBP)
  if (/^(A-R|AR)\b/.test(z) || /^A(-|\s|$)/.test(z) || /^AG/.test(z)) return "agricultural";
  if (/^(R(-|\s|\d|$)|RM|ER$|MH|SF|MF|TH)/.test(z)) return "residential"; // R-x, RM-x, ER (estate residential)
  return "other";
}

export const ZONE_COLORS = {
  industrial: "#7c3aed", commercial: "#ea580c", residential: "#ca8a04", agricultural: "#4d7c0f", pud: "#0f766e", overlay: "#64748b", other: "#6b7280",
};
export const ZONE_CLASS_LABEL = {
  industrial: "Industrial", commercial: "Commercial / office", residential: "Residential", agricultural: "Agricultural / rural", pud: "Planned unit development", overlay: "Overlay district", other: "Other",
};

/* Layer style (esri-leaflet per-feature style function): a translucent fill in the class colour with a thin outline. The fill is deliberately
 * quiet (zoning is a reference wash under the plan, tier "reference" ≤ 0.55 default opacity; the row's slider scales it). */
export function zoningStyle(props, opacity) {
  const c = ZONE_COLORS[zoneClass(props && props.ZONE)];
  const overlay = zoneClass(props && props.ZONE) === "overlay";
  return { color: c, weight: 1, opacity, fill: true, fillColor: c, fillOpacity: Math.min(overlay ? 0.2 : 0.45, opacity * (overlay ? 0.3 : 0.6)), ...(overlay ? { dashArray: "4 3" } : {}) };
}

/* The one-line tooltip text a zone label prints at the polygon's centre. */
export const zoneLabelText = (code) => { const z = String(code == null ? "" : code).trim(); return z || null; };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/* "Aug 18, 2026" from an Esri epoch-ms number, an ISO-ish string or a Date; null when it is not a date (never "Invalid Date", never 1970). */
export function approvalDate(raw) {
  if (raw == null || raw === "") return null;
  let d;
  if (raw instanceof Date) d = raw;
  else if (typeof raw === "number" || /^\d{9,}$/.test(String(raw).trim())) d = new Date(Number(raw));
  else d = new Date(String(raw));
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  if (d.getTime() <= 0) return null; // epoch zero / negative = an unset Esri date, never "Jan 1, 1970"
  const y = d.getUTCFullYear();
  if (y < 1900 || y > 2100) return null;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${y}`;
}

/* An ordinance field is a link when it is a plain http(s) URL (the county stores Municode links); otherwise it is the ordinance NUMBER as typed.
 * Returns { href, text } | { href: null, text } | null. Never turns arbitrary text into a link. */
export function ordinanceRef(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s || /^(null|none|n\/a|0)$/i.test(s)) return null;
  const m = s.match(/^<a\s[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>$/i);
  const url = m ? m[1].trim() : s;
  if (/^https?:\/\/[^\s]+$/i.test(url)) {
    let host = "";
    try { host = new URL(url).hostname; } catch (_) { return { href: null, text: s }; }
    const municode = /municode\.com$/i.test(host);
    return { href: url, text: municode ? "Zoning ordinance (Municode)" : (m && m[2] ? m[2].trim() : "Ordinance") };
  }
  return { href: null, text: s };
}

/* The rows the click card shows for one zoning polygon, labelled by the jurisdiction the SITE falls in (`jurisdiction`: a name from
 * municipalityAt, "Unincorporated DeSoto County", or null while the municipal limits are still loading — then the row says so rather than guessing). */
export function zoningRows(props, jurisdiction) {
  const p = props || {};
  const rows = [];
  const zone = zoneLabelText(p.ZONE);
  if (zone) rows.push({ label: "Zone", text: zoneWithName(zone, jurisdiction) }); // "M-1 · Light Industrial" when the ordinance name is sourced, else the bare code (B2507063)
  rows.push({ label: "Jurisdiction", text: jurisdiction || "Checking city limits…" });
  const prev = zoneLabelText(p.PREV_ZONE);
  if (prev && prev !== zone) rows.push({ label: "Previously", text: prev });
  const cs = String(p.CASE_NO == null ? "" : p.CASE_NO).trim();
  if (cs && !/^(null|none)$/i.test(cs)) rows.push({ label: "Case", text: cs });
  const dt = approvalDate(p.DATE_APPROVED);
  if (dt) rows.push({ label: "Approved", text: dt });
  const ord = ordinanceRef(p.ORDINANCE);
  if (ord) rows.push({ label: "Ordinance", text: ord.text, ...(ord.href ? { href: ord.href } : {}) });
  const nm = String(p.NAME == null ? "" : p.NAME).trim();
  if (nm && !/^(null|none)$/i.test(nm)) rows.push({ label: "Name", text: nm });
  return rows;
}

/* The click card's title — never claims the layer is one government's. */
export const zoningTitle = (jurisdiction) => (jurisdiction ? `Zoning · ${jurisdiction}` : "Zoning");
