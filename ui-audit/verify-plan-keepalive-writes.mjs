#!/usr/bin/env node
/* verify-plan-keepalive-writes — A KEPT (HIDDEN) PLANNER MAY NEVER WRITE TO THE WRONG PLAN (B2233521, owner's data-safety requirement).
 *
 * B2233521 keeps the plan you just left MOUNTED (hidden, detached from the page — lib/plannerKeepAlive.js) so switching back is a show, not a
 * rebuild. The owner's condition, verbatim in substance: a speed win that can write to the wrong plan is not shippable. So this harness drives
 * the signed-in rig (lib/planOpenRig.mjs — the owner's real Bolt-on + Concept A rows, the real cloud-pull → rows → seed path) through
 *
 *   A (Bolt-on) edits  : move an element (real mouse drag), toggle a GIS layer (FEMA, real checkbox), change the overlay (its opacity, typed into the
 *                        Overlays panel), rename the plan (real crumb editor)
 *   switch to B        : B (Concept A) gets its OWN, different edits (another element, the Wetlands layer, another crop, another name)
 *                        — and while A is HIDDEN: two window resizes, focus/resize events, and > 7 s of wall clock so every timer a hidden
 *                        planner owns (autosave 400 ms, the 4 s rows fallback, the tile heal, the mirror) has fired at least once
 *   switch back to A   : B is now hidden; same storm of resize/timers
 *   deploy-reload      : a full page reload while B is hidden, then B is opened fresh — its edits must have survived and A's must not be on it
 *   sign-out           : signed out while a plan is hidden
 *
 * and records EVERY write: each `commit_elements` RPC (p_site + every op), every `sites` header write (POST/PATCH body), every RPC, and every
 * on-device per-plan entry write (`<store>:p:<planId>` — parsed in the page down to name / layer set / overlay crops / the edited elements).
 *
 * VERDICTS (each named; any one fails the run):
 *   1. HIDDEN SILENCE   — while a plan is hidden, nothing writes it: no element op, no header row, no on-device entry whose content changed.
 *   2. NO CROSSOVER     — no write ever carries the OTHER plan's edit: A's rows/header/entry never hold B's name, B's layer, B's crop or B's moved
 *                         element; and the same the other way. Element ops for a plan only ever name that plan's own elements.
 *   3. EDITS LANDED     — each edit reached ITS plan (the moved element's op, the header with the layer + crop + name) — a run where an edit
 *                         wrote nothing at all is not a pass, it is VOID (the known-good arm: the instrument must see the writes it guards).
 *   4. RELOAD           — after a reload, each plan's stored record holds its own edits and none of the other's.
 *   5. SIGN-OUT         — after sign-out, no element op / header row is sent, and no account plan lands in the signed-out device store.
 *
 *   xvfb-run -a node ui-audit/verify-plan-keepalive-writes.mjs --dist <dir> [--json]
 * Build: VITE_SUPABASE_URL=https://bootauth.supabase.co VITE_SUPABASE_ANON_KEY=dummy npx vite build --outDir <dir>
 * Red-proof: build with the kept planner's layer re-apply disabled — verdict 2 fails (B's layer set saved into A).
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { authSessionSeed, detectSupabase } from "./lib/authRemount.mjs";
import { loadPlans, planRouteHandler } from "./lib/planOpenRig.mjs";
import { assertMeasurable, pacedWait } from "./lib/tabTiming.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const argOf = (f, d) => { const i = process.argv.indexOf(f); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d; };
const DIST = argOf("--dist", join(HERE, "..", "dist"));
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
if (!existsSync(join(DIST, "index.html"))) { console.error(`verify-plan-keepalive-writes: no build at ${DIST}`); process.exit(2); }
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".map": "application/json" };
const server = createServer((req, res) => {
  const u = (req.url || "/").split("?")[0].split("#")[0];
  let p = join(DIST, u === "/" ? "index.html" : u.replace(/^\/+/, ""));
  if (!existsSync(p) || p.endsWith("/")) p = join(DIST, "index.html");
  try { res.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream", "cache-control": "no-store" }); res.end(readFileSync(p)); } catch (_) { res.writeHead(404); res.end("nope"); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const SB = detectSupabase(DIST);
if (!SB) { console.error("verify-plan-keepalive-writes: the build carries no Supabase host"); process.exit(2); }

const plans = loadPlans(["concept-a", "bolt-on"]);
const A = plans.find((p) => p.key === "bolt-on"), B = plans.find((p) => p.key === "concept-a");
A.header.updatedAt = Date.now();                       // the group route lands on Bolt-on (A)
const idsOf = (p) => new Set(p.rows.map((r) => r.id));
const A_IDS = idsOf(A), B_IDS = idsOf(B);
const EDIT = {
  A: { id: A.id, name: "Bolt-on KA-edit", layer: "fema", layerLabel: "FEMA flood zones", opacity: 37 },
  B: { id: B.id, name: "Concept A KA-edit", layer: "wetlands", layerLabel: "Wetlands", opacity: 63 },
};

/* ---- in-page recorder: every on-device per-plan entry write, parsed down to the facts the verdicts read ---- */
const RECORDER = () => {
  window.__PLANYR_E2E = true;                          // the read-only E2E hooks (the overlay hook is the Crop… dialog's own write)
  window.__PLANYR_LEGACY_MIRROR = "idle";
  window.__lsw = [];
  const orig = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    try {
      const key = String(k);
      const m = /:p:([^:]+)$/.exec(key);
      if (m && this === window.localStorage) {
        let rec = null; try { rec = JSON.parse(v); } catch (_) {}
        const els = (rec && rec.els) || [];
        window.__lsw.push({ t: performance.now(), key, plan: m[1], len: String(v).length, raw: String(v),
          name: rec && rec.name, layerOverrides: rec && rec.layerOverrides, ops: ((rec && rec.sheetOverlays) || []).map((o) => (o.opacity == null ? null : Math.round(o.opacity * 100))),
          elIds: els.map((e) => e.id), els: Object.fromEntries(els.map((e) => [e.id, [e.cx, e.cy]])) });
      } else if (this === window.localStorage && /planarfit:sites/.test(key)) {
        window.__lsw.push({ t: performance.now(), key, plan: null, len: String(v).length, raw: String(v).slice(0, 0), mentions: [] });
        const last = window.__lsw[window.__lsw.length - 1];
        for (const id of (window.__planIds || [])) if (String(v).includes(id)) last.mentions.push(id);
      }
    } catch (_) {}
    return orig.call(this, k, v);
  };
};

const browser = await chromium.launch({ executablePath: EXEC, headless: false, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 820 }, deviceScaleFactor: 2 });
const net = [];                                         // every non-GET Supabase request
const rig = planRouteHandler({ base: BASE, supabaseUrl: SB.url, plans });
await ctx.route("**", (route) => {
  const req = route.request(), url = req.url();
  if (url.startsWith(SB.url) && req.method() !== "GET" && req.method() !== "OPTIONS" && !url.includes("/auth/v1/")) {
    let body = null; try { body = JSON.parse(req.postData() || "null"); } catch (_) { body = req.postData(); }
    net.push({ wall: Date.now(), method: req.method(), path: url.slice(SB.url.length).split("?")[0], query: url.split("?")[1] || "", body });
  }
  return rig(route);
});
await ctx.addInitScript(authSessionSeed({ ref: SB.ref, url: SB.url }));
await ctx.addInitScript(RECORDER);
await ctx.addInitScript((ids) => { window.__planIds = ids; }, [A.id, B.id]);
const page = await ctx.newPage();
await assertMeasurable(page, "verify-plan-keepalive-writes");

const marks = [];                                       // wall-clock windows (net requests carry wall clock; page writes carry perf time + segment)
let seg = 0;                                            // page lifetimes: a reload starts a new performance timeline AND a new in-page log
const mark = async (name) => { marks.push({ name, seg, wall: Date.now(), perf: await page.evaluate(() => performance.now()) }); };
const lswAll = [];
const harvest = async () => {                           // pull the in-page write log out BEFORE the page that holds it goes away
  const got = await page.evaluate(() => { const out = window.__lsw.map((w) => ({ ...w, raw: undefined, rawLen: (w.raw || "").length, rawHash: (() => { let h = 0; const s = w.raw || ""; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; })() })); window.__lsw = []; return out; });
  for (const w of got) lswAll.push({ ...w, seg });
};
const named = (n) => page.waitForFunction((x) => (document.body.innerText || "").includes(x), n, { timeout: 60000 });
const chip = (text) => page.locator("span:visible", { hasText: new RegExp(`^${text}$`) }).first();
const pick = (text) => page.locator("*:visible", { hasText: new RegExp(`^${text}$`) }).last();
const notes = [];
const note = (s) => { notes.push(s); console.log("· " + s); };

async function switchPlan(from, to) {                  // the header's own plan switcher: the crumb opens it, the row switches
  await page.keyboard.press("Escape"); await pacedWait(page, 200);
  for (let i = 0; i < 3 && !(await page.locator('[data-testid="plan-name-input"]:visible').count()); i++) {
    await page.locator('[data-testid="plan-crumb"]:visible').click(); await pacedWait(page, 600);
  }
  const row = page.locator("button:visible").filter({ has: page.locator("span", { hasText: new RegExp(`^${to}$`) }) }).first();
  try { await row.click({ timeout: 8000 }); } catch (e) { if (process.env.KA_SHOT) await page.screenshot({ path: process.env.KA_SHOT }); throw new Error(`could not switch ${from} → ${to}: ${e.message.split("\n")[0]}`); }
  await named(to); await pacedWait(page, 1500);
}
async function moveAnElement(ownIds) {
  try { await page.locator("button:visible", { hasText: "⤢" }).first().click({ timeout: 3000 }); } catch (_) {}
  await pacedWait(page, 900);
  const target = await page.evaluate((ids) => {
    const own = new Set(ids);
    for (const n of document.querySelectorAll("[data-el-id]")) {
      const id = n.getAttribute("data-el-id"); if (!own.has(id)) continue;
      const r = n.getBoundingClientRect(); if (r.width < 24 || r.height < 24) continue;
      const x = r.left + r.width * 0.3, y = r.top + r.height * 0.3;     // off the centre label (a press there moves the LABEL, not the element)
      const hit = document.elementFromPoint(x, y); const f = hit && hit.closest("[data-feature]");
      if (f && f.getAttribute("data-feature") === `el:${id}` && x > 380 && y > 140 && x < innerWidth - 80 && y < innerHeight - 80) return { id, x, y };
    }
    return null;
  }, [...ownIds]);
  if (!target) return null;
  const box = () => page.evaluate((id) => { const n = document.querySelector(`[data-el-id="${id}"]`); const r = n && n.getBoundingClientRect(); return r ? [r.left, r.top] : null; }, target.id);
  const before = await box();
  await page.mouse.click(target.x, target.y); await pacedWait(page, 400);           // select first
  await page.mouse.move(target.x, target.y); await page.mouse.down(); await pacedWait(page, 60);
  for (let i = 1; i <= 12; i++) { await page.mouse.move(target.x + i * 6, target.y + i * 3); await pacedWait(page, 40); }
  await page.mouse.up(); await pacedWait(page, 500);
  const after = await box();
  await page.keyboard.press("Escape");
  if (!before || !after || Math.hypot(after[0] - before[0], after[1] - before[1]) < 20) note(`element ${target.id} did not move on screen (${JSON.stringify(before)} → ${JSON.stringify(after)})`);
  return target.id;
}
async function toggleLayer(label) {
  const row = () => page.locator("label:visible", { hasText: label }).first();
  if (!(await row().count())) { try { await page.locator("button:visible", { hasText: "Layers" }).first().click({ timeout: 4000 }); } catch (_) {} await pacedWait(page, 500); }
  try { await row().waitFor({ state: "visible", timeout: 5000 }); } catch (_) { return false; }
  const cb = row().locator('input[type="checkbox"]').first();
  const was = await cb.isChecked(); await cb.click(); await pacedWait(page, 300);
  return (await cb.isChecked()) !== was;
}
/* The overlay edit is its OPACITY, typed into the Overlays panel's own field (the rig has no overlay bytes, so a crop — which needs the
 * drawing loaded — is refused by design; opacity is a plain overlay write through the same patch). */
async function setOverlayOpacity(pct) {
  const id = await page.evaluate(() => { const h = window.__plannerForeign; const own = h ? h.own() : []; return own.length ? own[0].id : null; });
  if (!id) return { ok: false, why: "no overlay" };
  if (!(await page.locator(`[data-testid="reference-open-${id}"]:visible`).count())) { await page.locator("button:visible", { hasText: "Overlays" }).first().click(); await pacedWait(page, 500); }
  if (!(await page.locator('[data-testid="overlay-opacity-pct"]:visible').count())) { await page.locator(`[data-testid="reference-open-${id}"]:visible`).click(); await pacedWait(page, 400); }
  const f = page.locator('[data-testid="overlay-opacity-pct"]:visible');
  await f.click(); await f.fill(String(pct)); await f.press("Enter"); await pacedWait(page, 400);
  const got = await page.evaluate(() => { const h = window.__plannerForeign; const o = h && h.own()[0]; return o ? o : null; });
  await page.locator("button:visible", { hasText: "Overlays" }).first().click(); await pacedWait(page, 300); // close the panel again
  return { ok: true, id };
}
async function renamePlan(next) {
  await page.locator('[data-testid="plan-crumb"]:visible').click();
  const input = page.getByTestId("plan-name-input");
  await input.fill(next); await input.press("Enter"); await page.keyboard.press("Escape"); await pacedWait(page, 400);
}
async function hiddenStorm(ms) {                        // everything that can wake a hidden planner, then the wall clock for its timers
  await page.setViewportSize({ width: 1400, height: 760 }); await pacedWait(page, 400);
  await page.evaluate(() => { window.dispatchEvent(new Event("resize")); window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
  await page.setViewportSize({ width: 1600, height: 820 }); await pacedWait(page, 400);
  await pacedWait(page, ms);
}

/* ================= the run ================= */
await page.goto(`${BASE}#/project/${A.header.groupId || A.id}/site`, { waitUntil: "load" });
await page.locator('[data-testid="planner-canvas"]').first().waitFor({ timeout: 60000 }); await named("Bolt-on");
await pacedWait(page, 6000);                            // the rows seed (the rig's 4 s fallback) has drawn A

await mark("A-edits");
const movedA = await moveAnElement(A_IDS); note(`A: moved element ${movedA}`);
const layerA = await toggleLayer(EDIT.A.layerLabel); note(`A: toggled ${EDIT.A.layerLabel}: ${layerA}`);
const ovA = await setOverlayOpacity(EDIT.A.opacity); note(`A: overlay opacity ${JSON.stringify(ovA)}`);
await renamePlan(EDIT.A.name); note(`A: renamed → ${EDIT.A.name}`);
await pacedWait(page, 2500);

await switchPlan(EDIT.A.name, "Concept A");
await pacedWait(page, 5000);                            // B's rows seed
await mark("A-hidden-start");
const movedB = await moveAnElement(B_IDS); note(`B: moved element ${movedB}`);
const layerB = await toggleLayer(EDIT.B.layerLabel); note(`B: toggled ${EDIT.B.layerLabel}: ${layerB}`);
const ovB = await setOverlayOpacity(EDIT.B.opacity); note(`B: overlay opacity ${JSON.stringify(ovB)}`);
await renamePlan(EDIT.B.name); note(`B: renamed → ${EDIT.B.name}`);
await hiddenStorm(7500);
await mark("A-hidden-end");

await switchPlan(EDIT.B.name, EDIT.A.name);
await mark("B-hidden-start");
const shownA = await page.evaluate(() => ({ layers: window.__plannerLayers ? window.__plannerLayers().on : null }));
note(`A shown again — layers on: ${JSON.stringify(shownA.layers)}`);
await hiddenStorm(7500);
await mark("B-hidden-end");

/* deploy-reload while B is hidden */
await mark("reload");
await harvest(); seg++;
await page.reload({ waitUntil: "load" });
await page.locator('[data-testid="planner-canvas"]').first().waitFor({ timeout: 60000 });
await pacedWait(page, 6000);
const afterReload = await page.evaluate((ids) => {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); const m = /:p:([^:]+)$/.exec(k); if (!m || !ids.includes(m[1])) continue;
    try { const r = JSON.parse(localStorage.getItem(k)); out[m[1]] = { key: k, name: r.name, layerOverrides: r.layerOverrides, ops: (r.sheetOverlays || []).map((o) => (o.opacity == null ? null : Math.round(o.opacity * 100))), els: Object.fromEntries((r.els || []).map((e) => [e.id, [e.cx, e.cy]])) }; } catch (_) {} }
  return out;
}, [A.id, B.id]);

/* sign-out while a plan is hidden: open B (A becomes hidden), then sign out */
const nameOnScreen = await page.evaluate((n) => (document.body.innerText || "").includes(n), EDIT.A.name);
note(`after reload the open plan is ${nameOnScreen ? "A" : "not A"}`);
if (nameOnScreen) await switchPlan(EDIT.A.name, EDIT.B.name);
await pacedWait(page, 2000);
let signedOut = false;
try {
  await page.locator('[aria-label^="Account:"]:visible').first().click({ timeout: 5000 });
  const btn = page.locator("button:visible", { hasText: "Sign out" }).first();
  await btn.waitFor({ timeout: 5000 });
  await mark("signout");                                 // the window opens at the click itself: anything written from here on is after sign-out
  await btn.click({ timeout: 5000 });
  signedOut = true;
} catch (e) { note(`sign-out UI not reachable: ${e.message.split("\n")[0]}`); }
await pacedWait(page, 8000);
await mark("end");

await harvest(); const lsw = lswAll;
await browser.close(); server.close();

/* ================= verdicts ================= */
const M = Object.fromEntries(marks.map((m) => [m.name, m]));
const fails = [], voids = [];
const inWall = (x, a, b) => x.wall >= M[a].wall && x.wall < M[b].wall;
const inPerf = (x, a, b) => x.seg === M[a].seg && x.seg === M[b].seg && x.t >= M[a].perf && x.t < M[b].perf;
const afterPerf = (x, a, slack = 0) => x.seg === M[a].seg && x.t >= M[a].perf + slack;
const commitsOf = (site) => net.filter((n) => n.path.includes("/rpc/commit_elements") && n.body && n.body.p_site === site);
const headerWrites = () => net.filter((n) => n.path === "/rest/v1/sites" || n.path.startsWith("/rest/v1/sites"));
const headerRowsFor = (n, site) => (Array.isArray(n.body) ? n.body : [n.body]).filter((r) => r && (r.id === site || (n.query || "").includes(`eq.${site}`)));
const json = (x) => JSON.stringify(x == null ? null : x);
const other = { A: "B", B: "A" };

// 1. HIDDEN SILENCE
for (const [who, a, b] of [["A", "A-hidden-start", "A-hidden-end"], ["B", "B-hidden-start", "B-hidden-end"]]) {
  const site = EDIT[who].id;
  const ops = commitsOf(site).filter((n) => inWall(n, a, b));
  if (ops.length) fails.push(`HIDDEN SILENCE: ${ops.length} commit_elements call(s) for ${who} while it was hidden (${ops.map((o) => (o.body.p_ops || []).map((x) => x.id).join(",")).join(" | ")})`);
  const hdr = headerWrites().filter((n) => inWall(n, a, b) && headerRowsFor(n, site).length);
  if (hdr.length) fails.push(`HIDDEN SILENCE: ${hdr.length} sites header write(s) for ${who} while it was hidden`);
  const prior = lsw.filter((w) => w.plan === site && w.seg === M[a].seg && w.t < M[a].perf).pop();
  const changed = lsw.filter((w) => w.plan === site && inPerf(w, a, b)).filter((w, i, arr) => (i === 0 ? (!prior || w.rawHash !== prior.rawHash) : w.rawHash !== arr[i - 1].rawHash));
  if (changed.length) fails.push(`HIDDEN SILENCE: ${changed.length} on-device write(s) changed ${who}'s entry while it was hidden`);
}
// 2. NO CROSSOVER — every write, all run long
for (const who of ["A", "B"]) {
  const me = EDIT[who], them = EDIT[other[who]];
  const themMoved = who === "A" ? movedB : movedA;
  const ownIds = who === "A" ? A_IDS : B_IDS;
  for (const n of commitsOf(me.id)) for (const op of n.body.p_ops || []) {
    if (!ownIds.has(op.id) && op.id !== undefined) fails.push(`NO CROSSOVER: commit for ${who} names element ${op.id}, which is not ${who}'s`);
    if (themMoved && op.id === themMoved && !ownIds.has(op.id)) fails.push(`NO CROSSOVER: ${who}'s commit carries ${other[who]}'s moved element`);
  }
  for (const n of headerWrites()) for (const r of headerRowsFor(n, me.id)) {
    const d = r.data || r;
    if (d.name === them.name || r.name === them.name) fails.push(`NO CROSSOVER: ${who}'s header row was written with ${other[who]}'s name "${them.name}"`);
    if (d.layerOverrides && d.layerOverrides[them.layer] === true && !(who === "B" && them.layer === me.layer)) fails.push(`NO CROSSOVER: ${who}'s header row carries ${other[who]}'s layer "${them.layer}"`);
    if ((d.sheetOverlays || []).some((o) => o && o.opacity != null && Math.round(o.opacity * 100) === them.opacity)) fails.push(`NO CROSSOVER: ${who}'s header row carries ${other[who]}'s overlay opacity`);
  }
  for (const w of lsw.filter((x) => x.plan === me.id)) {
    if (w.name === them.name) fails.push(`NO CROSSOVER: ${who}'s on-device entry written with ${other[who]}'s name`);
    if (w.layerOverrides && w.layerOverrides[them.layer] === true) fails.push(`NO CROSSOVER: ${who}'s on-device entry carries ${other[who]}'s layer "${them.layer}" (t=${Math.round(w.t)})`);
    if ((w.ops || []).includes(them.opacity)) fails.push(`NO CROSSOVER: ${who}'s on-device entry carries ${other[who]}'s overlay opacity`);
    if (themMoved && w.elIds.includes(themMoved) && !ownIds.has(themMoved)) fails.push(`NO CROSSOVER: ${who}'s on-device entry holds ${other[who]}'s moved element`);
  }
}
// 3. EDITS LANDED (the known-good arm)
const landed = {};
for (const who of ["A", "B"]) {
  const me = EDIT[who], moved = who === "A" ? movedA : movedB, fx = who === "A" ? A : B;
  const row0 = fx.rows.find((r) => r.id === moved);
  const moveOp = moved && commitsOf(me.id).some((n) => (n.body.p_ops || []).some((op) => op.id === moved && op.data && row0 && (op.data.cx !== row0.data.cx || op.data.cy !== row0.data.cy)));
  const entries = lsw.filter((x) => x.plan === me.id && x.seg === 0);   // before the reload: the edits as written
  const last = entries[entries.length - 1] || {};
  landed[who] = { move: !!moveOp, name: last.name === me.name, layer: !!(last.layerOverrides && last.layerOverrides[me.layer] === true), overlay: (last.ops || []).includes(me.opacity) };
  for (const [k, v] of Object.entries(landed[who])) if (!v) voids.push(`EDIT NOT SEEN: ${who}'s ${k} never reached a write (the instrument cannot vouch for what it did not see)`);
}
// 4. RELOAD
for (const who of ["A", "B"]) {
  const me = EDIT[who], them = EDIT[other[who]], r = afterReload[me.id];
  if (!r) { voids.push(`RELOAD: no on-device entry for ${who} after the reload`); continue; }
  if (r.name !== me.name) fails.push(`RELOAD: ${who}'s stored name is "${r.name}", expected "${me.name}"`);
  if (!(r.layerOverrides && r.layerOverrides[me.layer] === true)) fails.push(`RELOAD: ${who}'s stored layer set lost "${me.layer}"`);
  if (r.layerOverrides && r.layerOverrides[them.layer] === true) fails.push(`RELOAD: ${who}'s stored layer set holds ${other[who]}'s "${them.layer}"`);
  if (!(r.ops || []).includes(me.opacity)) fails.push(`RELOAD: ${who}'s stored overlay opacity is not its own (${json(r.ops)})`);
  if ((r.ops || []).includes(them.opacity)) fails.push(`RELOAD: ${who}'s stored overlay holds ${other[who]}'s opacity`);
}
// 5. SIGN-OUT
if (!M.signout) voids.push("SIGN-OUT: never reached the sign-out control");
else if (!signedOut) voids.push("SIGN-OUT: the sign-out control could not be reached");
else {
  const after = net.filter((n) => n.wall >= M.signout.wall && (n.path.includes("commit_elements") || n.path.startsWith("/rest/v1/sites")));
  if (after.length) fails.push(`SIGN-OUT: ${after.length} element/header write(s) sent after sign-out`);
  const leak = lsw.filter((w) => afterPerf(w, "signout") && w.plan == null && w.mentions && w.mentions.length && !/:cloud:/.test(w.key));
  if (leak.length) fails.push(`SIGN-OUT: an account plan was written into the signed-out device store (${leak.map((w) => w.key).join(", ")})`);
  const planWrites = lsw.filter((w) => afterPerf(w, "signout") && w.plan && !/:cloud:/.test(w.key));
  if (planWrites.length) fails.push(`SIGN-OUT: ${planWrites.length} account plan entry write(s) into a non-account store after sign-out (${planWrites.map((w) => `${w.key} at +${Math.round(w.t - M.signout.perf)} ms after the click, name "${w.name}"`).join("; ")})`);
}

if (process.env.KA_DUMP) { for (const m of marks) console.log("MARK", m.name, Math.round(m.perf)); for (const w of lsw) console.log("LSW", Math.round(w.t), w.key, w.rawLen, w.name || "", JSON.stringify(w.layerOverrides || null), JSON.stringify(w.mentions || null)); }
if (process.env.KA_DUMP) for (const n of net.filter((x) => x.path.includes("commit_elements"))) console.log("COMMIT", JSON.stringify(n.body).slice(0, 700));
const summary = { pass: !fails.length && !voids.length, fails, voids, notes, landed, counts: {
  commitsA: commitsOf(A.id).length, commitsB: commitsOf(B.id).length, headerWrites: headerWrites().length, deviceWritesA: lsw.filter((w) => w.plan === A.id).length, deviceWritesB: lsw.filter((w) => w.plan === B.id).length } };
if (process.argv.includes("--json")) console.log(JSON.stringify(summary, null, 1));
console.log(`\nverify-plan-keepalive-writes: ${summary.pass ? "PASS" : voids.length && !fails.length ? "VOID" : "FAIL"}`);
for (const f of fails) console.log("  ✗ " + f);
for (const v of voids) console.log("  ? " + v);
console.log("  counts " + JSON.stringify(summary.counts) + "  landed " + JSON.stringify(landed));
process.exit(summary.pass ? 0 : fails.length ? 1 : 2);
