/* taxUnitsClient.js — the browser half of the per-account tax table (B2158065).
 *
 * `/api/taxunits` (functions/api/taxunits.js) answers, for ONE CAD account, the COMPLETE list of
 * taxing units the CAD itself assigns it plus each unit's adopted rate for the latest adopted tax
 * year — or says plainly that it can't (`complete:false`). This module fetches it once per account
 * (in-flight + settled results are shared), and `tableFromUnits` shapes a complete answer into the
 * table `ParcelPage` already renders. A partial/failed answer is NULL — the table is hidden, never
 * guessed (owner rule, taxRates.js header).
 */
import { r6 } from "./taxRates.js";

// Counties whose per-account answer is wired server-side. A county not listed here never fetches.
export const TAX_UNIT_COUNTIES = new Set(["harris"]);

const cache = new Map(); // key -> Promise<response|null>

export const acctKey = (county, acct) => `${county}:${String(acct || "").trim()}`;

/** The CAD account number off a stored county lot, or null. Pure. */
export function accountOf(parcel, idField) {
  const a = parcel?.attrs || {};
  const v = (idField && a[idField]) ?? parcel?.acct ?? null;
  const s = v == null ? "" : String(v).replace(/\D/g, "");
  return s || null;
}

export function fetchTaxUnits(county, acct, fetchImpl = (typeof fetch === "function" ? fetch : null)) {
  if (!county || !acct || !TAX_UNIT_COUNTIES.has(county) || !fetchImpl) return Promise.resolve(null);
  const key = acctKey(county, acct);
  if (cache.has(key)) return cache.get(key);
  const p = fetchImpl(`/api/taxunits?county=${encodeURIComponent(county)}&acct=${encodeURIComponent(acct)}`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((j) => { if (!j || j.transient) cache.delete(key); return j; }); // a failure (or a "try again" answer) is retried on the next open, never cached
  cache.set(key, p);
  return p;
}

/** A server answer → the table shape `ParcelPage` renders, or null (hide). Pure. */
export function tableFromUnits(resp) {
  if (!resp || resp.complete !== true || !Array.isArray(resp.units) || !resp.units.length || !resp.year || !resp.source) return null;
  if (resp.units.some((u) => !u || !u.name || typeof u.rate !== "number" || !Number.isFinite(u.rate))) return null;
  const rows = resp.units.map((u) => ({ unit: u.name, rate: u.rate }));
  return { year: resp.year, source: resp.source, sourceUrl: resp.sourceUrl || "", rows, total: r6(rows.reduce((s, r) => s + r.rate, 0)) };
}

export function _resetTaxUnitsCache() { cache.clear(); }
