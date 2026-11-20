#!/usr/bin/env node
/* verify-notes-recovered-banner-live — a notice must never take the working surface away (V2115860 follow-up, NEW-1).
 *
 * The "N notes lost their filing and are back below" bar sits IN FLOW above the page, so it used to be as tall as the number of recovered notes:
 * measured on the test account, 20 recovered pages = a 598 px bar in a 768 px window, ~50 px left for the page and the first box's border below the fold.
 * Signed in as the TEST account only, on a THROWAWAY page, this plants N orphan note bodies (a body with words and no tree node — what the app adopts
 * as "Recovered — …" pages) in the browser's own storage, reloads so the app adopts them and shows the bar, opens a throwaway page with one box, and asserts:
 *   · the bar is up and names all N (known-good arm: otherwise the run is VOID — it would be vacuous),
 *   · the bar takes no more than 35% of the window, its Dismiss button is on screen,
 *   · the first box's TOP border is on screen and is what a pointer there lands on.
 * Everything it created (the throwaway page and every "Recovered — ZZ throwaway…" page, plus their Bin entries) is deleted and proven gone.
 * `BASE_URL` (default https://planyr.io) · `N` (default 20) · `H` (window height, default 768) · `EXPECT_BUILD=<sha>`. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { sweepNotesThrowaways } from "./lib/notesSweep.mjs";

const BASE = (process.env.BASE_URL || "https://planyr.io").replace(/\/$/, "");
const N = Number(process.env.N || 20), H = Number(process.env.H || 768);
const TITLE = "ZZ throwaway banner probe " + Date.now().toString(36);
let pass = 0, fail = 0;
const ok = (l, c, d = "") => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l}${d ? `\n      ${d}` : ""}`); } };
const arm = [[() => { window.__PLANYR_E2E = true; }, undefined]];
let s = null;
for (let i = 0; i < 12 && !s; i++) {
  try { s = await openSignedIn({ base: BASE, viewport: { width: 1440, height: H }, initScripts: arm }); }
  catch (e) { if (!/answered 5\d\d|Failed to fetch/.test(String(e)) || i === 11) throw e; await new Promise((r) => setTimeout(r, 15000)); }
}
const p = s.page;
await assertMeasurable(p, "verify-notes-recovered-banner-live");
const served = await p.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()));
console.log("signed in as", s.proof.email, "· served build", served.build, "· window height", H, "· recovered notes", N);
if (process.env.EXPECT_BUILD) ok(`served build is the merge commit ${process.env.EXPECT_BUILD}`, served.build === process.env.EXPECT_BUILD, JSON.stringify(served));
try {
  await p.goto(`${BASE}/?cb=${Date.now()}#/notes`, { waitUntil: "domcontentloaded" });
  await p.waitForSelector('[data-testid="notes-new-page"]', { timeout: 30000 });
  await p.waitForTimeout(2500);
  const stamp = Date.now().toString(36);   // fresh ids: an id the account has already purged is treated as a purged leftover and not adopted
  await p.evaluate(([n, st]) => {
    const key = Object.keys(localStorage).find((k) => /^planyr:notes:tree:v1:/.test(k));
    const scope = key.replace("planyr:notes:tree:v1:", "");
    for (let i = 0; i < n; i++) localStorage.setItem(`planyr:notes:page:v1:${scope}:pg_zzorphan${st}${i}`, JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `ZZ throwaway orphan ${i}` }] }] }));
  }, [N, stamp]);
  await p.goto(`${BASE}/?cb=${Date.now()}#/notes`, { waitUntil: "domcontentloaded" });
  await p.waitForSelector('[data-testid="notes-new-page"]', { timeout: 30000 });
  await p.waitForTimeout(4000);
  const bar = await p.evaluate(() => { const e = document.querySelector('[data-testid="notes-integrity-banner"]'); if (!e) return null; const r = e.getBoundingClientRect(); const d = [...e.querySelectorAll("button")].find((b) => b.textContent.trim() === "Dismiss")?.getBoundingClientRect(); return { h: r.height, rec: Number(e.dataset.recovered), dismissBottom: d ? d.bottom : null }; });
  if (!bar || bar.rec < N) { console.log(`\nVOID: the recovered-notes bar named ${bar ? bar.rec : "nothing"} of ${N} planted notes — the probe would be vacuous`); process.exitCode = 2; throw new Error("void"); }
  ok(`[known-good] the bar is up and names all ${N} recovered notes`, bar.rec === N, JSON.stringify(bar));
  ok("the bar takes no more than 35% of the window", bar.h <= H * 0.35, `bar ${Math.round(bar.h)} px of ${H} px`);
  ok("its Dismiss button is on screen", bar.dismissBottom != null && bar.dismissBottom <= H, `dismiss bottom ${bar.dismissBottom}`);
  await p.locator('[data-testid="notes-new-page"]').click();
  await p.waitForSelector('[data-testid="note-title"]', { timeout: 20000 });
  await p.locator('[data-testid="note-title"]').fill(TITLE);
  await p.locator('[data-testid="note-title"]').press("Tab").catch(() => {});
  await p.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await p.waitForTimeout(1500);
  const para = (t) => ({ type: "paragraph", content: t ? [{ type: "text", text: t }] : [] });
  await p.evaluate((d) => window.__noteEditor.setDoc(d), { type: "doc", content: [{ type: "noteAnchor", attrs: { x: 40, y: 150, w: 520, h: null, aid: "fmt" }, content: [para("Alpha bravo charlie")] }, para("")] });
  await p.waitForTimeout(1500);
  const g = await p.evaluate(() => { const a = [...document.querySelectorAll(".planyr-anchor")].find((x) => x.textContent.includes("Alpha")); const r = a.getBoundingClientRect(); const at = { x: r.left + r.width / 2, y: r.top - 1 }; const hit = document.elementFromPoint(at.x, at.y); return { top: r.top, onBand: !!hit?.closest?.(".planyr-anchor-edge") }; });
  ok("the first box's top border is on screen", g.top > 0 && g.top < H - 4, `box top ${Math.round(g.top)} of ${H}`);
  ok("a pointer on that border lands on the border (it can be grabbed)", g.onBand);
} catch (e) {
  if (e.message !== "void") { fail++; console.log("  ✗ run aborted:", String(e).slice(0, 300)); }
} finally {
  await s.close().catch(() => {});
  const a = await sweepNotesThrowaways({ base: BASE });
  const b = await sweepNotesThrowaways({ base: BASE, match: /^Recovered — ZZ throwaway/ });
  ok("everything the probe made is gone from the page list and the Bin", a.pagesLeft + a.binLeft + b.pagesLeft + b.binLeft === 0, JSON.stringify([a, b]));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(process.exitCode || (fail ? 1 : 0));
