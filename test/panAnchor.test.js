/* NEW-2 — THE PAN ANCHOR: a pan is one group transform, not ~1,200 re-emitted host elements.
 *
 * There is nothing pure to unit-test here — the change is a rearrangement of where a coordinate is
 * baked inside a React component — so this is a SOURCE guard, and that is deliberate: every
 * invariant below draws the IDENTICAL picture when broken. A pan that silently goes back to baking
 * the view renders exactly the same and is invisible to every screenshot, render assertion and
 * behavioural test in this repo. The only thing that would notice is a frame counter.
 *
 * The measured effect this protects (ui-audit/diagnose-pan-commits.mjs, reference plan, 60
 * pointermoves): 101,267 → 2,194 DOM mutation records, a 46x reduction.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "src/workspaces/site-planner/SitePlanner.jsx"), "utf8");

describe("the split between what is DRAWN at and what is TRUE", () => {
  it("f2p (world → screen) reads the ANCHOR, which is what lets memos bail mid-pan", () => {
    expect(src).toContain("const f2p = useCallback((p) => worldToScreen({ scale: renderView.ppf, tx: renderView.offX, ty: renderView.offY }, p), [renderView]);");
  });

  it("p2f (screen → world) reads the LIVE view, so the pointer path is untouched", () => {
    // If this ever followed f2p onto the anchor, every click during a pan would land off by the
    // pan delta — and only during a drag, which is the hardest kind of bug to catch by hand.
    expect(src).toContain("return screenToWorld({ scale: view.ppf, tx: view.offX, ty: view.offY }, { x: cx - r.left, y: cy - r.top });");
  });

  it("renderView is keyed BY VALUE, never on the view object", () => {
    // `useMemo(..., [view])` would allocate a fresh renderView every pan frame, f2p's identity would
    // churn, and every element memo would miss again — the change would be a no-op that still looks
    // correct. This one line is the whole mechanism.
    expect(src).toContain("const renderView = useMemo(() => ({ ppf: view.ppf, offX: rvOffX, offY: rvOffY }), [view.ppf, rvOffX, rvOffY]);");
  });

  it("a zoom re-bakes on its own — the anchor is only ever honoured at constant ppf", () => {
    expect(src).toContain("panAnchor.ppf === view.ppf");
  });
});

describe("the export resolves its own view — the precondition, not a side effect", () => {
  it("an export pass bypasses the anchor entirely", () => {
    // The owner lifted the "buildExportSvg clones the live SVG" constraint on 2026-08-06; this is
    // where that lift is spent. A sheet built mid-gesture must equal one built at rest.
    expect(src).toContain("const panAnchored = !exportPass && !!panAnchor && panAnchor.ppf === view.ppf;");
  });
});

describe("the harness and e2e contract is unchanged", () => {
  it("data-view-off* still carries the TRUE view", () => {
    expect(src).toContain("data-view-offx={view.offX} data-view-offy={view.offY} data-view-ppf={view.ppf}");
  });

  it("the live delta is exposed separately, so a probe can tell armed from at-rest", () => {
    expect(src).toContain("data-pan-dx={panDx} data-pan-dy={panDy}");
  });

  it("the cull rect still reads the LIVE view — culling by what is actually visible", () => {
    expect(src).toContain("() => (cullActive ? visibleWorldRect(view, size) : null),");
  });
});

describe("the transform reaches everything that is drawn through f2p, and nothing that is not", () => {
  it("the feet-space group carries the pan delta", () => {
    expect(src).toContain("<g transform={panT}>");
  });

  it("the transform is undefined at rest, so nothing outside a live pan sees one at all", () => {
    expect(src).toContain("const panT = panDx || panDy ? `translate(${panDx} ${panDy})` : undefined;");
  });

  it("the print crop — outside that group, placed through feet — uses the LIVE-view f2p", () => {
    // Its dim mask hugs the canvas edges; translate it and the mask detaches from the frame.
    expect(src).toContain("const a = f2pLive({ x: printFrame.cx - printFrame.wFt / 2");
    expect(src).toContain("const b = f2pLive({ x: printFrame.cx + printFrame.wFt / 2");
  });
});

describe("arming and disarming — the anchor may never outlive its gesture", () => {
  it("arms from the gesture's OWN captured origin, once, as it passes the dead zone", () => {
    expect(src).toContain("if (!d.panArmed) armPanAnchor(view.ppf, d.ox, d.oy);");
  });

  it("is rebased when a panel move rebases the gesture, or it carries the panel width forever", () => {
    // B837's compensation adjusts `d.ox` mid-pan; the anchor is a copy of that same origin.
    expect(src).toContain("setPanAnchor((a) => (a ? { ...a, offX: a.offX - delta } : a));");
  });

  it("disarms on BOTH gesture-end paths — a clean release and a torn-down one", () => {
    expect(src).toMatch(/flushFrameJobs\(\);\s*\n\s*disarmPanAnchor\(\);/);            // onUp
    expect(src).toMatch(/drag\.current = null;\s*\n\s*disarmPanAnchor\(\);/);          // abortGesture
  });
});
