/* MasterView double-click-to-edit silently lost focus to the table wrapper (discovered while
 * live-verifying NEW-1's multi-owner Owner cell in MasterView — reproduced identically on the
 * Name column, so it was never owner-specific).
 *
 * MEASURED CAUSE: onCellClick schedules `setTimeout(() => tableWrapRef.current.focus(), 0)` on
 * every click, and cancels only the PREVIOUS such timer. A real double-click fires TWO clicks
 * before the dblclick that opens the editor, so the SECOND click's timer is still pending when
 * the editor mounts and focuses its own input — the timer then fires (a macrotask, so strictly
 * after the editor's mount effect) and steals focus straight back to the table wrapper. Every
 * keystroke after that lands on the table's own key handler instead of the input: confirmed live
 * in a real browser, `document.activeElement` was the wrapper DIV, not the newly-mounted input,
 * and typing produced no change to the input's value at all.
 *
 * The fix: `openEdit` cancels that pending timer before opening an editor. This file pins the
 * structural shape so a future MasterView column can't reintroduce the direct call it wraps.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

import { sequencePageSource } from "./helpers/sequenceSource.js";
const here = dirname(fileURLToPath(import.meta.url));
const seq = sequencePageSource();

const masterViewSrc = (() => {
  const start = seq.indexOf("function MasterView(");
  expect(start, "MasterView must exist").toBeGreaterThan(-1);
  // MasterView is the last declaration of taskReport/TaskReport.jsx (an `export function`); its body ends where the
  // next top-level function, or the module's harness-registration block, begins.
  const rest = seq.slice(start + 10);
  const m = /\n(?:export )?function |\n\/\/ harness compatibility/.exec(rest);
  return seq.slice(start, m ? start + 10 + m.index : start + 60000);
})();

describe("MasterView — a double-click must not lose focus to the table wrapper's stale timer", () => {
  it("openEdit exists and cancels the pending click-refocus timer before opening", () => {
    expect(masterViewSrc, "openEdit must exist").toMatch(
      /const openEdit = payload => \{ clearTimeout\(cellFocusTimer\.current\); setLocalEdit\(payload\); \};/,
    );
  });

  it("every onDoubleClick that opens an editor goes through openEdit, never setLocalEdit directly", () => {
    const dblClicks = [...masterViewSrc.matchAll(/onDoubleClick=\{[\s\S]*?\}\}/g)].map(m => m[0]);
    expect(dblClicks.length, "expected the known MasterView double-click editors (name/duration/health/%/owner)").toBeGreaterThanOrEqual(5);
    const offenders = dblClicks.filter(d => /\bsetLocalEdit\(/.test(d) && !/\bopenEdit\(/.test(d));
    expect(offenders, "a double-click handler calling setLocalEdit directly reintroduces the focus-steal race").toEqual([]);
  });

  it("onCellClick's timer-clear still runs on every click too (belt-and-suspenders for a real triple-click)", () => {
    const i = masterViewSrc.indexOf("const onCellClick");
    expect(i, "onCellClick must exist").toBeGreaterThan(-1);
    const body = masterViewSrc.slice(i, i + 400);
    expect(body).toMatch(/clearTimeout\(cellFocusTimer\.current\)/);
  });
});
