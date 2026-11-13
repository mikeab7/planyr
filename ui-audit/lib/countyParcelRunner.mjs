/* County-parcel verification runner — the engine. NEW-1 (2026-11-13).
 *
 * ONE runner, driven by a TABLE (`ui-audit/county-parcels/cases.mjs`). Adding the next county is ADDING A ROW,
 * never a new script. Read `ui-audit/county-parcels/README.md` for the row format and the "add county number eight" recipe.
 *
 * Split in two on purpose so the verdict logic is unit-testable with no network (test/countyParcelRunner.test.js):
 *   · `collectPoint`  — the IMPURE half: asks the SHIPPED `candidateCountiesForPoint` which sources the app would ask,
 *                       then (live) asks each through the SHIPPED `queryAtPoint`, logging every parcel request fired.
 *   · `judgePoint`    — the PURE half: expectations × what was observed → PASS | FAIL | VOID, with a named cause.
 *
 * Verdict vocabulary (AGENT-RULES: "Empty never means zero"; a null is a FINDING, never a pass):
 *   PASS  every stated expectation held.
 *   FAIL  something answered wrong. `cause` says whose: "routing" (our code picked the wrong source), "source" (the county
 *         server answered an error or no parcel where we proved a lot stands), "shape" (a parcel came back but its PIN/layer
 *         is not what the row says).
 *   VOID  the live half could not run (host unreachable from THIS machine). Never a pass and never a failure of the county:
 *         the routing half is still judged and reported separately.
 */

const norm = (s) => String(s ?? "").trim();
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

/** Merge a case's defaults into each of its points (a point may override any case-level expectation). */
export function expandCase(c) {
  const { points, ...defaults } = c;
  return (points || []).map((p, i) => {
    const pt = Array.isArray(p) ? { label: p[0], lat: p[1], lng: p[2] } : p;
    return { ...defaults, ...pt, caseId: c.id, index: i, label: pt.label || `${c.place} #${i + 1}` };
  });
}

function attrOf(feature, field) {
  const a = (feature && feature.attributes) || {};
  if (field in a) return a[field];
  const k = Object.keys(a).find((x) => x.toLowerCase() === String(field).toLowerCase());
  return k ? a[k] : undefined;
}

/** Wrap global fetch so every request is recorded. `take()` returns and clears the log. */
export function installFetchLog() {
  const real = globalThis.fetch;
  let log = [];
  globalThis.fetch = (u, o) => { log.push(String(u)); return real(u, o); };
  return { take: () => { const l = log; log = []; return l; }, restore: () => { globalThis.fetch = real; } };
}

const isParcelRequest = (u) => /\/(query|identify)\?/.test(u);
const hostOf = (u) => { try { return new URL(u).host; } catch { return ""; } };

/** The impure half. `deps`: { candidatesFor(lat,lng) → keys, cfgFor(key) → {layerUrl,idField}, query(layerUrl,lng,lat), fetchLog, probeHost(host) }. */
export async function collectPoint(point, deps, { routingOnly = false } = {}) {
  const candidates = deps.candidatesFor(point.lat, point.lng);
  const observed = { candidates, live: null, probes: {} };
  if (!point.live || routingOnly) return observed;
  deps.fetchLog.take();
  const settled = await Promise.all(candidates.map(async (key) => {
    const cfg = deps.cfgFor(key);
    if (!cfg || !cfg.layerUrl) return [key, { layerUrl: null, feature: null, error: { kind: "config", message: "no layerUrl in COUNTIES_MAP" } }];
    try {
      const feature = await deps.query(cfg.layerUrl, point.lng, point.lat);
      return [key, { layerUrl: cfg.layerUrl, feature, error: null }];
    } catch (e) {
      return [key, { layerUrl: cfg.layerUrl, feature: null, error: { kind: e.kind || "unknown", message: e.message, status: e.status ?? null } }];
    }
  }));
  const requests = deps.fetchLog.take().filter(isParcelRequest);
  observed.live = { results: Object.fromEntries(settled), requests };
  // A network-class failure is only worth naming if we can say WHY (egress block vs the server itself being down).
  for (const [, r] of settled) {
    if (r.error && (r.error.kind === "network" || r.error.kind === "timeout") && r.layerUrl) {
      const host = hostOf(r.layerUrl);
      if (host && !(host in observed.probes)) observed.probes[host] = await deps.probeHost(host);
    }
  }
  return observed;
}

/** The pure half. `cfgFor` supplies the idField default. Returns { status, cause, checks[], evidence }. */
export function judgePoint(point, observed, cfgFor = () => ({})) {
  const checks = [];
  const add = (ok, label, cause) => { checks.push({ ok, label, cause: ok ? null : cause }); return ok; };
  let void_ = null;
  const evidence = {};

  if (point.routes) {
    add(sameSet(observed.candidates, point.routes),
      `routes to exactly [${point.routes.join(", ")}] (got [${observed.candidates.join(", ")}])`, "routing");
  }
  for (const k of point.routesNot || []) add(!observed.candidates.includes(k), `does not route to ${k}`, "routing");
  for (const k of point.routesInclude || []) add(observed.candidates.includes(k), `routes include ${k}`, "routing");

  if (point.live) {
    if (!observed.live) {
      void_ = "live half not run (--routing-only)";
    } else {
      const { results, requests } = observed.live;
      const want = point.answeredBy;
      const r = results[want];
      if (!r) {
        add(false, `${want} was asked (it is not among the candidates [${observed.candidates.join(", ")}])`, "routing");
      } else if (r.error && (r.error.kind === "network" || r.error.kind === "timeout")) {
        const host = hostOf(r.layerUrl);
        void_ = `${host} unreachable from this machine (${r.error.kind}) — ${observed.probes[host] || "reason unknown"}`;
      } else if (r.error) {
        add(false, `${want} answered without an error (got ${r.error.kind}${r.error.status ? " " + r.error.status : ""}: ${r.error.message})`, "source");
      } else if (!r.feature && point.interior === false) {
        // A point nobody has confirmed sits INSIDE a lot proves nothing when it returns none (it may be right-of-way).
        void_ = `no parcel at a point not yet confirmed to sit inside a lot (interior:false) — pick a lot-interior point from the county's own viewer and set interior:true`;
      } else if (!r.feature) {
        add(false, `${want} returned a parcel at this point (got none — the point may sit on right-of-way, or the source has a hole here)`, "source");
      } else {
        const cfg = cfgFor(want) || {};
        const field = point.field || cfg.idField;
        const pin = norm(attrOf(r.feature, field));
        evidence.pin = pin; evidence.field = field; evidence.rings = ((r.feature.geometry || {}).rings || []).length;
        add(!!pin, `parcel carries a non-empty ${field}`, "shape");
        if (point.pin) add(point.pin.test(pin), `${field} "${pin}" matches ${point.pin}`, "shape");
        if (point.layer) add(point.layer.test(r.layerUrl), `answered from a layer matching ${point.layer} (${r.layerUrl})`, "shape");
        add(evidence.rings > 0, `parcel has geometry`, "shape");
        for (const [f, re] of Object.entries(point.attrs || {})) add(re.test(norm(attrOf(r.feature, f))), `attribute ${f} matches ${re}`, "shape");
      }
      const max = point.requests ?? (point.routes ? point.routes.length : undefined);
      evidence.requests = requests.length;
      if (max != null && !void_) add(requests.length <= max, `fired ${requests.length} parcel request(s) (at most ${max})`, "routing");
      for (const h of point.noRequestTo || []) add(!requests.some((u) => hostOf(u) === h || u.includes(h)), `no request to ${h}`, "routing");
    }
  }

  const bad = checks.find((c) => !c.ok);
  if (bad) return { status: "FAIL", cause: bad.cause, checks, evidence, void: void_ };
  if (void_) return { status: "VOID", cause: "egress", checks, evidence, void: void_ };
  return { status: "PASS", cause: null, checks, evidence, void: null };
}

/** Case-level checks that need every point (PINs distinct across the case). Returns extra check results. */
export function judgeCase(c, pointVerdicts) {
  const out = [];
  if (c.distinct) {
    const pins = pointVerdicts.filter((v) => v.status === "PASS" && v.evidence.pin).map((v) => v.evidence.pin);
    const dup = pins.filter((p, i) => pins.indexOf(p) !== i);
    out.push({ ok: dup.length === 0, label: `PINs distinct across the case (${pins.length} compared${dup.length ? "; repeated: " + [...new Set(dup)].join(", ") : ""})`, cause: "shape" });
  }
  return out;
}

/** Roll a case's point verdicts (+ case checks) into one: FAIL beats VOID beats PASS. */
export function rollup(pointVerdicts, caseChecks = []) {
  if (pointVerdicts.some((v) => v.status === "FAIL") || caseChecks.some((c) => !c.ok)) return "FAIL";
  if (pointVerdicts.some((v) => v.status === "VOID")) return "VOID";
  return "PASS";
}

/** A deliberately wrong twin of a point — used by --prove-red to show the judge CAN go red on data it just passed. */
export function mutantsOf(point) {
  const m = [];
  if (point.routes) m.push({ name: "wrong routes", point: { ...point, routes: [...point.routes, "__not_a_county__"] } });
  if (point.live) {
    m.push({ name: "impossible PIN shape", point: { ...point, pin: /^__never__$/ } });
    m.push({ name: "wrong layer", point: { ...point, layer: /__never__/ } });
    m.push({ name: "zero request budget", point: { ...point, requests: 0 } });
  }
  return m;
}
