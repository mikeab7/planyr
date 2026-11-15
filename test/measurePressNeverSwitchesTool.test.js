/* B2671280 (owner constraint #56) — a PRESS on the canvas never ends the armed tool, and a finished measurement never
 * takes a left press while a Measure tool is armed.
 *
 * The bug this pins: `startMoveMeasure` answered a press from the Measure tool by selecting the measurement and calling
 * `setTool("select")`, so the first click of the next measurement — landing on (or, for an Area, inside) an old one —
 * placed nothing. Every OTHER press-starter is already gated on `tool === "select"`; this keeps it that way, structurally,
 * so a new surface cannot reintroduce the same drop on a different tool (markups, roads, buildings, parcels, overlays).
 * The behaviour itself is proved on the real canvas by e2e/measure-first-click.spec.js (red on the pre-fix build). */
import { describe, it, expect } from "vitest";
import { plannerSource } from "./helpers/plannerSource.js";

const SP = plannerSource();

/* "Press-starter" = a `const startXxx = (e, …) =>` pointer handler (tool-ARMING commands such as startMergePick take no event and may set the tool).
 * Body of `const <name> = (...) => { ... }` declared at the component's own indent, up to the next sibling `const`/`function`. */
function bodyOf(name) {
  const at = SP.indexOf(`  const ${name} = (`);
  if (at < 0) return null;
  const rest = SP.slice(at + 10);
  const next = rest.search(/\n  (const|function|let) [A-Za-z_$]/);
  return rest.slice(0, next < 0 ? rest.length : next);
}
const starters = [...SP.matchAll(/^  const (start[A-Z][A-Za-z0-9]*) = \(e[,)]/gm)].map((m) => m[1]);

describe("B2671280: a press-starter never drops the armed tool", () => {
  it("finds the press-starters by scanning (a new one is covered automatically)", () => {
    expect(starters).toContain("startMoveMeasure");
    expect(starters).toContain("startMoveEl");
    expect(starters).toContain("startMoveMarkup");
    expect(starters.length).toBeGreaterThan(15);
  });

  it.each(starters)("%s does not call setTool / selectTool (a press must not end the armed tool)", (name) => {
    const body = bodyOf(name);
    expect(body, `could not locate ${name}`).toBeTruthy();
    expect(body, `${name} switches the tool on a press — that eats the first click of whatever tool the user armed`).not.toMatch(/\bset(Tool)\(|\bselectTool\(/);
  });

  it("startMoveMeasure answers a press ONLY in the Select tool", () => {
    const body = bodyOf("startMoveMeasure");
    expect(body).toMatch(/if \(tool !== "select"\) return;/);
    expect(body, "a Measure-tool press on a measurement must fall through to onBgDown (place a point)").not.toMatch(/tool === "measure"/);
  });

  it("the measurement grab layer takes a LEFT press in Select only; Measure keeps it hit-testable for right-click alone", () => {
    expect(SP).toMatch(/const canGrab = tool === "select";/);
    expect(SP).toMatch(/const hitLive = canGrab \|\| \(tool === "measure" && !measDraft\.length\);/);
    // every grab shape binds the press handler through canGrab, never unconditionally
    const binds = [...SP.matchAll(/onPointerDown=\{([^}]*)startMoveMeasure\(e, i\)([^}]*)\}/g)];
    expect(binds.length).toBeGreaterThanOrEqual(3);
    for (const [full] of binds) expect(full, "an ungated startMoveMeasure binding").toMatch(/canGrab \?/);
  });
});
