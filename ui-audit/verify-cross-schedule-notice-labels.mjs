// NEW-1 (owner follow-on to B1696640/B1696641/B1696642, 2026-09-16) — live-browser proof that every
// notice naming a task or a schedule now disambiguates WHICH PLANYR PROJECT it belongs to, not just
// which row.
//
// The owner's exact complaint, verbatim: "also it says master schedule so i dont even know which
// project this is attached to." His live account holds TWO different projects that each have a
// schedule named "Master Schedule" (storage key hs-v1, projects '1' and '2') — B1696641 already made
// the drift/ancestor-pred banners carry a row ID, but the schedule's own NAME alone still doesn't say
// which project owns it. This asserts, against the REAL React app (not the pure-function mirror —
// that's covered by test/schedulerEngine.test.js):
//   • a row named in the ancestor-predecessor banner, belonging to a DIFFERENT (non-active) schedule,
//     is prefixed "<Project> / <Schedule>" — even though that schedule shares its NAME with the one
//     actually on screen
//   • a row named in the drift banner, belonging to the ACTIVE schedule, carries NO prefix (dropping
//     the redundant "you are already looking at this" label — PANEL-BREVITY)
//   • clicking the non-active row's link switches to its schedule and lands on it (cross-schedule
//     click-to-jump, not just same-schedule)
//   • the "Merged in changes saved elsewhere" toast names the schedule the merge actually touched when
//     it's NOT the one on screen, and says "in this schedule" (never a bare/no name) when it is
//   • the "A newer version was saved elsewhere" banner always names the CURRENT tab's own schedule —
//     and that name tracks a schedule switch live, proving it isn't frozen at the moment the poll fired
//
// Drives the load through the REAL "cloud already has this key" branch (not the seed/first-load
// branch) by intercepting `window.storage.get("hs-v1")` before the app's own script assigns
// `window.storage` (Playwright's addInitScript runs before every page script, so the interceptor is
// in place first; it wraps whatever `.get`/`.checkRemote` the app installs rather than replacing the
// object, so every OTHER storage behavior — saves, etc. — is untouched). This matters here
// specifically because the pre-existing seed/first-load branch never surfaces the drift banner at all
// (recascadeWithDrift's driftSink is a throwaway `[]` on that path) — an unrelated, pre-existing gap,
// not something this item touches — so exercising the drift-banner labeling needs the real-load path.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const ROOT = new URL("../public/", import.meta.url).pathname;
const OUT = new URL("./screens/", import.meta.url).pathname;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

const mk = (id, name, o) => Object.assign({ id, name, start: "", end: "", duration: 0,
  predecessors: [], health: "gray", percentComplete: 0, parentId: null, responsibleParty: "", cost: "", notes: [], isExpanded: true,
  durValue: 0, durUnit: "d" }, o || {});

// Two DIFFERENT Planyr projects, each holding a schedule named IDENTICALLY "Master Schedule" — the
// owner's exact reported shape. Project 1 = Goose Creek (the ancestor-predecessor bug; NOT on
// screen). Project 2 = Grand Port (a plain cascade-drift bug; ON screen — aPid = 2).
const DOC = {
  nPid: 2, nTid: { "1": 300, "2": 10 }, aPid: 2, view: "split", section: "projects",
  editProjId: null, healthColStyle: "stoplight",
  settings: { holidays: {}, customHealth: [], healthLabelOverrides: {} },
  projects: {
    "1": { id: 1, name: "Master Schedule", ownerKind: "site", linkedSiteId: "site-goose-creek", linkedSiteName: "Goose Creek",
      tasks: [
        mk(259, "Contract", { parentId: null, pinnedStart: true, start: "2026-08-12", end: "2027-09-13", durValue: 0, durUnit: "d" }),
        mk(260, "Begin Drafting Contract", { parentId: 259, pinnedStart: true, start: "2026-08-12", end: "2026-08-12", durValue: 1, durUnit: "d",
          predecessors: [{ id: 259, type: "FS", lag: 0 }] }),
        mk(261, "HW Review", { parentId: 259, pinnedStart: false, start: "2027-09-07", end: "2027-09-13", durValue: 5, durUnit: "d",
          predecessors: [{ id: 259, type: "FS", lag: 0 }, { id: 260, type: "FS", lag: 0 }] }),
      ] },
    "2": { id: 2, name: "Master Schedule", ownerKind: "site", linkedSiteId: "site-grand-port", linkedSiteName: "Grand Port",
      tasks: [
        mk(1, "Site Work", { start: "2027-01-04", end: "2027-01-15", durValue: 10, durUnit: "d" }),
        // Stored start is stale vs. what the cascade re-derives from its predecessor — B836 drift.
        mk(2, "Grading", { start: "2027-03-01", end: "2027-03-05", durValue: 5, durUnit: "d", predecessors: [{ id: 1, type: "FS", lag: 0 }] }),
      ] },
  },
};

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
    const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    const body = await readFile(fp);
    res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" }); res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise(r => server.listen(0, r));
const url = `http://localhost:${server.address().port}/sequence/`;
console.log("serving", url);

const BENIGN = [/supabase\.co/i, /CORS policy/i, /ERR_FAILED/i, /WebSocket/i, /Failed to load resource/i, /Cloud unreachable/i, /realtime/i, /BABEL/i, /deoptimised/i, /ERR_TUNNEL_CONNECTION_FAILED/i];
const EXEC = process.env.PW_CHROME
  || ["/opt/pw-browsers/chromium-1228/chrome-linux/chrome", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find(existsSync);
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
await assertMeasurable(page, "verify-cross-schedule-notice-labels");
const real = [];
page.on("console", m => { if (m.type() === "error" && !BENIGN.some(r => r.test(m.text()))) real.push(m.text()); });
page.on("pageerror", e => { if (!BENIGN.some(r => r.test(e.message))) real.push("PAGEERROR: " + e.message); });

// Intercept window.storage.get("hs-v1") to hand back OUR doc, so the app takes the real "cloud
// already has this key" load branch (see the file-header comment for why that matters here). Wraps
// whatever object the app assigns to window.storage rather than replacing it, so saves/etc. still go
// through the app's own (network-blocked-in-this-sandbox) implementation untouched.
await page.addInitScript((docJson) => {
  let real;
  Object.defineProperty(window, "storage", {
    configurable: true,
    get() { return real; },
    set(v) {
      if (v && typeof v.get === "function") {
        v.get = async (k) => (k === "hs-v1") ? { key: k, value: docJson } : null;
        v.checkRemote = async () => ({ ok: true, cloudRev: 0, knownRev: 0, newer: false });
      }
      real = v;
    },
  });
}, JSON.stringify(DOC));

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(e => real.push("GOTO: " + e.message));
const rendered = await page.waitForSelector("[data-task-row]", { timeout: 20000 }).then(() => true).catch(() => false);
await page.waitForTimeout(1400);

const norm = s => (s || "").replace(/\s+/g, " ").trim();

// ── the ancestor-predecessor notice (project 1, Goose Creek — NOT on screen) is prefixed ──────────
const ancestorNotice = await page.evaluate(() => {
  const norm = s => (s || "").replace(/\s+/g, " ").trim();
  const candidates = [...document.querySelectorAll("div")].filter(d => norm(d.textContent).includes("named") && norm(d.textContent).includes("parent summary row"));
  const banner = candidates.filter(d => !candidates.some(o => o !== d && d.contains(o)))[0];
  return { bannerText: banner ? norm(banner.textContent) : null };
});
console.log("ANCESTOR NOTICE:", JSON.stringify(ancestorNotice));
// The banner names its rows directly (its schedule isn't the active one, so it can't be resolved via
// [data-task-row] in the DOM — that only renders the ACTIVE schedule's grid). Parse the live id
// straight out of the banner's own rendered text, the same way a human reading the notice would.
const id261Match = (ancestorNotice.bannerText || "").match(/#(\d+) "HW Review"/);
const id261 = id261Match ? id261Match[1] : null;

// ── the drift notice (project 2, Grand Port — ON screen) carries NO project/schedule prefix ───────
const driftNotice = await page.evaluate(() => {
  const norm = s => (s || "").replace(/\s+/g, " ").trim();
  const candidates = [...document.querySelectorAll("div")].filter(d => norm(d.textContent).includes("out of sync with") && norm(d.textContent).includes("recalculated"));
  const banner = candidates.filter(d => !candidates.some(o => o !== d && d.contains(o)))[0];
  return { bannerText: banner ? norm(banner.textContent) : null };
});
console.log("DRIFT NOTICE:", JSON.stringify(driftNotice));

// ── the "A newer version was saved elsewhere" banner names the CURRENT tab's own schedule ─────────
await page.evaluate(() => window.dispatchEvent(new Event("planar:stale")));
await page.waitForTimeout(200);
const staleText1 = await page.evaluate(() => {
  const norm = s => (s || "").replace(/\s+/g, " ").trim();
  // Innermost match only — an ancestor container wrapping ALL the top banners together also
  // "includes" this banner's text, and would drag in the ancestor-pred/drift banners' own content too.
  const candidates = [...document.querySelectorAll("div")].filter(d => norm(d.textContent).includes("A newer version was saved elsewhere"));
  const el = candidates.find(d => !candidates.some(o => o !== d && d.contains(o)));
  return el ? norm(el.textContent) : null;
});
console.log("STALE (before switch, Grand Port on screen):", JSON.stringify(staleText1));

// Click the ancestor-pred banner's named row — it belongs to a DIFFERENT (non-active) schedule, so
// this proves cross-schedule click-to-jump AND lets us re-check the stale banner after switching.
const clickResult = await page.evaluate((id261) => {
  const norm = s => (s || "").replace(/\s+/g, " ").trim();
  const banner = [...document.querySelectorAll("div")].find(d => norm(d.textContent).includes("named") && norm(d.textContent).includes("parent summary row"));
  if (!banner || !id261) return { clicked: false };
  // The wrapping `<span style={{flex:1}}>` around the WHOLE banner message also matches "#<id>" in
  // its aggregate textContent (it contains every row link) and it comes FIRST in querySelectorAll's
  // document-order result — a plain `.find` grabs that outer, onClick-less span instead of the
  // specific inner row link. Keep only the INNERMOST matching span (same dedup as the banner lookup
  // above), the same trap DRIVER-SCROLL-IS-NOT-APP-SCROLL's "known-good arm" pattern exists to catch.
  const candidates = [...banner.querySelectorAll("span")].filter(s => new RegExp("#" + id261 + "\\b").test(s.textContent || ""));
  const link = candidates.find(s => !candidates.some(o => o !== s && s.contains(o)));
  if (!link) return { clicked: false };
  link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  return { clicked: true };
}, id261);
await page.waitForTimeout(600);
const afterClick = await page.evaluate((id261) => {
  const el = id261 ? document.querySelector(`[data-task-row="${id261}"]`) : null;
  const r = el ? el.getBoundingClientRect() : null;
  // Scope this to the GRID ROWS specifically (not document.body as a whole) — the drift banner's own
  // text now legitimately says "Grand Port / Master Schedule #2 "Grading"" once Goose Creek is the
  // active schedule (it's no longer the one on screen, so it picks up the disambiguating prefix),
  // which would false-positive a whole-page text search.
  const gridText = [...document.querySelectorAll("[data-task-row]")].map(r => r.innerText).join(" | ");
  return {
    visible: !!(r && r.top >= 0 && r.top < window.innerHeight && r.width > 0 && r.height > 0),
    gridStillShowsGrandPort: gridText.includes("Grading") || gridText.includes("Site Work"),
  };
}, id261);
console.log("CLICK:", JSON.stringify(clickResult), "AFTER-CLICK:", JSON.stringify(afterClick));

// The stale banner should now name Goose Creek — proving the label is computed fresh from the
// CURRENT schedule on screen, not frozen at the moment the poll originally fired.
const staleText2 = await page.evaluate(() => {
  const norm = s => (s || "").replace(/\s+/g, " ").trim();
  const candidates = [...document.querySelectorAll("div")].filter(d => norm(d.textContent).includes("A newer version was saved elsewhere"));
  const el = candidates.find(d => !candidates.some(o => o !== d && d.contains(o)));
  return el ? norm(el.textContent) : null;
});
console.log("STALE (after switch, Goose Creek on screen):", JSON.stringify(staleText2));

// ── the merge toast names WHERE the merge landed ───────────────────────────────────────────────
// After the click above, aPid is 1 (Goose Creek). A merge touching project 2 (Grand Port, NOT on
// screen) should be named; a merge touching project 1 (ON screen) should say "in this schedule".
// Realistic payloads carry full project metadata (name/ownerKind/linkedSiteId/linkedSiteName) — the
// merge event's `value` IS the whole account document, never a bare tasks-only diff.
const mergedElsewhere = await page.evaluate(async () => {
  window.dispatchEvent(new CustomEvent("planar:merged", { detail: {
    key: "hs-v1",
    base: { projects: { "2": { id: 2, name: "Master Schedule", ownerKind: "site", linkedSiteId: "site-grand-port", linkedSiteName: "Grand Port", tasks: [{ id: 1, name: "x" }] } } },
    value: { projects: { "2": { id: 2, name: "Master Schedule", ownerKind: "site", linkedSiteId: "site-grand-port", linkedSiteName: "Grand Port", tasks: [{ id: 1, name: "x-edited" }] } } },
  } }));
  await new Promise(r => setTimeout(r, 150));
  const t = document.querySelector('[data-testid="schedule-toast-text"]');
  return t ? t.textContent : null;
});
console.log("MERGE TOAST (touched Grand Port, not on screen):", JSON.stringify(mergedElsewhere));

const mergedHere = await page.evaluate(async () => {
  window.dispatchEvent(new CustomEvent("planar:merged", { detail: {
    key: "hs-v1",
    base: { projects: { "1": { id: 1, name: "Master Schedule", ownerKind: "site", linkedSiteId: "site-goose-creek", linkedSiteName: "Goose Creek", tasks: [{ id: 259, name: "x" }] } } },
    value: { projects: { "1": { id: 1, name: "Master Schedule", ownerKind: "site", linkedSiteId: "site-goose-creek", linkedSiteName: "Goose Creek", tasks: [{ id: 259, name: "x-edited" }] } } },
  } }));
  await new Promise(r => setTimeout(r, 150));
  const t = document.querySelector('[data-testid="schedule-toast-text"]');
  return t ? t.textContent : null;
});
console.log("MERGE TOAST (touched Goose Creek, on screen):", JSON.stringify(mergedHere));

await page.screenshot({ path: OUT + "cross-schedule-notice-labels.png" });

const pass = rendered
  && !!id261
  && ancestorNotice.bannerText && ancestorNotice.bannerText.includes(`Goose Creek / Master Schedule #${id261} "HW Review"`)
  && ancestorNotice.bannerText.includes("Goose Creek / Master Schedule #") // both rows prefixed
  && driftNotice.bannerText && driftNotice.bannerText.includes('#2 "Grading"') && !driftNotice.bannerText.includes("Master Schedule")
  && staleText1 && staleText1.includes("Grand Port / Master Schedule") && !staleText1.includes("Goose Creek")
  && clickResult.clicked && afterClick.visible && !afterClick.gridStillShowsGrandPort
  && staleText2 && staleText2.includes("Goose Creek / Master Schedule") && !staleText2.includes("Grand Port")
  && mergedElsewhere && mergedElsewhere.includes("Grand Port / Master Schedule")
  && mergedHere && mergedHere.includes("in this schedule") && !mergedHere.includes("Goose Creek / Master Schedule")
  && real.length === 0;

if (!pass) console.log("DEBUG:", JSON.stringify({
  rendered, id261,
  ancestorBanner: ancestorNotice.bannerText,
  driftBanner: driftNotice.bannerText,
  staleText1, staleText2,
  clicked: clickResult.clicked, afterClick,
  mergedElsewhere, mergedHere,
  realErrs: real.length,
}, null, 2));
console.log(pass
  ? "✅ PASS — every notice that names a task or a schedule now disambiguates the owning Planyr project"
  : "❌ FAIL");
console.log("REAL ERRORS (" + real.length + "):"); real.slice(0, 20).forEach(e => console.log("  - " + e));
await browser.close(); server.close();
process.exit(pass ? 0 : 1);
