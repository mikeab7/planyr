#!/usr/bin/env node
/* parcel-source-health-sweep.mjs — B1461730: a periodic health check over every WIRED parcel
 * source in counties.js, so a source that has quietly gone empty is caught by a scheduled build
 * rather than by Michael clicking on a map. (Same shape/purpose as gis-verify/gis-source-
 * coverage-verify.mjs — the drainage/utility screening registry's own weekly drift check — but
 * that verifier reads a completely different registry, src/shared/gis/sources.js, which carries
 * no parcel rows; this is the parcel registry's equivalent.)
 *
 * THE CASE THIS WAS BUILT FOR. Nevada's wired parcel layer went from 1,394,188 features to ZERO
 * layers overnight — the app itself never noticed (nothing in the runtime asks "does this source
 * still have data" unprompted; a click either finds a parcel or it doesn't, and a whole county
 * going dark reads the same as a click landing on a gap between two tracts). This script asks
 * that question directly, for every wired source, on a schedule.
 *
 * WHAT IT CHECKS, for every DISTINCT `layerUrl` in COUNTIES + COUNTIES_MAP (site-planner/lib/
 * counties.js — deduped, since many county keys point at one shared statewide layer):
 *   • metadata + count query both answer without an ArcGIS `{error}` body (B1461729's fix,
 *     via serviceNeighbourWalk.mjs's shared `measureParcelLayer`);
 *   • the layer has at least one feature (a service that answers cleanly but reports 0 features
 *     is the same "quietly gone empty" failure as a hard error).
 *   • (2026-11, the weekly parcels sweep) every column the county row DECLARES — `idField`, `addrField` and each `addrParts` role — still
 *     exists on the live layer's field list (leaf name, case-blind). HCAD dropped `LocAddr` and the address search answered HTTP 400 for
 *     weeks before anyone noticed; this catches the next CAD schema change the night it happens. A declared column is a HINT in
 *     the runtime (detection wins unless pinned), so a miss here is reported as "column drift", not as an outage.
 * A `serviceUrl`-only entry (no direct `layerUrl` — the app auto-resolves its layer at request
 * time) is skipped by this pass; every currently-wired statewide source and the great majority of
 * county CADs use `layerUrl` directly, so this is real coverage, not a token check, but it is not
 * exhaustive — say so rather than claim otherwise.
 *
 * ON A FAILURE, this walks the failed source's own REST server for a replacement
 * (serviceNeighbourWalk.mjs's `walkForReplacement`) and includes what it found in the report —
 * exactly what would have caught the Nevada rename the same day it happened. No persisted
 * "last-known-good" baseline exists yet (a future enhancement), so a walked candidate is reported
 * as a name-similarity match for a human to confirm, never auto-applied.
 *
 * Reuses probe-statewide-parcels.mjs's own `fetchJson` — the SAME per-host throttle + circuit
 * breaker (B1461731) as every other probe/discovery script in this folder, so a sweep over ~150+
 * sources backs off from a struggling host instead of hammering it.
 *
 * Exit 0 = every checked source answered with real data. Exit 1 = at least one did not (the
 * scheduled workflow turns that into a @claude GitHub issue, same shape as gis-drift.yml).
 *
 *   node ui-audit/parcel-source-health-sweep.mjs
 *   node ui-audit/parcel-source-health-sweep.mjs --json
 */
import { COUNTIES, COUNTIES_MAP } from "../src/workspaces/site-planner/lib/counties.js";
import { missingDeclaredColumns } from "../src/workspaces/site-planner/lib/addrParts.js";
import { fetchJson } from "./probe-statewide-parcels.mjs";
import { measureParcelLayer, walkForReplacement } from "./lib/serviceNeighbourWalk.mjs";
import { fileURLToPath } from "node:url";

const JSON_OUT = process.argv.includes("--json");

/* Every distinct wired layer URL, with every county/state key that points at it (so a shared
 * statewide layer's failure names every affected key, not just the first one found). Pure. */
export function collectWiredLayerUrls(registries = [COUNTIES, COUNTIES_MAP]) {
  const byUrl = new Map(); // url -> Set(labels)
  const cfgsByUrl = new Map(); // url -> [{ label, cfg }] — the rows whose DECLARED columns are held against the live field list
  for (const registry of registries) {
    for (const [key, cfg] of Object.entries(registry || {})) {
      if (!cfg || !cfg.layerUrl) continue; // serviceUrl-only entries are out of scope for this pass
      const url = String(cfg.layerUrl).replace(/\/+$/, "");
      const label = cfg.state ? `${cfg.state}/${key}` : key;
      if (!byUrl.has(url)) { byUrl.set(url, new Set()); cfgsByUrl.set(url, []); }
      byUrl.get(url).add(label);
      if (cfg.idField || cfg.addrField || cfg.addrParts) cfgsByUrl.get(url).push({ label, cfg });
    }
  }
  return [...byUrl.entries()].map(([url, labels]) => ({ url, labels: [...labels].sort(), cfgs: cfgsByUrl.get(url) }));
}

/* Check one source: alive, has data, and (on failure) what its own server's neighbours look like.
 * Never throws — every outcome, including a network exception, comes back as a result row. */
async function checkOne({ url, labels, cfgs = [] }) {
  const measured = await measureParcelLayer(url, { fetchJson });
  if (measured.ok && (measured.featureCount == null || measured.featureCount > 0)) {
    /* The layer answers with data — now hold each row's declared columns against its live field list. No replacement walk: the service is
     * fine, one column moved. */
    const drift = [];
    for (const { label, cfg } of cfgs) for (const m of missingDeclaredColumns(cfg, measured.fieldNames)) drift.push(`${label}: ${m.kind} "${m.name}"`);
    if (drift.length) return { url, labels, healthy: false, columnDrift: true, problem: `column drift — declared column(s) not on the live layer: ${drift.join("; ")}`, candidate: null, candidatesChecked: 0 };
    return { url, labels, healthy: true, featureCount: measured.featureCount };
  }
  const problem = measured.ok
    ? "layer answered but reports ZERO features"
    : measured.arcgisError
      ? `ArcGIS error: ${measured.error}`
      : `unreachable: ${measured.error}`;
  const walk = await walkForReplacement({ failedUrl: url, fetchJson });
  const best = walk.ok ? walk.results[0] : null;
  return {
    url, labels, healthy: false, problem,
    candidate: best ? { url: best.url, similarity: best.similarity, featureCount: best.featureCount } : null,
    candidatesChecked: walk.ok ? walk.candidatesChecked : 0,
  };
}

export async function sweep() {
  const sources = collectWiredLayerUrls();
  const results = [];
  for (const s of sources) results.push(await checkOne(s));
  const broken = results.filter((r) => !r.healthy);
  return { checkedAt: new Date().toISOString(), totalSources: sources.length, broken, results };
}

function report(sw) {
  const lines = [];
  lines.push(`Parcel source health sweep — ${sw.checkedAt}`);
  lines.push(`${sw.totalSources} distinct wired layer(s) checked, ${sw.broken.length} broken.`);
  lines.push("");
  for (const r of sw.broken) {
    lines.push(`⛔ ${r.labels.join(", ")}`);
    lines.push(`   ${r.url}`);
    lines.push(`   ${r.problem}`);
    if (r.candidate) {
      lines.push(`   → candidate on the same server: ${r.candidate.url} (name similarity ${r.candidate.similarity.toFixed(2)}, ${r.candidate.featureCount ?? "?"} features)`);
    } else if (r.columnDrift) {
      lines.push("   → the layer is up; fix the county row's declared column(s) in counties.js (and its search/card test).");
    } else {
      lines.push(`   → no plausible candidate found on the same server (${r.candidatesChecked} checked) — needs manual research.`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  const sw = await sweep();
  if (JSON_OUT) {
    console.log(JSON.stringify(sw, null, 2));
  } else {
    console.log(report(sw));
  }
  process.exitCode = sw.broken.length ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
