/* AREA UNITS ARE SPELLED "AC" AND "SF" (B548817).
 *
 * Owner report: the drawing and the panels read "94.40 AC" and "193,007 SF"; on every civil sheet,
 * survey and lease exhibit these plans sit beside, that is AC and SF.
 *
 * ⛔ WHY THIS IS A SOURCE SWEEP AND NOT JUST A UNIT TEST OF THE FORMATTER. The spelling was written
 * longhand at roughly fifty call sites, each with its own number formatter — the measurement chip,
 * the parcel badge, the building label, the yield panel, the pond rows, MapFinder's list, Doc
 * Review's totals. Testing the shared helper proves the helper; it proves nothing about the
 * fifty-first site somebody writes next week in lowercase. So the sweep is the guard, and the
 * helper is what a new site should call.
 *
 * Two exemptions, both narrow and both stated rather than assumed:
 *   • COMMENTS. Regulatory citations quote their source ("0.75 AC-FT/ac, 2026 IDM Table 9.5") and
 *     re-casing a quotation is wrong. Comments are skipped.
 *   • IDENTIFIERS. `areaSf`, `landSavedAc`, `AC_FT`, `SQFT_PER_ACRE` are code, not copy. The sweep
 *     matches only a unit standing alone after a value, which is what a reader sees.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { AC, SF, AC_FT, fmtSf, fmtAc, fmtAcFromSf, SQFT_PER_ACRE, CF_PER_ACFT } from "../src/shared/units/areaUnits.js";
import { fmtSf as measureFmtSf, fmtAcres as measureFmtAc } from "../src/workspaces/site-planner/lib/measureLabel.js";

describe("the shared spelling", () => {
  it("names the units the way the owner asked for", () => {
    expect([AC, SF, AC_FT]).toEqual(["AC", "SF", "AC-FT"]);
  });
  it("formats with the app's existing number conventions", () => {
    expect(fmtSf(193006.7)).toBe("193,007 SF");
    expect(fmtAc(94.4)).toBe("94.40 AC");
    expect(fmtAcFromSf(94.4 * SQFT_PER_ACRE)).toBe("94.40 AC");
  });
  /* The measurement chip has its own formatters (it also owns the ′ feet convention). They must
   * agree with the shared ones character for character, or the chip disagrees with the panel a few
   * inches away — which is the whole complaint. */
  it("the measurement chip's own formatters produce the identical string", () => {
    expect(measureFmtSf(193006.7)).toBe(fmtSf(193006.7));
    expect(measureFmtAc(94.4)).toBe(fmtAc(94.4));
  });
});

/* ------------------------------------------------------------------ the sweep */

/* ⛔ ONE FILE IS EXEMPT, NAMED HERE RATHER THAN QUIETLY SKIPPED BY THE REGEX.
 *
 * `detentionRules.js` builds the METHOD-BASIS strings — "0.75–1 ac-ft/ac (unincorporated Harris
 * outfall-type minimum …) × 80.34 ac". Those quote a published drainage ordinance term for term,
 * and they are pinned byte-for-byte by `test/goldenMasterTexas.test.js`, whose failure message
 * says in as many words: "Do NOT regenerate the fixture — put the value back." Re-casing half a
 * citation ("0.8 AC-FT/ac") is worse than either spelling. The owner named the DRAWING and the
 * PANELS — the measurement chip, the parcel badge, the building label, the yield rows — and those
 * are all converted. This is the honest edge, on the record. */
const EXEMPT = new Set(["src/workspaces/site-planner/lib/detentionRules.js"]);
const SRC = globSync("src/**/*.{js,jsx}").filter((f) => !EXEMPT.has(f.split("\\").join("/")));

/** Strip line and block comments, crudely but conservatively — anything that might be a comment
 *  is removed, so the sweep can only ever MISS a violation, never invent one. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((l) => (/^\s*(\/\/|\*)/.test(l) ? "" : l.replace(/\/\/.*$/, "")))
    .join("\n");
}

/* A unit in DISPLAY POSITION: immediately after a formatted value (a closed template expression or
 * a digit) and immediately before the end of that string or text node. Deliberately not "the
 * letters ac anywhere" — that matches `areaAc`, `acres`, and every third identifier here.
 *
 * ⛔ THE ONE THING IT DELIBERATELY DOES NOT MATCH, stated rather than left to be discovered: a unit
 * used as an ABBREVIATION INSIDE PROSE — "HEC-HMS required ≥640 AC", "§7.3 Detention Analysis (≤200
 * ac)", "0.8 AC-FT/ac × PROPOSED impervious". Those live in provenance notes that QUOTE a published
 * ordinance by section, and re-casing a quotation is wrong. The cost of the narrowness is honest:
 * a display string with a word after the unit (`${f0(x)} SF gross`) is outside the sweep, so those
 * were fixed by hand and are not defended by it. */
const LOWER_UNIT = /(\}|\d)\s(ac|sf|ac-ft)(?=\s*(?:[`"'<\u00b7]|$))|>(ac|sf|ac-ft)</g;

describe("no surface spells an area unit in lowercase", () => {
  it("sweeps every source file", () => {
    const hits = [];
    for (const f of SRC) {
      const body = stripComments(readFileSync(f, "utf8"));
      body.split("\n").forEach((line, i) => {
        LOWER_UNIT.lastIndex = 0;
        if (LOWER_UNIT.test(line)) hits.push(`${f}:${i + 1}  ${line.trim().slice(0, 120)}`);
      });
    }
    expect(hits, `lowercase area units found — use AC / SF (src/shared/units/areaUnits.js):\n${hits.join("\n")}`).toEqual([]);
  });

  /* TEETH. The sweep has to reject the exact strings the app shipped yesterday, or a regex that
   * silently matches nothing would pass this file forever. */
  it("the sweep rejects the strings that actually shipped", () => {
    const shipped = [
      "const txt = `${f2(x)} ac`;",
      "lines.push(`${f0(area)} sf`);",
      "<span>{f0(bldg)} sf</span>",
      "row(lbl, `${f2(b.acres)} ac`)",
      "`${lo} ac-ft`",
      "<b>{f2(acres)} ac</b>",
    ];
    for (const s of shipped) {
      LOWER_UNIT.lastIndex = 0;
      expect(LOWER_UNIT.test(s), s).toBe(true);
    }
  });
  /* …and passes the things that only LOOK like units, so it is not merely a red-light generator. */
  it("the sweep leaves identifiers and prose alone", () => {
    for (const s of ["const areaSf = 0;", "const { areaAc } = v;", "acres.toFixed(2)", "`${n} acres`",
                     "note: \"HEC-HMS required \u2265640 AC (DIA bar rises at 50 AC)\"", "onChange={(e) => ac.onSet(null)}"]) {
      LOWER_UNIT.lastIndex = 0;
      expect(LOWER_UNIT.test(s), s).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ one home for the constant + formatters (NEW-1) */

/* The acre constant and the number formatters each had a private copy at 30+ call sites — 34
 * separate `= 43560` under six names, 28 private f0/f1/f2 in three styles. They live in
 * `shared/units/areaUnits.js` (SQFT_PER_ACRE, CF_PER_ACFT) and `shared/units/numberFormat.js`.
 * The sweep below is what keeps the thirty-fifth from being written next week.
 *
 * ESCAPE, for a justified exception only: put `// acre-const-ok: <why>` (or `// fmt-ok: <why>`) on
 * the offending line or the line directly above it. The reason is required by the regex, so a bare
 * marker does not pass. Comments are not scanned — a doc comment may still say "÷ 43,560". */
const ONE_HOME = new Set(["src/shared/units/areaUnits.js"]);
const SWEEP = [...globSync("src/**/*.{js,jsx}"), ...globSync("functions/**/*.js")]
  .map((f) => f.split("\\").join("/"))
  .filter((f) => !ONE_HOME.has(f));

const ACRE_LITERAL = /(?<![\d.])43[_,]?560(?![\d_])/;
const PRIVATE_FORMATTER = /(?:^|[^.\w$])(?:const|let|var|function)\s+(f[012])\b\s*(?:=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>|=\s*function\b|\()/;
const escaped = (raw, i, tag) => {
  const re = new RegExp(`//\\s*${tag}:\\s*\\S`);
  return re.test(raw[i]) || (i > 0 && re.test(raw[i - 1]));
};
function sweepFor(pattern, tag) {
  const hits = [];
  for (const f of SWEEP) {
    const raw = readFileSync(f, "utf8").split("\n");
    const code = stripComments(raw.join("\n")).split("\n");
    code.forEach((line, i) => {
      if (pattern.test(line) && !escaped(raw, i, tag)) hits.push(`${f}:${i + 1}  ${line.trim().slice(0, 110)}`);
    });
  }
  return hits;
}

describe("the acre constant and the number formatters have one home", () => {
  it("exports both names of 43,560", () => {
    expect(SQFT_PER_ACRE).toBe(43560);
    expect(CF_PER_ACFT).toBe(43560);
  });
  it("no source file types the acre literal", () => {
    const hits = sweepFor(ACRE_LITERAL, "acre-const-ok");
    expect(hits, `a bare 43560 — import SQFT_PER_ACRE (area) or CF_PER_ACFT (volume) from src/shared/units/areaUnits.js, or add "// acre-const-ok: <why>":\n${hits.join("\n")}`).toEqual([]);
  });
  it("no source file defines its own f0 / f1 / f2", () => {
    const hits = sweepFor(PRIVATE_FORMATTER, "fmt-ok");
    expect(hits, `a private f0/f1/f2 — pick the style it already uses from src/shared/units/numberFormat.js, or add "// fmt-ok: <why>":\n${hits.join("\n")}`).toEqual([]);
  });

  /* TEETH — the exact shapes that shipped, so a regex that matches nothing cannot pass forever. */
  it("the sweeps reject the shapes that shipped", () => {
    for (const s of ["const SQFT_PER_ACRE = 43560;", "export const CF_PER_ACFT = 43560;", "const AC_FT = 43560;",
                     "acres: sqft / 43560,", "if (x > 0.05 * 43560) {"]) expect(ACRE_LITERAL.test(s), s).toBe(true);
    for (const s of ["const f0 = (n) => Math.round(n).toLocaleString();",
                     "export const f1 = (n) => (Math.round(n * 10) / 10).toFixed(1);",
                     "  const f2 = n => n.toFixed(2);", "const f1 = (v) => v.toFixed(1);", "function f0(n) { return n; }"]) expect(PRIVATE_FORMATTER.test(s), s).toBe(true);
  });
  it("…and leave things that only look like them alone", () => {
    for (const s of ["const x = 435600;", "const y = 0.43560;", "const a = 1.43560;", "const SQFT = SQFT_PER_ACRE;"]) expect(ACRE_LITERAL.test(s), s).toBe(false);
    for (const s of ["import { commaInt as f0 } from \"./numberFormat.js\";", "export const f1 = plainDec1;", "const f1 = w.flush();",
                     "const { f0 } = fmt;", "obj.f0 = (n) => n;", "const f10 = (n) => n;"]) expect(PRIVATE_FORMATTER.test(s), s).toBe(false);
  });
  it("the escape needs a reason", () => {
    expect(escaped(["const a = 43560; // acre-const-ok: matches a county table"], 0, "acre-const-ok")).toBe(true);
    expect(escaped(["// fmt-ok: quoted verbatim", "const f0 = (n) => n;"], 1, "fmt-ok")).toBe(true);
    expect(escaped(["const a = 43560; // acre-const-ok:"], 0, "acre-const-ok")).toBe(false);
    expect(escaped(["const a = 43560;"], 0, "acre-const-ok")).toBe(false);
  });
});
