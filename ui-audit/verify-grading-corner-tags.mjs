/* verify-grading-corner-tags — NEW-2 (B2571041) then NEW-5 (2026-10-30): the grading's corner spot tags ("fill 22.1" / "cut 3.1") and a building's edit
 * buttons (purple +, red −, green +, grey ramp) must NEVER meet. The rule, by construction: every button sits OUTSIDE the footprint in one row along its wall
 * (lib/buildingButtons.js); every tag sits INSIDE it (lib/padCornerTag.js).
 *
 * Drives the REAL GradingCanvas (ui-audit/harness/grading-harness.*, real Chehaw parcel + 3DEP lattice) with the selected building's buttons drawn through the
 * SAME layout SitePlanner's sideAddNodes uses, at the owner's two review scales — 250 ft across (`?zoom=sw250`) and 50 ft across (`?zoom=sw50`) — plus the
 * south-end working frame and the whole building. Measures the painted boxes in the DOM — tag rect vs button circle vs the building outline — not a model of them.
 *
 * KNOWN-BAD ARM (the instrument can see the bug): the same frame with the buttons pushed to the INSIDE of their walls (`?buttons=inside`, the pre-fix shape)
 * puts them under the tags. The run is VOID, never green, if that arm does not collide.
 *   node ui-audit/verify-grading-corner-tags.mjs       (starts its own vite dev server on :5201; PNGs → ui-audit/screenshots/grading/) */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const PORT = 5201, BASE = `http://localhost:${PORT}`;
const OUT = new URL("./screenshots/grading/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const fails = [], notes = [];
const check = (name, ok, extra = "") => { (ok ? notes : fails).push(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); };

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
    await assertMeasurable(page, "verify-grading-corner-tags");
    await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
    await page.waitForSelector("[data-pad-corner]", { timeout: 90000 });
    await page.waitForTimeout(800);
    return page;
  };
  // every tag's painted box, every button's painted disc, and the building outline, in px relative to the canvas (so a page scroll never matters)
  const read = (page) => page.evaluate(() => {
    const O = document.querySelector("#canvas").getBoundingClientRect();
    const outline = document.querySelector('polygon[stroke="#333"]');
    return {
      tags: [...document.querySelectorAll("[data-pad-corner]")].map((g) => {
        const r = g.querySelector("[data-grade-pill] rect").getBoundingClientRect();
        return { idx: +g.getAttribute("data-pad-corner-idx"), text: g.querySelector("text").textContent, leader: !!g.querySelector("[data-pad-corner-leader]"), x: r.x - O.x, y: r.y - O.y, w: r.width, h: r.height };
      }),
      discs: [...document.querySelectorAll("[data-harness-button]")].map((g) => { const r = g.querySelector("circle").getBoundingClientRect(); return { id: g.getAttribute("data-harness-button"), x: r.x - O.x + r.width / 2, y: r.y - O.y + r.height / 2, r: r.width / 2 }; }),
      quad: outline ? outline.getAttribute("points").trim().split(/\s+/).map((p) => { const [x, y] = p.split(",").map(Number); return { x, y }; }).slice(0, 4) : [],
    };
  });
  const hit = (t, d) => { const nx = Math.max(t.x, Math.min(d.x, t.x + t.w)), ny = Math.max(t.y, Math.min(d.y, t.y + t.h)); return Math.hypot(d.x - nx, d.y - ny) < d.r; };
  const overlaps = (m) => m.tags.flatMap((t) => m.discs.filter((d) => hit(t, d)).map((d) => `${t.text}@corner${t.idx}~${d.id}`));
  // is a point inside the convex quad (px)?
  const inQuad = (p, q) => { if (q.length < 3) return false; const s = q.map((a, i) => { const b = q[(i + 1) % q.length]; return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x); }); return s.every((v) => v >= -0.5) || s.every((v) => v <= 0.5); };
  const tagInside = (t, q) => [[0, 0], [1, 0], [1, 1], [0, 1]].every(([a, b]) => inQuad({ x: t.x + a * t.w, y: t.y + b * t.h }, q));

  // ---- known-bad arm: the buttons on the INSIDE of the walls (the pre-fix shape) at the 250-ft scale — the tags DO sit under them
  const bad = await open("?zoom=sw250&buttons=inside");
  const bm = await read(bad);
  const known = overlaps(bm);
  check("KNOWN-BAD arm: with the buttons pushed INSIDE their walls the tags DO sit under them (the owner's report reproduces)", known.length >= 1, `${known.length} collisions: ${known.slice(0, 3).join(", ")}`);
  if (known.length < 1) fails.push("✗ VOID: the known-bad arm did not collide — this run cannot see the bug, so no verdict is issued");

  // ---- the two review scales and the wider frames, the building selected, buttons outside
  for (const [name, qs, shot, expectTags] of [["250-ft view", "?zoom=sw250&buttons=1", "corner-tags-250ft", 1], ["50-ft view", "?zoom=sw50&buttons=1", "corner-tags-50ft", 1], ["south-end working zoom", "?zoom=south&buttons=1", "corner-tags-selected-south", 2], ["whole building", "?zoom=bldg&buttons=1", "corner-tags-selected-building", 0]]) {
    const page = await open(qs);
    const m = await read(page);
    check(`${name}: tags and buttons are both on screen`, m.tags.length >= expectTags && m.discs.length >= 3, `${m.tags.map((t) => t.text).join(" | ")} · ${m.discs.length} discs`);
    check(`${name}: ZERO overlap between any corner tag and any edit button`, overlaps(m).length === 0, overlaps(m).join(", "));
    check(`${name}: every button is OUTSIDE the building's outline (clear of it by its own radius)`, m.discs.every((d) => !inQuad(d, m.quad)), m.discs.filter((d) => inQuad(d, m.quad)).map((d) => d.id).join(", "));
    check(`${name}: every tag box is INSIDE the building's outline`, m.tags.every((t) => tagInside(t, m.quad)), m.tags.filter((t) => !tagInside(t, m.quad)).map((t) => t.text).join(", "));
    check(`${name}: any tag away from its corner is tied to it by a leader`, m.tags.every((t) => { const c = m.quad[t.idx]; if (!c) return true; const d = Math.hypot(Math.max(t.x - c.x, 0, c.x - (t.x + t.w)), Math.max(t.y - c.y, 0, c.y - (t.y + t.h))); return d <= 8.5 || t.leader; }));
    if (name === "whole building") {
      const ids = m.discs.map((d) => d.id);
      check("whole building: exactly one grey ramp button per dock wall and one per corner button, none on the short end walls",
        ids.filter((i) => /^ramp:(top|bottom)$/.test(i)).length === 2 && ids.filter((i) => /^ramp:(top|bottom):-?1$/.test(i)).length === 4 && !ids.some((i) => /^ramp:(left|right)/.test(i)), ids.filter((i) => i.startsWith("ramp:")).join(" "));
    }
    check(`${name}: tags are pointer-events none (they can never take a press from a button)`, await page.evaluate(() => [...document.querySelectorAll("[data-pad-corner]")].every((g) => getComputedStyle(g).pointerEvents === "none")));
    // every button answers a hit-test at its own centre (scrolled into view first: elementFromPoint is null off-screen)
    await page.locator("#canvas").scrollIntoViewIfNeeded();
    const real = await page.evaluate(() => [...document.querySelectorAll("[data-harness-button]")].filter((g) => { const r = g.querySelector("circle").getBoundingClientRect(); return r.x > 0 && r.y > 0 && r.x + r.width < innerWidth && r.y + r.height < innerHeight; }).map((g) => {
      const r = g.querySelector("circle").getBoundingClientRect(), e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { k: g.getAttribute("data-harness-button"), ok: !!(e && e.closest("[data-harness-button]") === g) };
    }));
    check(`${name}: every on-screen button answers a hit-test at its own centre (no tag over it)`, real.length >= 2 && real.every((b) => b.ok), JSON.stringify(real.filter((b) => !b.ok)));
    await page.locator("#canvas").screenshot({ path: `${OUT}${shot}.png` });
    if (name === "south-end working zoom") {
      // selection no longer moves a tag: deselecting leaves every tag exactly where it was
      const before = m.tags;
      await page.evaluate(() => window.__harness.setSel(null));
      await page.waitForTimeout(600);
      const after = (await read(page)).tags;
      check("deselecting moves no tag (the rule does not depend on selection)", before.every((b) => { const a = after.find((x) => x.idx === b.idx); return a && Math.abs(a.x - b.x) < 0.6 && Math.abs(a.y - b.y) < 0.6; }));
    }
  }

  check("no page errors", errs.length === 0, errs.slice(0, 2).join(" | "));
  await browser.close();
} catch (e) { fails.push(`✗ harness crashed — ${e && e.message}`); } finally { vite.kill(); }
console.log([...notes, ...fails].join("\n"));
console.log(fails.length ? `\n${fails.length} FAILED` : `\nall ${notes.length} checks passed`);
process.exit(fails.length ? 1 : code);
