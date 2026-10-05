#!/usr/bin/env node
/* verify-zoom-no-resize-thrash — A ZOOM GESTURE MUST NOT RE-SYNC LEAFLET'S SIZE (NEW-1 / B2096832).
 *
 *   node ui-audit/verify-zoom-no-resize-thrash.mjs --base http://127.0.0.1:4173 [--dist <dir>]   (or: npm run perf:zoomthrash)
 *
 * THE DEFECT IT GUARDS. B846384 cached the basemap registration effect's "Leaflet's size is stale" verdict and reused it
 * while `size`/`geoOverscan` were unchanged. Taken true once (the first commit), it was never cleared, so every
 * later view commit re-entered the resize branch: clear the gesture transform, `map.invalidateSize()` (a forced
 * synchronous layout), `map.setView()` — once per wheel event. On the owner's Silvestri plan: 96 `invalidateSize`
 * + 96 `setView` for 96 wheel events, ~45% of all scheduler time, the ~300 ms `U` frames in his perf capture.
 *
 * WHY THE GUARD COUNTS CALLS AND DOES NOT TIME FRAMES. The wall-clock effect depends on his machine and his live GIS
 * layers (egress-blocked here, so they mount empty — a LOWER BOUND); the CALL COUNT does not. 96 → 0 and 96 → 12 are the
 * same on every box, and a frame-time ceiling loose enough not to flake here would pass the broken build.
 *
 * KNOWN-GOOD ARM (never trusted without it): after the gesture the harness resizes the viewport and requires ≥ 1
 * `invalidateSize` call — proof the probe can see calls on this page AND that the legitimate resize re-sync survives.
 * A run where that arm reads 0 is VOID, never a pass.
 *
 * PROVEN RED ON UNFIXED CODE: run against a build of commit b8658dc (main before this fix) it reports 96 / 96 and exits 1.
 * Spawns the diagnose harness (`--leaflet-probe --json`) so there is ONE driver, not two that can drift.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const pass = process.argv.slice(2);
const r = spawnSync("node", [join(HERE, "diagnose-silvestri-zoom-freeze.mjs"), "--gesture", "burst", "--steps", "8", "--leaflet-probe", "--json", ...pass], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
if (r.status !== 0) { console.error(r.stderr || r.stdout); console.error("✗ VOID — the driver itself failed, so nothing was measured"); process.exit(2); }
const out = JSON.parse(r.stdout.slice(r.stdout.indexOf("{")));
const { leafletProbe: lp, resizeControl: rc } = out;

const WHEEL_EVENTS = 96;
const MAX_INVALIDATE = 3;       // the first commit's one legitimate re-sync, with slack for a settle-time layout change
const MAX_SETVIEW = WHEEL_EVENTS / 4; // settle/re-base commits only — never one per wheel event
const fails = [];
if (!lp || !rc) fails.push("no leaflet probe in the driver output");
else {
  if (rc.invalidateSizeCalls < 1) { console.error(`✗ VOID — the known-good arm read ${rc.invalidateSizeCalls} invalidateSize calls on a real resize; the probe or the resize re-sync is broken`); process.exit(2); }
  if (lp.invalidateSizeCalls > MAX_INVALIDATE) fails.push(`invalidateSize ran ${lp.invalidateSizeCalls}× across ${WHEEL_EVENTS} wheel events (max ${MAX_INVALIDATE}) — ${lp.invalidateSizeMs} ms of forced layout`);
  if (lp.setViewCalls > MAX_SETVIEW) fails.push(`setView ran ${lp.setViewCalls}× across ${WHEEL_EVENTS} wheel events (max ${MAX_SETVIEW}) — the gesture's cheap transform path is being bypassed`);
}
console.log(`zoom burst on the real Silvestri plan: invalidateSize ${lp?.invalidateSizeCalls} (${lp?.invalidateSizeMs} ms) · setView ${lp?.setViewCalls} · resize control ${rc?.invalidateSizeCalls}`);
if (fails.length) { for (const f of fails) console.error(`✗ ${f}`); process.exit(1); }
console.log("✓ a zoom gesture no longer re-syncs Leaflet's size per wheel event");
