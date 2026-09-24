/* NEW-1 (adversarial review, 2026-09-08) — A COUNTY NAME RESOLVED WITHOUT A STATE IS A DEFECT.
 *
 * THE EXPOSURE, reproduced before it was fixed by
 * `ui-audit/review-2026-09-08/probe-comp-county-state.mjs`: a comp pin dropped in Montgomery
 * County PA, Liberty County GA or Chambers County AL came back carrying the TEXAS routing key of
 * the same name, so the Comps card read "Montgomery County, TX" for a Norristown deal. The card
 * was innocent — `probe-county-label.mjs` cleared it, and its label agrees with the registry for
 * every configured key. The defect was one level up, in the code that decides WHICH key an anchor
 * gets: `countyKeyForName(name)` with no state means "Texas only", and it was being handed names
 * from `countyAtPoint`, whose offline floor (B209502) answers from a NATIONAL roster of 3,144
 * counties across 51 states. Texas shares a county name with another state hundreds of times.
 *
 * ON A SITE the same key is not cosmetic: it selects the drainage authority, the detention
 * criteria and the setbacks (the whole reason `countyPolygons.js` exists), so the B792 load-time
 * self-heal was healing an out-of-state plan INTO a Texas county.
 *
 * TWO HALVES, deliberately — the value test alone would pass again the day someone adds a fifth
 * unqualified call site, so the sweep is the part that actually holds:
 *   1. the SWEEP: no call in `src/` may pass a name without a state;
 *   2. the VALUES: an out-of-state name resolves to null, and the in-state cases still resolve
 *      (a guard that only proves the red side rots — DRIVER-SCROLL-IS-NOT-APP-SCROLL §6).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { countyKeyForName } from "../src/workspaces/site-planner/lib/counties.js";

const SRC = path.resolve(__dirname, "../src");

function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(js|jsx)$/.test(name)) out.push(p);
  }
  return out;
}

/* Every `countyKeyForName(` CALL in a file, with the argument text between its balanced parens —
 * a regex alone can't tell `countyKeyForName(ans.name)` from `countyKeyForName(f(a), s)`, and the
 * real call sites nest calls inside their arguments. Declarations/imports are skipped. */
/* Comments are prose, not calls — this very file's fix notes NAME the banned shape, and the first
 * run of the sweep dutifully reported one of them as a call site. Strings are left alone: nothing
 * here builds a call out of one, and stripping them is where a hand-rolled scanner starts guessing. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function unqualifiedCalls(input) {
  const src = stripComments(input);
  const found = [];
  const re = /countyKeyForName\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    const before = src.slice(Math.max(0, m.index - 30), m.index);
    if (/function\s+$|export\s+$/.test(before)) continue; // the declaration itself
    let depth = 0, i = re.lastIndex - 1, end = -1;
    for (; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) continue;
    const args = src.slice(re.lastIndex, end);
    // A top-level comma means a state was passed. Nested parens/brackets don't count.
    let d = 0, hasComma = false;
    for (const ch of args) {
      if ("([{".includes(ch)) d++;
      else if (")]}".includes(ch)) d--;
      else if (ch === "," && d === 0) hasComma = true;
    }
    if (!hasComma) found.push(`countyKeyForName(${args})`);
  }
  return found;
}

describe("countyKeyForName is never called without a state (the sweep)", () => {
  it("no source file resolves a county name unqualified", () => {
    const offenders = [];
    for (const file of sourceFiles(SRC)) {
      const calls = unqualifiedCalls(readFileSync(file, "utf8"));
      for (const c of calls) offenders.push(`${path.relative(SRC, file)}: ${c}`);
    }
    expect(offenders).toEqual([]);
  });

  it("the sweep has teeth — it flags an unqualified call and clears a qualified one", () => {
    expect(unqualifiedCalls('const k = countyKeyForName(ans.name);')).toHaveLength(1);
    expect(unqualifiedCalls('const k = countyKeyForName(ans.name, ans.state);')).toHaveLength(0);
    // The shapes the naive regex would get wrong, both ways.
    expect(unqualifiedCalls('countyKeyForName(String(f.name).trim())')).toHaveLength(1);
    expect(unqualifiedCalls('countyKeyForName(String(f.name), pick(a, b))')).toHaveLength(0);
    expect(unqualifiedCalls('export function countyKeyForName(name, state = null) {')).toHaveLength(0);
    // Prose that NAMES the banned shape is not a call site — the first run of this sweep flagged
    // one of the fix's own comments, which is how this clause got written.
    expect(unqualifiedCalls('/* `countyKeyForName(name)` with no state means Texas only. */')).toHaveLength(0);
    expect(unqualifiedCalls('// never write countyKeyForName(ans.name)\nconst k = countyKeyForName(a, b);')).toHaveLength(0);
  });
});

describe("a county name outside the configured states resolves to nothing, never a same-named key", () => {
  // The four names the probe caught, each a real county in another state AND a real Texas county.
  // ⛔ B1873776 (2026-09-23) — `["Liberty County", "GA"]` used to belong here: at the time this
  // fixture was written, Liberty County GA had no configured `ga_liberty` key, so this case was
  // proving "an unconfigured county name resolves to null, never the same-named Texas key." That
  // stopped being true the moment `ga_liberty` was wired — the row below now asserts the NEW
  // correct answer instead, and this fixture moved to a still-genuinely-unconfigured Florida
  // county (Florida is wired statewide-only, no per-county Florida keys exist) so this describe
  // keeps testing what it was written to test.
  it.each([
    ["Montgomery County", "PA"],
    ["Liberty County", "FL"],
    ["Chambers County", "AL"],
    ["Harris County", "GA"],
    ["Montgomery County", "AL"],
  ])("%s, %s → null", (name, state) => {
    expect(countyKeyForName(name, state)).toBeNull();
  });

  // KNOWN-GOOD ARM — Liberty County GA is now configured (B1873776), so a GA-qualified call must
  // reach it, while a TX-qualified call for the same name must still reach the Texas county, never
  // either one bleeding into the other's answer.
  it("Liberty County now resolves per state — GA reaches the new Georgia county, TX still reaches Texas's own", () => {
    expect(countyKeyForName("Liberty County", "GA")).toBe("ga_liberty");
    expect(countyKeyForName("Liberty County", "TX")).toBe("liberty");
  });

  // KNOWN-GOOD ARM — Jackson County GA (also wired this session, with a pinned id field —
  // test/parcelQuery.test.js covers the pin itself) resolves distinctly from any other state's
  // same-named county.
  it("Jackson County resolves to the Georgia key when GA-qualified", () => {
    expect(countyKeyForName("Jackson County", "GA")).toBe("ga_jackson");
  });

  // KNOWN-GOOD ARMS — the states Planyr actually configures must keep resolving, or the fix above
  // is just breaking county resolution everywhere and passing this file by doing nothing.
  it("still resolves the configured Texas counties when the state says TX", () => {
    expect(countyKeyForName("Montgomery", "TX")).toBe("montgomery");
    expect(countyKeyForName("Liberty County", "TX")).toBe("liberty");
    expect(countyKeyForName("Chambers", "TX")).toBe("chambers");
    expect(countyKeyForName("Harris", "TX")).toBe("harris");
    expect(countyKeyForName("Fort Bend", "TX")).toBe("fortbend");
  });

  it("resolves Colorado counties a state-qualified call can now reach", () => {
    // Before the fix every Colorado caller passed no state, so a Denver comp got NO county at all
    // (excluded from the Comps card peer set and flagged on the sheet) — the same missing argument,
    // failing quietly in the other direction.
    expect(countyKeyForName("Denver", "CO")).toBe("co_denver");
    expect(countyKeyForName("Adams", "CO")).toBe("co_adams");
  });
});
