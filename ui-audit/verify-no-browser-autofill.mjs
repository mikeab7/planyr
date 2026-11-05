#!/usr/bin/env node
/* verify-no-browser-autofill — NEW-1 (2026-10-16): no browser saved-entry / autofill dropdown on any input in the Site
 * Planner or the Schedule grid.
 *
 * WHAT THIS PROVES, AND WHAT IT CANNOT. Chrome's own dropdown is browser chrome — it is not in the DOM and a headless
 * run cannot show it. What IS observable is the attribute Chrome reads when it decides: for every input / textarea on
 * every surface below, FOCUS it (a real focus, as the user does) and read its `autocomplete` and `name`. A field
 * must carry the browser's honoured opt-out — `autocomplete="off"` on Chromium (an unknown token like `x-planyr` is read
 * by Chrome as "no opinion" and leaves its saved-entry list on, and a shared `name` pools every field's history) — unless
 * it carries a REAL contact token on purpose.
 * KNOWN-ANSWER ARMS (a run that cannot see them is VOID): (1) a planted bare <input> must come out "off" after focus;
 * (2) a planted autocomplete="email" field must be left alone (sign-in keeps autofill).
 *
 *   VITE_SUPABASE_URL=https://stub.supabase.co VITE_SUPABASE_ANON_KEY=x npx vite build
 *   npx vite preview --port 4190, then node ui-audit/verify-no-browser-autofill.mjs [baseUrl]
 */
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { installStubSupabase } from "./lib/stubSupabase.mjs";

const BASE = (process.argv.find((a, i) => i > 1 && a.startsWith("http")) || "http://localhost:4190").replace(/\/$/, "");
const EXEC = process.env.PW_CHROME || ["/opt/pw-browsers/chromium"].find(existsSync);
const UID = "b147d90d-b610-423d-af65-7e004f0ad72f", PROJ = "zzproj";
const jwt = (p) => { const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url"); return `${b({ alg: "HS256", typ: "JWT" })}.${b(p)}.sig`; };
const session = {
  access_token: jwt({ sub: UID, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, aud: "authenticated" }),
  refresh_token: "stub-refresh", expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: "bearer",
  user: { id: UID, aud: "authenticated", role: "authenticated", email: "owner@example.com", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
};
const plan = { id: PROJ, groupId: PROJ, site: "ZZ Project", name: "Concept A", origin: null, county: null,
  parcels: [{ id: "p1", points: [{ x: -600, y: -600 }, { x: 600, y: -600 }, { x: 600, y: 600 }, { x: -600, y: 600 }], active: true, z: 0 }],
  els: [{ id: "b1", type: "building", cx: 0, cy: 0, w: 500, h: 300, rot: 0, z: 1 }],
  measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now() };
const tables = () => ({
  sites: [{ id: PROJ, group_id: PROJ, site: "ZZ Project", name: "Concept A", user_id: UID, team_id: null, share_locked: false, deleted_at: null, version: 1, updated_at: new Date().toISOString(), origin: null, county: null, parcels: plan.parcels, els: plan.els, measures: [], settings: {} }],
  profiles: [{ id: UID, first_name: "Test", last_name: "Owner", organization: "Planyr", prefs: {} }],
  comps: [], site_elements: [], notes_trees: [], client_errors: [], file_facts: [], upload_sessions: [], doc_reviews: [], teams: [], team_members: [],
});
const seed = `(() => { try {
  localStorage.setItem('sb-stub-auth-token', ${JSON.stringify(JSON.stringify(session))});
  localStorage.setItem('planarfit:sites:cloud:${UID}', ${JSON.stringify(JSON.stringify({ [PROJ]: plan }))});
  localStorage.setItem('planyr:firstLanding:v1', '1');
} catch (e) {} })();`;

const results = [];
const check = (id, ok, detail = "") => { results.push({ id, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${id}${detail ? "  — " + detail : ""}`); };

const FIELD = "input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=color]):not([type=button]):not([type=submit]), textarea";
// Fields that ARE contact / location data and so must keep browser suggestions (B2308848 amended 2026-10-17), with the
// exact standard token each must carry. Matched on the field's label (testid / aria-label / placeholder).
const CONTACT = [
  { re: /^set-location-search$/, token: "street-address" },
  { re: /^Name \*$|^Full name \*$/, token: "name" },
  { re: /^Email$|^Email \(optional\)$/, token: "email" },
];
const contactTokenFor = (label) => CONTACT.find((c) => c.re.test(label))?.token;
// A real contact / credential token on purpose (sign-in, profile). Anything else must read "off".
const REAL = /^(name|given-name|family-name|additional-name|nickname|username|new-password|current-password|one-time-code|organization|organization-title|street-address|address-line[1-3]|address-level[1-4]|country|country-name|postal-code|cc-[a-z-]+|tel[a-z-]*|email|url)$/;

/** Focus every field in `doc` (page or same-origin frame) the way a user does, then read what Chrome would read. */
async function sweep(frame, scope) {
  const handles = await frame.evaluate(([FIELD, scope]) => {
    const roots = scope ? [...document.querySelectorAll(scope)] : [document];
    const out = [], seen = new Set();
    for (const old of document.querySelectorAll("[data-nba]")) old.removeAttribute("data-nba"); // a stale tag from an earlier sweep would make querySelector read the WRONG field
    for (const root of roots) for (const el of root.querySelectorAll(FIELD)) {
      if (seen.has(el) || el.disabled) continue; seen.add(el);
      el.setAttribute("data-nba", String(out.length));
      out.push({ i: out.length, label: el.dataset.testid || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("name") || el.tagName.toLowerCase() });
    }
    return out;
  }, [FIELD, scope || null]);
  const rows = [];
  for (const h of handles) {
    const row = await frame.evaluate((i) => {
      const el = document.querySelector(`[data-nba="${i}"]`); if (!el) return null;
      try { el.focus({ preventScroll: true }); } catch (_) {} // a real focus → focusin → the app's stamp
      return { ac: (el.getAttribute("autocomplete") || "").trim(), name: el.getAttribute("name") || "", type: el.type, vis: !!(el.getClientRects().length) };
    }, h.i);
    if (row) rows.push({ ...h, ...row });
  }
  await frame.evaluate(() => document.activeElement?.blur?.());
  return rows;
}
function score(surface, rows, { min = 1 } = {}) {
  check(`${surface} — fields found`, rows.length >= min, `${rows.length} field(s)`);
  // The OFF set stays off (strictly "off" — a real token on a non-contact field is a failure); the CONTACT set carries its token.
  const bad = rows.filter((r) => { const want = contactTokenFor(r.label); return want ? r.ac !== want : r.ac !== "off"; });
  check(`${surface} — every field is autocomplete=off, except contact/address fields which carry their real token`, bad.length === 0, bad.slice(0, 6).map((r) => `${r.label}[${r.type}] ac="${r.ac}"`).join("; ") + (bad.length > 6 ? ` …+${bad.length - 6}` : ""));
  const pooled = rows.filter((r) => r.name === "planyr-field");
  check(`${surface} — no shared history bucket (name="planyr-field")`, pooled.length === 0, `${pooled.length} field(s)`);
}

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await installStubSupabase(ctx, { tables: tables(), session });
const own = new URL(BASE).host;
await ctx.route((u) => !/localhost|127\.0\.0\.1|stub\.supabase\.co/.test(u.host) && u.host !== own, (r) => r.abort());
await ctx.addInitScript(seed);
const page = await ctx.newPage();
page.setDefaultTimeout(8000);
const click = async (re) => { await page.getByRole("button", { name: re }).first().click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(500); };
const unfold = async () => { for (let i = 0; i < 30; i++) { const hit = await page.evaluate(() => { const b = [...document.querySelectorAll('[aria-expanded="false"]')].find((e) => e.getClientRects().length && !e.hasAttribute("aria-haspopup") && !e.closest('[role="menu"], header, nav')); if (!b) return false; b.click(); return true; }); if (!hit) break; await page.waitForTimeout(200); } };

await page.goto(`${BASE}/#/project/${PROJ}/site`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);
await assertMeasurable(page, "verify-no-browser-autofill");

// ── KNOWN-ANSWER ARMS ────────────────────────────────────────────────────────────────────────────
await page.evaluate(() => {
  const w = document.createElement("div"); w.id = "nba-arm";
  w.innerHTML = '<input id="nba-bare" type="text"/><input id="nba-email" type="email" autocomplete="email"/><input id="nba-x" type="text" autocomplete="x-planyr"/>';
  document.body.appendChild(w);
});
const arm = await sweep(page, "#nba-arm");
const by = (id) => arm.find((r) => r.label === "text" || true) && null;
const armRows = await page.evaluate(() => Object.fromEntries(["nba-bare", "nba-email", "nba-x"].map((id) => [id, document.getElementById(id).getAttribute("autocomplete")])));
const voidRun = armRows["nba-bare"] !== "off" || armRows["nba-email"] !== "email" || armRows["nba-x"] !== "off";
// the off set must reject a real token on a non-contact label, and the contact set must reject "off" (the new assertions can go red)
check("known-answer arm: scorer flags a real token on a non-contact field", ![{ label: "Building depth", type: "text", ac: "name", name: "" }].every((r) => (contactTokenFor(r.label) ? r.ac === contactTokenFor(r.label) : r.ac === "off")));
check("known-answer arm: scorer flags 'off' on the address field", ![{ label: "set-location-search", type: "text", ac: "off", name: "" }].every((r) => (contactTokenFor(r.label) ? r.ac === contactTokenFor(r.label) : r.ac === "off")));
check("known-answer arms: bare→off, email stays email, x-planyr→off", !voidRun, JSON.stringify(armRows));
await page.evaluate(() => document.getElementById("nba-arm").remove());

// ── SITE PLANNER surfaces ────────────────────────────────────────────────────────────────────────
const tapParcel = async () => {
  const pt = await page.evaluate(() => { const e = document.querySelector('[data-feature^="parcel:"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width * 0.15, y: r.top + r.height * 0.2 }; });
  if (pt) { await page.mouse.click(pt.x, pt.y); await page.waitForTimeout(600); }
};
await tapParcel();
for (const panel of ["Land", "Analysis", "Drainage", "Yield", "Overlays", "Standards"]) {
  await click(new RegExp(`^${panel}\\b`)); await unfold();
  let rows = await sweep(page);
  if (panel === "Land") {
// Address entry keeps Chrome's address suggestions; Planyr's own live-suggestion search + the filter boxes stay off
  {
    const cta = page.locator('[data-testid="set-location-cta"]').first();
    if (await cta.count()) {
      await cta.click().catch(() => {}); await page.waitForTimeout(900);
      const ac = await page.locator('[data-testid="set-location-search"]').first().evaluate((el) => { el.focus(); return el.getAttribute("autocomplete"); }).catch((e) => "NOT FOUND: " + String(e.message).slice(0, 60));
      check("site — Set location: address box carries autocomplete=street-address", ac === "street-address", `autocomplete=${ac}`);
      score("site — Set location dialog", await sweep(page, '[data-testid="set-location-dialog"]'), { min: 1 });
      await page.mouse.click(5, 5); await page.waitForTimeout(400);
      check("site — Set location dialog closed again", (await page.locator('[data-testid="set-location-dialog"]').count()) === 0);
    } else check("site — Set location CTA present", false, "plan has an origin or the CTA moved");
  }
   // open the parcel's own page: "Your name for it" lives there (the owner's repro)
    await page.getByText(/^Parcel 1$/).first().click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(500); await unfold();
    rows = rows.concat(await sweep(page));
    const nm = page.getByText(/your name for it/i).first();
    const ac = await nm.locator("xpath=following::input[1]").evaluate((el) => { el.focus(); return el.getAttribute("autocomplete"); }).catch((e) => "NOT FOUND: " + String(e.message).slice(0, 60));
    check("site — Land: 'Your name for it' (the reported field) is autocomplete=off", ac === "off", `autocomplete=${ac}`);
  }
  score(`site — ${panel} panel`, rows, { min: 0 });
}
// the selected building's Properties
const bpt = await page.evaluate(() => { const e = document.querySelector('[data-el-id="b1"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
if (bpt) { await page.mouse.click(bpt.x, bpt.y); await page.waitForTimeout(700); }
await click(/^Properties\b/); await unfold();
score("site — Properties (selected building)", await sweep(page), { min: 1 });
// the plan-name crumb editor
await page.locator('[data-testid="plan-crumb"]').first().click({ timeout: 3000 }).catch(() => {});
await page.waitForTimeout(400);
score("site — plan name editor", await sweep(page), { min: 1 });
await page.keyboard.press("Escape");
// the whole page, every field that exists anywhere in the planner chrome
score("site — all fields on the page", await sweep(page), { min: 1 });

// ── SCHEDULE grid (the same-origin iframe) ───────────────────────────────────────────────────────
// The grid is the same-origin /sequence/ page the Schedule module embeds. Mount it in a frame of the REAL app page (so the app-wide
// stamp, which attaches to same-origin frames on load, is exactly what runs in production); the module's own route needs a stored
// schedule the stub does not hold.
// (a SIGNED-OUT app page hosts it: with the stub session the grid sits waiting on a stored schedule the stub does not hold, and renders nothing)
const ctx2 = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
// (the grid page pulls its scripts from CDNs, so only the cloud and map hosts are blocked here)
await ctx2.route((u) => /tile|arcgis|googleapis/.test(u.host), (r) => r.abort());
await ctx2.addInitScript(`try { localStorage.setItem('planyr:firstLanding:v1', '1'); } catch (e) {}`);
const page2 = await ctx2.newPage();
page2.setDefaultTimeout(8000);
await page2.goto(`${BASE}/#/site`, { waitUntil: "domcontentloaded" });
await page2.waitForTimeout(3000);
await page2.evaluate(() => { const f = document.createElement("iframe"); f.src = "/sequence/"; f.style.cssText = "position:fixed;inset:0;width:100%;height:100%;z-index:99999;background:#fff"; document.body.appendChild(f); });
await page2.waitForTimeout(500);
page2.on('console', (m) => { if (process.env.SHOT) console.log('C2', m.type(), m.text().slice(0, 140)); });
page2.on('pageerror', (e) => { if (process.env.SHOT) console.log('PE2', e.message.slice(0, 200)); });
const frame = page2.frames().find((f) => /\/sequence\//.test(f.url()));
check("schedule grid frame present", !!frame, frame ? frame.url() : "no /sequence/ frame");
if (frame) {
  await frame.waitForSelector("[data-task-row]", { timeout: 25000 }).catch(() => {});
  if (process.env.SHOT) console.log("FRAME", await frame.evaluate(() => [document.querySelectorAll("[data-task-row]").length, document.body.innerText.slice(0, 200)])), await page2.screenshot({ path: process.env.SHOT });
  await page2.waitForTimeout(1200);
  // open each cell editor the way a user does (double-click), sweeping after each — one editor mounts at a time
  let rows = [];
  const nRows = Math.min(4, await frame.locator("[data-task-row]").count());
  for (let r = 0; r < nRows; r++) {
    const nTd = await frame.locator("[data-task-row]").nth(r).locator("[data-col-key]").count();
    for (let c = 0; c < nTd; c++) {
      await frame.locator("[data-task-row]").nth(r).locator("[data-col-key]").nth(c).dblclick({ timeout: 1500 }).catch(() => {});
      await page2.waitForTimeout(120);
      rows = rows.concat(await sweep(frame));
      await frame.locator("body").press("Escape").catch(() => {});
    }
  }
  score(`schedule — grid cell editors (${nRows} rows × every column)`, rows, { min: 3 });
  score("schedule — every field on the page", await sweep(frame), { min: 0 });
  // Contacts: a person's name + email are contact data, so they keep browser suggestions with the right standard tokens
  // (the toolbar lives in the host app and posts this message to the grid — exactly what its Contacts button does)
  await page2.evaluate(() => document.querySelector("iframe").contentWindow.postMessage({ source: "planar-shell", type: "planar:contacts" }, location.origin));
  await page2.waitForTimeout(500);
  await frame.getByText(/Add contact/i).first().click({ timeout: 3000 }).catch(() => {});
  await page2.waitForTimeout(400);
  const crows = await sweep(frame);
  const cn = crows.find((r) => r.label === "Full name *"), ce = crows.find((r) => r.label === "Email (optional)");
  check("schedule — Contacts: 'Full name' carries autocomplete=name", cn?.ac === "name", `ac=${cn?.ac}`);
  check("schedule — Contacts: 'Email' carries autocomplete=email", ce?.ac === "email", `ac=${ce?.ac}`);
  score("schedule — Contacts panel", crows, { min: 2 });
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
