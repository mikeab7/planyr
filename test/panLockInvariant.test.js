/* B1122 — the STRUCTURAL invariant: the basemap and the drawn feet-frame are driven from ONE
 * source value, applied in the SAME frame.
 *
 * The owner's correction, and it was the right one: a pixel-offset probe against real imagery is
 * unrunnable in this sandbox (no tile host) AND in his (hidden tab, rAF suspended — the B1086 trap).
 * Both of us hit the same wall chasing the instrument. So assert the STRUCTURE instead: it needs no
 * imagery, no visible tab and no rAF, and it runs in CI on every commit.
 *
 * THE INVARIANT. The SVG is rendered from `view` during the React commit and paints immediately.
 * The basemap wrapper's transform is computed from the SAME `view`. For the two never to disagree,
 * that write must happen BEFORE paint — i.e. in a LAYOUT effect. A passive `useEffect` runs after
 * paint, which paints one frame of separation per pan frame: exactly "the buildings will move
 * separately and then kinda sling back into position".
 *
 * TEETH: the first assertion FAILS on the pre-fix model — restore `useEffect(` on that block and it
 * goes red — which is what makes this a guard and not a decoration (the B1062 standard).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");

// The block is identified by the transform write itself, not by a line number.
const TRANSFORM_WRITE = "wrap.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`";

describe("B1122 — the basemap transform is applied in the same frame as the drawn layer", () => {
  it("the effect that writes the basemap transform is a LAYOUT effect, not a passive one", () => {
    const at = src.indexOf(TRANSFORM_WRITE);
    expect(at, "the basemap transform write was not found — has it moved or been renamed?").toBeGreaterThan(-1);
    // Walk back to the effect that owns this write and confirm which kind it is.
    const before = src.slice(0, at);
    const layoutAt = before.lastIndexOf("useLayoutEffect(() => {");
    const passiveAt = before.lastIndexOf("useEffect(() => {");
    expect(layoutAt, "no effect encloses the transform write").toBeGreaterThan(-1);
    // The ENCLOSING effect is whichever opener is nearest above the write.
    expect(layoutAt).toBeGreaterThan(passiveAt);
  });

  it("both surfaces read the SAME source value — one transform source, not two", () => {
    const at = src.indexOf(TRANSFORM_WRITE);
    // Slice the ENCLOSING effect (opener → write), not a fixed window: the source reads sit at the
    // top of the effect and a fixed lookback silently misses them.
    const block = src.slice(src.lastIndexOf("useLayoutEffect(() => {", at), at);
    // The wrapper's transform is derived from `view` (offX/offY/ppf), the same state the SVG renders
    // from. If this ever starts from a separately-tracked map centre instead, the two can drift apart
    // again by construction, which is the failure mode this item exists to remove.
    expect(block).toMatch(/view\.offX/);
    expect(block).toMatch(/view\.offY/);
    expect(block).toMatch(/view\.ppf/);
  });

  it("the fix is not a shortened debounce — the commit delay is unchanged", () => {
    // Narrowing the window would read as fixed on a slow drag and still sling on a fast flick, which
    // the owner called out explicitly. The debounce is deliberately left alone; the per-frame lag is
    // what was removed. This pins that intent so a future "perf tweak" can't quietly substitute one
    // for the other.
    expect(src).toMatch(/setTimeout\(\(\) => commit\(center, z, true\), 160\)/);
  });

  it("VIEWPORT-STABLE is not violated elsewhere in the geo transform path", () => {
    // Any OTHER place that writes a transform onto the map wrapper must also be pre-paint.
    const writes = [...src.matchAll(/wrap\.style\.transform\s*=/g)].map((m) => m.index);
    for (const at of writes) {
      const before = src.slice(0, at);
      expect(before.lastIndexOf("useLayoutEffect(() => {"), `transform write at ${at} is in a passive effect`)
        .toBeGreaterThan(before.lastIndexOf("useEffect(() => {"));
    }
  });
});
