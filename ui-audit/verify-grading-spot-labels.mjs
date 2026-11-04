/* verify-grading-spot-labels — NEW-1 (owner 2026-11-04, Georgia Test Site › Concept A, building zoom): the grading's court / lot labels — the dock face spot
 * ("dock 784.5"), the far-edge spots ("784.5"), the "1.5% fall" tag, the cut / fill corner tags and the setback flag pill — must NEVER be drawn under an edit
 * button, a wall handle, the rotate grip, another label, or off the map's edge. Controls stay where they are; labels move clear (a short leader ties a moved
 * label back to the point it measures).
 *
 * Drives the REAL GradingController + GradingCanvas (ui-audit/harness/grading-harness.*, the owner's real Concept A at 259° with its two dock courts, and a plain
 * unrotated building) with the building's edit buttons AND selection grips drawn the way SitePlanner's sideAddNodes / handleNodes draw them. Everything is measured in the DOM —
 * the painted label rects against the painted button discs / grip squares / rotate stem — never a model of them.
 *
 * ADJACENT CASES (each judged selected and not selected; the layout must not move when you select): the whole building · both dock walls · a rotated building (the
 * owner's) and an unrotated one · a building with bump-outs (the corner + grey ramp buttons) · zoomed one step in and one step out · dock doors on ONE wall only ·
 * a label that would run off the top / side of the map.
 *
 * VOID RULES (a verdict from an instrument that could not have seen the bug is not a verdict): the detector is first pointed at a synthetic disc laid on top of a
 * measured label (it must call a hit) and at one far away (it must not); every case must DRAW at least the labels the scene is known to have; a run in which no case
 * had a label near a control is reported VOID.
 *
 *   node ui-audit/verify-grading-spot-labels.mjs       (starts its own vite dev server on :5203; PNGs → ui-audit/screenshots/grading/spot-labels-*.png)
 *   PW_CHROME=/opt/pw-browsers/chromium-…/chrome-linux64/chrome  to point at a browser build Playwright did not install itself. */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const PORT = 5203, BASE = `http://localhost:${PORT}`;
const OUT = new URL("./screenshots/grading/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const fails = [], notes = [];
const check = (name, ok, extra = "") => { (ok ? notes : fails).push(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); };
const CANVAS = { w: 1400, h: 1000 };

const vite = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
let code = 0;
try {
  for (let i = 0; i < 100; i++) { try { const r = await fetch(BASE); if (r.ok) break; } catch {} await sleep(300); }
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ["--no-sandbox"] });
  const errs = [];
  const open = async (qs) => {
    const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    page.on("pageerror", (e) => errs.push(String(e)));
    await page.goto(`${BASE}/ui-audit/harness/grading-harness.html${qs}`);
    await assertMeasurable(page, "verify-grading-spot-labels");
    await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
    await page.waitForSelector("[data-label-set]", { timeout: 90000 });
    await page.waitForTimeout(900);
    return page;
  };
  // every label's painted box, every control's painted shape — px relative to the canvas
  const read = (page) => page.evaluate(() => {
    const O = document.querySelector("#canvas").getBoundingClientRect();
    const rel = (r) => ({ x: r.x - O.x, y: r.y - O.y, w: r.width, h: r.height });
    const labels = [];
    for (const g of document.querySelectorAll("[data-spot-label]")) {
      const r = g.querySelector("[data-grade-pill] rect"); if (!r) continue;
      labels.push({ key: g.closest("[data-spot-set]") ? g.closest("[data-spot-set]").getAttribute("data-spot-set") + ":" + g.getAttribute("data-spot-label") : g.getAttribute("data-spot-label"), kind: g.getAttribute("data-spot-label"), text: g.querySelector("text").textContent, moved: g.getAttribute("data-spot-moved") === "1", leader: !!g.querySelector("[data-spot-leader]"), ...rel(r.getBoundingClientRect()) });
    }
    for (const g of document.querySelectorAll("[data-pad-corner]")) {
      const r = g.querySelector("[data-grade-pill] rect"); if (!r) continue;
      labels.push({ kind: "corner", text: g.querySelector("text").textContent, moved: false, leader: !!g.querySelector("[data-pad-corner-leader]"), ...rel(r.getBoundingClientRect()) });
    }
    const discs = [...document.querySelectorAll("[data-harness-button]")].map((g) => { const r = g.querySelector("circle").getBoundingClientRect(); return { id: g.getAttribute("data-harness-button"), x: r.x - O.x + r.width / 2, y: r.y - O.y + r.height / 2, r: r.width / 2 }; });
    const handles = [...document.querySelectorAll("[data-harness-handle]")].map((h) => ({ id: h.getAttribute("data-harness-handle"), ...rel(h.getBoundingClientRect()) }));
    const leaders = [...document.querySelectorAll("[data-spot-leader] line")].map((ln) => ({ x1: +ln.getAttribute("x1"), y1: +ln.getAttribute("y1"), x2: +ln.getAttribute("x2"), y2: +ln.getAttribute("y2"), owner: (ln.closest("[data-spot-label]").closest("[data-spot-set]") ? ln.closest("[data-spot-label]").closest("[data-spot-set]").getAttribute("data-spot-set") + ":" : "") + ln.closest("[data-spot-label]").getAttribute("data-spot-label") }));
    const stem = document.querySelector("[data-harness-buttons] line");
    return {
      labels, discs, handles, leaders,
      stem: stem ? { x1: +stem.getAttribute("x1"), y1: +stem.getAttribute("y1"), x2: +stem.getAttribute("x2"), y2: +stem.getAttribute("y2") } : null,
      hidden: [...document.querySelectorAll("[data-label-hidden]")].reduce((s, g) => s + (+g.getAttribute("data-label-hidden") || 0), 0),
    };
  });
  // the detectors (pure, on measured boxes)
  const hitDisc = (b, d) => Math.hypot(d.x - Math.max(b.x, Math.min(d.x, b.x + b.w)), d.y - Math.max(b.y, Math.min(d.y, b.y + b.h))) < d.r;
  const hitRect = (b, r) => b.x < r.x + r.w && r.x < b.x + b.w && b.y < r.y + r.h && r.y < b.y + b.h;
  const hitSeg = (b, s) => { for (let i = 0; i <= 60; i++) { const t = i / 60, p = { x: s.x1 + (s.x2 - s.x1) * t, y: s.y1 + (s.y2 - s.y1) * t }; if (p.x > b.x && p.x < b.x + b.w && p.y > b.y && p.y < b.y + b.h) return true; } return false; };
  const collisions = (m) => {
    const out = [];
    for (const l of m.labels) {
      for (const d of m.discs) if (hitDisc(l, d)) out.push(`"${l.text}"[${l.kind}] ✕ button ${d.id}`);
      for (const h of m.handles) if (hitRect(l, h)) out.push(`"${l.text}"[${l.kind}] ✕ handle ${h.id}`);
      if (m.stem && hitSeg(l, m.stem)) out.push(`"${l.text}"[${l.kind}] ✕ rotate stem`);
    }
    // a leader line (the dark line from a moved label back to its spot) must not run through ANOTHER label's box — owner 2026-11-04, second finding
    for (const ld of m.leaders) for (const l of m.labels) if (l.key !== ld.owner && hitSeg(l, ld)) out.push(`leader of ${ld.owner} ✕ "${l.text}"[${l.kind}]`);
    for (let i = 0; i < m.labels.length; i++) for (let j = i + 1; j < m.labels.length; j++) if (hitRect(m.labels[i], m.labels[j])) out.push(`"${m.labels[i].text}"[${m.labels[i].kind}] ✕ label "${m.labels[j].text}"[${m.labels[j].kind}]`);
    return out;
  };
  // a label wholly off the map is simply not in the picture; one the edge CUTS is the bug
  const offMap = (m) => m.labels.filter((l) => (l.x < -0.5 || l.y < -0.5 || l.x + l.w > CANVAS.w + 0.5 || l.y + l.h > CANVAS.h + 0.5) && l.x + l.w > 0 && l.y + l.h > 0 && l.x < CANVAS.w && l.y < CANVAS.h).map((l) => `"${l.text}"[${l.kind}]`);

  // ---- VOID guard 1: the detector itself — a disc laid on a measured label must hit, one far from it must not
  let nearMisses = 0;
  const first = await open("?owner=2&zoom=dockb&span=420&buttons=1");
  const m0 = await read(first);
  const probe = m0.labels.find((l) => l.kind === "face") || m0.labels[0];
  check("detector: a disc laid ON a measured label is called a hit; one 400 px away is not", !!probe && hitDisc(probe, { x: probe.x + probe.w / 2, y: probe.y + probe.h / 2, r: 9 }) && !hitDisc(probe, { x: probe.x + 400, y: probe.y + 400, r: 9 }));

  // [name, query, minimum labels the scene is known to draw, kinds that must be among them]
  const OWNER = "?owner=2";
  const CASES = [
    ["owner Concept A · whole building", `${OWNER}&zoom=bldg&buttons=1`, 6, ["face", "far", "corner"]],
    ["owner Concept A · bottom (east) dock wall, building zoom", `${OWNER}&zoom=dockb&span=420&buttons=1`, 4, ["face", "far", "fall"]],
    ["owner Concept A · top (west) dock wall, building zoom", `${OWNER}&zoom=dockt&span=420&buttons=1`, 4, ["face", "far", "fall"]],
    ["owner Concept A · bottom dock wall, one step IN (×1.25)", `${OWNER}&zoom=dockb&span=420&zm=1.25&buttons=1`, 3, ["face"]],
    ["owner Concept A · bottom dock wall, one step OUT (×0.8)", `${OWNER}&zoom=dockb&span=420&zm=0.8&buttons=1`, 3, ["face"]],
    ["owner Concept A · top dock wall, one step IN", `${OWNER}&zoom=dockt&span=420&zm=1.25&buttons=1`, 3, ["face"]],
    ["owner Concept A · top dock wall, one step OUT", `${OWNER}&zoom=dockt&span=420&zm=0.8&buttons=1`, 3, ["face"]],
    ["owner Concept A · dock doors on ONE wall only", `${OWNER}&single=1&zoom=dockb&span=420&buttons=1`, 3, ["face"]],
    ["owner Concept A · label near the top of the map", `${OWNER}&zoom=dockt&span=420&sy=330&buttons=1`, 3, ["face"]],
    ["owner Concept A · label near the side of the map", `${OWNER}&zoom=dockb&span=420&sx=-420&buttons=1`, 2, ["face"]],
    ["plain building (unrotated) · dock wall", "?zoom=dockb&span=420&buttons=1", 4, ["face", "far", "fall"]],
    ["plain building (unrotated) · whole building", "?zoom=bldg&buttons=1", 6, ["face", "far", "corner"]],
    ["plain building with bump-outs (corner + ramp buttons)", "?bump=1&zoom=dockb&span=420&buttons=1", 4, ["face", "far"]],
    ["plain building · dock doors on ONE wall only", "?single=1&zoom=dockb&span=420&buttons=1", 3, ["face"]],
  ];
  let sawNear = 0;
  for (const [name, qs, minLabels, kinds] of CASES) {
    const page = await open(qs);
    const m = await read(page);
    const have = new Set(m.labels.map((l) => l.kind));
    check(`${name}: the labels are on screen (non-vacuous)`, m.labels.length >= minLabels && kinds.every((k) => have.has(k)), `${m.labels.length} labels: ${[...have].join(",")}; need ≥ ${minLabels} incl. ${kinds.join(",")}`);
    check(`${name}: controls are on screen`, m.discs.length >= 3 && m.handles.length >= 8, `${m.discs.length} buttons, ${m.handles.length} grips`);
    const col = collisions(m);
    check(`${name}: NO label under a button, grip, rotate stem or another label`, col.length === 0, col.slice(0, 4).join("; "));
    check(`${name}: every label is inside the map`, offMap(m).length === 0, offMap(m).join(", "));
    check(`${name}: a label flagged as moved has its leader drawn`, m.labels.every((l) => !l.moved || l.leader), m.labels.filter((l) => l.moved && !l.leader).map((l) => l.text).join(", "));
    check(`${name}: no label was dropped for lack of room`, m.hidden === 0, `${m.hidden} hidden`);
    // how close did the NATURAL spot come to a control? (a run where nothing moved never tested the placer)
    sawNear += m.labels.filter((l) => l.moved).length;
    await page.locator("#canvas").screenshot({ path: `${OUT}spot-labels-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png` });
    // the same scene with nothing selected: the labels must not move (the rule never depends on selection)
    const un = await open(qs.replace("&buttons=1", "&sel=none"));
    const mu = await read(un);
    const same = m.labels.length === mu.labels.length && m.labels.every((l) => mu.labels.some((u) => u.text === l.text && u.kind === l.kind && Math.abs(u.x - l.x) < 0.7 && Math.abs(u.y - l.y) < 0.7));
    check(`${name}: nothing selected → every label is exactly where it was when selected`, same, `${mu.labels.length} vs ${m.labels.length}`);
    await un.context().close(); await page.context().close();
  }
  check("VOID guard: at least one label in the matrix had to MOVE to clear a control (else the run never exercised the placer)", sawNear >= 3, `${sawNear} moved labels`);
  // ---- the real label sets (the controller's own court / lot spots on the owner's Concept A) laid out over a dense sweep of zoom × pan × map size, in the page:
  // label-vs-label and leader-vs-label, at every view
  const sweepPage = await open("?owner=2&zoom=bldg&buttons=1");
  const sw = await sweepPage.evaluate(async () => {
    const lib = await import("/src/workspaces/site-planner/lib/spotLabelPlacement.js");
    const Ls = window.__harness.model.labels, out = { layouts: 0, drawn: 0, boxes: [], leaders: [], leaderCentre: [] };
    const seg = (b, g) => { for (let i = 0; i <= 40; i++) { const t = i / 40, x = g.x1 + (g.x2 - g.x1) * t, y = g.y1 + (g.y2 - g.y1) * t; if (x > b.x - b.w / 2 + 0.5 && x < b.x + b.w / 2 - 0.5 && y > b.y - b.h / 2 + 0.5 && y < b.y + b.h / 2 - 0.5) return true; } return false; };
    for (const V of [{ w: 1400, h: 1000 }, { w: 1100, h: 650 }, { w: 900, h: 560 }]) for (const ppf of [0.5, 0.7, 0.9, 1.2, 1.8, 2.8, 3.4]) for (let ox = -1500; ox <= 2400; ox += 100) for (let oy = -1500; oy <= 2600; oy += 100) {
      const f2p = (p) => ({ x: ox + p.x * ppf, y: oy + p.y * ppf });
      for (const L of Ls) {
        const lay = lib.layoutLabelSet(L, f2p, ppf, V); out.layouts++;
        const bx = [...lay.spots].filter(([, v]) => !v.hidden && !v.skip).map(([k, v]) => ({ k, ...v })); out.drawn += bx.length;
        for (let i = 0; i < bx.length; i++) for (let j = i + 1; j < bx.length; j++) if (lib.boxHitsBox(bx[i], bx[j], 0) && out.boxes.length < 5) out.boxes.push([V.w, ppf, ox, oy, bx[i].k, bx[j].k]);
        for (const a of bx) if (a.leader) for (const c of bx) if (c !== a && seg(c, a.leader)) { /* inMid = a full-size map with the building in it; the small maps are the squeeze bucket */ const inMid = V.w >= 1400 && ox >= -100 && ox <= 1200 && oy >= -100 && oy <= 1400; (inMid ? out.leaderCentre : out.leaders).push([V.w, ppf, ox, oy, a.k, c.k]); }
      }
    }
    return out;
  });
  check("REAL label sets × dense zoom / pan / map-size sweep: label boxes never overlap", sw.boxes.length === 0 && sw.layouts > 20000, `${sw.layouts} layouts, ${sw.drawn} labels drawn; ${JSON.stringify(sw.boxes.slice(0, 3))}`);
  check("REAL label sets × sweep: a leader line never runs through another label (building in view)", sw.leaderCentre.length === 0, JSON.stringify(sw.leaderCentre.slice(0, 3)));
  check("REAL label sets × sweep: leader-through-label in a map-edge squeeze stays under 0.2% of layouts", sw.leaders.length < sw.layouts * 0.002, `${sw.leaders.length} of ${sw.layouts}`);
  await sweepPage.context().close();
  check("no page errors", errs.length === 0, errs.slice(0, 2).join(" | "));
  await browser.close();
} catch (e) { fails.push(`✗ harness crashed — ${e && e.message}`); } finally { vite.kill(); }
console.log([...notes, ...fails].join("\n"));
console.log(fails.length ? `\n${fails.length} FAILED` : `\nall ${notes.length} checks passed`);
process.exit(fails.length ? 1 : code);
