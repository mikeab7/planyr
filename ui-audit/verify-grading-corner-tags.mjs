/* verify-grading-corner-tags — NEW-2 (2026-10-30): at a selected building's south corners the grading's "fill NN.N" spot tag must
 * never sit under the purple "+" bump-out button (or any other edit button), and must go back to the corner when nothing is selected.
 *
 * Drives the REAL GradingCanvas (ui-audit/harness/grading-harness.*, real Chehaw parcel + 3DEP lattice) at the 50-ft working zoom
 * (`?zoom=south`), with the selected building's edit buttons drawn through the SAME anchors SitePlanner's sideAddNodes uses
 * (`?buttons=1`). Measures the painted boxes in the DOM — tag rect vs button circle — not a model of them.
 *
 * KNOWN-BAD ARM (the instrument can see the bug): the same frame with nothing selected puts the tags back at the corner, where they
 * DO intersect the discs — the very overlap the owner reported. The run is VOID, never green, if that arm does not collide.
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
  // every tag's painted box, and every button's painted disc, in px relative to the canvas (so a page scroll never matters)
  const read = (page) => page.evaluate(() => { const O = document.querySelector("#canvas").getBoundingClientRect(); return ({
    tags: [...document.querySelectorAll("[data-pad-corner]")].map((g) => {
      const r = g.querySelector("[data-grade-pill] rect").getBoundingClientRect();
      return { idx: +g.getAttribute("data-pad-corner-idx"), text: g.querySelector("text").textContent, moved: g.getAttribute("data-pad-corner-moved") === "1", leader: !!g.querySelector("[data-pad-corner-leader]"), x: r.x - O.x, y: r.y - O.y, w: r.width, h: r.height };
    }),
    discs: [...document.querySelectorAll("[data-harness-button] circle")].map((c) => { const r = c.getBoundingClientRect(); return { x: r.x - O.x + r.width / 2, y: r.y - O.y + r.height / 2, r: r.width / 2 }; }),
    corners: window.__harness.els[0].ring,
  }); });
  const hit = (t, d) => { const nx = Math.max(t.x, Math.min(d.x, t.x + t.w)), ny = Math.max(t.y, Math.min(d.y, t.y + t.h)); return Math.hypot(d.x - nx, d.y - ny) < d.r; };
  const overlaps = (m) => m.tags.flatMap((t) => m.discs.filter((d) => hit(t, d)).map((d) => `${t.text}@corner${t.idx}`));

  // ---- known-bad arm: nothing selected → tags at the corner; measured against the discs a SELECTED building would show
  const bad = await open("?zoom=south&sel=none");
  const badTags = (await read(bad)).tags;
  // ---- the selected building, buttons on
  const page = await open("?zoom=south&buttons=1");
  const sel = await read(page);
  check("south-end frame shows both south corner tags (fill / cut) and the edit buttons", sel.tags.length >= 2 && sel.discs.length >= 6, `${sel.tags.map((t) => t.text).join(" | ")} · ${sel.discs.length} discs`);
  const known = badTags.flatMap((t) => sel.discs.filter((d) => hit(t, d)).map(() => t.text));
  check("KNOWN-BAD arm: with nothing selected the tags DO sit under the purple +/− buttons (the owner's report reproduces)", known.length >= 1, `${known.length} collisions`);
  if (known.length < 1) { fails.push("✗ VOID: the known-bad arm did not collide — this run cannot see the bug, so no verdict is issued"); }
  check("selected: ZERO overlap between any corner tag and any edit button", overlaps(sel).length === 0, overlaps(sel).join(", "));
  check("selected: every tag is tied to its exact corner by a leader", sel.tags.every((t) => t.moved && t.leader));
  check("tags are pointer-events none (they can never take a press from a button)", await page.evaluate(() => [...document.querySelectorAll("[data-pad-corner]")].every((g) => getComputedStyle(g).pointerEvents === "none")));
  // every button answers a hit-test at its own centre (scrolled into view first: elementFromPoint is null off-screen)
  await page.locator("#canvas").scrollIntoViewIfNeeded();
  const real = await page.evaluate(() => [...document.querySelectorAll("[data-harness-button]")].filter((g) => { const r = g.querySelector("circle").getBoundingClientRect(); return r.x > 0 && r.y > 0 && r.x + r.width < innerWidth && r.y + r.height < innerHeight; }).map((g) => {
    const r = g.querySelector("circle").getBoundingClientRect(), e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { k: g.getAttribute("data-harness-button"), x: Math.round(r.x), y: Math.round(r.y), ok: !!(e && e.closest("[data-harness-button]") === g), got: e ? (e.closest("[data-harness-button]")?.getAttribute("data-harness-button") || e.tagName) : "null" };
  }));
  check("every on-screen button answers a hit-test at its own centre (no tag over it)", real.length >= 4 && real.every((b) => b.ok), JSON.stringify(real.filter((b) => !b.ok)));
  await page.locator("#canvas").screenshot({ path: `${OUT}corner-tags-selected-south.png` });

  // ---- deselect: the tags return to the corner, the leaders go
  await page.evaluate(() => window.__harness.setSel(null));
  await page.waitForFunction(() => [...document.querySelectorAll("[data-pad-corner]")].every((g) => g.getAttribute("data-pad-corner-moved") === "0"), null, { timeout: 30000 });
  const after = await read(page);
  check("deselected: no tag is moved and no leader remains", after.tags.every((t) => !t.moved && !t.leader));
  const same = after.tags.every((t) => { const b = badTags.find((x) => x.idx === t.idx); return b && Math.abs(b.x - t.x) < 0.6 && Math.abs(b.y - t.y) < 0.6; });
  check("deselected: each tag is back exactly where an unselected plan puts it", same);
  await page.locator("#canvas").screenshot({ path: `${OUT}corner-tags-deselected-south.png` });

  // ---- the whole building at fit zoom, selected (labels may or may not draw here; whatever draws must clear)
  const wide = await open("?zoom=bldg&buttons=1");
  const w = await read(wide);
  check("whole-building frame: any tag that draws clears every button", overlaps(w).length === 0, `${w.tags.length} tags`);
  await wide.locator("#canvas").screenshot({ path: `${OUT}corner-tags-selected-building.png` });

  check("no page errors", errs.length === 0, errs.slice(0, 2).join(" | "));
  await browser.close();
} catch (e) { fails.push(`✗ harness crashed — ${e && e.message}`); } finally { vite.kill(); }
console.log([...notes, ...fails].join("\n"));
console.log(fails.length ? `\n${fails.length} FAILED` : `\nall ${notes.length} checks passed`);
process.exit(fails.length ? 1 : code);
