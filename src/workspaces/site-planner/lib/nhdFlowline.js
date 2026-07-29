/* USGS NHD hydrography decoding (NEW-4 / B1072) — pure.
 *
 * WHY this exists: NHD reports what a channel IS as a bare integer (`ftype` 336,
 * `fcode` 33600). A popup that shows "336" teaches the user nothing; a popup that says
 * "canal / ditch" answers the question they actually asked ("what IS that thing next to
 * my site?"). This module is the one crosswalk, so the map popup, the drainage readout
 * and any future export all read the same plain English.
 *
 * HONESTY RULE: NHD is an INVENTORY, not an engineering product. It says a channel is
 * there and roughly what kind — never how big, how deep, or what it can carry. Every
 * consumer surfaces NHD_INVENTORY_NOTE alongside the decoded name; nothing here may be
 * phrased as a capacity, a regulatory line, or a design basis.
 *
 * Codes are the published NHDFlowline / NHDWaterbody FType domain (USGS NHD data model).
 * An unknown code is reported honestly as its number, never guessed into a nearby class.
 */

/* NHD FType → plain English. Covers the flowline + waterbody classes that actually occur
 * on Gulf-coast industrial sites; anything else falls through to the honest numeric form. */
export const NHD_FTYPE = {
  // ---- flowline classes ----
  334: "connector",
  336: "canal / ditch",
  420: "underground conduit",
  428: "pipeline",
  460: "stream / river",
  558: "artificial path",
  566: "coastline",
  // ---- waterbody classes ----
  361: "playa",
  378: "ice mass",
  390: "lake / pond",
  436: "reservoir",
  466: "swamp / marsh",
  493: "estuary",
};

/* The standing caveat every NHD readout carries. One string so the map popup and any
 * panel copy can never drift into implying more than an inventory. */
export const NHD_INVENTORY_NOTE =
  "USGS national hydrography — an inventory of where water runs, not a regulatory floodplain " +
  "or an engineered channel capacity.";

/* Decode an NHD ftype to plain English. Unknown → "type 999" (honest, never guessed);
 * null/undefined/non-numeric → null so the caller can omit the row entirely. Pure. */
export function ftypeLabel(ftype) {
  if (ftype == null || ftype === "") return null;
  const n = Number(ftype);
  if (!Number.isFinite(n)) return null;
  return NHD_FTYPE[n] || `type ${n}`;
}

/* A feature's display name: its GNIS name when the USGS has one, else the decoded ftype,
 * else a last-resort generic. Never returns an empty string. Pure. */
export function flowlineTitle(props = {}) {
  const name = props.gnis_name || props.GNIS_NAME || props.name;
  if (name != null && String(name).trim() !== "") return String(name).trim();
  return ftypeLabel(props.ftype ?? props.FTYPE) || "Watercourse";
}

/* One-line summary for a readout: "Willow Fork (stream / river)" · "canal / ditch".
 * Never duplicates the class when the name IS the class. Pure. */
export function flowlineSummary(props = {}) {
  const title = flowlineTitle(props);
  const kind = ftypeLabel(props.ftype ?? props.FTYPE);
  if (!kind || kind.toLowerCase() === title.toLowerCase()) return title;
  return `${title} (${kind})`;
}
