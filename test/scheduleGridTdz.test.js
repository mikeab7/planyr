/* B2530690 follow-up — "Cannot access 'allCols' before initialization" took the Schedule grid down on production for
 * the minutes after #2694 merged. Cause: `useRef({ tasks, allCols, … })` sat ABOVE `const allCols = useMemo(…)` in
 * GridView. The in-browser-Babel page (public/, what every local run and unit test sees) turns `const` into `var`, so it
 * read `undefined` and worked; the COMPILED production page keeps block scoping and throws at render.
 *
 * This guard reads GridView's own top level: a `useRef(` / `useState(` initializer is evaluated immediately, so it may not
 * name a `const` that the component declares LATER. (The real instrument for the general class is serving the compiled
 * page: `npm run build`, then `SEQ_ROOT=dist node ui-audit/verify-schedule-multirange.mjs`.) */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../public/sequence/index.html", import.meta.url), "utf8");
const start = html.indexOf("function GridView(");
const end = html.indexOf("\nfunction ", start + 20);
const body = html.slice(start, end).split("\n");

describe("GridView — no render-time read of a later const", () => {
  it("every useRef/useState initializer only names consts declared above it", () => {
    const declaredAt = new Map();                       // top-level (2-space) `const name =` → line index
    body.forEach((ln, i) => { const m = /^  const (\w+)\s*=/.exec(ln); if (m && !declaredAt.has(m[1])) declaredAt.set(m[1], i); });
    const bad = [];
    body.forEach((ln, i) => {
      const m = /^  const (?:\[?\w+(?:,\s*\w+)?\]?)\s*=\s*(?:React\.)?(useRef|useState)\((.*)$/.exec(ln);
      if (!m) return;
      const init = m[2].replace(/\/\/.*$/, "");
      for (const [name, at] of declaredAt) {
        if (at > i && new RegExp(`(^|[^\\w.$])${name}(?![\\w$])(?!\\s*:)`).test(init)) bad.push(`line ${i + 1}: ${m[1]} initializer names \`${name}\`, declared at line ${at + 1}`);
      }
    });
    expect(bad).toEqual([]);
  });
  it("RED-PROOF: the guard does catch the shipped shape", () => {
    const sample = ["  const a = useRef({ x, allCols, y });", "  const allCols = useMemo(() => 1, []);"];
    const declared = new Map([["allCols", 1]]);
    const hit = /^  const (?:\[?\w+(?:,\s*\w+)?\]?)\s*=\s*(?:React\.)?(useRef|useState)\((.*)$/.exec(sample[0]);
    expect(hit && new RegExp(`(^|[^\\w.$])allCols(?![\\w$])`).test(hit[2]) && declared.get("allCols") > 0).toBe(true);
  });
});
