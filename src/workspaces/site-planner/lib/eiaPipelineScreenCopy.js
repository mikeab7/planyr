/* NEW-1 (FL/GA pipelines) — the WORDS and the COMBINER of the FL/GA pipeline screen, split off
 * `eiaPipelineScreen.js` so they load only when a site is positively in FL/GA (or another non-Texas
 * state) — see that module's header for the rule this enforces and for why nothing here may ever
 * return "absent". Pure. Node-testable. */
import { EIA_BUFFER_MI } from "./eiaPipelineScreen.js";

export const STATE_NAME = { TX: "Texas", CO: "Colorado", FL: "Florida", GA: "Georgia" };

/* One-call locate service per state — named, because "call 811" is the national number but the
 * ticket is opened with the state's own one-call centre. */
const ONE_CALL = {
  FL: "Sunshine 811 (call 811 or sunshine811.com)",
  GA: "Georgia 811 (call 811 or georgia811.com)",
};

/* The real site-level checks that replace the answer this data cannot give. Ordered by how
 * authoritative each is for an easement. Pure. */
export function siteCheckPointers(state) {
  const st = String(state || "").toUpperCase();
  return [
    "Title commitment — Schedule B lists recorded pipeline easements.",
    "ALTA survey — locates recorded easements and visible pipeline markers on the ground.",
    `811 locate — ${ONE_CALL[st] || "call 811"}; the operator marks buried lines before anyone digs.`,
  ];
}

/* The short "go do the real check" tail for a summary line. */
export function pointerLine(state) {
  const st = String(state || "").toUpperCase();
  const oneCall = st === "FL" ? "Sunshine 811" : st === "GA" ? "Georgia 811" : "811";
  return `Check the title commitment, an ALTA survey and ${oneCall}.`;
}

const APPROX_CAVEAT =
  "APPROXIMATE. EIA publishes major transmission lines only — no local gas distribution mains, and gathering " +
  "lines are not reliably mapped — and the geometry is schematic (a line can be miles from where the pipe " +
  "actually runs). A nearby line is worth chasing; an empty result proves nothing. PHMSA's complete pipeline " +
  "map is restricted to government officials and operators.";

const finite = (n) => (Number.isFinite(n) ? n : null);
const uniq = (a) => [...new Set(a.filter(Boolean))];
const listOf = (names) => names.length <= 1 ? (names[0] || "") : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];

/* Fold the four per-commodity proximity findings into ONE panel finding.
 *   parts: [{ commodity: <EIA_COMMODITIES row>, finding: <analyzeProximitySource result> }]
 *   ctx:   { state }
 * Never returns status "absent". Pure. */
export function combineEiaFindings(parts, { state } = {}) {
  const list = (parts || []).filter((p) => p && p.finding);
  const hits = list.filter((p) => p.finding.status === "present");
  const failed = list.filter((p) => p.finding.status === "unavailable" || p.finding.error);
  const stName = STATE_NAME[String(state || "").toUpperCase()] || "this state";
  const ts = list.map((p) => finite(p.finding.ts)).filter((t) => t != null);
  const ages = list.map((p) => finite(p.finding.ageMs)).filter((t) => t != null);
  const base = {
    id: "pipelines",
    category: "Pipelines",
    label: "Pipelines (approximate — EIA, major transmission only)",
    rows: null,
    sourceName: "US Energy Information Administration (EIA) — via Esri U.S. Federal Datasets",
    ageMs: ages.length ? Math.max(...ages) : null,
    ts: ts.length ? Math.min(...ts) : null,
    stale: list.some((p) => p.finding.stale),
    refreshError: (list.find((p) => p.finding.refreshError) || {}).refreshError || null,
    verified: false, // never a trustworthy "none found" — see the header
    approximate: true,
    mapLayer: null,
  };

  if (hits.length) {
    const names = uniq(hits.map((p) => p.commodity.name.toLowerCase()));
    const total = hits.reduce((n, p) => n + (Number(p.finding.total) || 1), 0);
    const detail = [];
    for (const p of hits) {
      const first = (p.finding.summary || "").trim();
      if (first) detail.push(`${p.commodity.name}: ${first}`);
      for (const d of p.finding.detail || []) detail.push(`${p.commodity.name} · ${d}`);
    }
    if (failed.length) detail.push(`⚠ ${listOf(failed.map((p) => p.commodity.name.toLowerCase()))} didn't load — not a clear result. Retry.`);
    detail.push(...siteCheckPointers(state));
    return {
      ...base,
      status: "present",
      summary: `Approximate — ${hits.length > 1 || total > 1 ? "mapped lines" : "a mapped line"} within ${EIA_BUFFER_MI} mi: ${listOf(names)}. ${pointerLine(state)}`,
      detail,
      error: null,
      caveat: APPROX_CAVEAT,
      mapLayer: hits[0].commodity.mapLayer,
    };
  }

  if (failed.length || !list.length) {
    const which = failed.length ? listOf(failed.map((p) => p.commodity.name.toLowerCase())) : "the EIA pipeline layers";
    return {
      ...base,
      status: "unavailable",
      summary: null,
      detail: siteCheckPointers(state),
      error: `EIA pipeline data (${which}) didn't load — not a clear result. Retry, and use the site checks below.`,
      caveat: APPROX_CAVEAT,
    };
  }

  return {
    ...base,
    status: "unconfirmed",
    summary: `Not confirmed — no major transmission line within ${EIA_BUFFER_MI} mi on EIA's approximate map. That is not "clear": ${stName} has no complete public pipeline map. ${pointerLine(state)}`,
    detail: siteCheckPointers(state),
    error: null,
    caveat: APPROX_CAVEAT,
  };
}

/* A Texas-only source asked about a site that is positively in another state. Planyr has no such
 * source there — say so, and never query the Texas service at that coordinate (its empty answer
 * would read as "none found"). `source` is the ANALYSIS_SOURCES row. Pure. */
export function outOfStateFinding(source, state) {
  const stName = STATE_NAME[String(state || "").toUpperCase()] || "this state";
  return {
    id: source.id, category: source.category, label: source.label,
    status: "unconfirmed",
    summary: `Not available in ${stName} yet — Planyr has no “${source.category || source.label || "source"}” source here. A gap in what Planyr carries, not a finding.`,
    detail: [], rows: null,
    sourceName: null, ageMs: null, ts: null, error: null,
    caveat: null, verified: false, mapLayer: null, outOfState: true,
  };
}
