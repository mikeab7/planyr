/* SET A NOTE PAGE'S OWN WIDTH BY HAND — the pure preset/resolution rules (NEW-1).
 *
 * ⛔ THE PROPERTY THIS FILE EXISTS FOR: a pin is a FLOOR — the resolved baseline never exceeds
 * what the pane actually has room for (it shrinks to fit a narrow window, it never clips), and
 * "Full width" always leaves the standing gutter on each side. NoteEditor.jsx's own measurement
 * effect trusts these answers without re-deriving them, so a wrong one here is a wrong page for
 * every note in the app, not a local bug.
 */
import { describe, expect, it } from "vitest";

import {
  FULL_WIDTH_GUTTER, PAGE_WIDTH_MAX, PAGE_WIDTH_MIN, PAGE_WIDTH_PRESETS,
  dragWidthFromDelta, pageWidthLabel, pageWidthPresetId, resolvePinnedBaseWidth, resolvePresetPx,
} from "../src/workspaces/notes/lib/notesPageWidth.js";

describe("the presets", () => {
  it("names exactly four, in menu order, each with a usable px or the full sentinel", () => {
    expect(PAGE_WIDTH_PRESETS.map((p) => p.id)).toEqual(["narrow", "normal", "wide", "full"]);
    expect(PAGE_WIDTH_PRESETS.map((p) => p.px)).toEqual([440, 580, 900, "full"]);
  });

  it("Normal matches the app's own unpinned default (580) — a real pin, not a renamed no-op", () => {
    expect(PAGE_WIDTH_PRESETS.find((p) => p.id === "normal").px).toBe(580);
  });

  it("is strictly increasing narrow < normal < wide, so the menu order reads as the visual order", () => {
    const [narrow, normal, wide] = PAGE_WIDTH_PRESETS;
    expect(narrow.px).toBeLessThan(normal.px);
    expect(normal.px).toBeLessThan(wide.px);
  });
});

describe("pageWidthPresetId — which row, if any, a stored value matches", () => {
  it("matches a preset's own exact px", () => {
    expect(pageWidthPresetId(440)).toBe("narrow");
    expect(pageWidthPresetId(580)).toBe("normal");
    expect(pageWidthPresetId(900)).toBe("wide");
  });

  it("null is unpinned, not a preset match", () => {
    expect(pageWidthPresetId(null)).toBeNull();
  });

  it("a dragged, off-preset width matches nothing — it is Custom, not a mis-highlighted preset", () => {
    expect(pageWidthPresetId(733)).toBeNull();
    expect(pageWidthPresetId(441)).toBeNull();
  });

  it("the literal string \"full\" matches the Full width preset's own id", () => {
    expect(pageWidthPresetId("full")).toBe("full");
  });
});

describe("pageWidthLabel — the closed menu trigger's word (PANEL-BREVITY)", () => {
  it("unpinned reads Fit to content", () => {
    expect(pageWidthLabel(null)).toBe("Fit to content");
  });
  it("a preset reads its own name", () => {
    expect(pageWidthLabel(440)).toBe("Narrow");
    expect(pageWidthLabel(580)).toBe("Normal");
    expect(pageWidthLabel(900)).toBe("Wide");
  });
  it("full width reads its own name", () => {
    expect(pageWidthLabel("full")).toBe("Full width");
  });
  it("a dragged, off-preset width reads Custom — never a bare number", () => {
    expect(pageWidthLabel(733)).toBe("Custom");
  });
});

describe("resolvePresetPx — a preset's own px against the pane it is rendering in", () => {
  it("a plain-number preset ignores the pane entirely", () => {
    expect(resolvePresetPx(440, { paneWidth: 2000 })).toBe(440);
    expect(resolvePresetPx(900, { paneWidth: 500 })).toBe(900);
  });

  it("\"full\" fills the pane down to the standing gutter on each side", () => {
    expect(resolvePresetPx("full", { paneWidth: 1400 })).toBe(1400 - FULL_WIDTH_GUTTER * 2);
  });

  it("\"full\" never resolves narrower than the drag floor, even on a tiny pane", () => {
    expect(resolvePresetPx("full", { paneWidth: 10 })).toBe(PAGE_WIDTH_MIN);
  });
});

describe("resolvePinnedBaseWidth — the ONE answer NoteEditor.jsx's measurement effect trusts", () => {
  it("null (Fit to content) is passed straight back — the caller's own SHEET_MAX_WIDTH fallback is untouched", () => {
    expect(resolvePinnedBaseWidth(null, { paneWidth: 1200 })).toBeNull();
  });

  it("a numeric pin resolves to itself when the pane has room", () => {
    expect(resolvePinnedBaseWidth(900, { paneWidth: 2000 })).toBe(900);
    expect(resolvePinnedBaseWidth(440, { paneWidth: 2000 })).toBe(440);
  });

  it("\"full\" resolves against the live pane, matching resolvePresetPx exactly", () => {
    expect(resolvePinnedBaseWidth("full", { paneWidth: 1000 })).toBe(resolvePresetPx("full", { paneWidth: 1000 }));
  });

  it("is a FLOOR CONCEPT, never a clip — clamps to the drag min/max but never throws on a wild value", () => {
    expect(resolvePinnedBaseWidth(1, { paneWidth: 2000 })).toBe(PAGE_WIDTH_MIN);
    expect(resolvePinnedBaseWidth(999999, { paneWidth: 999999 })).toBe(PAGE_WIDTH_MAX);
  });

  it("an unreadable stored value (a stale/foreign string) answers null rather than throwing", () => {
    expect(resolvePinnedBaseWidth("garbage", { paneWidth: 1200 })).toBeNull();
    expect(resolvePinnedBaseWidth(NaN, { paneWidth: 1200 })).toBeNull();
  });
});

describe("dragWidthFromDelta — the live preview and the eventual commit share one clamp", () => {
  it("adds the delta, both directions", () => {
    expect(dragWidthFromDelta(580, 100)).toBe(680);
    expect(dragWidthFromDelta(580, -100)).toBe(480);
  });

  it("never drops below PAGE_WIDTH_MIN, however far the pointer travels", () => {
    expect(dragWidthFromDelta(580, -100000)).toBe(PAGE_WIDTH_MIN);
  });

  it("never exceeds PAGE_WIDTH_MAX, however far the pointer travels", () => {
    expect(dragWidthFromDelta(580, 100000)).toBe(PAGE_WIDTH_MAX);
  });

  it("rounds to a whole pixel — a stored width is never a fraction", () => {
    expect(Number.isInteger(dragWidthFromDelta(580.4, 12.6))).toBe(true);
  });
});
