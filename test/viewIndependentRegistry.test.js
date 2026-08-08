/* VIEW-INDEPENDENT-ONCE — the CI-runnable half of the guard (NEW-3).
 *
 * The real gate is `ui-audit/verify-view-independent.mjs`: it drives a pure pan in a real browser
 * against an instrumented build and COUNTS how many times each registered computation runs. That is
 * the only instrument that can see this defect class — it draws the identical picture when broken —
 * but it needs Chromium and a preview server, and this repo's required `build` check runs `npm test`
 * and `npm run build` and nothing else. A guard that cannot run in CI is a guard that runs when
 * someone remembers.
 *
 * So this is the half that always runs, and it asserts the two things that can be checked from the
 * source alone:
 *   1. every registered computation STILL EXISTS as a memo (the registry cannot rot silently — the
 *      browser gate makes the same check against runtime observation);
 *   2. no registered memo's dependency array carries a RAW VIEW TERM. That is the exact mechanism of
 *      the `view-churned` verdict, and it is the one-line edit that reintroduces the class.
 *
 * It is deliberately WEAKER than the counter — it cannot see a computation called from the render
 * body with no memo at all, which is half of what the detector found. Run the browser gate before
 * claiming this class is clear.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { REGISTRY } from "../ui-audit/lib/viewIndependentRegistry.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "src/workspaces/site-planner/SitePlanner.jsx"), "utf8");

/* A view term whose PRESENCE in a dep array is the defect. `view.ppf` is deliberately NOT here:
 * a value that is genuinely a function of the scale — the scale bar, the north arrow, the label
 * frame — must key on it, and a pan holds it constant, so it costs nothing per gesture. Bare
 * `view`, the offsets, and the anchor are what a pan moves. */
const VIEW_TERMS = [/\bview\b(?!\.ppf)/, /\boffX\b/, /\boffY\b/, /\brvOff[XY]\b/, /\bpanAnchor\b/, /\bpanD[xy]\b/];

/** The dependency array of `const NAME = useMemo(…)`, read by balanced-bracket scan rather than a
 *  regex — the factories here contain commas, parens and brackets by the hundred. */
function depsOf(name) {
  const decl = `const ${name} = useMemo(`;
  const at = src.indexOf(decl);
  if (at < 0) return null;
  let i = at + decl.length, depth = 1, lastComma = -1;
  for (; i < src.length && depth > 0; i++) {
    const c = src[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 1) lastComma = i;
  }
  if (depth !== 0 || lastComma < 0) return null;
  return src.slice(lastComma + 1, i - 1).trim().replace(/,\s*$/, "");
}

const SP_FILE = "src/workspaces/site-planner/SitePlanner.jsx";
const spEntries = REGISTRY.filter((r) => r.file === SP_FILE);
const libEntries = REGISTRY.filter((r) => r.file !== SP_FILE);

describe("the VIEW-INDEPENDENT-ONCE registry has not rotted", () => {
  it("is not empty — an empty registry is a guard that asserts nothing", () => {
    expect(REGISTRY.length).toBeGreaterThan(8);
  });

  it("every SitePlanner entry names a real memo in SitePlanner.jsx", () => {
    const missing = spEntries.filter((r) => depsOf(r.name) == null).map((r) => r.name);
    expect(missing).toEqual([]);
  });

  /* B217539 — the registry gained its first PURE-LIBRARY entry. A leaf has no dep array to
   * inspect, so the source-level half checks the two things it can: the symbol still exists as an
   * export in the file the registry names (the browser gate makes the same check against runtime
   * observation), and it is reached through a memo rather than being called raw. Without this, a
   * library entry would be silently exempt from the anti-rot check that is this file's whole job. */
  it("every library entry names a real export in the file it claims", () => {
    for (const r of libEntries) {
      const code = readFileSync(join(ROOT, r.file), "utf8");
      expect(
        new RegExp(`export\\s+(?:const|function)\\s+${r.name}\\b`).test(code),
        `${r.file} no longer exports ${r.name} — the registry has rotted`,
      ).toBe(true);
    }
  });

  it("every entry carries a WHY, so a failure names the property and not just the symbol", () => {
    for (const r of REGISTRY) expect(r.why, r.name).toMatch(/\S+(\s+\S+){3,}/);
  });
});

describe("⛔ no registered memo may key on a view term the answer does not use", () => {
  // Library entries have no dep array to read; their key is a value signature, and the browser
  // gate is what proves it holds. Only the component memos can be checked this way.
  for (const r of spEntries) {
    it(`${r.name} — ${r.why}`, () => {
      const deps = depsOf(r.name);
      expect(deps, `${r.name} is registered but has no memo`).not.toBeNull();
      for (const term of VIEW_TERMS) {
        expect(term.test(deps), `${r.name} deps [${deps}] carry a view term — this is the one-line edit that reintroduces the class`).toBe(false);
      }
    });
  }
});

describe("the two halves of the cull latch are both present", () => {
  // Either one alone is a no-op: re-deriving the numbers re-filters the model, and rebuilding the
  // object invalidates every memo downstream even when the numbers did not move.
  it("the rect is latched against the rect already held", () => {
    // B1449 — the latch is now keyed on the RENDER view (constant through a zoom gesture, so it can
    // actually hold) and probed against the LIVE one (so a zoom-out still re-arms). Passing one view
    // for both is what made a wheel notch re-filter the whole model.
    expect(src).toContain("cullRectFor(renderView, size, cullRectRef.current, undefined, undefined, view)");
  });
  it("and `cullRectFor` returns the PREVIOUS OBJECT rather than an equal one", () => {
    const cull = readFileSync(join(ROOT, "src/workspaces/site-planner/lib/viewCull.js"), "utf8");
    expect(cull).toContain("return prev;");
  });
});
