/* NEW-1 (2026-10-22) — the doc and the table agree. docs/STATEWIDE-PARCELS.md is the research record (what was searched, why);
 * `site-planner/lib/parcelGaps.js` is the runtime truth. The doc's per-state gap tables are read back by
 * `scripts/lib/parcelGapDoc.mjs` and compared — this test is the agreement mechanism (chosen over generating the doc's status
 * column, because each state's section was written in its own shape and carries findings that are not ours to regenerate). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readParcelGapRows } from "../scripts/lib/parcelGapDoc.mjs";
import { PARCEL_GAPS, gapKey } from "../src/workspaces/site-planner/lib/parcelGaps.js";
import { COUNTIES_MAP } from "../src/workspaces/site-planner/lib/counties.js";

const rows = readParcelGapRows(readFileSync(new URL("../docs/STATEWIDE-PARCELS.md", import.meta.url), "utf8"))
  .map((r) => ({ ...r, key: gapKey(r.county, r.state) }));
const reasonOf = (r) => (PARCEL_GAPS[r.key] || [])[0];

describe("docs/STATEWIDE-PARCELS.md gap rows ↔ parcelGaps.js", () => {
  it("the parser still finds every state's gap table (a renamed heading must not quietly empty this test)", () => {
    const by = {};
    rows.forEach((r) => { by[r.state] = (by[r.state] || 0) + 1; });
    expect(by).toEqual({ KY: 83, GA: 48, IA: 43, MI: 29, MO: 42, WA: 5, OR: 3, OK: 61, KS: 55, IL: 36, LA: 26, ID: 10, NY: 1, TN: 1 });
  });

  it("every gap row in the doc has an explicit entry in the table (even `none` is a decision, not an omission)", () => {
    const missing = rows.filter((r) => !PARCEL_GAPS[r.key]).map((r) => `${r.state} ${r.county} (${r.key})`);
    expect(missing).toEqual([]);
  });

  it("every table entry is a county the doc lists as a gap (no stale or undocumented rows)", () => {
    const docKeys = new Set(rows.map((r) => r.key));
    expect(Object.keys(PARCEL_GAPS).filter((k) => !docKeys.has(k))).toEqual([]);
  });

  it("a doc row that says login / token / subscription / relay-TLS is never filed under `none`", () => {
    const wrong = [];
    for (const r of rows) {
      const k = r.kind;
      if (/login-required|token-required|token-gated|— locked/.test(k) && !["locked", "paywall"].includes(reasonOf(r))) wrong.push(`${r.state} ${r.county}: doc "${k}" but table "${reasonOf(r)}"`);
      if (/relay-tls/.test(k) && reasonOf(r) !== "unreachable") wrong.push(`${r.state} ${r.county}: doc "${k}" but table "${reasonOf(r)}"`);
    }
    expect(wrong).toEqual([]);
  });

  it("the owner-accepted gaps stay `none` and still get the request link (Fulton KY, New Madrid / Pemiscot MO)", () => {
    for (const k of ["ky_fulton", "mo_newmadrid", "mo_pemiscot"]) expect(PARCEL_GAPS[k][0]).toBe("none");
  });

  it("no doc gap row names a county that is wired (the doc or the table is stale — wire a county, update both)", () => {
    expect(rows.filter((r) => COUNTIES_MAP[r.key]).map((r) => `${r.state} ${r.county}`)).toEqual([]);
  });
});
