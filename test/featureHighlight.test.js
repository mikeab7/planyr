/* B2507061 amendment (owner 2026-10-29, Olive Branch, zoning on): "Each hovered polygon gets a red outline that never clears … hovering does nothing at all."
 * Hover highlights NOTHING on any layer; a CLICK outlines exactly one feature, and the outline clears when another feature is clicked, the card closes, or empty map
 * is clicked. This guards both halves: the source never binds a hover restyle, and the click highlight is single, exactly restored, and leaves zero after release. */
import { describe, it, expect, beforeEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { makeHighlight, setHighlight, releaseHighlight, clearHighlight, highlightedCount, childFor, _resetHighlightForTests } from "../src/workspaces/site-planner/lib/featureHighlight.js";

/* A stand-in for a Leaflet path: options + setStyle that merges, like L.Path. */
const path = (opts = {}) => {
  const p = { options: { color: "#3388ff", weight: 2, opacity: 0.6, fillColor: "#3388ff", fillOpacity: 0.2, dashArray: "4 2", ...opts }, fronted: 0 };
  p.setStyle = (s) => { Object.assign(p.options, s); };
  p.bringToFront = () => { p.fronted++; };
  return p;
};
const snapshot = (p) => JSON.stringify(p.options);

beforeEach(() => _resetHighlightForTests());

describe("click highlight", () => {
  it("outlines only the clicked feature and restores its exact prior style on release", () => {
    const a = path();
    const before = snapshot(a);
    const t = makeHighlight(a);
    setHighlight(t);
    expect(highlightedCount()).toBe(1);
    expect(a.options.color).not.toBe("#3388ff");
    expect(a.options.dashArray).toBe(null);
    releaseHighlight(t);
    expect(highlightedCount()).toBe(0);
    expect(snapshot(a)).toBe(before);
  });

  it("never holds more than one highlight: a second click turns the first off", () => {
    const a = path(), b = path();
    const ta = makeHighlight(a), tb = makeHighlight(b);
    const beforeA = snapshot(a);
    setHighlight(ta);
    setHighlight(tb);
    expect(ta.active).toBe(false);
    expect(tb.active).toBe(true);
    expect(snapshot(a)).toBe(beforeA);
    expect(highlightedCount()).toBe(1);
    // dozens of clicks in a row still leave exactly one
    const many = Array.from({ length: 40 }, () => path());
    many.forEach((p) => setHighlight(makeHighlight(p)));
    expect(many.filter((p) => p.options.weight > 2).length).toBe(1);
  });

  it("a card closing (release) leaves zero highlighted features, and a late release of an old card cannot clear the new one", () => {
    const a = path(), b = path();
    const ta = makeHighlight(a), tb = makeHighlight(b);
    setHighlight(ta);
    setHighlight(tb);
    releaseHighlight(ta); // the first card's popup closing after the second was clicked
    expect(tb.active).toBe(true);
    expect(highlightedCount()).toBe(1);
    releaseHighlight(tb);
    expect(highlightedCount()).toBe(0);
    expect(b.options.color).toBe("#3388ff");
  });

  it("clicking empty map (clearHighlight) leaves zero", () => {
    const a = path();
    setHighlight(makeHighlight(a));
    clearHighlight();
    expect(highlightedCount()).toBe(0);
    expect(a.options.color).toBe("#3388ff");
  });

  it("childFor finds the drawn child by feature identity", () => {
    const f1 = { id: 1 }, f2 = { id: 2 };
    const c1 = { feature: f1 }, c2 = { feature: f2 };
    const group = { eachFeature: (fn) => [c1, c2].forEach(fn) };
    expect(childFor(group, f2)).toBe(c2);
    expect(childFor(group, { id: 2 })).toBe(null);
  });

  it("hover alone never highlights: nothing in the module reacts to a pointer passing over a feature", () => {
    const a = path();
    makeHighlight(a); // a token is inert until setHighlight
    expect(a.options.color).toBe("#3388ff");
    expect(highlightedCount()).toBe(0);
  });
});

/* Source guard: no overlay layer binds a hover handler that restyles it (the old wireFeatureHover restored a hard-coded red on mouseout and never cleared). */
describe("no hover restyle anywhere in the layer code", () => {
  const root = new URL("../src/workspaces/site-planner/", import.meta.url).pathname;
  const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : /\.(js|jsx)$/.test(n) ? [p] : []; });
  const files = walk(root);
  it("only the map-level coordinate chip listens for mouseout; no layer binds mouseover/mouseenter/mouseleave", () => {
    const offenders = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8").split("\n");
      src.forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, "");
        if (/["'](mouseover|mouseenter|mouseleave)["']|\bmouseover\s*:/.test(code)) offenders.push(`${f.slice(root.length)}:${i + 1}`);
        if (/["']mouseout["']/.test(code) && !/MapFinder\.jsx$/.test(f)) offenders.push(`${f.slice(root.length)}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe("a boundary's fill never catches a click meant for the layer under it", () => {
  it("index.css makes boundary paths answer on their outline only", () => {
    const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.leaflet-pane > svg path\.pf-boundary-hit\.leaflet-interactive\s*\{\s*pointer-events:\s*visibleStroke/);
  });
});
