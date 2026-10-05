#!/usr/bin/env node
/* verify-phone-typing — B2088384: every place you type in Planyr, on a phone, with the iOS keyboard up.
 *
 * For each SURFACE (a route + the clicks that reveal its fields), every visible text field is found
 * in the DOM, scrolled near the bottom of its own scroller the way a person would have left it
 * (in-page, never the driver's actionability scroll — DRIVER-SCROLL-IS-NOT-APP-SCROLL), focused, and
 * scored with the iOS keyboard modelled by ui-audit/lib/iosKeyboard.mjs — INCLUDING iOS's own page
 * scroll to reveal the field and this app's page-containment guard pinning it back, the tug-of-war
 * production telemetry shows on the owner's phone. Per field:
 *   FIELD    — the field (a contentEditable: its caret line) is inside the visible band, before and
 *              after typing;
 *   OVER     — nothing else is drawn over the visible part of the field;
 *   GAP      — a panel pinned near the bottom does not stop short of the keyboard with page showing;
 *   AUTOFILL — a field without a REAL autocomplete token (email, given-name, current-password, …)
 *              carries a non-standard one and no contact word in `name`; contact WORDING in its
 *              placeholder / aria-label / label is listed (iOS reads it too) for the phone check.
 * Screenshots (keyboard + accessory bar drawn) of every field go to --shots=<dir>.
 * KNOWN-ANSWER ARM: before scoring, a field planted at the bottom of a pinned, non-scrolling panel
 * with the app's reveal switched off must read as HIDDEN; else the run is VOID.
 *
 * Build against the stub backend so the signed-in half is reachable (no real data, nothing sent):
 *   VITE_SUPABASE_URL=https://stub.supabase.co VITE_SUPABASE_ANON_KEY=x npx vite build
 *   npx vite preview --port 4190, then node ui-audit/verify-phone-typing.mjs [baseUrl] [--shots=dir] [--only=regex]
 */
import { webkit, devices } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { installStubSupabase } from "./lib/stubSupabase.mjs";
import { IOS_MODEL, KEYBOARDS, probeFocused, shootWithKeyboard, CONTACT_WORDS, REAL_TOKEN } from "./lib/iosKeyboard.mjs";

const BASE = (process.argv.find((a, i) => i > 1 && a.startsWith("http")) || "http://localhost:4190").replace(/\/$/, "");
const SHOTS = (process.argv.find((a) => a.startsWith("--shots=")) || "").slice(8);
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7);
const JSON_OUT = (process.argv.find((a) => a.startsWith("--json=")) || "").slice(7);
const PHONES = (process.argv.find((a) => a.startsWith("--phones=")) || "--phones=iPhone 15,iPhone SE").slice(9).split(",");
const MODES = ["ios", "ios-tallinner"];
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const results = [];
const fieldRows = [];
const check = (id, ok, detail = "") => { results.push({ id, ok: !!ok, detail }); if (!ok || process.env.VERBOSE) console.log(`${ok ? "PASS" : "FAIL"}  ${id}${detail ? "  — " + detail : ""}`); };

// ── signed-in stub session + one seeded project ─────────────────────────────────────────────────
const UID = "b147d90d-b610-423d-af65-7e004f0ad72f";
const jwt = (p) => { const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url"); return `${b({ alg: "HS256", typ: "JWT" })}.${b(p)}.sig`; };
const session = {
  access_token: jwt({ sub: UID, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, aud: "authenticated" }),
  refresh_token: "stub-refresh", expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: "bearer",
  user: { id: UID, aud: "authenticated", role: "authenticated", email: "owner@example.com", app_metadata: {}, user_metadata: { first_name: "Test", last_name: "Owner" }, created_at: new Date().toISOString() },
};
const PROJ = "zzproj";
// a minimal plan in the app's CURRENT element shape (one parcel, one building — synthetic, no real
// data), so the panels show the fields a real plan has (parcel record, yield, the Properties sheet).
// (The committed e2e test-fit fixture was tried first: its element shapes predate the current planner
// and crash it — recorded so nobody re-tries it.)
const plan = { id: PROJ, groupId: PROJ, site: "ZZ Project", name: "Concept A", origin: null, county: null,
  parcels: [{ id: "p1", points: [{ x: -600, y: -600 }, { x: 600, y: -600 }, { x: 600, y: 600 }, { x: -600, y: 600 }], active: true, z: 0 }],
  els: [{ id: "b1", type: "building", cx: 0, cy: 0, w: 500, h: 300, rot: 0, z: 1 }],
  measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now() };
const tables = () => ({
  sites: [{ id: PROJ, group_id: PROJ, site: "ZZ Project", name: "Concept A", user_id: UID, team_id: null, share_locked: false, deleted_at: null, version: 1, updated_at: new Date().toISOString(), origin: plan.origin, county: plan.county, parcels: plan.parcels, els: plan.els, measures: plan.measures || [], settings: plan.settings || {} }],
  profiles: [{ id: UID, first_name: "Test", last_name: "Owner", organization: "Planyr", prefs: {} }],
  comps: [], site_elements: [], notes_trees: [], client_errors: [], file_facts: [], upload_sessions: [], doc_reviews: [], teams: [], team_members: [],
});
const seed = (signedIn) => `(() => { try {
  ${signedIn ? `localStorage.setItem('sb-stub-auth-token', ${JSON.stringify(JSON.stringify(session))});
  localStorage.setItem('planarfit:sites:cloud:${UID}', ${JSON.stringify(JSON.stringify({ [PROJ]: plan }))});` : `localStorage.setItem('planarfit:sites:v1', ${JSON.stringify(JSON.stringify({ [PROJ]: plan }))});`}
  localStorage.setItem('planyr:firstLanding:v1', '1');
} catch (e) {} })();`;

async function open(browser, phone, mode, { signedIn = true, route }) {
  const ctx = await browser.newContext({ ...devices[phone], ignoreHTTPSErrors: true });
  await installStubSupabase(ctx, { tables: tables(), session });
  await ctx.route(/^(?!.*(localhost|127\.0\.0\.1|stub\.supabase\.co)).*/, (r) => r.abort()); // no external network: tiles/GIS blocked
  await ctx.addInitScript(seed(signedIn));
  await ctx.addInitScript(IOS_MODEL, { kbPx: KEYBOARDS[phone], tallInner: mode === "ios-tallinner" });
  const page = await ctx.newPage();
  page.setDefaultTimeout(6000);
  const errs = []; page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 160)));
  await page.goto(`${BASE}/${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await assertMeasurable(page, `verify-phone-typing:${phone}:${mode}`);
  await page.waitForTimeout(4200); // the page-containment guard arms on idle (~4.5 s): score with it live, as on the phone
  return { ctx, page, errs };
}

const tapText = async (page, re) => { const l = page.getByRole("button", { name: re }).first(); await l.click({ timeout: 4000 }); await page.waitForTimeout(500); };
const tapSel = async (page, sel) => { await page.locator(sel).locator("visible=true").first().click({ timeout: 4000 }); await page.waitForTimeout(500); };
// select the parcel (a point inside it, clear of the building) so the Land panel shows its record
const tapParcel = async (page) => {
  const pt = await page.evaluate(() => { const e = document.querySelector('[data-feature^="parcel:"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width * 0.15, y: r.top + r.height * 0.2 }; });
  if (pt) { await page.touchscreen.tap(pt.x, pt.y); await page.waitForTimeout(600); }
};
// unfold every folded section inside the open side panel (the phone drawer), so its fields exist
const unfoldPanel = async (page) => {
  for (let i = 0; i < 24; i++) {
    const clicked = await page.evaluate(() => {
      const W = innerWidth;
      const b = [...document.querySelectorAll('[aria-expanded="false"]')].find((e) => {
        const r = e.getBoundingClientRect();
        return r.width && r.height && r.left > 40 && r.right < W - 30 && r.top > 120 && !e.hasAttribute("aria-haspopup") && !e.closest('[role="menu"], [role="dialog"], header, nav, [data-testid*="color"]') && !/^(tools|panels)$/i.test((e.innerText || "").trim());
      });
      if (!b) return false;
      b.click(); return true;
    });
    if (!clicked) break;
    await page.waitForTimeout(250);
  }
};

// ── SURFACES ────────────────────────────────────────────────────────────────────────────────────
// Each lists how to reveal its fields. `scope` limits the field search to a container once open.
const SURFACES = [
  { id: "auth — sign in", signedIn: false, route: "#/", open: async (p) => { await tapSel(p, '[data-testid="account-signed-out"]'); }, scope: '[role="dialog"], form' },
  { id: "auth — sign up", signedIn: false, route: "#/", open: async (p) => { await tapSel(p, '[data-testid="account-signed-out"]'); await tapText(p, /^(create (an )?account|sign up)$/i); }, scope: '[role="dialog"], form' },
  { id: "help — report a problem", signedIn: false, route: "#/", open: async (p) => { await tapSel(p, '[data-testid="help-report-fab"]'); await p.getByText(/^Report a problem$/).first().click(); await p.waitForTimeout(500); } },
  { id: "help — keyboard shortcuts search", signedIn: false, route: "#/", open: async (p) => { await tapSel(p, '[data-testid="help-report-fab"]'); await tapSel(p, '[data-testid="help-menu-shortcuts"]'); } },
  { id: "account — profile", route: "#/", open: async (p) => { await p.getByRole("button", { name: /^Account:/ }).first().click(); await p.waitForTimeout(300); await tapText(p, /^profile$/i); } },
  { id: "account — team", route: "#/", open: async (p) => { await p.getByRole("button", { name: /^Account:/ }).first().click(); await p.waitForTimeout(300); await tapText(p, /^team$/i); await p.getByRole("button", { name: /create (a )?team|new team/i }).first().click({ timeout: 2500 }).catch(() => {}); await p.waitForTimeout(300); } },
  // (on an iPhone SE the crumb sits past the end of the header row, which scrolls sideways — scroll it in first, as a finger would)
  { id: "project search", route: `#/project/${PROJ}/site`, signedIn: true, open: async (p) => { const hit = await p.evaluate(() => { const c = [...document.querySelectorAll('[data-testid="project-crumb"]')].find((e) => e.getClientRects().length); if (!c) return false; c.scrollIntoView({ inline: "center", block: "nearest" }); c.click(); return true; }); if (!hit) throw new Error("no project crumb"); await p.waitForTimeout(600); } },
  { id: "site — map search", route: "#/site", open: async () => {} },
  { id: "site — plan name", route: `#/project/${PROJ}/site`, signedIn: false, open: async (p) => { await tapSel(p, '[data-testid="plan-crumb"]'); } },
  ...["Land", "Analysis", "Drainage", "Yield", "Overlays", "Standards"].map((panel) => ({
    id: `site — ${panel} panel`, route: `#/project/${PROJ}/site`, signedIn: false, max: 14, noType: true,
    // opened and screenshotted (SURFACE_SHOT=dir): on this one-parcel/one-building plan these panels are read-only summaries
    ...(panel === "Standards" ? {} : { mayBeEmpty: "read-only on this plan (no text fields shown)" }),
    open: async (p) => { if (panel === "Land") await tapParcel(p); await tapSel(p, '[data-testid="mobile-panels-tab"]'); await p.getByRole("button", { name: new RegExp(`^${panel}$`) }).first().click(); await p.waitForTimeout(700); await unfoldPanel(p); },
  })),
  { id: "site — Properties of a selected building", route: `#/project/${PROJ}/site`, signedIn: false, max: 16, noType: true,
    open: async (p) => {
      const pt = await p.evaluate(() => { const e = document.querySelector('[data-el-id="b1"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      if (pt) { await p.touchscreen.tap(pt.x, pt.y); await p.waitForTimeout(700); }
      await p.locator('[data-testid="mobile-panels-tab"]').locator("visible=true").first().click({ timeout: 2500 }).catch(() => {});
      await p.getByRole("button", { name: /^Properties$/ }).first().click({ timeout: 2500 }).catch(() => {});
      await p.waitForTimeout(700); await unfoldPanel(p);
    } },
  { id: "site — set location dialog", route: `#/project/${PROJ}/site`, signedIn: false, open: async (p) => { await tapSel(p, '[data-testid="mobile-panels-tab"]'); await p.getByRole("button", { name: /^Land$/ }).first().click(); await p.waitForTimeout(500); await tapSel(p, '[data-testid="set-location-cta"]'); }, scope: '[role="dialog"]' },
  { id: "notes", route: "#/notes", open: async (p) => { await p.getByRole("button", { name: /new (page|note)|\+ page|add page/i }).first().click({ timeout: 2500 }).catch(() => {}); await p.waitForTimeout(600); } },
  { id: "spreadsheet", route: `#/project/${PROJ}/spreadsheet`, open: async () => {} },
  { id: "schedule — agenda", route: "#/org/schedule", open: async () => {} },
  { id: "schedule — new schedule", route: `#/project/${PROJ}/schedule`, open: async (p) => { await p.getByRole("button", { name: /create|new schedule/i }).first().click({ timeout: 3000 }).catch(() => {}); await p.waitForTimeout(500); } },
  { id: "library", route: `#/project/${PROJ}/library`, open: async () => {} },
  { id: "review — reviews menu", route: "#/markup", open: async (p) => { await p.getByRole("button", { name: /^Reviews/ }).first().click(); await p.waitForTimeout(500); } },
];

const FIELD_SEL = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=color]):not([type=button]):not([type=submit]), textarea, select, [contenteditable="true"]';
const listFields = (page, scope) => page.evaluate(([FIELD_SEL, scope]) => {
  const roots = scope ? [...document.querySelectorAll(scope)] : [document];
  const seen = new Set(); const out = [];
  for (const root of (roots.length ? roots : [document])) for (const el of root.querySelectorAll(FIELD_SEL)) {
    if (seen.has(el)) continue; seen.add(el);
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (!r.width || !r.height || cs.visibility === "hidden" || el.disabled || el.readOnly) continue;
    if (el.closest("[aria-hidden='true']")) continue;
    const i = out.length; el.setAttribute("data-ptyp", String(i));
    out.push({ i, label: el.dataset.testid || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("name") || `${el.tagName.toLowerCase()}#${i}` });
  }
  return out;
}, [FIELD_SEL, scope || null]);

async function scoreField(page, tag, f, shotPath, { noType = false } = {}) {
  const sel = `[data-ptyp="${f.i}"]`;
  // leave it where a person scrolling down to it would: near the BOTTOM of its scroller, then tap
  await page.evaluate((sel) => { const el = document.querySelector(sel); el.scrollIntoView({ block: "end", inline: "nearest" }); el.focus(); }, sel);
  await page.waitForTimeout(1100);
  let p = await probeFocused(page);
  if (p.none) { check(`${tag} — focus`, false, "field would not take focus"); return; }
  const isSelect = p.tag === "SELECT";
  // (Site Planner surfaces: focus only — typing edits the plan, and the stub backend answers the
  // resulting save with a "tab is out of date" notice no real session would see.)
  if (!noType && !isSelect && !/^(date|time|number)$/.test(p.type)) {
    await page.keyboard.type(p.ce ? "Typing a line on the phone" : "abc", { delay: 10 }).catch(() => {});
    await page.waitForTimeout(450);
    p = await probeFocused(page);
  }
  check(`${tag} — keyboard up`, p.kbOpen, p.tag);
  check(`${tag} — FIELD visible above the keyboard`, p.inBand, p.detail + (p.iosReveals ? ` (iOS tried to reveal it ${p.iosReveals}× — the page guard pins that back)` : ""));
  check(`${tag} — OVER nothing drawn over it`, p.over.length === 0, p.over.join(", "));
  if (p.gap) check(`${tag} — GAP`, false, p.gap);
  // AUTOFILL
  const real = REAL_TOKEN.test(p.ac);
  const tokenOk = isSelect || p.ce || real || /^x-/.test(p.ac);
  const nameOk = real || !CONTACT_WORDS.test(p.nm);
  check(`${tag} — AUTOFILL no contact AutoFill hooks`, tokenOk && nameOk, `autocomplete="${p.ac}" name="${p.nm}"${real ? " (a real contact/credential field — AutoFill wanted)" : ""}`);
  const wording = real ? [] : [p.ph, p.al, p.lbl].filter((w) => w && CONTACT_WORDS.test(w));
  fieldRows.push({ tag, ok: p.inBand && p.over.length === 0 && !p.gap && tokenOk && nameOk, real, wording, ac: p.ac, detail: p.detail });
  if (SHOTS && shotPath) await shootWithKeyboard(page, shotPath);
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.waitForTimeout(400);
}

const section = async (name, fn) => { if (ONLY && !new RegExp(ONLY).test(name)) return; try { await fn(); } catch (e) { check(`${name}: section aborted`, false, String(e.message).split("\n")[0]); } };

const browser = await webkit.launch();
try {
  // ── 0. KNOWN-ANSWER ARM ───────────────────────────────────────────────────────────────────────
  await section("0 known answer", async () => {
    const { ctx, page } = await open(browser, "iPhone 15", "ios", { signedIn: false, route: "#/" });
    await page.evaluate(() => {
      const d = document.createElement("div");
      d.style.cssText = "position:fixed;left:0;right:0;bottom:0;height:90px;background:#fff;z-index:9999";
      d.setAttribute("data-keyboard-managed", ""); // switch the app's reveal OFF for this planted panel
      d.innerHTML = '<input id="__planted" style="margin:30px 10px;width:200px" autocomplete="x-test">';
      document.body.appendChild(d);
    });
    await page.evaluate(() => document.getElementById("__planted").focus());
    await page.waitForTimeout(1100);
    const p = await probeFocused(page);
    check("0 KNOWN ANSWER: a field pinned under the keyboard with no reveal reads as HIDDEN", p.kbOpen && !p.inBand, p.detail);
    await ctx.close();
  });
  const voided = results.some((r) => r.id.startsWith("0 KNOWN") && !r.ok);

  for (const phone of PHONES) for (const mode of MODES) for (const s of SURFACES) {
    const name = `[${phone} · ${mode}] ${s.id}`;
    await section(name, async () => {
      const { ctx, page, errs } = await open(browser, phone, mode, s);
      await s.open(page);
      if (process.env.SURFACE_SHOT) await page.screenshot({ path: `${process.env.SURFACE_SHOT}/${s.id.replace(/[^a-z0-9]+/gi, "_")}.png` });
      const all = await listFields(page, s.scope);
      const fields = s.max ? all.slice(0, s.max) : all;
      // a surface that finds NO field is vacuous unless it says why (an empty list must never read as a pass by default)
      check(`${name} — fields found`, all.length > 0 || !!s.mayBeEmpty, `${all.length ? "" : s.mayBeEmpty ? `none — ${s.mayBeEmpty} · ` : "NONE — the surface did not open, or lost its fields · "}${all.length} field(s)${fields.length < all.length ? ` (first ${fields.length} scored)` : ""}: ${fields.map((f) => f.label).join(" · ").slice(0, 300)}`);
      if (process.env.VERBOSE) console.log(`      ${name}: ${fields.length} fields`);
      for (const f of fields) {
        const tag = `${name} › ${f.label}`;
        const shot = SHOTS ? `${SHOTS}/${phone.replace(/\s+/g, "")}-${mode}-${s.id.replace(/[^a-z0-9]+/gi, "_")}-${f.i}.png` : null;
        await scoreField(page, tag, f, mode === "ios" ? shot : null, { noType: !!s.noType }).catch((e) => check(`${tag} — scored`, false, String(e.message).split("\n")[0]));
      }
      if (errs.length) check(`${name} — no page errors`, false, errs.slice(0, 2).join(" | "));
      await ctx.close();
    });
  }
  if (voided) console.log("\nVOID — the known-answer arm failed: the probe cannot see a hidden field.");
} finally {
  await browser.close();
}
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ results, fieldRows }, null, 1));
const failed = results.filter((r) => !r.ok);
const voided = results.some((r) => r.id.startsWith("0 KNOWN") && !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed · ${fieldRows.length} field checks (WebKit, iPhone descriptors, iOS keyboard MODEL incl. the page-guard tug-of-war)${voided ? " — VOID" : ""}`);
process.exit(failed.length || voided ? 1 : 0);
