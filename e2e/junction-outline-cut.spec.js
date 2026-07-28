/* NEW-1 — junction outline-cut polylines must not be DOUBLE-ROTATED.
 *
 * Owner repro (Tsakiris / Concept A, east end of Building 3): the parking field a drive tees into
 * (e52duuwgj, 150×42, rot 270) drew two parking-coloured lines 42 ft apart cutting across the field
 * and projecting ~59 ft east into bare aerial, plus a short vertical stub — and the field's own
 * outline was missing entirely.
 *
 * The interrupted-outline polylines are built in WORLD feet (el.rot baked into the corners) but were
 * pushed straight into the parts array that renderElPx returns inside a `rotate(el.rot, c)` group, so
 * el.rot landed twice. rot 0/180 are unaffected (0°/360°) — which is exactly why every previous mock
 * passed: a rot-0 Car Parking field drawn by mouse cannot see this bug. rot 90/270 reach 540° ≡ 180°,
 * and a rectangle rotated 180° about its own centre is congruent to the unrotated one, so a 42×150
 * field drew its outline as 150×42 about the same centre.
 *
 * So this spec seeds the OWNER'S REAL element set and asserts what he actually sees: no geometry
 * outside the true footprint, and the footprint outline back and interrupted only at the drive mouth.
 * The rot 90 / rot 0 / rot 180 / paving-truck-court cases are the SAME real target+drive pair rotated
 * about the target's own centre and moved clear of the plan — real geometry through the real solver,
 * not a hand-built mock. The last test covers the export path, which clones the live canvas DOM.
 *
 * Run: PW_CHROME=/opt/pw-browsers/chromium npx playwright test e2e/junction-outline-cut.spec.js --project=chromium
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { armPlannerHooks, roadNetwork } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const FIXTURE = JSON.parse(readFileSync(new URL("../ui-audit/fixtures/tsakiris-concept-a.json", import.meta.url), "utf8"));
const SITE_ID = "e2e-junction-outline-cut";

/* The owner's exact repro pair. */
const TARGET_ID = "e52duuwgj";        // parking 150×42, rot 270
const DRIVE_ID = "e1454682splyoj";    // the fire-lane drive that tees into it

const rotAbout = (p, deg, c) => {
  const r = (deg * Math.PI) / 180, co = Math.cos(r), si = Math.sin(r);
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * co - dy * si, y: c.y + dx * si + dy * co };
};

/* A rotated + relocated COPY of the real target/drive pair. Rotating the drive's centerline about the
 * target's own centre by the same delta keeps the weld exactly where it was, so the copy goes through
 * driveJunctionsOf / the dissolve identically — only its rotation and its position differ. */
function variant(els, { key, dRot, dx, dy, type, kind }) {
  const T = els.find((e) => e.id === TARGET_ID), S = els.find((e) => e.id === DRIVE_ID);
  const c = { x: T.cx, y: T.cy };
  const tId = `${key}-t`, sId = `${key}-s`;
  const t = { ...T, id: tId, rot: (((T.rot || 0) + dRot) % 360 + 360) % 360, cx: c.x + dx, cy: c.y + dy };
  delete t.attachedTo; delete t.sideParkSide;   // a free-standing field takes the identical render path
  if (type) t.type = type;
  const sc = rotAbout({ x: S.cx, y: S.cy }, dRot, c);
  const s = {
    ...S, id: sId, cx: sc.x + dx, cy: sc.y + dy,
    pts: S.pts.map((p) => { const q = rotAbout(p, dRot, c); return { x: q.x + dx, y: q.y + dy }; }),
    driveTee: { ...S.driveTee, targetId: tId, ...(kind ? { kind } : {}) },
  };
  return { targetId: tId, driveId: sId, rot: t.rot, els: [t, s] };
}

/* rot 270 is the owner's own field, in place. The rest are copies parked well clear of the plan (and
 * of each other) so no stray weld/tee can form between them. */
const CASES = [
  { key: "own", label: "rot 270 parking (the owner's field)", targetId: TARGET_ID, driveId: DRIVE_ID, rot: 270, els: [] },
  { key: "r90", label: "rot 90 parking", ...variant(FIXTURE.els, { key: "r90", dRot: 180, dx: 0, dy: 4000 }) },
  { key: "r0", label: "rot 0 parking (regression)", ...variant(FIXTURE.els, { key: "r0", dRot: 90, dx: 0, dy: 6000 }) },
  { key: "r180", label: "rot 180 parking (regression)", ...variant(FIXTURE.els, { key: "r180", dRot: 270, dx: 0, dy: 8000 }) },
  { key: "pav90", label: "rot 90 paving pad, truck-court drive", ...variant(FIXTURE.els, { key: "pav90", dRot: 180, dx: 0, dy: 10000, type: "paving", kind: "truckcourt" }) },
];

const SEEDED_ELS = [...FIXTURE.els, ...CASES.flatMap((c) => c.els)];
/* Every drive in the seeded plan must actually solve — the fixture's own three (two truck-court drives
 * into the paving pad plus the owner's parking drive) as well as the four rotated copies. If a copy
 * failed to weld, its case would silently pass on a missing group instead of on correct geometry. */
const EXPECTED_DRIVES = SEEDED_ELS.filter((e) => e.driveTee).length;

async function loadPlan(page) {
  await armPlannerHooks(page);
  const site = {
    id: SITE_ID, groupId: SITE_ID, site: "Tsakiris", name: "Concept A", origin: null, county: "waller",
    parcels: [], els: SEEDED_ELS, measures: [], callouts: [], markups: [],
    settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  };
  await page.addInitScript(([id, rec]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
    localStorage.setItem("planarfit:currentSite:v1", id);
  }, [SITE_ID, site]);
  await page.goto("/");
  await expect(canvas(page)).toBeVisible();
  await expect.poll(async () => (await roadNetwork(page))?.drives.length ?? 0, { timeout: 20_000 }).toBe(EXPECTED_DRIVES);
}

/* Measure ONE element's drawn outline against its own true footprint, in the live DOM.
 *
 * The footprint reference is the element's own <rect> — the first child of the SAME rotate(el.rot)
 * group — so the comparison needs no unit math and no assumption about zoom or pan: whatever the
 * group's transform is, the rect and the outline see the identical one. Everything below is likewise
 * expressed as a RATIO of the footprint's own size, so the canvas's fit-to-extent zoom (which settles
 * a beat after load) cannot skew a number and turn a real pass into a flake. */
const measure = (page, elId) => page.evaluate((id) => {
  const g = [...document.querySelectorAll('[data-testid="rect-outline-cut"]')].find((n) => n.getAttribute("data-el-id") === id);
  if (!g) return { found: false };
  const fp = g.parentElement.querySelector("rect").getBoundingClientRect();
  const lines = [...g.querySelectorAll("polyline")];
  let drawnPx = 0;
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const ln of lines) {
    const r = ln.getBoundingClientRect();
    box.x0 = Math.min(box.x0, r.left); box.y0 = Math.min(box.y0, r.top);
    box.x1 = Math.max(box.x1, r.right); box.y1 = Math.max(box.y1, r.bottom);
    const pts = (ln.getAttribute("points") || "").trim().split(/\s+/).map((s) => s.split(",").map(Number));
    for (let i = 1; i < pts.length; i++) drawnPx += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  // At an orthogonal rotation the footprint rect's client box IS the footprint, so its half-perimeter
  // is the exact yardstick for how much of the outline actually got drawn.
  const perimPx = 2 * (fp.width + fp.height);
  const diag = Math.hypot(fp.width, fp.height);
  return {
    found: true, lines: lines.length, drawnFrac: drawnPx / perimPx,
    fpW: fp.width, fpH: fp.height, diag,
    spanW: box.x1 - box.x0, spanH: box.y1 - box.y0,
    overhang: {
      left: (fp.left - box.x0) / diag, top: (fp.top - box.y0) / diag,
      right: (box.x1 - fp.right) / diag, bottom: (box.y1 - fp.bottom) / diag,
    },
  };
}, elId);

test.describe("NEW-1 — a drive junction never throws outline outside the rect it tees into", () => {
  for (const c of CASES) {
    test(`${c.label}: the interrupted outline sits exactly on the true footprint`, async ({ page }) => {
      await loadPlan(page);
      const m = await measure(page, c.targetId);
      expect(m.found, `no outline-cut group rendered for ${c.targetId} — the drive junction did not solve`).toBe(true);

      // 1. NOTHING outside the true footprint. The only slack is half a stroke width plus clip
      //    tolerance; the bug overhung by more than a third of the footprint's own diagonal each way.
      const slack = 0.02;                                    // fraction of the footprint diagonal
      for (const [side, over] of Object.entries(m.overhang)) {
        expect(over, `outline projects past the ${side} edge of the footprint`).toBeLessThan(slack);
      }

      // 2. The footprint outline is genuinely BACK — it spans the real footprint on both axes. (With the
      //    plain rect's stroke blanked, a double-rotated outline left the true edge undrawn entirely.)
      expect(m.spanW).toBeGreaterThan(m.fpW - slack * m.diag);
      expect(m.spanH).toBeGreaterThan(m.fpH - slack * m.diag);

      // 3. …and interrupted ONLY at the drive mouth: most of the perimeter is still drawn, but not all
      //    of it — a drive mouth plus its curb returns takes a modest bite out of the 150×42 field.
      expect(m.drawnFrac, "no gap at all — the drive mouth is not interrupting the curb").toBeLessThan(0.99);
      expect(m.drawnFrac, "most of the outline is missing, not just the drive mouth").toBeGreaterThan(0.6);
      expect(m.lines).toBeGreaterThanOrEqual(4);             // four edges, at least one of them split
    });
  }

  test("PDF/PNG export parity — the cloned canvas keeps the outline on the footprint too", async ({ page }) => {
    await loadPlan(page);
    // The export builds its SVG by cloning the LIVE canvas node and rewriting the viewBox
    // (buildExportSvg in SitePlanner.jsx), so a transform bug on screen rides straight into the PDF and
    // the PNG. Reproduce that clone here and re-measure inside it: this is the same DOM the export
    // rasterizes, so parity is proved on the actual bytes rather than assumed from the screen pass.
    const res = await page.evaluate((ids) => {
      const live = document.querySelector('[data-testid="planner-canvas"]');
      const clone = live.cloneNode(true);
      clone.querySelectorAll('[data-export="skip"]').forEach((n) => n.remove());
      clone.removeAttribute("style");
      clone.setAttribute("width", "2000");
      clone.setAttribute("height", "2000");
      Object.assign(clone.style, { position: "fixed", left: "-10000px", top: "0" });
      document.body.appendChild(clone);
      const out = {};
      for (const id of ids) {
        const g = [...clone.querySelectorAll('[data-testid="rect-outline-cut"]')].find((n) => n.getAttribute("data-el-id") === id);
        if (!g) { out[id] = { found: false }; continue; }
        const fp = g.parentElement.querySelector("rect").getBoundingClientRect();
        const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
        for (const ln of g.querySelectorAll("polyline")) {
          const r = ln.getBoundingClientRect();
          b.x0 = Math.min(b.x0, r.left); b.y0 = Math.min(b.y0, r.top);
          b.x1 = Math.max(b.x1, r.right); b.y1 = Math.max(b.y1, r.bottom);
        }
        out[id] = { found: true, transform: g.getAttribute("transform"),
          overhang: { left: fp.left - b.x0, top: fp.top - b.y0, right: b.x1 - fp.right, bottom: b.y1 - fp.bottom },
          diag: Math.hypot(fp.width, fp.height) };
      }
      clone.remove();
      return out;
    }, CASES.map((c) => c.targetId));

    for (const c of CASES) {
      const m = res[c.targetId];
      expect(m.found, `${c.label}: outline-cut group missing from the export clone`).toBe(true);
      // The counter-rotate survives the clone verbatim — it is a plain attribute, not runtime state.
      expect(m.transform, `${c.label}: export clone lost the counter-rotate`).toMatch(new RegExp(`^rotate\\(${-c.rot}[ )]`));
      for (const [side, over] of Object.entries(m.overhang)) {
        // Scale-free: any real overhang would be a large fraction of the footprint's own diagonal.
        expect(over / m.diag, `${c.label}: export outline projects past the ${side} edge`).toBeLessThan(0.02);
      }
    }
  });
});
