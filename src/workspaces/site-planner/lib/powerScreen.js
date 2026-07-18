/* Power screening — public-data screening PHASE 5.
 * Pure. Turns HIFLD electric features near the parcel into two screening findings:
 *
 *   • TRANSMISSION lines (polyline): a line crossing the footprint is a real constraint —
 *     a transmission easement you can't build under (and towers/guy-wires eat usable area).
 *     A line merely near the site is context. `summarizeTransmission` flags the crossing.
 *   • SUBSTATIONS (points): distance to the nearest is a SERVICE / interconnect proxy —
 *     heavy-power industrial users want to be near one. `summarizeSubstations` reports the
 *     nearest distance as an INFO fact (neither a good nor bad constraint), never a flag.
 *
 * Screening only — HIFLD is a redacted national dataset (many substation NAMEs are
 * anonymized "UNKNOWN…" and voltages are 0 where withheld), and line routes are schematic.
 * The utility and a survey are the authoritative check.
 */
import { fmtDistFt } from "./proximityScreen.js";

// A transmission feature's voltage label: the numeric kV if the dataset carries a real one,
// else the VOLT_CLASS band string, else nothing. HIFLD withholds voltage as 0 / a big-negative
// sentinel / "NOT AVAILABLE" on redacted lines — never render those as a number. Pure.
export function voltLabel(attrs = {}) {
  const kv = Number(attrs.VOLTAGE);
  if (Number.isFinite(kv) && kv > 0) return `${Math.round(kv)} kV`;
  const cls = String(attrs.VOLT_CLASS || "").trim();
  if (cls && !/^not available$/i.test(cls)) return cls.includes("kV") ? cls : `${cls} kV`;
  return "";
}

// A transmission owner label (utility name), cleaned of the dataset's "NOT AVAILABLE". Pure.
export function ownerLabel(attrs = {}) {
  const o = String(attrs.OWNER || "").trim();
  return o && !/^not available$/i.test(o) ? o : "";
}

// A substation display name: HIFLD anonymizes many as "UNKNOWN#####" and blanks others —
// show a clean "unnamed substation" rather than a redaction code. Pure.
export function subName(attrs = {}) {
  const n = String(attrs.NAME || "").trim();
  if (!n || /^unknown/i.test(n) || /^not available$/i.test(n)) return "unnamed substation";
  return n;
}

/* Summarize the transmission lines the proximity screen returned (`scr` = screenProximity
 * result over polyline features). A line CROSSING the footprint (nearest ≈ 0 ft) is a present
 * constraint — a transmission easement; lines only NEAR the site are info context. Returns
 * { status, summary, detail }. Pure. */
export function summarizeTransmission(scr, { total = null, bufferMi = 0.25 } = {}) {
  const ranked = (scr && scr.ranked) || [];
  const n = total != null ? total : ranked.length;
  if (n === 0) return { status: "absent", summary: null, detail: [] }; // caller supplies absentLabel

  const crossing = ranked.filter((f) => f.distFt != null && f.distFt <= 25);
  // Headline voltage = the biggest line in the sample (the most constraining one).
  let topKv = 0, topLabel = "";
  for (const f of ranked) {
    const kv = Number(f.attrs.VOLTAGE);
    if (Number.isFinite(kv) && kv > topKv) { topKv = kv; topLabel = voltLabel(f.attrs); }
  }
  const near = scr.nearest;
  const nearOwner = near ? ownerLabel(near.attrs) : "";
  const nearVolt = near ? voltLabel(near.attrs) : "";
  const who = [nearOwner, nearVolt].filter(Boolean).join(" · ");

  let status, summary;
  if (crossing.length) {
    status = "present";
    summary = `${crossing.length} transmission line${crossing.length === 1 ? "" : "s"} cross${crossing.length === 1 ? "es" : ""} the site` +
      (topLabel ? ` (up to ${topLabel})` : "") + " — ⚑ likely a transmission easement (no building under it)";
  } else {
    status = "info";
    summary = `${n} transmission line${n === 1 ? "" : "s"} within ${bufferMi} mi` +
      (near ? ` — nearest ${fmtDistFt(near.distFt)}${who ? ": " + who : ""}` : "");
  }

  const detail = ranked.slice(0, 6).map((f) => {
    const who2 = [ownerLabel(f.attrs), voltLabel(f.attrs)].filter(Boolean).join(" · ") || "transmission line";
    const dist = f.distFt != null && f.distFt <= 25 ? "crosses the site" : fmtDistFt(f.distFt);
    return `${who2}${dist ? " · " + dist : ""}`;
  });
  return { status, summary, detail };
}

/* Summarize the substations the proximity screen returned (`scr` over point features). The
 * value here is the NEAREST distance as a service / interconnect proxy — an INFO fact, not a
 * constraint (a nearby substation is generally an advantage for a heavy-power user). None
 * within the buffer is itself informative (far from grid infrastructure). Returns
 * { status, summary, detail }. Pure. */
export function summarizeSubstations(scr, { total = null, bufferMi = 3 } = {}) {
  const ranked = (scr && scr.ranked) || [];
  const n = total != null ? total : ranked.length;
  if (n === 0) {
    return {
      status: "info",
      summary: `No mapped electric substation within ${bufferMi} mi — farther from grid infrastructure (screening only).`,
      detail: [],
    };
  }
  const near = scr.nearest;
  const nearVolt = near ? voltLabel(near.attrs) : "";
  const summary = `Nearest electric substation ${fmtDistFt(near.distFt)}` +
    (near ? `: ${subName(near.attrs)}${nearVolt ? " (" + nearVolt + ")" : ""}` : "") +
    ` · ${n} within ${bufferMi} mi`;
  const detail = ranked.slice(0, 6).map((f) => {
    const v = voltLabel(f.attrs);
    return `${subName(f.attrs)}${v ? " · " + v : ""} · ${fmtDistFt(f.distFt)}`;
  });
  return { status: "info", summary, detail };
}
