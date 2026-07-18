/* NEW-B5 — the NOAA Atlas-14 PFDS client: fetch (via the same-origin proxy) → parse → design-
 * storm rainfall DEPTH for the site, feeding the Curve-Number method (curveNumber.js) and the
 * routing inflow. The pure parser (parsePfdsText / pfdsDepthFor) lives in pfds.js; this adds the
 * bounded-fetch leg. Browser routes through functions/api/pfds.js (NO CORS on the raw endpoint);
 * `proxy:false` hits NOAA directly (server-side / tests). Screening only — a design reference,
 * never a regulatory determination. LOUD-FAILURE: out of coverage / a bad body → honest null.
 * Injectable fetch keeps it Node-testable. */
import { parsePfdsText, pfdsDepthFor } from "./pfds.js";

export const PFDS_PROXY_PATH = "/api/pfds";
const NOAA_DIRECT = "https://hdsc.nws.noaa.gov/cgi-bin/new/fe_text_mean.csv";

/* The request URL for a point. Proxy path (browser) or the direct NOAA endpoint (server/tests). */
export function buildPfdsUrl(lat, lng, { proxy = true } = {}) {
  return proxy
    ? `${PFDS_PROXY_PATH}?lat=${Number(lat)}&lon=${Number(lng)}`
    : `${NOAA_DIRECT}?lat=${Number(lat)}&lon=${Number(lng)}&data=depth&units=english&series=pds`;
}

/* Read a design-storm rainfall depth (inches) from a parsed PFDS table: the duration row at the
 * return-period column. Default 24-hr (the SCS design-storm duration). Null when unavailable. */
export function designStormDepthIn(parsed, returnPeriodYr, durationLabel = "24-hr") {
  return pfdsDepthFor(parsed, durationLabel, returnPeriodYr);
}

/* Fetch + parse point precipitation frequency. Returns { ok, table, source } or { ok:false,
 * reason }. `fetchImpl` injectable; `proxy` routes through the same-origin proxy. A short body
 * (out of coverage) parses to null → honest failure, never a fabricated depth. */
export async function resolvePfds({ lat, lng } = {}, { fetchImpl, timeoutMs = 12000, signal, proxy = true } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false, reason: "no point" };
  const url = buildPfdsUrl(lat, lng, { proxy });
  const ctrl = !signal && typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  let r;
  try {
    r = await (fetchImpl || fetch)(url, { signal: signal || (ctrl && ctrl.signal) || undefined });
  } catch (e) {
    if (timer) clearTimeout(timer);
    return { ok: false, reason: `PFDS fetch failed: ${e && e.message ? e.message : e}` };
  }
  if (timer) clearTimeout(timer);
  if (!r.ok) return { ok: false, reason: `PFDS HTTP ${r.status}` };
  const body = await r.text();
  const table = parsePfdsText(body);
  if (!table) return { ok: false, reason: "no PFDS coverage / unparseable body at this point" };
  return { ok: true, table, source: "NOAA Atlas 14 (PFDS)" };
}
