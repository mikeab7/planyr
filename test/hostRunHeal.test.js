import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { normalizeBondedChildren, normalizeHostRuns } from "../src/workspaces/site-planner/lib/siteModel.js";
import { sideParkAlongRun, wallKidAlong, sidewalkSpanForBumps } from "../src/workspaces/site-planner/lib/dogEar.js";
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

  it("a run that FITS is never touched — a hand-positioned field survives every load", () => {
    // A 300 ft field slid 40 ft along building 3's 514 ft wall: shorter than the wall, so it is a
    // real placement and the heal has no business re-deriving it (the owner's fire-lane curb return).
    const host = by(ELS, B3);
    const rad = ((host.rot || 0) * Math.PI) / 180;
    const perp = -(host.w / 2 + 5 + 30), along = 40;
    const slid = {
      ...by(ELS, B3_PK_LEFT), w: 300,
      cx: host.cx + perp * Math.cos(rad) - along * Math.sin(rad),
      cy: host.cy + perp * Math.sin(rad) + along * Math.cos(rad),
    };
    const out = normalizeHostRuns(ELS.map((e) => (e.id === B3_PK_LEFT ? slid : e)), () => {});
    expect(by(out, B3_PK_LEFT)).toBe(slid);
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
    expect(sideParkAlongRun({ ...args, pinAllowed: true }).stamp).toEqual({ run: 800, alongShift: 0 });
    expect(sideParkAlongRun({ ...args, pinAllowed: true }).run, "the render is still clamped").toBe(514);
  });

  it("sideParkAlongRun: an existing IMPOSSIBLE stamp is dropped, a possible one is honoured", () => {
    const span = { run: 514, alongShift: 0 };
    expect(sideParkAlongRun({ cur: { run: 514, alongShift: 0 }, span, stamp: { run: 708.58, alongShift: 3.79 } }).stamp).toBeNull();
    const keep = sideParkAlongRun({ cur: { run: 300, alongShift: 40 }, span, stamp: { run: 300, alongShift: 40 } });
    expect(keep.run).toBe(300);
    expect(keep.alongShift).toBe(40);
    expect(keep.stale).toBe(false);
  });

  it("sideParkAlongRun: a field sitting on the span default keeps tracking it", () => {
    const res = sideParkAlongRun({ cur: { run: 514, alongShift: 0 }, span: { run: 600, alongShift: 0 } });
    expect(res.stale).toBe(false);
    expect(res.stamp).toBeUndefined();
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
