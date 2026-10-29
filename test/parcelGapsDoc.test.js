/* NEW-1 (2026-10-22) — the doc and the table agree. docs/STATEWIDE-PARCELS.md is the research record (what was searched, why);
 * `site-planner/lib/parcelGaps.js` is the runtime truth. The doc's per-state gap tables are read back by
 * `scripts/lib/parcelGapDoc.mjs` and compared — this test is the agreement mechanism (chosen over generating the doc's status
 * column, because each state's section was written in its own shape and carries findings that are not ours to regenerate). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  readParcelGapRows, gapRowsOutsideGapSources, missingFromTable, schneiderReasonOfRow, SCHNEIDER_MARKERS, GAP_SOURCES,
} from "../scripts/lib/parcelGapDoc.mjs";
import { PARCEL_GAPS, gapKey } from "../src/workspaces/site-planner/lib/parcelGaps.js";
import { COUNTIES_MAP } from "../src/workspaces/site-planner/lib/counties.js";

const rows = readParcelGapRows(readFileSync(new URL("../docs/STATEWIDE-PARCELS.md", import.meta.url), "utf8"))
  .map((r) => ({ ...r, key: gapKey(r.county, r.state) }));
const reasonOf = (r) => (PARCEL_GAPS[r.key] || [])[0];

describe("docs/STATEWIDE-PARCELS.md gap rows ↔ parcelGaps.js", () => {
  it("the parser still finds every state's gap table (a renamed heading must not quietly empty this test)", () => {
    const by = {};
    rows.forEach((r) => { by[r.state] = (by[r.state] || 0) + 1; });
    expect(by).toEqual({ KY: 83, GA: 43, IA: 43, MI: 29, MO: 42, WA: 1, OR: 1, OK: 61, KS: 55, IL: 36, LA: 23, ID: 10, TN: 1, SD: 49 });
  });

  it("every gap row in the doc has an explicit entry in the table (even `none` is a decision, not an omission)", () => {
    expect(missingFromTable(rows, PARCEL_GAPS, gapKey)).toEqual([]);
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

  it("B2486192: South Dakota's 49 named gaps are read (the state was never in GAP_SOURCES, so they were invisible)", () => {
    expect(rows.filter((r) => r.state === "SD")).toHaveLength(49);
    for (const c of ["Aurora", "Hughes", "Harding", "Lincoln", "Corson", "Fall River", "Oglala Lakota"]) expect(rows.some((r) => r.state === "SD" && r.county === c), c).toBe(true);
  });

  it("B2486192 red-proof: a gap row the table lacks IS reported (the comparison cannot pass vacuously)", () => {
    const fake = [{ state: "SD", county: "Aurora" }, { state: "SD", county: "Atlantis" }];
    expect(missingFromTable(fake, PARCEL_GAPS, gapKey)).toEqual(["SD Atlantis"]);
    expect(missingFromTable(fake, {}, gapKey)).toEqual(["SD Aurora", "SD Atlantis"]);
  });

  it("B2486192 red-proof: a state section nobody registered in GAP_SOURCES is flagged, and the real doc has none", () => {
    const doc = readFileSync(new URL("../docs/STATEWIDE-PARCELS.md", import.meta.url), "utf8");
    expect(gapRowsOutsideGapSources(doc)).toEqual([]);
    const fake = "## Nebraska counties (2030-01-01)\n\n| County | Key | Source | Owner | Notes |\n|---|---|---|---|---|\n| Arthur | — (named gap) | **no source wired** | — | none found |\n";
    expect(gapRowsOutsideGapSources(fake)).toEqual([{ heading: "Nebraska counties (2030-01-01)", count: 1 }]);
    // the same fake section, once registered, is read as data and compared (the SD entry itself is the proof it can be)
    const sd = GAP_SOURCES.find((x) => x.state === "SD");
    expect(gapRowsOutsideGapSources(fake.replace("Nebraska", "South Dakota").replace("2030-01-01", "2026-10-19"), [sd])).toEqual([]);
  });

  it("every District III row (dead host) is `unreachable` unless a Schneider measurement says otherwise", () => {
    const bad = rows.filter((r) => r.state === "SD" && /answers the relay 404|host dead as above|same dead host/.test(r.text) && !schneiderReasonOfRow(r.text) && reasonOf(r) !== "unreachable").map((r) => r.county);
    expect(bad).toEqual([]);
  });

  it("NEW-2 (B2486193): a Schneider phrase on a doc row and the table reason agree, both ways", () => {
    const wrong = [];
    for (const r of rows) {
      const want = schneiderReasonOfRow(r.text);
      if (want && reasonOf(r) !== want) wrong.push(`${r.state} ${r.county}: doc says ${want}, table says ${reasonOf(r)}`);
    }
    expect(wrong).toEqual([]);
    const docKeys = new Map(rows.map((r) => [r.key, r]));
    const orphan = Object.entries(PARCEL_GAPS).filter(([, e]) => /^Schneider map/.test(e[1] || "")).filter(([k, e]) => {
      const m = SCHNEIDER_MARKERS.find((x) => e[1].startsWith(x.text));
      return !m || m.reason !== e[0] || schneiderReasonOfRow((docKeys.get(k) || {}).text) !== e[0];
    }).map(([k]) => k);
    expect(orphan).toEqual([]);
  });

  it("NEW-2: the measured Schneider counties are filed paywall / locked, and the unmeasured ones are left alone", () => {
    for (const k of ["ga_taliaferro", "ga_randolph", "ga_quitman", "sd_clay", "sd_mccook", "sd_hughes"]) expect(PARCEL_GAPS[k][0], k).toBe("paywall");
    for (const k of ["ga_bacon", "ga_wilkes", "ia_adams", "ia_union", "mi_houghton", "mo_pettis", "ks_miami", "ks_wilson", "il_ogle", "sd_brookings", "sd_custer"]) expect(PARCEL_GAPS[k][0], k).toBe("locked");
    for (const k of ["ky_martin", "ky_menifee"]) expect(PARCEL_GAPS[k]).toEqual(["none"]);
    const counts = { paywall: 0, locked: 0 };
    for (const e of Object.values(PARCEL_GAPS)) if (/^Schneider map/.test(e[1] || "")) counts[e[0]]++;
    expect(counts).toEqual({ paywall: 6, locked: 62 });
  });
});
