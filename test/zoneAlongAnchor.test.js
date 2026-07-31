/* NEW-1 — "when I shrink the trailer parking, it shrinks from both sides."
 *
 * THE DEFECT, exactly: `layoutZoneByKind` built the zone centre as `b.c + u·center + tan·alongShift`
 * and the ONLY along-wall term was `alongShift`, the B492 bump-out trim. The LENGTH came from the
 * user (`alongLen` → `zoneAlongSpan`) and the CENTRE did not, so the zone stayed centred on its wall
 * and BOTH ends travelled inward by half the reduction. A stored SPAN with no ANCHOR.
 *
 * Every case below is stated as the owner would state it: drag one end, the OTHER END DOES NOT MOVE.
 * They run against the real `layoutZoneByKind` through a `layChain` helper that mirrors the canvas's
 * `relayoutSide` / `courtBumpOpts` pair line for line, so a change to the layout that skipped the
 * anchor would show up here rather than only on the screen.
 *
 * The geometry is the OWNER'S OWN, read out of `site_elements` for "Concept D — Sylvestri Retail"
 * (site sms4zs8unbkg): building e1454698mwpaoj is 867.94 × 300 at rot 0 with a 55 ft corner bump-out
 * at each end of its dock wall (clear face 757.94) carrying court e1454699mwpaoj + trailer
 * e1454796yyuqqs, and building e1454759yyuqqs is 540 × 1041 at rot 33.959 with four bump-outs and a
 * court + trailer on each long wall. The rotated one is deliberate: an axis-aligned host hides every
 * frame error in this family.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  layoutZoneByKind, anchoredAlongSpan, zoneAlongPlacement, alongAnchorFromDrag, alongOffsetFor,
  resizedZoneAlongFit, usableCourtSpan, normalizeAlongAnchor, ALONG_ANCHOR,
} from "../src/workspaces/site-planner/lib/dockZones.js";
import { sideParkAlongRun } from "../src/workspaces/site-planner/lib/dogEar.js";
import { normalizeBondedChildren } from "../src/workspaces/site-planner/lib/siteModel.js";

const FIXTURE = JSON.parse(readFileSync(new URL("../ui-audit/fixtures/sylvestri-concept-d.json", import.meta.url), "utf8"));
const byId = (id) => FIXTURE.els.find((e) => e.id === id);

/* The owner's flat building: 867.94 × 300, dock on `bottom`, a 55 ft bump-out at each end. */
const HOST = byId("e1454698mwpaoj");
const FACE = usableCourtSpan(HOST.w, 55, 55);            // { along: 757.94, shift: 0 }
/* …and his rotated one: 540 × 1041 at 33.959°, dock on both long walls, four bump-outs. */
const HOST_ROT = byId("e1454759yyuqqs");
const FACE_ROT = usableCourtSpan(HOST_ROT.h, 55, 55);    // 931 along the LEFT/RIGHT walls

const COURT_D = 135, TRAILER_D = 50, BUFFER_D = 15;
const KINDS = ["strip", "trailer", "strip"];

/* ---- The canvas's own pair, in one place. `courtBumpOpts` resolves the COURT's anchored span
 * against the clear bump-out face; `relayoutSide` then lays every zone against that resolved span.
 * Mirrors SitePlanner.jsx exactly — see the source guard at the bottom of this file. */
function layChain(host, side, zones, face) {
  const horiz = side === "top" || side === "bottom";
  const full = horiz ? host.w : host.h;
  const head = zones[0] || {};
  const fit = anchoredAlongSpan({
    stored: head.alongLen, anchor: head.alongAnchor, off: head.alongOff,
    chainAlong: face.along, chainShift: face.shift, fullAlong: full, limitAlong: face.along, limitShift: face.shift,
  });
  const opts = {
    along: fit.along, alongShift: fit.shift,
    alongs: zones.map((z, i) => (i === 0 ? null : z.alongLen)),
    anchors: zones.map((z, i) => (i === 0 ? 0 : z.alongAnchor)),
    offs: zones.map((z, i) => (i === 0 ? 0 : z.alongOff)),
  };
  const depths = zones.map((z) => z.zd);
  return zones.map((_, i) => layoutZoneByKind(host, side, i, depths, KINDS, opts));
}

/* The zone's two ends along the wall, in the HOST's frame — the numbers the owner is describing. */
const ends = (box, host, side) => {
  const p = zoneAlongPlacement(box, { ...host }, side);
  return { min: p.min, max: p.max, len: p.len };
};

/* Simulate the real gesture: an edge drag moves ONE end by `delta` (+ grows) and leaves the other
 * exactly where it was — which is what the planner's `edgeResize` branch produces. */
function dragEnd(box, host, side, end, delta) {
  const horiz = side === "top" || side === "bottom";
  const r = ((host.rot || 0) * Math.PI) / 180;
  const tan = horiz ? { x: Math.cos(r), y: Math.sin(r) } : { x: -Math.sin(r), y: Math.cos(r) };
  const p = zoneAlongPlacement(box, host, side);
  const grow = end === ALONG_ANCHOR.END ? delta : delta;   // `delta` is always along-length growth
  const shift = (end === ALONG_ANCHOR.END ? 1 : -1) * (grow / 2);
  // The along dimension is `w` for a trailer on either wall and for a strip on a horizontal wall.
  const alongIsW = box.rot !== ((host.rot || 0) % 360) || horiz;
  const nextLen = p.len + grow;
  return {
    ...box,
    cx: box.cx + tan.x * shift, cy: box.cy + tan.y * shift,
    ...(alongIsW ? { w: nextLen } : { h: nextLen }),
  };
}

/* One resize, end to end: drag → `resizedZoneAlongFit` → store → re-lay the chain. Returns the new
 * zone list and the freshly laid boxes, so a test can assert on what the owner would SEE. */
function resizeZone(host, side, zones, face, i, end, delta) {
  const laid = layChain(host, side, zones, face);
  const nextBox = dragEnd(laid[i], host, side, end, delta);
  const isHead = i === 0;
  const fit = resizedZoneAlongFit(laid[i], nextBox, {
    host, side, userResize: true, alongAxisDragged: true,
    chainAlong: isHead ? face.along : layChain(host, side, zones, face)[0] && anchoredAlongSpan({
      stored: zones[0].alongLen, anchor: zones[0].alongAnchor, off: zones[0].alongOff,
      chainAlong: face.along, chainShift: face.shift, fullAlong: side === "top" || side === "bottom" ? host.w : host.h,
      limitAlong: face.along, limitShift: face.shift,
    }).along,
    chainShift: isHead ? face.shift : anchoredAlongSpan({
      stored: zones[0].alongLen, anchor: zones[0].alongAnchor, off: zones[0].alongOff,
      chainAlong: face.along, chainShift: face.shift, fullAlong: side === "top" || side === "bottom" ? host.w : host.h,
      limitAlong: face.along, limitShift: face.shift,
    }).shift,
  });
  const next = zones.map((z, k) => (k === i && fit ? { ...z, alongLen: fit.len, alongAnchor: fit.anchor, alongOff: fit.off } : z));
  return { zones: next, boxes: layChain(host, side, next, face), fit, before: laid };
}

const CHAIN = () => [
  { zd: COURT_D },                                   // truck court (head)
  { zd: TRAILER_D },                                 // trailer parking
  { zd: BUFFER_D },                                  // buffer
];

describe("anchoredAlongSpan — the pure rule", () => {
  const base = { chainAlong: 757.94, chainShift: 0, fullAlong: 867.94 };

  it("with no anchor stored it is EXACTLY the old centred behaviour", () => {
    expect(anchoredAlongSpan({ ...base })).toEqual({ along: 757.94, shift: 0 });
    expect(anchoredAlongSpan({ ...base, stored: 520 })).toEqual({ along: 520, shift: 0 });
  });

  it("anchored to the − end, a shorter span keeps that end put", () => {
    const full = anchoredAlongSpan({ ...base, anchor: -1 });
    const cut = anchoredAlongSpan({ ...base, stored: 520, anchor: -1 });
    expect(full.shift - full.along / 2).toBeCloseTo(cut.shift - cut.along / 2, 9);   // − end unmoved
    expect(cut.shift + cut.along / 2).toBeCloseTo(full.shift + full.along / 2 - 237.94, 9);
  });

  it("anchored to the + end, a shorter span keeps THAT end put instead", () => {
    const full = anchoredAlongSpan({ ...base, anchor: 1 });
    const cut = anchoredAlongSpan({ ...base, stored: 520, anchor: 1 });
    expect(full.shift + full.along / 2).toBeCloseTo(cut.shift + cut.along / 2, 9);   // + end unmoved
  });

  it("COMPOSES with the bump-out trim rather than replacing it", () => {
    // One 90 ft bump at the − end only: the clear face is 777.94 shifted +45.
    const trim = { chainAlong: 777.94, chainShift: 45, fullAlong: 867.94 };
    const full = anchoredAlongSpan(trim);
    expect(full.shift).toBe(45);                                       // unchanged, no anchor
    const cut = anchoredAlongSpan({ ...trim, stored: 500, anchor: -1 });
    expect(cut.shift - cut.along / 2).toBeCloseTo(45 - 777.94 / 2, 9);  // still starts at the bump
    const cutEnd = anchoredAlongSpan({ ...trim, stored: 500, anchor: 1 });
    expect(cutEnd.shift + cutEnd.along / 2).toBeCloseTo(45 + 777.94 / 2, 9);
  });

  it("RE-CLAMPS rather than sliding off the wall when the host shrinks past it", () => {
    // Anchored to the + end of a 757.94 chain, 700 long — then the host shrinks to a 300 ft wall.
    const small = anchoredAlongSpan({ stored: 700, anchor: 1, chainAlong: 190, chainShift: 0, fullAlong: 300 });
    expect(small.along).toBe(300);                    // clamped to the wall (never forgotten)
    expect(small.shift).toBe(0);                      // …and pulled back onto it, not hanging off
    expect(Math.abs(small.shift) + small.along / 2).toBeLessThanOrEqual(300 / 2 + 1e-9);
    // A partial shrink keeps the anchor working inside whatever room is left.
    const mid = anchoredAlongSpan({ stored: 400, anchor: 1, chainAlong: 440, chainShift: 0, fullAlong: 550 });
    expect(mid.shift + mid.along / 2).toBeCloseTo(220, 9);
  });

  it("an offset rides ON TOP of the chain reference (the second drag, from the other end)", () => {
    const a = anchoredAlongSpan({ ...base, stored: 400, anchor: 1, off: -150 });
    expect(a.shift + a.along / 2).toBeCloseTo(757.94 / 2 - 150, 9);
  });

  it("normalizes junk anchors to CENTRED rather than throwing", () => {
    for (const junk of [undefined, null, "", NaN, 2, -7, "left"]) expect(normalizeAlongAnchor(junk)).toBe(0);
    expect(anchoredAlongSpan({ ...base, stored: 520, anchor: "nonsense", off: "x" })).toEqual({ along: 520, shift: 0 });
  });
});

describe("alongAnchorFromDrag / alongOffsetFor — reading the gesture off the geometry", () => {
  it("an edge drag that held the − end reads as anchored to the − end", () => {
    expect(alongAnchorFromDrag({ min: -100, max: 100 }, { min: -100, max: 40 })).toBe(-1);
  });
  it("…and one that held the + end reads the other way", () => {
    expect(alongAnchorFromDrag({ min: -100, max: 100 }, { min: -40, max: 100 })).toBe(1);
  });
  it("a re-centre (both ends moved) stays CENTRED — the conservative answer", () => {
    expect(alongAnchorFromDrag({ min: -100, max: 100 }, { min: -60, max: 60 })).toBe(0);
  });
  it("sub-foot residue against the chain's own end snaps the offset to zero", () => {
    expect(alongOffsetFor(-1, { min: -378.97 + 0.2, max: 100, center: 0 }, 757.94, 0)).toBe(0);
    expect(alongOffsetFor(-1, { min: -300, max: 100, center: 0 }, 757.94, 0)).toBeCloseTo(78.97, 2);
  });
});

describe("the owner's report, on his own building: shrink pulls in ONE end", () => {
  for (const [label, host, side, face] of [
    ["flat 867.94 × 300 at rot 0", HOST, "bottom", FACE],
    ["rotated 540 × 1041 at 33.959°", HOST_ROT, "right", FACE_ROT],
  ]) {
    describe(label, () => {
      for (const [endLabel, end] of [["− (north)", ALONG_ANCHOR.START], ["+ (south)", ALONG_ANCHOR.END]]) {
        it(`SHRINKING the trailer from the ${endLabel} end leaves the opposite end exactly where it was`, () => {
          const r = resizeZone(host, side, CHAIN(), face, 1, end, -180);
          const was = ends(r.before[1], host, side), now = ends(r.boxes[1], host, side);
          expect(now.len).toBeCloseTo(was.len - 180, 0);
          if (end === ALONG_ANCHOR.END) expect(now.min).toBeCloseTo(was.min, 6);
          else expect(now.max).toBeCloseTo(was.max, 6);
        });

        it(`GROWING the trailer from the ${endLabel} end does the same`, () => {
          const shrunk = resizeZone(host, side, CHAIN(), face, 1, end, -180);
          const r = resizeZone(host, side, shrunk.zones, face, 1, end, 90);
          const was = ends(r.before[1], host, side), now = ends(r.boxes[1], host, side);
          expect(now.len).toBeCloseTo(was.len + 90, 0);
          if (end === ALONG_ANCHOR.END) expect(now.min).toBeCloseTo(was.min, 6);
          else expect(now.max).toBeCloseTo(was.max, 6);
        });
      }

      it("PRE-FIX BASELINE: without the anchor the same shrink moves BOTH ends", () => {
        const laid = layChain(host, side, CHAIN(), face);
        const centred = layChain(host, side, [{ zd: COURT_D }, { zd: TRAILER_D, alongLen: Math.round(ends(laid[1], host, side).len - 180) }, { zd: BUFFER_D }], face);
        const was = ends(laid[1], host, side), now = ends(centred[1], host, side);
        expect(now.min).not.toBeCloseTo(was.min, 1);
        expect(now.max).not.toBeCloseTo(was.max, 1);
      });

      it("dragging one end then the OTHER moves only the second end (where a bare offset fails)", () => {
        const first = resizeZone(host, side, CHAIN(), face, 1, ALONG_ANCHOR.END, -200);
        const held = ends(first.boxes[1], host, side);
        const second = resizeZone(host, side, first.zones, face, 1, ALONG_ANCHOR.START, -150);
        const now = ends(second.boxes[1], host, side);
        expect(now.max).toBeCloseTo(held.max, 6);        // the end the SECOND drag held
        expect(now.len).toBeCloseTo(held.len - 150, 0);
        expect(second.zones[1].alongOff).not.toBe(0);    // the offset is what carries this case
      });

      it("a TYPED length keeps the current anchor instead of silently re-centring", () => {
        const dragged = resizeZone(host, side, CHAIN(), face, 1, ALONG_ANCHOR.START, -180);
        const held = ends(dragged.boxes[1], host, side);
        // The panel's `setZoneLengthAll`: it writes `alongLen` and touches nothing else.
        const typed = dragged.zones.map((z, i) => (i === 1 ? { ...z, alongLen: 420 } : z));
        const now = ends(layChain(host, side, typed, face)[1], host, side);
        expect(now.len).toBeCloseTo(420, 6);
        expect(now.max).toBeCloseTo(held.max, 6);        // the anchored end did not move
      });

      it("clearing the override (length + anchor) puts the zone back on the court's span", () => {
        const dragged = resizeZone(host, side, CHAIN(), face, 1, ALONG_ANCHOR.START, -180);
        const cleared = dragged.zones.map((z, i) => (i === 1 ? { zd: z.zd } : z));
        const now = ends(layChain(host, side, cleared, face)[1], host, side);
        const court = ends(layChain(host, side, cleared, face)[0], host, side);
        expect(now.len).toBeCloseTo(court.len, 6);
        expect(now.min).toBeCloseTo(court.min, 6);
      });

      it("survives a HOST RESIZE: the held end tracks the wall, and springs back when it grows", () => {
        const dragged = resizeZone(host, side, CHAIN(), face, 1, ALONG_ANCHOR.END, -200);
        const horiz = side === "top" || side === "bottom";
        const wallOf = (h) => (horiz ? h.w : h.h);
        const small = horiz ? { ...host, w: host.w - 100 } : { ...host, h: host.h - 100 };
        const smallFace = usableCourtSpan(wallOf(small), 55, 55);
        const nowSmall = ends(layChain(small, side, dragged.zones, smallFace)[1], small, side);
        // Still on the wall, and its held end has TRACKED the − end of the now-shorter clear face.
        expect(nowSmall.max).toBeLessThanOrEqual(wallOf(small) / 2 + 1e-6);
        expect(nowSmall.min).toBeGreaterThanOrEqual(-wallOf(small) / 2 - 1e-6);
        expect(nowSmall.min).toBeCloseTo(-smallFace.along / 2 + smallFace.shift, 6);
        expect(nowSmall.len).toBeCloseTo(ends(dragged.boxes[1], host, side).len, 6);   // length untouched
        // …and growing the host back springs the stored length out again, unforgotten.
        const grown = layChain(host, side, dragged.zones, face);
        expect(ends(grown[1], host, side).len).toBeCloseTo(ends(dragged.boxes[1], host, side).len, 6);
      });

      it("survives a ROTATION of the host — the anchor is a reference, not a world position", () => {
        const dragged = resizeZone(host, side, CHAIN(), face, 1, ALONG_ANCHOR.END, -220);
        const flat = ends(layChain(host, side, dragged.zones, face)[1], host, side);
        for (const rot of [0, 17.5, 90, 178.543241069641, 269, 359]) {
          const turned = { ...host, rot };
          const now = ends(layChain(turned, side, dragged.zones, face)[1], turned, side);
          expect(now.min).toBeCloseTo(flat.min, 6);
          expect(now.max).toBeCloseTo(flat.max, 6);
        }
      });

      it("RE-CLAMPS rather than sliding off the wall when the host shrinks PAST the zone", () => {
        const dragged = resizeZone(host, side, CHAIN(), face, 1, ALONG_ANCHOR.END, -100);
        const horiz = side === "top" || side === "bottom";
        const tiny = horiz ? { ...host, w: 240 } : { ...host, h: 240 };
        const tinyFace = usableCourtSpan(240, 55, 55);
        const now = ends(layChain(tiny, side, dragged.zones, tinyFace)[1], tiny, side);
        expect(now.len).toBeLessThanOrEqual(240 + 1e-6);
        expect(Math.abs(now.min)).toBeLessThanOrEqual(120 + 1e-6);
        expect(Math.abs(now.max)).toBeLessThanOrEqual(120 + 1e-6);
      });
    });
  }
});

describe("the AUDIT: every resizable bonded zone, not only the trailer", () => {
  it("the BUFFER shares the defect and is fixed by the same rule", () => {
    const r = resizeZone(HOST, "bottom", CHAIN(), FACE, 2, ALONG_ANCHOR.END, -240);
    const was = ends(r.before[2], HOST, "bottom"), now = ends(r.boxes[2], HOST, "bottom");
    expect(now.len).toBeCloseTo(was.len - 240, 0);
    expect(now.min).toBeCloseTo(was.min, 6);
  });

  it("the TRUCK COURT shares the defect — its typed length used to re-centre, and no longer does", () => {
    const r = resizeZone(HOST, "bottom", CHAIN(), FACE, 0, ALONG_ANCHOR.START, -160);
    const was = ends(r.before[0], HOST, "bottom"), now = ends(r.boxes[0], HOST, "bottom");
    expect(now.len).toBeCloseTo(was.len - 160, 0);
    expect(now.max).toBeCloseTo(was.max, 6);
    // …and a length TYPED afterwards still respects that anchor.
    const typed = r.zones.map((z, i) => (i === 0 ? { ...z, alongLen: 400 } : z));
    const after = ends(layChain(HOST, "bottom", typed, FACE)[0], HOST, "bottom");
    expect(after.len).toBeCloseTo(400, 6);
    expect(after.max).toBeCloseTo(was.max, 6);
  });

  it("an anchored COURT drags its whole outward stack with it (the chain still tracks the court)", () => {
    const r = resizeZone(HOST, "bottom", CHAIN(), FACE, 0, ALONG_ANCHOR.START, -160);
    const court = ends(r.boxes[0], HOST, "bottom");
    for (const i of [1, 2]) {
      const z = ends(r.boxes[i], HOST, "bottom");
      expect(z.min).toBeCloseTo(court.min, 6);
      expect(z.max).toBeCloseTo(court.max, 6);
    }
  });

  it("an anchored COURT can never slide onto a corner bump-out (B492 still holds)", () => {
    const r = resizeZone(HOST, "bottom", CHAIN(), FACE, 0, ALONG_ANCHOR.START, -160);
    // Ask for far more length than the clear face has; the face still bounds it.
    const greedy = r.zones.map((z, i) => (i === 0 ? { ...z, alongLen: 5000 } : z));
    const now = ends(layChain(HOST, "bottom", greedy, FACE)[0], HOST, "bottom");
    expect(now.len).toBeCloseTo(FACE.along, 6);
    expect(now.min).toBeGreaterThanOrEqual(-FACE.along / 2 + FACE.shift - 1e-6);
    expect(now.max).toBeLessThanOrEqual(FACE.along / 2 + FACE.shift + 1e-6);
  });

  it("SIDE PARKING already anchored correctly — it stores its along CENTRE beside its run", () => {
    // The rule (`sideParkAlongRun`) records `{ run, alongShift }`, so the centre the drag produced is
    // carried through verbatim rather than being re-derived to the middle of the wall. This is the
    // half of the audit that needed NO change; it is asserted so a future edit cannot quietly lose it.
    const span = { run: 500, alongShift: 0 };
    const dragged = { run: 300, alongShift: 100 };            // shrunk from the − end
    const res = sideParkAlongRun({ cur: dragged, span, pinAllowed: true });
    expect(res.run).toBe(300);
    expect(res.alongShift).toBe(100);                          // the grabbed-end geometry survives
    expect(res.stamp).toEqual({ run: 300, alongShift: 100 });
    // …and a later host change re-clamps the run while keeping that centre.
    const after = sideParkAlongRun({ cur: { run: 300, alongShift: 100 }, span: { run: 380, alongShift: 0 }, stamp: res.stamp });
    expect(after.alongShift).toBe(100);
  });

  it("WALL STRIPS are fully derived from the span rule, so they have no anchor to lose", () => {
    const res = sideParkAlongRun({ cur: { run: 500, alongShift: 60 }, span: { run: 500, alongShift: 0 }, pinAllowed: false });
    expect(res.alongShift).toBe(0);                            // no stamp ⇒ back on the span default
  });
});

describe("the load-time heals do not re-centre an anchored zone", () => {
  /* The tear detector IS the healer's own diff (B1340), so a heal that ignored the anchor would
   * report a permanent tear against a canvas that is laying the zone correctly. */
  const HOST_ID = "e1454698mwpaoj", COURT_ID = "e1454699mwpaoj", TRAILER_ID = "e1454796yyuqqs";

  const plan = (trailerPatch) => FIXTURE.els.map((e) => (e.id === TRAILER_ID ? { ...e, ...trailerPatch } : e));

  it("an anchored trailer survives `normalizeBondedChildren` untouched (identity, no tear)", () => {
    // Lay the anchored trailer exactly as the canvas would, then hand the plan to the heal chain.
    const host = byId(HOST_ID), court = byId(COURT_ID);
    const laid = layChain(host, "bottom", [
      { zd: 135 }, { zd: 50, alongLen: 500, alongAnchor: ALONG_ANCHOR.START, alongOff: 0 },
    ], FACE);
    const els = plan({ alongLen: 500, alongAnchor: ALONG_ANCHOR.START, alongOff: 0, ...laid[1] });
    const heals = [];
    const out = normalizeBondedChildren(els, (h) => heals.push(h));
    const t = out.find((e) => e.id === TRAILER_ID);
    expect(t.alongLen).toBe(500);
    expect(t.alongAnchor).toBe(ALONG_ANCHOR.START);
    expect(t.cx).toBeCloseTo(laid[1].cx, 6);
    expect(t.cy).toBeCloseTo(laid[1].cy, 6);
    expect(heals.filter((h) => h.id === TRAILER_ID)).toEqual([]);
    expect(court.w).toBe(757.94);                             // fixture untouched
  });

  it("a CENTRED trailer laid the old way is still healed onto the chain (no behaviour lost)", () => {
    const out = normalizeBondedChildren(FIXTURE.els);
    const t = out.find((e) => e.id === TRAILER_ID);
    expect(t.w).toBeCloseTo(757.94, 6);                        // still tracking its court
    expect(t.alongAnchor).toBeUndefined();
  });

  it("an over-length anchored trailer drops the ANCHOR with the length it can no longer mean", () => {
    const host = byId(HOST_ID);
    const els = plan({ alongLen: 4000, alongAnchor: ALONG_ANCHOR.END, alongOff: 900, w: 4000 });
    const out = normalizeBondedChildren(els);
    const t = out.find((e) => e.id === TRAILER_ID);
    expect(t.alongLen).toBeUndefined();
    expect(t.alongAnchor).toBeUndefined();
    expect(t.alongOff).toBeUndefined();
    expect(t.w).toBeLessThanOrEqual(host.w + 1);
  });
});

describe("source guard — the anchor reaches every layout site", () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
  const PLANNER = read("../src/workspaces/site-planner/SitePlanner.jsx");
  const MODEL = read("../src/workspaces/site-planner/lib/siteModel.js");

  it("the canvas relayout passes anchors AND offsets, not just lengths", () => {
    expect(PLANNER).toMatch(/layoutZoneByKind\(b, side, i, depths, kinds, \{ \.\.\.courtOpts, alongs, anchors, offs \}\)/);
  });
  it("the resize gesture stores all three fields together", () => {
    expect(PLANNER).toMatch(/alongLen: fit\.len, alongAnchor: fit\.anchor, alongOff: fit\.off/);
  });
  it("clearing a zone's length clears its anchor too", () => {
    expect(PLANNER).toMatch(/alongLen: _drop, alongAnchor: _dropA, alongOff: _dropO/);
  });
  it("the truck court is no longer excluded from pinning (it shared the defect)", () => {
    expect(PLANNER).not.toMatch(/resized\.truckCourt \? null : resized(ZoneAlongLen|AlongLen)/);
  });
  it("every siteModel heal that lays a chain passes anchors + offs", () => {
    const sites = MODEL.match(/layoutZoneByKind\(host, side, i, depths, kinds, opts\)/g) || [];
    expect(sites.length).toBe(3);
    expect((MODEL.match(/anchors: chain\.map/g) || []).length).toBe(2);   // the two length-dropping heals
    expect(MODEL).toMatch(/const anchors = chain\.map/);                  // …and the stranded re-fit
  });
});
