/* NEW-1 — THE ROW-1 CENTRE SLOT IS CENTRED ON THE HEADER, NOT ON THE LEFTOVER SPACE.
 *
 * THE REPORT (owner, 2026-08-09, right after the label grammar changed): "now the jurisdiction is
 * not centered." Measured on Clay & Porter (project smqh35mzsju1) on production at a 1600 px
 * viewport, true centre x = 800: the chip spanned 776 → 1012, centre x = 894 — 94 px right of the
 * window's centre. The chip was PERFECTLY centred inside its slot; the slot itself was off-centre,
 * spanning 410 → 1378 (centre 894) because `flex: 1 1 0%` makes it the space left over between the
 * breadcrumb and the account controls, and the breadcrumb group is the wider of the two by ~94 px.
 *
 * ⛔ NOT A REGRESSION FROM THE LABEL CHANGE (B367296). A leftover-space centre slot has ALWAYS
 * positioned the chip relative to the side groups, so the chip's position has always depended on the
 * project and plan names. The new label text only made a long-standing offset visible. The browser
 * half of this guard proves that directly: the offset tracks the BREADCRUMB, not the label.
 *
 * ⛔ THE REAL PROOF IS A MEASUREMENT IN A BROWSER — `ui-audit/verify-header-center.mjs`, which reads
 * the chip's own `getBoundingClientRect` against the viewport centre for the longest and shortest
 * label shapes crossed with the longest and shortest breadcrumbs, at four widths. CI cannot run a
 * browser, so this suite guards the two halves that can be checked without one: the pure bound, and
 * — by reading the real source — the layout rule it feeds.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { centerSlotMaxWidth, centerSlotPlan, CENTER_SLOT_GAP, CENTER_SLOT_MIN } from "../src/shared/ui/headerCenterFit.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const header = readFileSync(join(ROOT, "src/shared/ui/AppHeader.jsx"), "utf8");

describe("the centre slot's width is bounded by the WIDER side group", () => {
  it("keeps the slot clear of both groups, symmetrically about the midpoint", () => {
    // The owner's own measurement: a 1600 px row whose left (navigation) group is ~410 px and whose
    // right (account) group is ~222 px. The slot may reach to within a gap of the LEFT group on both
    // sides — 1600 − 2×(410 + 12).
    expect(centerSlotMaxWidth({ rowW: 1600, leftW: 410, rightW: 222 })).toBe(1600 - 2 * (410 + CENTER_SLOT_GAP));
  });

  it("binds on the right group when THAT is the wider one", () => {
    expect(centerSlotMaxWidth({ rowW: 1600, leftW: 200, rightW: 500 })).toBe(1600 - 2 * (500 + CENTER_SLOT_GAP));
  });

  it("⛔ a slot sized to this bound cannot overlap either side group", () => {
    // The property, stated as geometry rather than as arithmetic: the slot is centred, so its edges
    // sit at rowW/2 ∓ width/2, and both must clear their group.
    for (const [rowW, leftW, rightW] of [[1600, 410, 222], [1280, 380, 222], [1024, 300, 260], [900, 500, 120]]) {
      const w = centerSlotMaxWidth({ rowW, leftW, rightW });
      // A group wider than half the row leaves no centred space at all — the slot collapses to
      // nothing, which occupies no pixels and so overlaps nothing. (The 900/500 case.)
      if (w === 0) continue;
      const left = rowW / 2 - w / 2, right = rowW / 2 + w / 2;
      expect(left).toBeGreaterThanOrEqual(leftW + CENTER_SLOT_GAP - 1e-9);
      expect(rowW - right).toBeGreaterThanOrEqual(rightW + CENTER_SLOT_GAP - 1e-9);
    }
  });

  it("never returns a negative width — a squeezed row collapses the slot, it does not invert it", () => {
    expect(centerSlotMaxWidth({ rowW: 600, leftW: 400, rightW: 200 })).toBe(0);
  });

  it("⛔ returns NULL, never 0, when the row cannot be measured (LOUD-FAILURE)", () => {
    // A null routes the caller back to the in-flow layout — the old, VISIBLE behaviour. A zero would
    // silently collapse the chip, which is a worse bug than the one being fixed.
    expect(centerSlotMaxWidth({ rowW: 0, leftW: 100, rightW: 100 })).toBe(null);
    expect(centerSlotMaxWidth({ rowW: NaN, leftW: 100, rightW: 100 })).toBe(null);
    expect(centerSlotMaxWidth({ rowW: 1600, leftW: undefined, rightW: 100 })).toBe(null);
    expect(centerSlotMaxWidth({ rowW: 1600, leftW: 100, rightW: Infinity })).toBe(null);
  });

  it("the bound depends on the side groups' widths ONLY through the wider one", () => {
    // Which is the whole point: the chip's centre is the row's centre no matter what the breadcrumb
    // says, so renaming a plan can never move it.
    expect(centerSlotMaxWidth({ rowW: 1600, leftW: 300, rightW: 222 }))
      .toBe(centerSlotMaxWidth({ rowW: 1600, leftW: 222, rightW: 300 }));
  });
});

describe("three outcomes, never two", () => {
  it("a row with room says `centered` and hands over the bound", () => {
    expect(centerSlotPlan({ rowW: 1600, leftW: 410, rightW: 222 }))
      .toEqual({ mode: "centered", max: 1600 - 2 * (410 + CENTER_SLOT_GAP) });
  });

  it("⛔ a true centre that would leave a SLIVER goes back in flow — readable beats centred", () => {
    // The owner's long-breadcrumb case at a laptop width: a real centre would be a pin and half a
    // word. Off-centre-but-readable is the honest degradation; a stub or a vanished chip is not.
    const tight = centerSlotPlan({ rowW: 1280, leftW: 632, rightW: 128 });
    expect(centerSlotMaxWidth({ rowW: 1280, leftW: 632, rightW: 128 })).toBeLessThan(CENTER_SLOT_MIN);
    expect(tight).toEqual({ mode: "tight", max: null });
  });

  it("⛔ an unmeasurable row is its OWN verdict, never disguised as a legitimate `tight`", () => {
    // Kept distinct so a header that never measures cannot hide behind a plausible-looking mode.
    expect(centerSlotPlan({ rowW: 0, leftW: 100, rightW: 100 })).toEqual({ mode: "unmeasured", max: null });
    expect(centerSlotPlan({ rowW: NaN, leftW: 100, rightW: 100 }).mode).toBe("unmeasured");
  });

  it("the floor is a stated number, not a fraction of the row", () => {
    // A percentage floor would make the mode flip at different content widths on different screens.
    expect(CENTER_SLOT_MIN).toBe(120);
    expect(centerSlotPlan({ rowW: 4000, leftW: 1930, rightW: 100 }).mode).toBe("tight");
    expect(centerSlotPlan({ rowW: 4000, leftW: 1920, rightW: 100 }).mode).toBe("centered");
  });
});

describe("the layout rule, read off the real source", () => {
  it("⛔ the centre slot is pinned to the row's midpoint, out of flow", () => {
    // If `flex: 1 1 0%` becomes the only centring rule again, the chip goes back to being centred on
    // the leftover space and the owner's report returns.
    expect(header).toContain('position: "absolute", left: "50%", transform: "translateX(-50%)"');
    expect(header).toContain("maxWidth: center.max");
  });

  it("the row it is pinned against is the positioning container", () => {
    expect(header).toContain('display: "flex", alignItems: "center", position: "relative", ...rowScroll');
  });

  it("⛔ the bound comes from MEASUREMENT, in a LAYOUT effect (VIEWPORT-STABLE)", () => {
    // A passive effect would paint one frame of a mis-sized slot on every resize / panel toggle.
    expect(header).toContain("useLayoutEffect(() => {");
    expect(header).toContain("centerSlotPlan({");
    expect(header).toContain("ro.observe(row); ro.observe(left); ro.observe(right);");
  });

  it("⛔ anything but `centered` falls back to the IN-FLOW layout, never to a collapsed slot", () => {
    expect(header).toContain('const centered = !narrow && center.mode === "centered";');
    expect(header).toContain(': { flex: "1 1 0%", minWidth: 0, overflow: "hidden" }');
    expect(header).toContain('window.addEventListener("resize", measure)');
    // …and which mode is live is reported, so a headless check never has to infer it.
    expect(header).toContain("data-center-mode={centerMode}");
  });

  it("⛔ the right zone still does not grow — a growing zone would poison its own measurement", () => {
    // With the centre out of flow, the slack is held by an inert spacer. If the right zone absorbed
    // it instead, `rightW` would measure the whole remainder and the bound would collapse the slot.
    expect(header).toContain('flex: narrow ? "1 0 auto" : "0 0 auto"');
    expect(header).toContain('{centered && <div aria-hidden="true" style={{ flex: "1 1 0%", minWidth: CENTER_SLOT_GAP }} />}');
  });

  it("NAVIGATION WINS is untouched — the side groups keep their B371361 flexes", () => {
    expect(header).toContain(`{ flex: "0 1 auto", maxWidth: "60%", overflow: "hidden" }`);
    expect(header).not.toContain(`maxWidth: "40%"`);
  });

  it("the phone layout is untouched — the row still scrolls sideways there", () => {
    expect(header).toContain(`{ flexShrink: 0, maxWidth: "none" }`);
    expect(header).toContain("if (narrow) return undefined; // phone");
  });
});
