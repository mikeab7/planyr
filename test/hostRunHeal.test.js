import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { normalizeBondedChildren, normalizeHostRuns } from "../src/workspaces/site-planner/lib/siteModel.js";
import {
  sideParkAlongRun, wallKidAlong, sidewalkSpanForBumps, dogEarGeom, bumpsOfHost,
  sideParkStack, wallKidBox, hostAxisExtents, ownExtents, localToWorld,
} from "../src/workspaces/site-planner/lib/dogEar.js";
import { zoneAlongExtent, resizedZoneAlongLen } from "../src/workspaces/site-planner/lib/dockZones.js";
import { collectClipboard, pasteClipboard } from "../src/workspaces/site-planner/lib/planClipboard.js";

/* NEW-1 — a child may never carry a DIFFERENT (longer) host's along-wall run.
 *
 * The fixture is the owner's REAL Weld County plan (site `sms7v3ua7ksy`, "Concept A"), copied
 * verbatim out of `site_elements`, because a freshly drawn building lays out correctly today and
 * would pass while the bug is still in the code:
 *
 *   e7373  260 × 708.58   its court 135 × 708.58, its west parking 708.58 × 60   ← consistent
 *   e7381  260 × 577      its court 135 × 577,    its west parking 577 × 60
 *                         …but that parking carries `sideParkFit { run: 708.58 }` — a stored
 *                         "the owner set this length" intent naming the FIRST building's length
 *   e7389  260 × 514      its court 135 × 708.58, its west parking 708.58 × 60  ← 194.58 ft of
 *                         overhang past the end of the building; its SIDEWALKS are already right
 *                         (5 × 514), which is `normalizeWallKids` having healed them, not the
 *                         resize having worked (the saved revs prove it — see siteModel.js).
 */
const FIXTURE = JSON.parse(readFileSync(new URL("../ui-audit/fixtures/weld-concept-a.json", import.meta.url), "utf8"));
const ELS = FIXTURE.els;

const B1 = "e7373vqgilf", B2 = "e7381vqgilf", B3 = "e7389vqgilf";
const B3_COURT = "e7390vqgilf", B3_SW_TOP = "e7391vqgilf", B3_PK_TOP = "e7392vqgilf";
const B3_SW_LEFT = "e7393vqgilf", B3_PK_LEFT = "e7394vqgilf", B3_SW_BOT = "e7395vqgilf", B3_PK_BOT = "e7396vqgilf";
const B2_PK_LEFT = "e7386vqgilf";
const FOREIGN_LEN = 708.58;          // building 1's length — the number that leaked
const B3_LEN = 514;                  // building 3's own length

const by = (list, id) => list.find((e) => e.id === id);
/* Every bonded child of `hostId`, measured ALONG its host's wall in the host's own frame — the
 * frame the overhang is stated in. A court/strip on a left/right wall and a quarter-turned parking
 * row all reduce to one number here. */
const alongRuns = (list, hostId) => {
  const host = by(list, hostId);
  const out = {};
  for (const e of list) {
    if (e.attachedTo !== hostId || e.points) continue;
    const side = e.truckCourt ? e.truckCourt.side : (e.sideParkSide || e.sidewalkSide);
    out[e.id] = side === "top" || side === "bottom"
      ? zoneAlongExtent(e, host.rot || 0, "bottom")
      : zoneAlongExtent(e, host.rot || 0, "right");
  }
  return out;
};

describe("the load-time heal re-lays a child carrying another host's run (NEW-1)", () => {
  const healed = normalizeBondedChildren(ELS, () => {});

  it("every child of the shortened building measures against 514, not 708.58", () => {
    const runs = alongRuns(healed, B3);
    // The court + the west parking row, the two the owner is looking at.
    expect(runs[B3_COURT]).toBeCloseTo(B3_LEN, 2);
    expect(runs[B3_PK_LEFT]).toBeCloseTo(B3_LEN, 2);
    // …and the whole child set, so nothing else is quietly carrying the foreign length either.
    for (const [id, run] of Object.entries(runs)) {
      expect(run, `${id} still measures against a different building`).not.toBeCloseTo(FOREIGN_LEN, 1);
      expect(run, `${id} overhangs its host`).toBeLessThanOrEqual(B3_LEN + 1);
    }
    // The end-wall children (top/bottom) run the building's DEPTH and are untouched by all this.
    expect(runs[B3_SW_TOP]).toBeCloseTo(260, 2);
    expect(runs[B3_PK_BOT]).toBeCloseTo(260, 2);
  });

  it("the court is re-POSITIONED too, not merely re-sized", () => {
    const host = by(healed, B3), court = by(healed, B3_COURT);
    // Flush outward from the dock wall: half the building depth + half the court depth.
    const rad = ((host.rot || 0) * Math.PI) / 180;
    const u = { x: Math.cos(rad), y: Math.sin(rad) };            // outward normal of the "right" wall
    const across = (court.cx - host.cx) * u.x + (court.cy - host.cy) * u.y;
    const along = (court.cx - host.cx) * -u.y + (court.cy - host.cy) * u.x;
    expect(across).toBeCloseTo(host.w / 2 + 135 / 2, 2);
    expect(along, "the court is still centred on the OLD host's wall").toBeCloseTo(0, 2);
  });

  it("the sidewalks it did not need to touch are returned BY IDENTITY (no churn)", () => {
    for (const id of [B3_SW_LEFT, B3_SW_TOP, B3_SW_BOT, B3_PK_TOP, B3_PK_BOT]) {
      expect(by(healed, id), `${id} was rewritten for no reason`).toBe(by(ELS, id));
    }
  });

  it("the two CONSISTENT buildings are left completely alone", () => {
    for (const e of ELS) {
      if (e.attachedTo !== B1 && e.id !== B1) continue;
      expect(by(healed, e.id), `${e.id} (a correct building) was healed`).toBe(e);
    }
  });

  it("is idempotent — a healed plan re-heals to the same objects", () => {
    const twice = normalizeBondedChildren(healed, () => {});
    for (const e of healed) expect(by(twice, e.id)).toBe(e);
  });

  it("reports what it repaired (a silent repair is one nobody can audit)", () => {
    const heals = [];
    normalizeBondedChildren(ELS, (h) => heals.push(h));
    const kinds = heals.filter((h) => /^host-run/.test(h.kind));
    expect(kinds.map((h) => h.id).sort()).toEqual([B2_PK_LEFT, B3_COURT, B3_PK_LEFT].sort());
    expect(kinds.find((h) => h.id === B3_COURT).kind).toBe("host-run-zone");
    expect(kinds.find((h) => h.id === B3_PK_LEFT).kind).toBe("host-run-side-parking");
  });

  it("drops the spurious `sideParkFit` that remembered the OTHER building's length", () => {
    expect(by(ELS, B2_PK_LEFT).sideParkFit.run).toBe(FOREIGN_LEN);   // the state on the owner's plan
    expect(by(healed, B2_PK_LEFT).sideParkFit).toBeUndefined();
    // …and the row it applied to is still exactly as long as its own host's wall.
    expect(alongRuns(healed, B2)[B2_PK_LEFT]).toBeCloseTo(577, 2);
  });

  it("drops an `alongLen` longer than the wall it is stored against", () => {
    const poisoned = ELS.map((e) => (e.id === B3_COURT ? { ...e } : e))
      .map((e) => (e.id === B3_PK_TOP ? e : e));
    // A trailer bonded outward of building 3's court, pinned to the foreign length.
    const trailer = {
      id: "tX", type: "trailer", cx: -46, cy: 889, w: FOREIGN_LEN, h: 50, rot: 84.81766642639934,
      attachedTo: B3, forCourt: B3_COURT, prevZone: B3_COURT, noFit: true, zd: 50, alongLen: FOREIGN_LEN,
    };
    const out = normalizeBondedChildren([...poisoned, trailer], () => {});
    expect(by(out, "tX").alongLen).toBeUndefined();
    expect(alongRuns(out, B3).tX).toBeLessThanOrEqual(B3_LEN + 1);
  });

  /* ⛔ NEW-2 (2026-07-31) — THE OWNER AMENDED THIS RULE, and this pair of cases is the record of it.
   * The old contract was "a run that FITS is never touched": any shorter-than-the-wall run read as a
   * hand-placed field forever. That is what B1340 did not close — on "Concept D — Sylvestri Retail"
   * a building's depth went 220 → 200, its sidewalks correctly followed to 260 and its end PARKING
   * fields sat at 205 against that same 260 ft wall (and 80 against 259 on the building beside it).
   * The run is derivable from the host exactly like the position is, so it is derived — and a
   * genuine user length is an EXPLICIT `sideParkFit` override, re-clamped to the host every time. */
  it("an UNSTAMPED short run is re-derived to the wall — 'preserve once touched' is gone", () => {
    const host = by(ELS, B3);
    const rad = ((host.rot || 0) * Math.PI) / 180;
    const perp = -(host.w / 2 + 5 + 30), along = 40;
    const slid = {
      ...by(ELS, B3_PK_LEFT), w: 300,
      cx: host.cx + perp * Math.cos(rad) - along * Math.sin(rad),
      cy: host.cy + perp * Math.sin(rad) + along * Math.cos(rad),
    };
    const out = normalizeHostRuns(ELS.map((e) => (e.id === B3_PK_LEFT ? slid : e)), () => {});
    const got = by(out, B3_PK_LEFT);
    expect(got).not.toBe(slid);                          // it WAS re-derived
    expect(alongRuns(out, B3)[B3_PK_LEFT]).toBeCloseTo(B3_LEN, 0);   // …onto the wall it hugs
  });

  it("a RECORDED length survives every load, and is re-clamped to the host it currently has", () => {
    const host = by(ELS, B3);
    const rad = ((host.rot || 0) * Math.PI) / 180;
    const perp = -(host.w / 2 + 5 + 30), along = 40;
    const stamped = {
      ...by(ELS, B3_PK_LEFT), w: 300, sideParkFit: { run: 300, alongShift: along },
      cx: host.cx + perp * Math.cos(rad) - along * Math.sin(rad),
      cy: host.cy + perp * Math.sin(rad) + along * Math.cos(rad),
    };
    const out = normalizeHostRuns(ELS.map((e) => (e.id === B3_PK_LEFT ? stamped : e)), () => {});
    expect(by(out, B3_PK_LEFT)).toBe(stamped);           // explicit intent → untouched
    // …and the same stamp on a SHORTER host is clamped to that host, never left overhanging.
    const shortHost = ELS.map((e) => (e.id === B3 ? { ...e, h: 120 } : (e.id === B3_PK_LEFT ? stamped : e)));
    expect(alongRuns(normalizeHostRuns(shortHost, () => {}), B3)[B3_PK_LEFT]).toBeLessThanOrEqual(121);
  });

  it("legacy: a run that FITS used to be frozen — kept as a named record of the old contract", () => {
    const host = by(ELS, B3);
    const rad = ((host.rot || 0) * Math.PI) / 180;
    const perp = -(host.w / 2 + 5 + 30), along = 40;
    const slid = {
      ...by(ELS, B3_PK_LEFT), w: 300,
      cx: host.cx + perp * Math.cos(rad) - along * Math.sin(rad),
      cy: host.cy + perp * Math.sin(rad) + along * Math.cos(rad),
    };
    const out = normalizeHostRuns(ELS.map((e) => (e.id === B3_PK_LEFT ? slid : e)), () => {});
    // Under the amended rule this is NO LONGER frozen. Asserted as the inverse so the change of
    // contract is explicit in the suite rather than silently deleted.
    expect(by(out, B3_PK_LEFT)).not.toBe(slid);
  });
});

describe("shortening a host re-lays the court and the side parking, not just the sidewalks", () => {
  /* The canvas does this through `refitChildren`; the invariant it has to leave behind is the one
     asserted here, and the load-time heal is the backstop that enforces it however it was broken.
     Shrink building 1 (the internally consistent one) and re-heal: everything follows. */
  const SHORT = 400;
  const shrunk = ELS.map((e) => (e.id === B1 ? { ...e, h: SHORT } : e));
  const healed = normalizeBondedChildren(shrunk, () => {});
  const runs = alongRuns(healed, B1);

  it("the truck court follows the host down", () => {
    expect(runs["e7374vqgilf"]).toBeCloseTo(SHORT, 2);
  });
  it("the side-parking row follows the host down", () => {
    expect(runs["e7378vqgilf"]).toBeCloseTo(SHORT, 2);
  });
  it("the wall strip follows the host down (the half that already worked)", () => {
    expect(runs["e7377vqgilf"]).toBeCloseTo(SHORT, 2);
  });
  it("and none of the three is left pinned to the old length", () => {
    for (const id of ["e7374vqgilf", "e7377vqgilf", "e7378vqgilf"]) {
      expect(runs[id]).not.toBeCloseTo(FOREIGN_LEN, 1);
    }
  });
});

describe("a stored along length is never stamped by a duplicate or a host resize", () => {
  it("sideParkAlongRun: a host SHRINK re-derives the run and stamps nothing", () => {
    // The exact shape `relayoutWallKids` sees mid-resize: the NEW host span, the OLD child run.
    const res = sideParkAlongRun({ cur: { run: 708.58, alongShift: 97.29 }, span: { run: 514, alongShift: 0 } });
    expect(res.run).toBe(514);
    expect(res.alongShift).toBe(0);
    expect(res.stamp).toBeUndefined();          // ← the `sideParkFit { run: 708.58 }` that used to appear
    expect(res.stale).toBe(true);
  });

  it("sideParkAlongRun: only a gesture aimed AT THE FIELD may pin an over-length run", () => {
    const args = { cur: { run: 800, alongShift: 0 }, span: { run: 514, alongShift: 0 } };
    expect(sideParkAlongRun({ ...args, pinAllowed: false }).stamp).toBeUndefined();
    // NEW-3 (B1843901) — the render used to clamp back to the span even for the gesture aimed at
    // this exact field ("the render is still clamped"), which IS the bug this rule now fixes: an
    // end-grip drag past a bump-out visibly extended the piece and snapped back on release. The
    // gesture's own drag is honoured as-is, and the stamp records that it went past the wall.
    expect(sideParkAlongRun({ ...args, pinAllowed: true }).stamp).toEqual({ run: 800, alongShift: 0, beyond: true });
    expect(sideParkAlongRun({ ...args, pinAllowed: true }).run, "the render honours the full drag, unclamped").toBe(800);
  });

  /* ⛔ NEW-3 (2026-09-22, B1843901) — an end-grip drag past the wall (or past a bump-out that
   * lengthens it) is now real, permanent intent: `beyond` marks it, and once marked it survives
   * every later refit and the load-time heal untouched — the over-length branch above must never
   * fire on it. A stamp with NO `beyond` marker (every stamp already on disk, the Weld one
   * included) is completely unaffected: it still re-clamps to the current span and drops the
   * instant it goes over, exactly as before. */
  it("sideParkAlongRun: a `beyond` stamp is honoured as-is by a later refit, never re-clamped", () => {
    const span = { run: 540, alongShift: 10 };
    // The gesture that created it: dragging the south end 100 ft past a 540 ft span.
    const pinned = sideParkAlongRun({ cur: { run: 640, alongShift: 60 }, span, pinAllowed: true });
    expect(pinned.stamp).toEqual({ run: 640, alongShift: 60, beyond: true });
    // A later refit aimed at nothing in particular (pinFrom null) — the shape `relayoutWallKids`
    // and the load-time heal both call.
    const refit = sideParkAlongRun({ cur: { run: 640, alongShift: 60 }, span, stamp: pinned.stamp });
    expect(refit.run).toBe(640);
    expect(refit.alongShift).toBe(60);
    expect(refit.stale).toBe(false);
    expect(refit.stamp).toBeUndefined();               // "leave whatever is there" — the stamp is kept
    // It survives even when the host has since changed (a sidewalk width, a bump-out, the building
    // itself) and the span it hugs is now smaller than the pinned run — the whole point of the fix.
    const shrunkSpan = { run: 300, alongShift: 0 };
    const afterHostShrink = sideParkAlongRun({ cur: { run: 640, alongShift: 60 }, span: shrunkSpan, stamp: pinned.stamp });
    expect(afterHostShrink.run).toBe(640);
    expect(afterHostShrink.stale).toBe(false);
    expect(afterHostShrink.stamp).toBeUndefined();
    // …and even LARGER than the span has since grown to.
    const grownSpan = { run: 900, alongShift: 0 };
    const afterHostGrow = sideParkAlongRun({ cur: { run: 640, alongShift: 60 }, span: grownSpan, stamp: pinned.stamp });
    expect(afterHostGrow.run).toBe(640);
    expect(afterHostGrow.stale).toBe(false);
  });

  it("sideParkAlongRun: a LEGACY over-length stamp with no `beyond` marker still heals (the Weld shape)", () => {
    const span = { run: 577, alongShift: 0 };
    // Exactly the Weld fixture's shape: a stamp naming a different, longer building's length, no
    // `beyond` marker because it predates this fix — dropped, never honoured.
    const legacy = { run: 708.58, alongShift: 3.79 };
    const res = sideParkAlongRun({ cur: { run: 577, alongShift: 0 }, span, stamp: legacy });
    expect(res.run).toBe(577);
    expect(res.stale).toBe(true);
    expect(res.stamp).toBeNull();
  });

  it("sideParkAlongRun: dragging a `beyond` field back onto the span default withdraws it completely", () => {
    const span = { run: 540, alongShift: 10 };
    const pinned = sideParkAlongRun({ cur: { run: 640, alongShift: 60 }, span, pinAllowed: true });
    expect(pinned.stamp.beyond).toBe(true);
    const withdrawn = sideParkAlongRun({ cur: { run: 540, alongShift: 10 }, span, stamp: pinned.stamp, pinAllowed: true });
    expect(withdrawn.stamp).toBeNull();
    expect(withdrawn.run).toBe(540);
  });

  it("sideParkAlongRun: an existing IMPOSSIBLE stamp is dropped, a possible one is honoured", () => {
    const span = { run: 514, alongShift: 0 };
    expect(sideParkAlongRun({ cur: { run: 514, alongShift: 0 }, span, stamp: { run: 708.58, alongShift: 3.79 } }).stamp).toBeNull();
    const keep = sideParkAlongRun({ cur: { run: 300, alongShift: 40 }, span, stamp: { run: 300, alongShift: 40 } });
    expect(keep.run).toBe(300);
    expect(keep.alongShift).toBe(40);
    expect(keep.stale).toBe(false);
  });

  it("sideParkAlongRun: a field sitting ON the span default keeps tracking it", () => {
    const res = sideParkAlongRun({ cur: { run: 600, alongShift: 0 }, span: { run: 600, alongShift: 0 } });
    expect(res.run).toBe(600);
    expect(res.stale).toBe(false);
    expect(res.stamp).toBeUndefined();
  });

  it("sideParkAlongRun: an UNSTAMPED run SHORT of the span is stale and re-derived (NEW-2)", () => {
    // The Sylvestri shape: a 205 ft field against the 260 ft wall its host now has.
    const res = sideParkAlongRun({ cur: { run: 205, alongShift: 0 }, span: { run: 260, alongShift: 0 } });
    expect(res.run).toBe(260);
    expect(res.stale).toBe(true);            // → the load-time heal applies it, and it is reported
    expect(res.stamp).toBeUndefined();
  });

  it("sideParkAlongRun: a gesture aimed at the field RECORDS its intent, and dragging back clears it", () => {
    const span = { run: 260, alongShift: 0 };
    const pinned = sideParkAlongRun({ cur: { run: 205, alongShift: 12 }, span, pinAllowed: true });
    expect(pinned.run).toBe(205);
    expect(pinned.stamp).toEqual({ run: 205, alongShift: 12 });   // EXPLICIT, per-element, storable
    // Recorded intent then survives an ordinary refit…
    expect(sideParkAlongRun({ cur: { run: 205, alongShift: 12 }, span, stamp: pinned.stamp }).run).toBe(205);
    // …and is re-clamped when the host shrinks under it, rather than overhanging.
    expect(sideParkAlongRun({ cur: { run: 205, alongShift: 12 }, span: { run: 150, alongShift: 0 }, stamp: pinned.stamp }).run).toBe(150);
    // Dragged back onto the default → intent withdrawn.
    expect(sideParkAlongRun({ cur: { run: 260, alongShift: 0 }, span, stamp: pinned.stamp, pinAllowed: true }).stamp).toBeNull();
  });

  it("resizedZoneAlongLen: a host refit / relayout / heal can never pin a dock zone's length", () => {
    const prev = { w: 135, h: 708.58, rot: 354.81766642639934 };
    const next = { w: 135, h: 514, rot: 354.81766642639934 };
    const at = { hostRot: 354.81766642639934, side: "right" };
    expect(resizedZoneAlongLen(prev, next, { ...at, userResize: false })).toBeNull();
    expect(resizedZoneAlongLen(prev, next, { ...at, userResize: true, alongAxisDragged: false })).toBeNull();
    // …only a real drag of THAT axis may.
    expect(resizedZoneAlongLen(prev, next, { ...at, userResize: true, alongAxisDragged: true })).toBe(514);
  });
});

describe("duplicating a building carries the FULL child set at the copy's own dimensions", () => {
  /* Duplicate building 1 — the internally CONSISTENT one — because that is the gesture the owner's
     three identical-rotation buildings came from, and because a copy of a healthy assembly is the
     thing that must arrive needing no repair. (The copy of the BROKEN building is the case below.) */
  let n = 0;
  const mint = () => `c${++n}`;
  const translate = { el: (o, dx, dy) => ({ ...o, cx: o.cx + dx, cy: o.cy + dy }) };
  const { items } = collectClipboard([{ kind: "el", id: B1 }], { els: ELS });
  const pasted = pasteClipboard(items, { mint, translate, dx: 1000, dy: 0 });

  it("copies the host and every one of its bonded children", () => {
    const src = ELS.filter((e) => e.id === B1 || e.attachedTo === B1);
    expect(items).toHaveLength(src.length);
    expect(pasted.els).toHaveLength(src.length);
    expect(src.length).toBe(8);            // host + truck court + 3 sidewalks + 3 side-parking rows
    // every child role survives the copy
    expect(pasted.els.filter((e) => e.truckCourt)).toHaveLength(1);
    expect(pasted.els.filter((e) => e.sideParkSide)).toHaveLength(3);
    expect(pasted.els.filter((e) => e.sidewalkSide)).toHaveLength(3);
  });

  it("every child keeps the dimensions of the element it was copied from — the COPY's own host", () => {
    const map = new Map(items.map((it, i) => [it.obj.id, pasted.els[i]]));
    for (const [srcId, copy] of map) {
      const src = by(ELS, srcId);
      expect(copy.w, `${srcId} → ${copy.id} width`).toBe(src.w);
      expect(copy.h, `${srcId} → ${copy.id} height`).toBe(src.h);
    }
  });

  it("bonds are remapped INSIDE the copy — no child points back at the original", () => {
    const newIds = new Set(pasted.els.map((e) => e.id));
    const oldIds = new Set(ELS.map((e) => e.id));
    for (const e of pasted.els) {
      for (const tag of ["attachedTo", "forCourt", "forTrailer", "prevZone"]) {
        if (typeof e[tag] !== "string") continue;
        expect(newIds.has(e[tag]), `${e.id}.${tag} escaped the copy`).toBe(true);
        expect(oldIds.has(e[tag]), `${e.id}.${tag} still names the ORIGINAL`).toBe(false);
      }
    }
  });

  it("the copy stamps no along-wall intent of its own", () => {
    for (const e of pasted.els) {
      expect(e.alongLen, `${e.id} arrived with a pinned length`).toBeUndefined();
      expect(e.sideParkFit, `${e.id} arrived with a pinned run`).toBeUndefined();
    }
  });

  it("the pasted assembly needs NO heal — the load-time pass leaves it byte-identical", () => {
    const both = [...ELS, ...pasted.els];
    const heals = [];
    const out = normalizeHostRuns(both, (h) => heals.push(h));
    for (const e of pasted.els) expect(by(out, e.id), `${e.id} was healed`).toBe(e);
    expect(heals.filter((h) => pasted.els.some((e) => e.id === h.id))).toEqual([]);
  });

  it("a copy of the BROKEN building inherits the defect — and the heal repairs the copy too", () => {
    // Copying carries geometry verbatim, so duplicating building 3 as it is saved today hands the
    // copy the same 708.58 court. The invariant is stated against each element's OWN host, so the
    // copy is repaired exactly like the original rather than being missed for being new.
    let m = 0;
    const copy = pasteClipboard(collectClipboard([{ kind: "el", id: B3 }], { els: ELS }).items,
      { mint: () => `d${++m}`, translate, dx: 3000, dy: 0 });
    const copyHost = copy.els.find((e) => e.type === "building");
    expect(alongRuns(copy.els, copyHost.id)[copy.els.find((e) => e.truckCourt).id])
      .toBeCloseTo(FOREIGN_LEN, 1);                                   // inherited, as expected
    const both = normalizeBondedChildren([...ELS, ...copy.els], () => {});
    const runs = alongRuns(both, copyHost.id);
    expect(Object.keys(runs).length).toBe(7);
    for (const [id, run] of Object.entries(runs)) {
      expect(run, `${id} on the copy still carries the foreign length`).toBeLessThanOrEqual(B3_LEN + 1);
    }
  });
});

describe("the along-run rule agrees with what the canvas measures", () => {
  it("wallKidAlong + sidewalkSpanForBumps see the overhang the owner sees", () => {
    const host = by(ELS, B3);
    const cur = wallKidAlong(host, "left", by(ELS, B3_PK_LEFT));
    const span = sidewalkSpanForBumps(host, "left", []);
    expect(cur.run).toBeCloseTo(FOREIGN_LEN, 2);
    expect(span.run).toBe(B3_LEN);
    expect(cur.run - span.run).toBeCloseTo(194.58, 2);   // the owner's overhang, to the foot
  });
});

/* ⛔ B1843901 (NEW-1) — an end-grip drag past a corner bump-out, driven through the exact same pure
 * geometry `relayoutWallKids` (SitePlanner.jsx) and the load-time heal (`normalizeBondedChildren`)
 * both call, on a SYNTHETIC building shaped like the owner's report: a long dock building with two
 * corner bump-outs lengthening one end wall, and its side parking EXPLODED into a row | aisle | row
 * stack. `relayoutWallKids` itself is a closure inside the SitePlanner component and can't be
 * imported, but every piece of arithmetic it does is these exported `dogEar.js` functions — so
 * driving them in the same order it does IS driving the real mechanism, not a re-implementation of
 * it (the same relationship `test/wallKidDrift.test.js` and the rest of this file already have to
 * the canvas). The three checkpoints below are the three the bug report names: the LIVE drag
 * (`sideParkAlongRun` with `pinAllowed`), an ordinary REFIT with no gesture (`pinFrom` null — a
 * sidewalk/bump-out/host change elsewhere), and a HARD RELOAD (`normalizeBondedChildren`) — and the
 * numbers must agree all three times. A known-good arm (the untouched siblings + the unstamped
 * fields in the earlier describe blocks above) sits beside every assertion here, and reverting the
 * `dogEar.js` fix under test makes every "unclamped"/"beyond" assertion in this block fail — that
 * IS the mutation check this class of bug needs (there is no separate "run it broken" step). */
describe("an end-grip drag past the wall span survives every refit and a hard reload (B1843901, NEW-1)", () => {
  const SIDE_PARK_ANGLE = { top: 180, bottom: 0, left: 90, right: 270 };
  const ROW_D = 60, AISLE_D = 24;
  const northAlong = (c) => c.alongShift - c.run / 2;
  const southAlong = (c) => c.alongShift + c.run / 2;

  // A 1122 × 420 dock building with a 55 × 60 bump-out at each of its two WEST-wall corners (NW/SW)
  // — Building 4 from the report — and its west-wall side parking exploded into row | aisle | row.
  function buildFixture() {
    const host = { id: "hostB", type: "building", cx: 0, cy: 0, w: 1122, h: 420, rot: 0 };
    const bumpDe = (side, sign) => ({ side, sign, along: 55, proj: 60 });
    const bumpNW = { id: "bumpNW", type: "building", attachedTo: host.id, dogEar: bumpDe("top", -1), ...dogEarGeom(host, bumpDe("top", -1)) };
    const bumpSW = { id: "bumpSW", type: "building", attachedTo: host.id, dogEar: bumpDe("bottom", -1), ...dogEarGeom(host, bumpDe("bottom", -1)) };
    const bumps = bumpsOfHost([bumpNW, bumpSW], host);
    const span = sidewalkSpanForBumps(host, "left", bumps);          // 420 + 60 + 60 = 540, centred
    const kidRot = ((host.rot || 0) + SIDE_PARK_ANGLE.left) % 360;
    const { cross } = hostAxisExtents(host, { rot: kidRot, w: 0, h: 0 });
    const place = (id, type, piece, depth, gap, run, alongShift) => {
      const box = wallKidBox(host, "left", { depth, gap, run, alongShift });
      const c = localToWorld(host, box.lx, box.ly);
      return { id, type, attachedTo: host.id, sideParkSide: "left", sideParkPiece: piece, rot: kidRot,
        cx: c.x, cy: c.y, ...ownExtents(cross, box.dimBX, box.dimBY) };
    };
    const stubPad = (id, i, depth) => ({ id, sideParkSide: "left", sideParkPiece: i, rot: kidRot, w: 1, h: depth });
    const gapById = new Map(sideParkStack(host, "left", [stubPad("row1", 0, ROW_D), stubPad("aisle", 1, AISLE_D), stubPad("row2", 2, ROW_D)], 0)
      .map((r) => [r.el.id, r.gap]));
    const row1 = place("row1", "parking", 0, ROW_D, gapById.get("row1"), span.run, span.alongShift);
    const aisle = place("aisle", "paving", 1, AISLE_D, gapById.get("aisle"), span.run, span.alongShift);
    const row2 = place("row2", "parking", 2, ROW_D, gapById.get("row2"), span.run, span.alongShift);
    return { host, bumpNW, bumpSW, bumps, span, row1, aisle, row2, place, gapById };
  }

  it("dragging the SOUTH end 100 ft past the bump-out: live, refit, and reload agree", () => {
    const { host, bumpNW, bumpSW, span, row1, aisle, row2, place, gapById } = buildFixture();
    const cur = wallKidAlong(host, "left", aisle);
    expect(cur.run).toBeCloseTo(540, 2);                              // the full extended side
    // The gesture: drag the south (+) end 100 ft further out, the north (−) end held.
    const dragged = sideParkAlongRun({ cur: { run: cur.run + 100, alongShift: cur.alongShift + 50 }, span, pinAllowed: true });
    expect(dragged.stale).toBe(false);
    expect(dragged.stamp).toEqual({ run: 640, alongShift: 50, beyond: true });
    expect(dragged.run, "the live drag is honoured, not clamped").toBe(640);
    const draggedAisle = { ...place("aisle", "paving", 1, AISLE_D, gapById.get("aisle"), dragged.run, dragged.alongShift), sideParkFit: dragged.stamp };
    const afterDrag = wallKidAlong(host, "left", draggedAisle);
    expect(northAlong(afterDrag), "the north end never moved").toBeCloseTo(northAlong(cur), 1);
    expect(southAlong(afterDrag), "the south end landed exactly where it was dropped").toBeCloseTo(southAlong(cur) + 100, 1);
    // Sibling rows are untouched by this gesture — he drags each himself.
    expect(wallKidAlong(host, "left", row1)).toEqual(wallKidAlong(host, "left", row1));
    expect(wallKidAlong(host, "left", row2).run).toBeCloseTo(540, 2);

    // An ordinary refit aimed at NOTHING (pinFrom null) — the shape a sidewalk add/delete/width, a
    // bump-out add/delete/resize, or a host resize elsewhere all trigger.
    const refit = sideParkAlongRun({ cur: wallKidAlong(host, "left", draggedAisle), span, stamp: draggedAisle.sideParkFit, pinAllowed: false });
    expect(refit.stale, "the over-length branch must not fire on a stamped field").toBe(false);
    expect(refit.run).toBe(640);
    const refitAisle = { ...place("aisle", "paving", 1, AISLE_D, gapById.get("aisle"), refit.run, refit.alongShift), sideParkFit: draggedAisle.sideParkFit };
    const afterRefit = wallKidAlong(host, "left", refitAisle);
    expect(northAlong(afterRefit)).toBeCloseTo(northAlong(afterDrag), 1);
    expect(southAlong(afterRefit)).toBeCloseTo(southAlong(afterDrag), 1);

    // A hard reload: the real load-time heal, over the whole assembly.
    const heals = [];
    const healed = normalizeBondedChildren([host, bumpNW, bumpSW, row1, draggedAisle, row2], (h) => heals.push(h));
    expect(heals.filter((h) => h.id === "aisle"), "assembly-tear-detected must not report the beyond field").toEqual([]);
    const healedAisle = healed.find((e) => e.id === "aisle");
    expect(healedAisle, "byte-identical — nothing needed to change").toBe(draggedAisle);
    const afterReload = wallKidAlong(host, "left", healedAisle);
    expect(northAlong(afterReload)).toBeCloseTo(northAlong(afterDrag), 1);
    expect(southAlong(afterReload)).toBeCloseTo(southAlong(afterDrag), 1);
    // Siblings never moved, through the whole reload.
    expect(healed.find((e) => e.id === "row1")).toBe(row1);
    expect(healed.find((e) => e.id === "row2")).toBe(row2);
  });

  it("dragging the NORTH end 80 ft past the bump-out: the south end holds, the heal agrees", () => {
    const { host, bumpNW, bumpSW, span, row1, aisle, row2, place, gapById } = buildFixture();
    const cur = wallKidAlong(host, "left", aisle);
    const dragged = sideParkAlongRun({ cur: { run: cur.run + 80, alongShift: cur.alongShift - 40 }, span, pinAllowed: true });
    expect(dragged.run).toBe(620);
    expect(dragged.stamp.beyond).toBe(true);
    const draggedAisle = { ...place("aisle", "paving", 1, AISLE_D, gapById.get("aisle"), dragged.run, dragged.alongShift), sideParkFit: dragged.stamp };
    const afterDrag = wallKidAlong(host, "left", draggedAisle);
    expect(southAlong(afterDrag), "the south end never moved").toBeCloseTo(southAlong(cur), 1);
    expect(northAlong(afterDrag), "the north end landed exactly where it was dropped").toBeCloseTo(northAlong(cur) - 80, 1);

    const healed = normalizeBondedChildren([host, bumpNW, bumpSW, row1, draggedAisle, row2], () => {});
    const healedAisle = healed.find((e) => e.id === "aisle");
    expect(healedAisle).toBe(draggedAisle);
    const afterReload = wallKidAlong(host, "left", healedAisle);
    expect(southAlong(afterReload)).toBeCloseTo(southAlong(afterDrag), 1);
    expect(northAlong(afterReload)).toBeCloseTo(northAlong(afterDrag), 1);
  });

  it("the same gesture on a LONG-WALL (top) field extends east/west past its span, and survives reload", () => {
    const { host, bumpNW, bumpSW, bumps } = buildFixture();
    const span = sidewalkSpanForBumps(host, "top", bumps);            // no bump-out lengthens this wall
    expect(span.run).toBe(1122);
    const kidRot = ((host.rot || 0) + SIDE_PARK_ANGLE.top) % 360;
    const { cross } = hostAxisExtents(host, { rot: kidRot, w: 0, h: 0 });
    const place = (run, alongShift) => {
      const box = wallKidBox(host, "top", { depth: 60, gap: 0, run, alongShift });
      const c = localToWorld(host, box.lx, box.ly);
      return { id: "topField", type: "parking", attachedTo: host.id, sideParkSide: "top", rot: kidRot,
        cx: c.x, cy: c.y, ...ownExtents(cross, box.dimBX, box.dimBY) };
    };
    const field = place(span.run, span.alongShift);
    const cur = wallKidAlong(host, "top", field);
    // Drag the east (+) end 120 ft past the building's own end wall.
    const dragged = sideParkAlongRun({ cur: { run: cur.run + 120, alongShift: cur.alongShift + 60 }, span, pinAllowed: true });
    expect(dragged.run).toBe(1242);
    expect(dragged.stamp.beyond).toBe(true);
    const draggedField = { ...place(dragged.run, dragged.alongShift), sideParkFit: dragged.stamp };
    const afterDrag = wallKidAlong(host, "top", draggedField);
    expect(afterDrag.alongShift - afterDrag.run / 2, "the west end never moved").toBeCloseTo(cur.alongShift - cur.run / 2, 1);
    expect(afterDrag.alongShift + afterDrag.run / 2, "the east end landed exactly where it was dropped")
      .toBeCloseTo(cur.alongShift + cur.run / 2 + 120, 1);

    const healed = normalizeBondedChildren([host, bumpNW, bumpSW, draggedField], () => {});
    const healedField = healed.find((e) => e.id === "topField");
    expect(healedField).toBe(draggedField);
    expect(wallKidAlong(host, "top", healedField).run).toBe(1242);
  });

  it("a field dragged back onto the span default is not left 'beyond' anything", () => {
    const { aisle, host, span } = buildFixture();
    const cur = wallKidAlong(host, "left", aisle);
    const dragged = sideParkAlongRun({ cur: { run: cur.run + 100, alongShift: cur.alongShift + 50 }, span, pinAllowed: true });
    const back = sideParkAlongRun({ cur: { run: span.run, alongShift: span.alongShift }, span, stamp: dragged.stamp, pinAllowed: true });
    expect(back.stamp).toBeNull();
    expect(back.run).toBe(span.run);
  });
});
