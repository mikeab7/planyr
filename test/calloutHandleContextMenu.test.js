/* NEW-3 (B806082) — right-click a callout leader to delete it.
 *
 * The leader body already carries `onContextMenu={(e) => onCalloutContext(e, c.id, i)}` and the
 * "Delete Leader" row already exists (B919, gated on `mapMenu.leaderIndex >= 0`) — so the mechanism
 * is built. AUDIT-FIRST found why it still doesn't fire for a natural right-click: once the callout
 * is SELECTED, `calloutHandles` renders three grip kinds — the width grips (box corners/mids), the
 * per-leader TIP grip (sits exactly at the arrowhead — the single most obvious place to aim a
 * right-click at a leader) and the per-leader ELBOW grip — into the always-on-top handle layer. In
 * SVG, paint order is hit-test order, so any of those grips wins a press landing on it. None of the
 * three carried an `onContextMenu`, so a right-click there fell all the way through the leader's own
 * handler and the box's own handler to the empty-canvas map menu, in total silence — the exact
 * CHROME-NEVER-EATS-A-PRESS shape (a handle that paints over its own object's body must forward the
 * press to that object, never swallow it).
 *
 * The fix: `data-handle="callout-tip"` and `data-handle="callout-elbow"` forward a right-click to
 * their own leader's context menu (`onCalloutContext(e, c.id, i)`); `data-handle="callout-width"`
 * forwards to the box's (`onCalloutContext(e, c.id, -1)`). This is a SOURCE guard for the same reason
 * as handleLayerOrder.test.js — the property is about which handler a topmost, always-on-top node
 * carries, which only a source read or a real browser can prove.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SP = readFileSync(join(here, "../src/workspaces/site-planner/SitePlanner.jsx"), "utf8");

const calloutHandlesStart = SP.indexOf("const calloutHandles = (() => {");
const calloutHandlesEnd = SP.indexOf("\n  })();", calloutHandlesStart);
const block = SP.slice(calloutHandlesStart, calloutHandlesEnd);

function attrsOf(marker) {
  // Grab the <rect .../> or <circle .../> element that carries this data-handle marker.
  const i = block.indexOf(marker);
  expect(i, `${marker} not found in calloutHandles`).toBeGreaterThan(-1);
  const openStart = block.lastIndexOf("<", i);
  const closeEnd = block.indexOf("/>", i);
  return block.slice(openStart, closeEnd + 2);
}

describe("NEW-3: every callout handle forwards a right-click to its own object's menu", () => {
  it("the width grip (box) forwards to the box's context menu", () => {
    const el = attrsOf('data-handle="callout-width"');
    expect(el).toMatch(/onContextMenu=\{.*onCalloutContext\(e, c\.id, -1\)/);
  });

  it("the per-leader tip grip forwards to ITS leader's context menu, not the box's", () => {
    const el = attrsOf('data-handle="callout-tip"');
    expect(el).toMatch(/onContextMenu=\{.*onCalloutContext\(e, c\.id, i\)/);
  });

  it("the per-leader elbow grip forwards to ITS leader's context menu", () => {
    const el = attrsOf('data-handle="callout-elbow"');
    expect(el).toMatch(/onContextMenu=\{.*onCalloutContext\(e, c\.id, i\)/);
  });
});
