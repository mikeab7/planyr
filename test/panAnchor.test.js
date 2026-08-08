/* NEW-2 — THE PAN ANCHOR: a pan is one group transform, not ~1,200 re-emitted host elements.
 * B1449 — …and a ZOOM is the same group transform with the scale term restored.
 *
 * ⛔ RETARGETED 2026-08-08, NOT WEAKENED. Every invariant below is the one it was written to
 * protect; what changed is that `panAnchor` became `viewAnchor` and the transform gained a `k`.
 * Two of them are now STRICTLY STRONGER (the cull rect pins the live PROBE as well as the latch;
 * the at-rest transform is pinned through `anchorTransformAttr`, whose own unit test proves it
 * emits B1440's byte-identical bare translate at k === 1). The pure math this file could not test
 * before now EXISTS and is tested — see test/viewAnchor.test.js — and the mid-gesture behaviour
 * this file is structurally blind to is covered by ui-audit/verify-midgesture-zoom.mjs.
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
    expect(src).toContain("const renderView = useMemo(() => ({ ppf: rvPpf, offX: rvOffX, offY: rvOffY }), [rvPpf, rvOffX, rvOffY]);");
  });

  it("a PAN anchor is still honoured only at constant ppf, and never gated on the zoom setting", () => {
    // B1449 — the same-zoom case is B1440's, unchanged, and turning smooth zoom OFF must not take
    // the pan increment away with it. That is what the `anchorSameZoom ||` short-circuit buys.
    expect(src).toContain("const anchorSameZoom = !!viewAnchor && viewAnchor.ppf === view.ppf;");
    expect(src).toMatch(/\(anchorSameZoom \|\| \(smoothZoom && anchorHolds\(view, viewAnchor\)\)\)/);
  });

  it("a zoom anchor is bounded — past the drift cap the frame re-bakes instead of scaling further", () => {
    expect(src).toContain("anchorHolds(view, viewAnchor)");
    expect(src).toMatch(/if \(!a \|\| !anchorHolds\(next, a\)\) armViewAnchor\(v\.ppf, v\.offX, v\.offY\);/);
  });

  it("the RENDER ppf is what the render body reasons at, and the label tier reads it too", () => {
    // The mixture this forbids — geometry emitted at the anchor while labels/LOD/strokes are sized
    // at the LIVE zoom — is invisible at rest, because at rest the two are equal.
    expect(src).toContain("const rppf = renderView.ppf;");
    expect(src).toContain("makeLabelFrame(rppf, exportPass && exportPass.ppf)");
  });
});

describe("the export resolves its own view — the precondition, not a side effect", () => {
  it("an export pass bypasses the anchor entirely", () => {
    // The owner lifted the "buildExportSvg clones the live SVG" constraint on 2026-08-06; this is
    // where that lift is spent. A sheet built mid-gesture must equal one built at rest.
    expect(src).toMatch(/const anchored = !exportPass && !!viewAnchor/);
  });
});

describe("the harness and e2e contract is unchanged", () => {
  it("data-view-off* still carries the TRUE view", () => {
    expect(src).toContain("data-view-offx={view.offX} data-view-offy={view.offY} data-view-ppf={view.ppf}");
  });

  it("the live delta is exposed separately, so a probe can tell armed from at-rest", () => {
    expect(src).toContain("data-pan-dx={panDx} data-pan-dy={panDy}");
    // B1449 — and the zoom half of it, plus the ppf the geometry was actually emitted at. Both are
    // inert at rest (k === 1, render-ppf === view-ppf), so no pre-B1449 assertion moved.
    expect(src).toContain("data-pan-k={panK} data-render-ppf={rppf}");
  });

  /* ⛔ RETARGETED, NOT WEAKENED (NEW-2, 2026-08-06). The property this asserts is unchanged —
     the cull rect is derived from the LIVE `view`, never from the pan anchor, so what is drawn
     is what is actually visible. What changed is that the rect is now LATCHED against the live
     view rather than re-derived from it every frame (`cullRectFor` keeps the rect it already
     holds for as long as the true viewport is still inside it), because re-deriving it
     re-filtered the whole model on every pan frame to produce an identical set of elements.
     The assertion is now STRONGER than it was: it pins the live-view source AND the latch, so
     removing either goes red. */
  /* ⛔ RETARGETED AGAIN (B1449) AND STRICTLY STRONGER. The property is unchanged: what is DRAWN
     must cover what is actually VISIBLE. What changed is that the two questions the old call
     conflated are now separate arguments — the rect is BUILT at the render view (so the latch key
     is constant through a zoom gesture instead of re-arming on every notch) and PROBED against the
     LIVE view (so a zoom-OUT, whose true viewport grows while the anchor's does not, still re-arms
     in time and nothing pops in at the edge). Dropping EITHER argument now goes red; before, only
     one could be asserted at all. */
  it("the cull rect is built at the render view but PROBED against the live one", () => {
    expect(src).toContain("cullRectFor(renderView, size, cullRectRef.current, undefined, undefined, view)");
  });
});

describe("the transform reaches everything that is drawn through f2p, and nothing that is not", () => {
  it("the feet-space group carries the pan delta", () => {
    expect(src).toContain("<g transform={panT}>");
  });

  it("the transform is undefined at rest, so nothing outside a live pan sees one at all", () => {
    // B1449 — the emptiness is now a property of `anchorTransformAttr`, which test/viewAnchor.test.js
    // proves returns `undefined` when the anchor and the view coincide AND a bare `translate(dx dy)`
    // at k === 1 (byte-for-byte what this line used to build). Assert the wiring here, the behaviour
    // there — a string built inline could not be unit-tested at all.
    expect(src).toContain("const panT = anchorTransformAttr(viewT);");
    expect(src).toContain("const viewT = anchored ? anchorTransform(view, renderView) : null;");
  });

  it("the print crop — outside that group, placed through feet — uses the LIVE-view f2p", () => {
    // Its dim mask hugs the canvas edges; translate it and the mask detaches from the frame.
    expect(src).toContain("const a = f2pLive({ x: printFrame.cx - printFrame.wFt / 2");
    expect(src).toContain("const b = f2pLive({ x: printFrame.cx + printFrame.wFt / 2");
  });
});

describe("arming and disarming — the anchor may never outlive its gesture", () => {
  it("arms from the gesture's OWN captured origin, once, as it passes the dead zone", () => {
    expect(src).toContain("if (!d.panArmed) armViewAnchor(view.ppf, d.ox, d.oy);");
  });

  it("is rebased when a panel move rebases the gesture, or it carries the panel width forever", () => {
    // B837's compensation adjusts `d.ox` mid-pan; the anchor is a copy of that same origin.
    expect(src).toContain("setViewAnchor((a) => { if (!a) return a; const n = { ...a, offX: a.offX - delta }; viewAnchorRef.current = n; return n; });");
  });

  it("disarms on BOTH gesture-end paths — a clean release and a torn-down one", () => {
    expect(src).toMatch(/flushFrameJobs\(\);\s*\n\s*disarmViewAnchor\(\);/);            // onUp
    expect(src).toMatch(/drag\.current = null;\s*\n\s*disarmViewAnchor\(\);/);          // abortGesture
  });

  /* B1449 — a WHEEL has no pointer-up, so its gesture boundary is a settle timer. These three are
     the whole lifetime, and each one left out is a distinct visible bug: no settle → the drawing
     never re-bakes and stays at the anchor's line weights forever; no pinch disarm → the same on
     touch; no pointerdown flush → a pan arms its own anchor over a live zoom one and the two
     gestures fight over one anchor. */
  it("a wheel gesture settles on a timer, because a wheel has no pointer-up", () => {
    expect(src).toMatch(/wheelSettleRef\.current = setTimeout\(settleZoomAnchor, ZOOM_SETTLE_MS\);/);
    expect(src).toMatch(/clearTimeout\(wheelSettleRef\.current\); wheelSettleRef\.current = 0;\s*\n\s*disarmViewAnchor\(\);/);
  });

  it("a pinch disarms when the second finger lifts", () => {
    expect(src).toMatch(/pinchRafRef\.current = 0; \}\s*\n\s*disarmViewAnchor\(\);/);
  });

  it("a pointer gesture starting mid-zoom flushes AND re-bakes before it arms its own anchor", () => {
    expect(src).toContain("const flushWheelForPointer = () => { flushWheelNow(); if (wheelSettleRef.current) settleZoomAnchor(); };");
    expect(src).toContain('wrap.addEventListener("pointerdown", flushWheelForPointer, { capture: true });');
  });
});
