// NEW-1 / NEW-2 — pond label fit ladder, seeded from the REAL Goose Creek geometry.
//
// Owner report (Goose Creek / "Plan 1 (copy)", City of Baytown, Harris County):
//   • SOUTHERN pond — the label vanished entirely.
//   • NORTHERN pond — the label rendered OUTSIDE the pond outline.
//
// Two different symptoms on two ponds in ONE plan, which is the tell that the old fit
// chain had two terminal branches (leader-out and hide) and took a different one per pond.
// The fixture is the real drawn geometry pulled from the production database (see
// test/fixtures/gooseCreekPonds.json `_source`), not a shape invented to make a point.
import { test, assert } from "vitest";
import { readFileSync } from "node:fs";
import { layoutLabels, boxOf } from "../src/workspaces/site-planner/lib/labelLayout.js";
import { interiorFitter, labelForms, LADDER_RUNGS } from "../src/workspaces/site-planner/lib/labelFitLadder.js";
import { pondAreaLabelLine } from "../src/workspaces/site-planner/lib/pondLabelText.js";

const FX = JSON.parse(readFileSync(new URL("./fixtures/gooseCreekPonds.json", import.meta.url)));

const SQFT_PER_ACRE = 43560;
const f0 = (n) => Math.round(n).toLocaleString("en-US");
const f2 = (n) => (Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const polyArea = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i].x * q.y - q.x * p[i].y; } return Math.abs(a) / 2; };
const centroid = (p) => { let a = 0, cx = 0, cy = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; const f = p[i].x * q.y - q.x * p[i].y; a += f; cx += (p[i].x + q.x) * f; cy += (p[i].y + q.y) * f; } a /= 2; return { x: cx / (6 * a), y: cy / (6 * a) }; };
const bbox = (p) => { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const q of p) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); } return { x0, x1, y0, y1 }; };

// The SitePlanner's own label metrics (SitePlanner.jsx :11784) at a given px-per-foot.
const metrics = (ppf) => { const ls = Math.max(0.34, Math.min(1, ppf / 0.45)); const fs = 11 * ls; return { fs, lh: 14.5 * ls, charW: fs * 0.6 }; };

// Build the label candidate for one pond exactly as SitePlanner.jsx does.
// NEW-1 — the area line is now the bare acreage, straight from the SHIPPED builder, so this
// fixture cannot drift from the app's own label text.
function pondCand(ring, ppf) {
  const area = polyArea(ring), c = centroid(ring), b = bbox(ring);
  const m = metrics(ppf);
  return {
    id: "pond",
    cx: c.x * ppf, cy: c.y * ppf,     // screen px with zero pan offset
    lines: ["Detention Pond", pondAreaLabelLine(area)],
    lh: m.lh, charW: m.charW,
    halfW: ((b.x1 - b.x0) / 2) * ppf, halfH: ((b.y1 - b.y0) / 2) * ppf,
    ring, ringOrigin: c, ringPpf: ppf,
    mustLabel: true,
    importance: area,
  };
}

// The parcel-area badge ("Parcel 20.20 ac") that paints at the parcel centroid and is fed to
// layoutLabels as an immovable obstacle (B951).
function parcelChipBox(parcel, ppf) {
  const c = centroid(parcel.points);
  const txt = `Parcel ${f2(parcel.acres)} ac`;
  const ls = Math.max(0.34, Math.min(1, ppf / 0.45));
  const fs = 12 * ls, padX = 9 * ls, padY = 5 * ls, charW = fs * 0.6;
  return boxOf(c.x * ppf, c.y * ppf, txt.length * charW + padX * 2, fs + padY * 2);
}

const WORKING_PPF = 0.45; // the planner's default working zoom

// The OLD chain, verbatim, so the two symptoms can be reproduced from the real geometry
// before the fix instead of being asserted from memory. (`layoutLabels` pre-NEW-1: fit against
// the BOUNDING BOX, one anchor, leader straight up, hide when the last single line collides.)
function oldEngine(items, obstacles = []) {
  const placed = [...obstacles];
  const out = new Map();
  for (const it of [...items].sort((a, b) => b.importance - a.importance)) {
    let lines = it.lines.slice(), chosen = null;
    while (lines.length >= 1) {
      const w = Math.max(1, ...lines.map((t) => t.length)) * it.charW, h = lines.length * it.lh;
      const inside = w <= it.halfW * 2 && h <= it.halfH * 2;
      const spot = inside ? { x: it.cx, y: it.cy, leader: null }
        : { x: it.cx, y: it.cy - it.halfH - h / 2 - 4, leader: { x: it.cx, y: it.cy } };
      const box = boxOf(spot.x, spot.y, w, h);
      const hits = placed.some((p) => p.x - 2 < box.x + box.w && p.x + p.w + 2 > box.x && p.y - 2 < box.y + box.h && p.y + p.h + 2 > box.y);
      if (!hits) { chosen = { box, lines, ...spot }; break; }
      if (lines.length === 1) break;
      lines = lines.slice(0, lines.length - 1);
    }
    if (chosen) { placed.push(chosen.box); out.set(it.id, chosen); }
  }
  return out;
}
const oldItem = (ring, ppf, id) => {
  const c = pondCand(ring, ppf); const a = polyArea(ring);
  return { id, cx: c.cx, cy: c.cy, halfW: c.halfW, halfH: c.halfH, lh: c.lh, charW: c.charW, importance: a,
    lines: ["Detention Pond", `footprint ${f2(a / SQFT_PER_ACRE)} ac · ${f0(a)} sf`] };
};

test("AUDIT — ONE trigger (leader-out), TWO endings; the hide is downstream of the fit failure", () => {
  // What the live repro against the whole real plan showed (ui-audit/verify-pond-label-fit.mjs,
  // pre-fix): BOTH ponds leadered OUT at every zoom step, and at the closest step the SOUTHERN
  // one then vanished. So the two symptoms the owner saw are not two independent bugs — they are
  // the same fit failure with two different endings. Width is the TRIGGER; it is never the thing
  // that hides a label. Reproduced here from the real rings.
  const seen = { northOut: [], southOut: [], bothInside: [] };
  for (const ppf of [0.90, 0.55, 0.45, 0.30, 0.20, 0.14, 0.10, 0.07, 0.05]) {
    const res = oldEngine([oldItem(FX.northPond.points, ppf, "n"), oldItem(FX.southPond.points, ppf, "s")], []);
    if (res.get("n").leader) seen.northOut.push(ppf); else seen.bothInside.push(ppf);
    if (res.get("s").leader) seen.southOut.push(ppf);
  }
  // The NORTHERN pond escapes its outline from the working zoom DOWN — its 374 ft bounding box is
  // narrower than the wide "footprint … ac · … sf" line as soon as the plan is not zoomed right in.
  assert.ok(seen.northOut.includes(0.45) && seen.northOut.length >= 6,
    `north pond leaders out from working zoom down; saw ${JSON.stringify(seen.northOut)}`);
  // The SOUTHERN pond — 672 ft wide — holds out longer but goes the same way once zoomed out.
  assert.ok(seen.southOut.length >= 3 && Math.max(...seen.southOut) <= 0.12,
    `south pond leaders out further zoomed out; saw ${JSON.stringify(seen.southOut)}`);
  // Both stay inside when zoomed right in, which is why the plan looks fine at inspect zoom.
  assert.ok(seen.bothInside.includes(0.9));

  // And THIS is the terminal branch that blanked the southern pond in the live repro: once the
  // label is out on the paper it joins the general collision pool, and the old chain's last resort
  // there was to say nothing. Model the crowded real neighbourhood — the pond has a road running
  // through it, a truck court beside it and a parcel badge on its centroid, so both the inside
  // anchor and the strip above the pond are already committed — and the label simply disappears.
  const ppf = 0.10;
  const s = oldItem(FX.southPond.points, ppf, "s");
  const busy = boxOf(s.cx, s.cy - s.halfH / 2, s.halfW * 2.5, s.halfH * 3.2);
  assert.equal(oldEngine([s], [busy]).get("s"), undefined,
    "reproduced: with its anchor and its outside spot both contested, the old chain drops the label");
  // The same crowding under the NEW ladder keeps the pond named — that is the whole point.
  const now = layoutLabels([{ ...pondCand(FX.southPond.points, ppf), id: "s" }], { obstacles: [busy] }).get("s");
  assert.ok(now && now.lines[0], "the ladder keeps the pond named under identical crowding");

  // Footnote on the owner's theory: "too wide" is exactly right as the trigger. It is not,
  // by itself, what removes the label — that took the hide branch underneath it.
  const m = metrics(WORKING_PPF), a = polyArea(FX.northPond.points);
  assert.ok(`footprint ${f2(a / SQFT_PER_ACRE)} ac · ${f0(a)} sf`.length * m.charW >
            pondCand(FX.northPond.points, WORKING_PPF).halfW * 2,
    "the wide single line really is wider than the north pond at working zoom");
});

test("AFTER — neither Goose Creek symptom survives, across the same zoom band", () => {
  for (const ppf of [0.45, 0.30, 0.20, 0.14, 0.10, 0.07, 0.05]) {
    const chip = parcelChipBox(FX.parcelOverSouthPond, ppf);
    const res = layoutLabels(
      [{ ...pondCand(FX.northPond.points, ppf), id: "n" }, { ...pondCand(FX.southPond.points, ppf), id: "s" }],
      { obstacles: [chip] },
    );
    for (const id of ["n", "s"]) {
      const p = res.get(id);
      assert.ok(p, `ppf ${ppf}: pond ${id} must still be labelled`);
      assert.ok(p.lines[0], `ppf ${ppf}: pond ${id} keeps its name line`);
    }
  }
});

test("interiorFitter measures the ACTUAL interior, not the bounding box", () => {
  for (const key of ["northPond", "southPond"]) {
    const ring = FX[key].points;
    const b = bbox(ring);
    const fit = interiorFitter(ring);
    const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    // The biggest box that fits inside the ring is strictly smaller than the bbox — which is
    // exactly why a bbox test said "fits" for a shape that has no room for the text.
    assert.ok(fit.maxW < bw, `${key}: interior width must be under the bbox width`);
    assert.ok(fit.maxH <= bh, `${key}: interior height must not exceed the bbox height`);
    // Anything it reports as fitting is genuinely inside the ring.
    const spot = fit.place(fit.maxW * 0.5, fit.maxH * 0.4);
    assert.ok(spot, "a box at half the reported interior size must place");
    for (const dx of [-0.5, 0.5]) for (const dy of [-0.5, 0.5]) {
      const corner = { x: spot.x + dx * fit.maxW * 0.5, y: spot.y + dy * fit.maxH * 0.4 };
      assert.ok(fit.contains(corner), `${key}: placed label corner must be inside the ring`);
    }
    assert.equal(fit.place(bw * 2, bh * 2), null, "an absurdly large box must not place");
  }
});

test("labelForms walks inline → stacked → abbreviated, and never empties the label", () => {
  const forms = labelForms(["Detention Pond", { parts: ["footprint 6.11 ac", "266,354 sf"], sep: " · ", keep: 1 }]);
  assert.deepEqual(forms.map((f) => f.rung), ["inline", "stacked", "abbrev"]);
  assert.deepEqual(forms[0].lines, ["Detention Pond", "footprint 6.11 ac · 266,354 sf"]);
  assert.deepEqual(forms[1].lines, ["Detention Pond", "footprint 6.11 ac", "266,354 sf"]);
  assert.deepEqual(forms[2].lines, ["Detention Pond", "footprint 6.11 ac"]);
  for (const f of forms) assert.ok(f.lines.length >= 1 && f.lines[0], "no form may be empty");
  // A plain string list has exactly one form — nothing to stack or abbreviate.
  assert.deepEqual(labelForms(["Building 3", "166,240 sf"]).map((f) => f.rung), ["inline"]);
});

test("NORTHERN pond — the label sits INSIDE the outline, and the trim buys it the INLINE rung", () => {
  // NEW-1 follow-up. Before the label trim this pond could only fit by STACKING
  // ("Detention Pond" / "footprint 6.11 ac" / "266,354 sf") — three lines, and at some zooms it
  // leadered outside instead. With the area line down to "6.11 ac" the whole label fits on the
  // widest rung, unreflowed. This is the assertion that records the rung actually moving.
  const ppf = WORKING_PPF;
  const cand = pondCand(FX.northPond.points, ppf);
  const out = layoutLabels([cand], {});
  const p = out.get("pond");
  assert.ok(p, "north pond must be labelled");
  assert.equal(p.leader, null, "north pond label must no longer be leadered outside");
  assert.equal(p.rung, "inline", `the trimmed label should need no reflow at working zoom, got ${p.rung}`);
  assert.deepEqual(p.lines, ["Detention Pond", "6.11 ac"], "and it keeps BOTH facts — name and acreage");
  // Every corner of the committed box is inside the real ring.
  const fit = interiorFitter(FX.northPond.points);
  const c = centroid(FX.northPond.points);
  const toFt = (px, py) => ({ x: c.x + (px - cand.cx) / ppf, y: c.y + (py - cand.cy) / ppf });
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    assert.ok(fit.contains(toFt(p.box.x + dx * p.box.w, p.box.y + dy * p.box.h)),
      "every corner of the north pond's label must land inside the pond ring");
  }
});

test("SOUTHERN pond — the label is present despite the parcel badge on its anchor", () => {
  const ppf = WORKING_PPF;
  const cand = pondCand(FX.southPond.points, ppf);
  const chip = parcelChipBox(FX.parcelOverSouthPond, ppf);
  const out = layoutLabels([cand], { obstacles: [chip] });
  const p = out.get("pond");
  assert.ok(p, "south pond MUST be labelled — a fit/collision failure may never blank it");
  assert.ok(p.lines[0].length > 0);
  // It cleared the badge rather than overprinting it.
  assert.ok(p.box.x + p.box.w <= chip.x || p.box.x >= chip.x + chip.w ||
            p.box.y + p.box.h <= chip.y || p.box.y >= chip.y + chip.h,
    "the south pond label must not overprint the parcel badge");
  // And it stayed inside its own outline — there was plenty of interior to slide into.
  assert.equal(p.leader, null, "there was interior room, so no leader was needed");
});

test("INVARIANT — a fit failure alone can never produce no label (NEW-2 guard)", () => {
  const ppf = WORKING_PPF;
  for (const key of ["northPond", "southPond"]) {
    const ring = FX[key].points;
    // Wall the whole neighbourhood off with obstacles so nothing can be placed cleanly.
    const b = bbox(ring);
    const wall = boxOf(((b.x0 + b.x1) / 2) * ppf, ((b.y0 + b.y1) / 2) * ppf,
      (b.x1 - b.x0) * ppf * 3, (b.y1 - b.y0) * ppf * 3);
    const out = layoutLabels([pondCand(ring, ppf)], { obstacles: [wall] });
    const p = out.get("pond");
    assert.ok(p, `${key}: a must-label element stays labelled even when every spot is contested`);
    assert.ok(p.lines.length >= 1 && p.lines[0], `${key}: the name line always survives`);
    assert.equal(p.rung, "outside", `${key}: the terminal rung is a leadered outside placement, not a hide`);
    assert.ok(p.leader, `${key}: an outside label must carry a leader back to the shape`);
  }
});

// NEW-1 — the pond's REMAINING reflowable line, exactly as SitePlanner authors it: the
// stage-storage line that appears once the contour tier reveals. After the area-line trim this is
// the pond label's only multi-atom line, so it is what keeps the ladder's stacked/abbrev rungs
// exercised — which is why the aspect test below drives it rather than the (now single-atom) area
// line. If this line is ever removed, the rungs go untested, not merely unused.
// A pond narrow enough that the storage line cannot ride inline, wide enough that it still fits
// once stacked — i.e. the shape class the stacked rung exists for. 420 × 500 ft, a perfectly
// ordinary detention basin, and the same 210,000 sf as the wide-and-shallow ring below.
const TALL_RING = [{ x: 0, y: 0 }, { x: 420, y: 0 }, { x: 420, y: 500 }, { x: 0, y: 500 }];

const pondCandWithHolds = (ring, ppf) => {
  const c = pondCand(ring, ppf);
  return { ...c, lines: [...c.lines, { parts: ["Holds 12.4 ac-ft usable", "8.0′ rim to floor"], sep: " · ", keep: 1 }] };
};

test("ASPECT-AWARE — a long THIN pond keeps the single line rather than stacking", () => {
  // 1400 ft wide × 150 ft tall: stacking is narrower but taller, and taller is what this
  // shape has no room for. The ladder must pick by MEASURED fit, not by always preferring
  // the stack. (The owner's fix, applied blindly, would have broken exactly this case.)
  const ring = [{ x: 0, y: 0 }, { x: 1400, y: 0 }, { x: 1400, y: 150 }, { x: 0, y: 150 }];
  const ppf = WORKING_PPF;
  const p = layoutLabels([pondCandWithHolds(ring, ppf)], {}).get("pond");
  assert.ok(p, "long thin pond must be labelled");
  assert.equal(p.rung, "inline", "a wide, shallow pond must keep the single-line form");
  // And a tall NARROW pond of the SAME area (420 × 500 = 210,000 sf) takes the stack instead.
  const pt = layoutLabels([pondCandWithHolds(TALL_RING, ppf)], {}).get("pond");
  assert.ok(pt, "tall narrow pond must be labelled");
  assert.ok(pt.rung !== "inline", "a tall narrow pond must reflow rather than keep the wide line");
});

test("NEW-1 — the stacked rung is still REACHABLE after the trim, and still needed", () => {
  // The owner's explicit instruction: a shorter label must not quietly retire a rung. Two ponds
  // that still need one, so this is not a rung kept for its own sake.
  const ppf = WORKING_PPF;

  // (a) the stage-storage line, on a pond too narrow to carry it inline.
  const holds = layoutLabels([pondCandWithHolds(TALL_RING, ppf)], {}).get("pond");
  assert.ok(["stacked", "abbrev"].includes(holds.rung),
    `the multi-atom storage line must still reflow; got ${holds.rung}`);

  // (b) a LONG pond NAME — the case the owner named. The name itself is one atom and cannot be
  //     broken, so what has to survive is that a long name is still never dropped or truncated.
  const long = pondCand([{ x: 0, y: 0 }, { x: 260, y: 0 }, { x: 260, y: 900 }, { x: 0, y: 900 }], ppf);
  const named = layoutLabels([{ ...long, lines: ["Detention + Mitigation Pond", long.lines[1]] }], {}).get("pond");
  assert.ok(named, "a long pond name is never left unlabelled");
  assert.ok(named.lines[0].startsWith("Detention + Mitigation"), "and the name itself is never truncated");
});

test("LADDER_RUNGS is the one ordered vocabulary", () => {
  assert.deepEqual(LADDER_RUNGS, ["inline", "stacked", "abbrev", "outside"]);
});

test("NO REGRESSION — Tsakiris and Bain pond labels that read correctly today still do", () => {
  // The other two plans that already have ponds. Their labels sit inside their outlines today,
  // so the ladder must leave them there — a fix for one plan that moves another plan's labels
  // is not a fix. Real rings, same production database (see the fixture's `_regression` note).
  for (const [plan, ponds] of [["Tsakiris/Concept A", FX.tsakirisConceptA.ponds], ["Bain/Concept A", FX.bainConceptA.ponds]]) {
    for (const pond of ponds) {
      const fit = interiorFitter(pond.points);
      const c = centroid(pond.points);
      for (const ppf of [0.9, 0.45, 0.3, 0.2]) {
        const cand = { ...pondCand(pond.points, ppf), id: pond.id };
        const p = layoutLabels([cand], {}).get(pond.id);
        assert.ok(p, `${plan}/${pond.id} @${ppf}: still labelled`);
        if (p.rung === "outside") continue; // legitimately too small on screen to hold its own name
        // Every corner of the committed label lands inside the real ring — the property the
        // owner described for Tsakiris ("its pond label currently sits inside its outline").
        const toFt = (px, py) => ({ x: c.x + (px - cand.cx) / ppf, y: c.y + (py - cand.cy) / ppf });
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          assert.ok(fit.contains(toFt(p.box.x + dx * p.box.w, p.box.y + dy * p.box.h)),
            `${plan}/${pond.id} @${ppf}: label corner escaped the outline (rung ${p.rung})`);
        }
        assert.equal(p.leader, null, `${plan}/${pond.id} @${ppf}: an inside label carries no leader`);
      }
    }
  }
});
