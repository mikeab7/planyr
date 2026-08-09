/* NEW-2 — a plan's contents are its FIVE drawn kinds, and no census may be blind to four of them.
 *
 * THE MISS. Every census in this repo counted `[data-el-id]`, which is on ELEMENTS ONLY. Measured
 * live on the owner's signed-in Silvestri pair (V27088, 2026-08-09): a cross-plan paste landed
 * three markup objects and the element count read **120 before, 120 after** — a complete no-op —
 * while the app correctly reported the paste. "Paste succeeds silently but writes nothing" was one
 * keystroke from being filed against a feature that is fine. The same plan holds 145 distinct
 * features against those 120 elements.
 *
 * TWO HALVES, because either alone rots:
 *   • the COUNTING RULE, pinned against a fixture holding one of each kind (the answer is FIVE);
 *   • a SOURCE SWEEP, so an element-only counter cannot come back. It is not a style rule — it
 *     bans a CENSUS on `[data-el-id]`, and requires any remaining element-tier read to say so with
 *     an `el-tier:` marker naming why. A targeted `[data-el-id="b3"]` lookup is untouched.
 *
 * The live half is `e2e/feature-census.spec.js`, which draws one of each kind through the real
 * tools and requires the answer FIVE off the real render.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  FEATURE_KINDS, BLANK_POINT_EXCLUDE, parseFeatureKey, censusFrom, censusDiff,
  FEATURE_COUNT_FIELD, FEATURE_CENSUS_EXPR, FEATURE_COUNT_EXPR,
} from "../ui-audit/lib/featureCensus.mjs";
import { CLIP_KINDS } from "../src/workspaces/site-planner/lib/planClipboard.js";

/* ── the counting rule ─────────────────────────────────────────────────────────────────────── */

describe("the five kinds", () => {
  it("is exactly the clipboard's set — the render census and the copy set may not drift apart", () => {
    expect([...FEATURE_KINDS].sort()).toEqual([...CLIP_KINDS].sort());
  });

  it("parses a feature key, and refuses anything that is not one", () => {
    expect(parseFeatureKey("markup:m7")).toEqual({ kind: "markup", id: "m7" });
    expect(parseFeatureKey("measure:0")).toEqual({ kind: "measure", id: "0" });
    expect(parseFeatureKey("el:b1:2")).toEqual({ kind: "el", id: "b1:2" });   // ids may hold colons
    for (const bad of ["", "el", "el:", ":b1", "handle:h1", null, undefined, 7]) {
      expect(parseFeatureKey(bad)).toBeNull();
    }
  });
});

describe("censusFrom — ONE OF EACH KIND COUNTS AS FIVE", () => {
  /* The fixture the item asks for by name, and the whole point of the guard: an el-only counter
   * answers ONE on this canvas. */
  const ONE_OF_EACH = ["el:b1", "markup:m1", "measure:0", "callout:c1", "parcel:p1"];

  it("counts one of each kind as five", () => {
    const c = censusFrom(ONE_OF_EACH);
    expect(c.total).toBe(5);
    expect(c.byKind).toEqual({ el: 1, markup: 1, measure: 1, callout: 1, parcel: 1 });
  });

  it("an element-only counter would answer ONE on the same canvas — that is the defect", () => {
    expect(ONE_OF_EACH.filter((k) => k.startsWith("el:")).length).toBe(1);
  });

  it("counts KEYS, not NODES — chrome repeats its owner's key on purpose", () => {
    /* A pond's label carries its element's key; a parcel's acreage badge carries its parcel's;
     * a road's radius dot carries the road's. All identity-transparent chrome per
     * CHROME-NEVER-EATS-A-PRESS. A node count would drift with selection and hover state. */
    const withChrome = [...ONE_OF_EACH, "el:b1", "parcel:p1", "parcel:p1"];
    expect(censusFrom(withChrome).total).toBe(5);
    expect(withChrome.length).toBe(8);
  });

  it("an empty canvas is zero, and junk is ignored rather than counted", () => {
    expect(censusFrom([]).total).toBe(0);
    expect(censusFrom(null).total).toBe(0);
    expect(censusFrom(["", null, undefined, "el"]).total).toBe(0);
  });

  it("NAMES a key whose kind it does not know, instead of dropping it silently", () => {
    /* A sixth drawn kind that forgets to join FEATURE_KINDS must show up as a name — a census that
     * silently swallowed it would be the same class of blindness all over again. */
    const c = censusFrom([...ONE_OF_EACH, "easement:e1"]);
    expect(c.total).toBe(5);
    expect(c.unknown).toEqual(["easement:e1"]);
  });

  it("diffs by NAME, so a paste that adds and a delete that removes cannot cancel out", () => {
    const before = censusFrom(ONE_OF_EACH);
    const after = censusFrom([...ONE_OF_EACH.filter((k) => k !== "callout:c1"), "markup:m2"]);
    const d = censusDiff(before, after);
    expect(d.added).toEqual(["markup:m2"]);
    expect(d.removed).toEqual(["callout:c1"]);
    expect(d.changed).toBe(true);
    /* A bare count would have read 5 → 5 and reported "nothing happened". */
    expect(after.total).toBe(before.total);
  });
});

describe("the in-page expressions", () => {
  it("are argument-free EXPRESSIONS — Playwright evaluates a string as one and will not call it", () => {
    for (const expr of [FEATURE_CENSUS_EXPR, FEATURE_COUNT_EXPR]) {
      expect(expr.trim().startsWith("(")).toBe(true);
      expect(expr).not.toMatch(/=>\s*\{[\s\S]*\}\s*$/);   // not a bare function object
    }
  });

  it("carry no backticks, so they are safe to interpolate into a template-literal counter row", () => {
    for (const s of [FEATURE_CENSUS_EXPR, FEATURE_COUNT_EXPR, FEATURE_COUNT_FIELD]) expect(s).not.toContain("`");
  });

  it("count distinct keys when run against a fake DOM", () => {
    const nodes = ["el:b1", "markup:m1", "measure:0", "callout:c1", "parcel:p1", "el:b1"]
      .map((k) => ({ getAttribute: () => k }));
    const document = { querySelector: () => ({ querySelectorAll: () => nodes }) };
    expect(new Function("document", `return ${FEATURE_COUNT_EXPR}`)(document)).toBe(5);
    expect(censusFrom(new Function("document", `return ${FEATURE_CENSUS_EXPR}`)(document)).total).toBe(5);
  });

  it("return null — not zero — when there is no canvas, so 'could not measure' is never 'empty plan'", () => {
    const document = { querySelector: () => null };
    expect(new Function("document", `return ${FEATURE_COUNT_EXPR}`)(document)).toBeNull();
  });
});

/* ── the source sweep: an el-only counter cannot come back ──────────────────────────────────── */

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".auth" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(mjs|js)$/.test(name)) out.push(p);
  }
  return out;
}

const ROOT = new URL("..", import.meta.url).pathname;
const DRIVEN = [join(ROOT, "ui-audit"), join(ROOT, "e2e")];
const OWN_FILE = join(ROOT, "ui-audit/lib/featureCensus.mjs");

/** A CENSUS: an unfiltered sweep of `[data-el-id]` — `querySelectorAll` / `locator` / a spread —
 *  as opposed to a targeted `[data-el-id="<something>"]` lookup, which is fine. */
const CENSUS_RE = /(?:querySelectorAll|locator|querySelector)\s*\(\s*['"`]\[data-el-id\][^'"`]*['"`]/g;

/** Picking a "blank canvas" point by asking only whether the hit is inside an ELEMENT — either
 *  `!x.closest("[data-el-id]")` (keep it) or `if (x.closest("[data-el-id]")) continue` (skip it).
 *  A plain `closest("[data-el-id]")` that answers "which element owns this node" is a different
 *  question and is left alone. */
function blankPointHit(line) {
  return /!\s*[\w.?[\]]*\.closest\s*\(\s*['"`]\[data-el-id\]['"`]\s*\)/.test(line)
    || /\.closest\s*\(\s*['"`]\[data-el-id\]['"`]\s*\)\s*\)\s*(?:continue|return\b)/.test(line);
}

const MARKER_LOOKBACK = 6;

function censusHits(src) {
  const lines = src.split("\n");
  const hits = [];
  lines.forEach((line, i) => {
    if (!CENSUS_RE.test(line)) { CENSUS_RE.lastIndex = 0; return; }
    CENSUS_RE.lastIndex = 0;
    /* The escape valve, and it is deliberately a REASON rather than a bare pragma: a read that
     * really is about the element tier says so, on the line or in the few lines above it — the
     * window is 6 because the reason usually belongs in the doc comment on the function, not
     * jammed onto the query itself. Far enough away and it no longer counts (asserted below). */
    const context = lines.slice(Math.max(0, i - MARKER_LOOKBACK), i + 1).join("\n");
    if (/el-tier:/.test(context)) return;
    hits.push(`${i + 1}: ${line.trim().slice(0, 120)}`);
  });
  return hits;
}

describe("SOURCE SWEEP — no harness may take a census of plan contents from [data-el-id]", () => {
  const files = DRIVEN.flatMap((d) => walk(d)).filter((f) => f !== OWN_FILE);

  it("finds harnesses to sweep at all (a guard that scans nothing is a permanent green)", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("has no unmarked element-only census left in ui-audit/ or e2e/", () => {
    const offenders = [];
    for (const f of files) {
      const hits = censusHits(readFileSync(f, "utf8"));
      if (hits.length) offenders.push(`${f.replace(ROOT, "")}\n    ${hits.join("\n    ")}`);
    }
    expect(offenders, `element-only census found — move it to [data-feature] (ui-audit/lib/featureCensus.mjs), or mark it \`el-tier: <why>\` if the element tier really is the subject:\n\n${offenders.join("\n\n")}`)
      .toEqual([]);
  });

  it("MUTATION CHECK — the sweep really does catch one, and the marker really does exempt it", () => {
    expect(censusHits(`const n = svg.querySelectorAll("[data-el-id]").length;`)).toHaveLength(1);
    expect(censusHits(`/* el-tier: this axis draws buildings */\nconst n = svg.querySelectorAll("[data-el-id]").length;`)).toHaveLength(0);
    // a marker on the function's doc comment, a few lines up, still exempts the read it explains
    expect(censusHits(`/* el-tier: why */\nconst f = (page) => page.evaluate(() => {\n  const svg = q();\n  return svg.querySelectorAll("[data-el-id]").length;\n});`)).toHaveLength(0);
    // …but a marker far enough away is not a licence for an unrelated read
    expect(censusHits(`/* el-tier: why */\n${"//\n".repeat(8)}const n = svg.querySelectorAll("[data-el-id]").length;`)).toHaveLength(1);
    // a targeted lookup is not a census and was never the problem
    expect(censusHits('const n = document.querySelector(`[data-el-id="${id}"]`);')).toHaveLength(0);
  });

  it("MUTATION CHECK — the blank-point sweep catches both spellings, and only those", () => {
    expect(blankPointHit('if (hit && !hit.closest("[data-el-id]")) return { x, y };')).toBe(true);
    expect(blankPointHit('if (hit.closest("[data-el-id]")) continue;')).toBe(true);
    // "which element owns this node" is a different question and stays legal
    expect(blankPointHit('const owner = n.closest("[data-el-id]");')).toBe(false);
    expect(blankPointHit('if (!hit.closest(BLANK_POINT_EXCLUDE)) return { x, y };')).toBe(false);
  });

  /* ⛔ THE FAILURE `node --check` CANNOT SEE. `FEATURE_COUNT_FIELD` is interpolated into template
   * literals that are evaluated IN THE PAGE, so a file that uses it without importing it parses
   * fine and dies at run time with "not defined" — inside a browser, in a counter row, where it
   * reads as a broken arm rather than a broken import. */
  it("every file that interpolates a census helper actually imports it", () => {
    const missing = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const name of ["FEATURE_COUNT_FIELD", "BLANK_POINT_EXCLUDE"]) {
        const uses = new RegExp(`\\b${name}\\b`).test(src.replace(new RegExp(`^import[^;]*${name}[^;]*;`, "m"), ""));
        const imports = new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*["'][^"']*featureCensus\\.mjs["']`).test(src);
        if (uses && !imports) missing.push(`${f.replace(ROOT, "")} uses ${name} without importing it`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("nobody picks a 'blank canvas' point by excluding elements alone", () => {
    /* Worse than a wrong number: a point free of ELEMENTS can still be on top of a markup or a
     * parcel, and a 'pan' started there DRAGS that feature — silently mutating the plan being
     * measured, and sampling a serene idle frame as if it were a pan. */
    const offenders = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const line of src.split("\n")) {
        if (blankPointHit(line)) offenders.push(`${f.replace(ROOT, "")}: ${line.trim().slice(0, 110)}`);
      }
    }
    expect(offenders, `use BLANK_POINT_EXCLUDE (${BLANK_POINT_EXCLUDE}) — excluding only elements leaves four kinds looking like bare canvas:\n${offenders.join("\n")}`)
      .toEqual([]);
  });
});
