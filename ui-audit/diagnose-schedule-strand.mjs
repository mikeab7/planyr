/**
 * Diagnosis — "the Schedule tab shows NO link/create surface for this project" (NEW-1).
 *
 * The owner's repro: on Tsakiris, opening Schedule showed no create/link panel at all — leaving
 * the project with no way to get a schedule. On Sylvestri the panel appeared normally. Two
 * mechanisms in the just-shipped B1050/B1051 work can suppress the panel; this script drives the
 * REAL built app headless (logged out, no cloud, no GIS) to establish which one actually fires
 * and whether each is a permanent strand.
 *
 *   SUSPECT 1 — `dismissedFor` (Scheduler.jsx): the X/Escape dismissal is component state, and the
 *               scheduler is KEPT ALIVE behind the other tabs, so one dismissal suppresses the
 *               panel for THAT project for the rest of the session. Per-project ⇒ predicts exactly
 *               the Tsakiris-broken / Sylvestri-fine asymmetry the owner saw.
 *   SUSPECT 2 — the `section !== "projects"` gate (navState.js): if the embedded iframe reports its
 *               dashboard/reports section, the panel is suppressed. Session-wide ⇒ would break
 *               BOTH projects, so it cannot by itself explain the asymmetry — but it is a second,
 *               independent strand (the embed persists `section` in its saved data).
 *
 * Run:  npm run build && npx vite preview --port 4173   (then)  node ui-audit/diagnose-schedule-strand.mjs
 */
import { chromium } from "playwright";
import { assertForeground } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || chromium.executablePath();

const A = "g-tsakiris", B = "g-sylvestri";
const NAME_A = "Tsakiris", NAME_B = "Sylvestri";

const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({
    pA: { id: 'pA', groupId: '${A}', site: '${NAME_A}', name: 'Plan 1', origin: null, updatedAt: Date.now(), parcels: [], els: [], measures: [], settings: {} },
    pB: { id: 'pB', groupId: '${B}', site: '${NAME_B}', name: 'Plan 1', origin: null, updatedAt: Date.now(), parcels: [], els: [], measures: [], settings: {} }
  }));
} catch (e) {} })();`;

const postSeq = (page, msg) =>
  page.evaluate((m) => window.postMessage({ source: "planar-seq", ...m }, window.location.origin), msg);
const navState = (section, projects = [], activeId = null) => ({ type: "planar:nav-state", section, activeId, projects });

// The panel is the ONLY create/link entry point — its absence IS the strand.
const panelVisible = (page) =>
  page.evaluate(() => !!document.querySelector('[role="dialog"]') &&
    /No schedule for/.test(document.body.innerText));

const line = (s) => console.log("  " + s);

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
/* ⛔ A wall-clock reading from a BACKGROUND tab is void — a hidden tab clamps setTimeout, and a
   setTimeout-paced probe then times the clamp (measured: 3,156 ms for a 138-182 ms gesture).
   See ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting a throttled number. */
await assertForeground(page, "diagnose-schedule-strand");

async function waitPanel(ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await panelVisible(page)) return true; await page.waitForTimeout(250); }
  return false;
}

console.log("\nSUSPECT 1 — the per-project dismissal (`dismissedFor`)");
await page.goto(`${BASE}/#/project/${A}/schedule`, { waitUntil: "load" });
line(`panel on ${NAME_A} (first visit): ${await waitPanel() ? "SHOWN" : "MISSING"}`);
await page.keyboard.press("Escape");                       // exactly what the owner would have tried
await page.waitForTimeout(400);
line(`panel after Escape: ${await panelVisible(page) ? "still shown" : "dismissed"}`);
// Leave the Schedule tab and come back — the scheduler stays MOUNTED behind the other tabs.
await page.goto(`${BASE}/#/project/${A}/site`, { waitUntil: "load" });
await page.waitForTimeout(800);
await page.goto(`${BASE}/#/project/${A}/schedule`, { waitUntil: "load" });
await page.waitForTimeout(2500);
const backOnA = await panelVisible(page);
line(`panel on ${NAME_A} after leaving + returning: ${backOnA ? "SHOWN (recovers)" : "MISSING → STRANDED"}`);
// …and the asymmetry: a DIFFERENT project in the same session.
await page.goto(`${BASE}/#/project/${B}/schedule`, { waitUntil: "load" });
await page.waitForTimeout(2500);
const onB = await panelVisible(page);
line(`panel on ${NAME_B} in the same session: ${onB ? "SHOWN" : "MISSING"}`);
line(`⇒ asymmetry reproduced: ${!backOnA && onB ? "YES — matches the owner's report exactly" : "no"}`);

console.log("\nSUSPECT 2 — the `section !== \"projects\"` gate");
const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 860 } });
await ctx2.addInitScript(seed);
const p2 = await ctx2.newPage();
await p2.goto(`${BASE}/#/project/${A}/schedule`, { waitUntil: "load" });
{
  const t0 = Date.now(); let shown = false;
  while (Date.now() - t0 < 20000 && !shown) { shown = await panelVisible(p2); await p2.waitForTimeout(250); }
  line(`panel on ${NAME_A} while the embed reports "projects": ${shown ? "SHOWN" : "MISSING"}`);
}
// The embed reports its dashboard section — e.g. it booted there (its `section` is persisted in the
// embed's own saved data), and a routed site with NO link is never switched off it: the embed's
// nav-select-by-site handler returns state UNCHANGED when it can't resolve the link.
await postSeq(p2, navState("reports", [{ id: 1, name: "Some other schedule" }], null));
await p2.waitForTimeout(1200);
line(`panel after the embed reports section "reports": ${await panelVisible(p2) ? "still shown" : "MISSING → STRANDED"}`);
await postSeq(p2, navState("reports", [{ id: 1, name: "Some other schedule" }], null));
await p2.waitForTimeout(1200);
line(`…and it stays missing while the embed sits on reports: ${await panelVisible(p2) ? "no (recovered)" : "yes"}`);

await browser.close();
console.log("");
