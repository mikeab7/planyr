import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse } from "@babel/parser";

/* Guard against the silent "duplicate JSX prop" clobber — a build-invisible correctness
 * bug. When the same attribute is written twice on one element (e.g. two
 * `onPointerDownCapture={...}`), JSX/React keeps only the LAST one and DROPS the first
 * with no error: the build is green, lint is green (the minimal gate has no react plugin),
 * and a handler just silently stops firing. This actually shipped once — B331's pinch
 * `onPointerDownCapture`/`onPointerMoveCapture` overwrote the Site Planner's vertex-edit
 * capture handlers — so it now has a test. In the spirit of eslint.config.js: catch the
 * class of bug a build-only check can't see, using a parser that's already a dep. */

function walkJsx(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkJsx(p, out);
    else if (name.endsWith(".jsx")) out.push(p);
  }
  return out;
}

// Recursively collect every JSXOpeningElement from a Babel AST (no @babel/traverse needed).
function collectOpeningElements(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { for (const n of node) collectOpeningElements(n, out); return out; }
  if (node.type === "JSXOpeningElement") out.push(node);
  for (const k of Object.keys(node)) {
    if (k === "loc" || k === "start" || k === "end" || k === "range") continue;
    const v = node[k];
    if (v && typeof v === "object") collectOpeningElements(v, out);
  }
  return out;
}

describe("no duplicate JSX props (silent last-wins clobber guard)", () => {
  const files = walkJsx("src");

  it("found .jsx files to scan", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("no element repeats an attribute (the second silently overwrites the first)", () => {
    const offenders = [];
    for (const file of files) {
      const code = readFileSync(file, "utf8");
      const ast = parse(code, { sourceType: "module", plugins: ["jsx"] });
      for (const el of collectOpeningElements(ast)) {
        const seen = new Map();
        for (const attr of el.attributes || []) {
          if (attr.type !== "JSXAttribute" || !attr.name) continue;
          const name = attr.name.name;
          if (typeof name !== "string") continue; // skip namespaced/spread
          const line = attr.loc?.start?.line;
          if (seen.has(name)) offenders.push(`${file}: <${el.name?.name || "?"}> repeats "${name}" (lines ${seen.get(name)} & ${line})`);
          else seen.set(name, line);
        }
      }
    }
    expect(offenders, `duplicate JSX props:\n${offenders.join("\n")}`).toEqual([]);
  });
});
