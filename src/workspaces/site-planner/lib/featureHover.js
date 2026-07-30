/* Hover wording for the VECTOR feature overlays (NEW-2). Pure — no leaflet, no network.
 *
 * THE GAP THIS CLOSES. Hovering an OSM power feature has always named it, because
 * evidenceLayers.js binds a tooltip as it draws: "Substation (OSM)", "Transmission line (OSM)
 * · 138000 V", "Power pole (OSM)". The esri-leaflet feature overlays — HIFLD transmission
 * lines and substations, EPA cleanups, faults, rail, airports, traffic counts — were built
 * with `interactive: false` and no tooltip at all, so the owner could see a red transmission
 * line crossing the site and had no way to ask what it was. This module supplies the wording
 * for those layers, in the SAME shape as the OSM tooltips so the two paths read identically:
 *
 *     <Title> (<Source>) · <detail> · <detail>
 *
 * REGISTRY-DRIVEN, and deliberately TOLERANT of field names. These are third-party national
 * datasets whose exact attribute casing we cannot probe from here (the sandbox blocks the
 * hosts), so a field is declared as a LIST of candidate names matched case-insensitively —
 * a layer that spells it `VOLTAGE`, `Voltage` or `voltage` all resolve. A candidate that
 * resolves to nothing is simply omitted; a tooltip never shows an empty label.
 *
 * REDACTION IS ABSENCE, not a value. HIFLD withholds attributes as "NOT AVAILABLE", 0, or an
 * anonymised "UNKNOWN12345" name. Those must read as "we don't know", never as a fact — the
 * same rule powerScreen.js already applies to the analysis cards, whose cleaners this reuses
 * so the tooltip and the Site Analysis card can never disagree about a voltage.
 */
import { voltLabel, ownerLabel } from "./powerScreen.js";

/* The dataset sentinels that mean "withheld / not populated". `0` is included because HIFLD
 * uses it for a withheld voltage, and a bare "0" in a tooltip reads as a real measurement. */
const REDACTED = /^(not available|not applicable|unknown|undetermined|none|null|n\/?a|0|-{1,2}|0\.0+)$/i;
const ANON_NAME = /^unknown[\s_-]*\d+$/i;

/* Federal datasets store display text in ALL CAPS — the live HIFLD services return
 * `CENTERPOINT ENERGY HOUSTON ELECTRIC, LLC` and `KATY` (probed 2026-07-29). Shouting that back at
 * the user is worse than it sounds in a one-line tooltip, so an all-caps value is title-cased.
 *
 * Deliberately NOT the naive `titleCaseName` from boundaryLabels.js, which would render "LLC" as
 * "Llc". Corporate suffixes and geographic acronyms stay upper; small connecting words go lower
 * (never in first position). A value that is already mixed-case is a considered spelling and is
 * left exactly as the publisher wrote it. */
const KEEP_UPPER = new Set(["LLC", "L.L.C.", "LP", "L.P.", "LLP", "INC", "INC.", "PLC", "LTD", "LTD.",
  "CO", "CO.", "US", "USA", "TX", "LA", "NM", "OK", "AR", "MUD", "PUD", "ISD", "WCID", "LID", "GLO",
  "TX.", "II", "III", "IV", "NE", "NW", "SE", "SW", "N", "S", "E", "W", "DBA", "RR", "FM", "IH", "SH"]);
const KEEP_LOWER = new Set(["of", "and", "the", "at", "in", "on", "for", "de", "del", "la", "van"]);

export function titleCaseAgency(raw) {
  const s = String(raw == null ? "" : raw).trim();
  // Only reformat SHOUTED text; anything with a lowercase letter is left alone.
  if (!s || /[a-z]/.test(s)) return s;
  return s.split(/(\s+)/).map((tok, i) => {
    if (/^\s+$/.test(tok)) return tok;
    const bare = tok.replace(/[^\w.]/g, "");
    if (KEEP_UPPER.has(bare)) return tok;
    const lower = tok.toLowerCase();
    if (i > 0 && KEEP_LOWER.has(lower.replace(/[^\w]/g, ""))) return lower;
    // Capitalise after a letter boundary so "MC DONALD"/"O'BRIEN"/hyphens read correctly.
    return lower.replace(/(^|[\s'\-/.(])([a-z])/g, (_m, pre, c) => pre + c.toUpperCase());
  }).join("");
}

/* One attribute value, cleaned. Returns "" for absent OR redacted — the caller omits it. */
export function cleanAttr(raw) {
  const s = raw == null ? "" : String(raw).trim();
  if (!s || REDACTED.test(s) || ANON_NAME.test(s)) return "";
  return s;
}

/* Resolve the first of several candidate attribute names, case-insensitively. ArcGIS
 * attribute casing varies between a FeatureServer's own fields and what a republication
 * exposes, so an exact-key lookup is too brittle to rely on. */
export function pickAttr(props, names) {
  if (!props || !names) return null;
  for (const n of names) {
    if (props[n] != null) return props[n];
  }
  const lower = new Map(Object.keys(props).map((key) => [key.toLowerCase(), key]));
  for (const n of names) {
    const hit = lower.get(String(n).toLowerCase());
    if (hit != null && props[hit] != null) return props[hit];
  }
  return null;
}

/* The registry-declarable cleaners. A `hoverFields` entry may name one instead of listing
 * candidate field names, when the honest value needs more than one attribute to compute
 * (a HIFLD voltage falls back from VOLTAGE to the VOLT_CLASS band). */
export const HOVER_CLEANERS = {
  // voltage is a measurement, never title-cased ("220-287 kV" must stay as published).
  voltage: (props) => voltLabel(props || {}),
  owner: (props) => titleCaseAgency(ownerLabel(props || {})),
};

/* A tooltip is chrome, not a report — keep it to one readable line. Anything longer belongs
 * in the click-pinned readout, which has room for rows. */
export const HOVER_MAX_CHARS = 90;

/* The short source tag in the parenthetical. Registry rows carry long provenance strings
 * ("HIFLD (US DOE/NETL)"), which would swamp a one-line tooltip — so a row may declare
 * `hoverSource: "HIFLD"`, and otherwise we take the leading token before any bracket/dash. */
export function sourceTag(cfg = {}) {
  if (cfg.hoverSource) return cfg.hoverSource;
  const s = String(cfg.source || "").trim();
  if (!s) return "";
  return s.split(/\s*[(—–-]/)[0].trim();
}

/* The headline noun. Registry rows label themselves in the PLURAL for the Layers panel
 * ("Transmission lines", "Substations") but a tooltip names ONE feature, so a row declares
 * its singular via `hoverTitle`. Absent that, strip a trailing "s" as a last resort rather
 * than render nothing. */
export function hoverTitle(cfg = {}) {
  if (cfg.hoverTitle) return cfg.hoverTitle;
  const l = String(cfg.label || "").trim();
  if (!l) return "Feature";
  return /[^s]s$/.test(l) ? l.slice(0, -1) : l;
}

/* The ` · `-joined detail segments for one feature. Each `hoverFields` entry is
 * `{ names?: string[], clean?: keyof HOVER_CLEANERS, unit?: string, label?: string }`. */
export function hoverDetails(cfg = {}, props = {}) {
  const out = [];
  for (const f of cfg.hoverFields || []) {
    let text = "";
    if (f.clean && HOVER_CLEANERS[f.clean]) text = HOVER_CLEANERS[f.clean](props) || "";
    else text = titleCaseAgency(cleanAttr(pickAttr(props, f.names || [])));
    if (!text) continue;
    if (f.unit && /^[\d.,]+$/.test(text)) text = `${text} ${f.unit}`;
    out.push(f.label ? `${f.label} ${text}` : text);
  }
  return out;
}

/* The full one-line hover string for a feature on layer `cfg`. Always returns SOMETHING
 * nameable — a feature whose every attribute is withheld still reports what KIND of thing it
 * is and who published it, which is the question the owner actually asked ("I should be able
 * to hover over it and see what it is"). */
export function hoverText(cfg = {}, props = {}) {
  const tag = sourceTag(cfg);
  const head = tag ? `${hoverTitle(cfg)} (${tag})` : hoverTitle(cfg);
  const bits = hoverDetails(cfg, props);
  let s = bits.length ? `${head} · ${bits.join(" · ")}` : head;
  if (s.length > HOVER_MAX_CHARS) s = s.slice(0, HOVER_MAX_CHARS - 1).trimEnd() + "…";
  return s;
}

/* Does this layer opt into vector hover identify? Registry-gated (`hoverIdentify`) rather
 * than blanket-on: a layer that BLANKETS the view (county / city / ETJ / ISD polygons) would
 * put a tooltip under every idle cursor position, which is noise rather than an answer — the
 * same judgement `canvasIdentify` already makes for the click card. */
export const hoverIdentifyEnabled = (cfg) => !!(cfg && cfg.hoverIdentify);
