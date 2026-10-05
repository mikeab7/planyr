/* verify-project-switcher-cards — the breadcrumb project dropdown (grouped cards) + company workspace
 * card, measured in a real browser. NEW-1 / NEW-2 (this file replaces verify-project-switcher-cards,
 * which guarded the #1870 label-and-hover-pin design this work supersedes).
 *
 * Signed in against a STUB Supabase (lib/stubSupabase.mjs), 65 projects (six located, mixed statuses;
 * three pinned), 57 soft-deleted, an organization name in the profile. THEME=dark|light and
 * VIEWPORT=WxH (default 1440x900; use 390x844 for a phone) select the surface; SHOTS=dir saves screenshots.
 * Checks (each PASS/FAIL): no section labels · ONE card, pinned first, rest newest-opened first · pin
 * icons (pinned always visible + green, unpinned hover-only) · panel surface/border/shadow ·
 * exactly one scrollable element, footer inside the visible panel · right-cluster columns share left x ·
 * company card (org name / 'Company workspace' / search hides it) · outside click closes (no scrim)
 * falling through · company scope keeps the tab from every org-capable tab, no project id · Site tab at
 * company scope = map with a labelled pin per located project, tap a pin opens that project.
 * KNOWN-GOOD ARM: the run is VOID unless the stub's 65 projects and 57 deleted count are really seen.
 *
 * Run:  VITE_SUPABASE_URL=https://stub.supabase.co VITE_SUPABASE_ANON_KEY=dummy npm run build \
 *       && npx vite preview --port 4173   (then)   node ui-audit/verify-project-switcher-cards.mjs
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { installStubSupabase } from "./lib/stubSupabase.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const SHOTS = process.env.SHOTS || "";
const EXEC = process.env.PW_CHROME
  || ["/opt/pw-browsers/chromium/chrome-linux/chrome", "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find(existsSync)
  || chromium.executablePath();
const UID = "b147d90d-b610-423d-af65-7e004f0ad72f";
const NOW = Date.now();
const H = 3600e3;

const plan = (id, site, ts, sched, origin = null) => ({
  id, groupId: id, site, name: "Concept A", origin, county: null, parcels: [], els: [], measures: [],
  callouts: [], markups: [], settings: {}, underlay: null, updatedAt: ts, scheduleProjectId: sched ? `s-${id}` : null,
});
const NAMES = ["Goose Creek", "Grand Port", "8 South", "Richfield", "Silvestri", "Woods Road", "Clay & Porter", "Bain", "Tsakiris", "A very long project name that has to ellipsize because it does not fit the row"];
const localSites = {};
const ids = [];
for (let i = 0; i < 65; i++) {
  const id = `pj${String(i).padStart(2, "0")}`;
  ids.push(id);
  const name = i < NAMES.length ? NAMES[i] : `Project ${i}`;
  // Deliberately NOT in id order, so a sort that falls back to insertion order is caught.
  const hoursAgo = ((i * 37) % 65) * 1.7 + 0.5;
  // First 6 projects get a location (a spread of statuses, below) so the company-scope map has pins to find.
  localSites[id] = plan(id, name, NOW - hoursAgo * H, i % 3 === 0 || i === 9, i < 6 ? { lat: 29.7 + i * 0.04, lon: -95.4 + i * 0.05 } : null);
}
const PINNED = ["pj01", "pj03", "pj07"];
const CURRENT = "pj04";
const ORG_NAME = "Acme Industrial Partners";
const THEME = process.env.THEME || "dark";
const VIEW = (process.env.VIEWPORT || "1440x900").split("x").map(Number);

const jwt = (payload) => { const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url"); return `${b({ alg: "HS256", typ: "JWT" })}.${b(payload)}.sig`; };
const session = {
  access_token: jwt({ sub: UID, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, aud: "authenticated" }),
  refresh_token: "stub-refresh", expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: "bearer",
  user: { id: UID, aud: "authenticated", role: "authenticated", email: "owner@example.com", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
};
const STATUS_BY_ID = { pj00: "active", pj01: "pursuit", pj02: "complete", pj03: "dead", pj04: "active", pj05: "onhold" };
const siteRow = (s, extra = {}) => ({ id: s.id, group_id: s.groupId, site: s.site, name: s.name, user_id: UID, team_id: null, share_locked: false,
  deleted_at: null, version: 1, updated_at: new Date(s.updatedAt).toISOString(), origin: s.origin || null, status: STATUS_BY_ID[s.id] || "pursuit", county: null, parcels: [], els: [], measures: [], settings: {}, ...extra });
const tables = {
  sites: [
    ...Object.values(localSites).map((s) => siteRow(s)),
    ...Array.from({ length: 57 }, (_, i) => siteRow({ id: `del${i}`, groupId: `del${i}`, site: `Deleted ${i}`, name: "Concept A", updatedAt: NOW - 40 * 86400e3 },
      { deleted_at: new Date(NOW - (i + 1) * 3600e3).toISOString() })),
  ],
  profiles: [{ id: UID, org: ORG_NAME, first_name: "Owner", last_name: "Test", prefs: { sitesPanel: { order: [], collapsed: {}, pinned: PINNED, sort: "recent" } } }],
  comps: [], site_elements: [], notes_trees: [], client_errors: [], doc_reviews: [], file_facts: [], upload_sessions: [],
};
const mirror = { sitesPanel: { order: [], collapsed: {}, pinned: PINNED, sort: "recent" } };
const seed = `(() => { try {
  localStorage.setItem('sb-stub-auth-token', ${JSON.stringify(JSON.stringify(session))});
  localStorage.setItem('planarfit:sites:cloud:${UID}', ${JSON.stringify(JSON.stringify(localSites))});
  localStorage.setItem('planarfit:current-site', ${JSON.stringify(CURRENT)});
  localStorage.setItem('planyr.theme', ${JSON.stringify(THEME)});
  localStorage.setItem('planyr:userPrefs:v1', ${JSON.stringify(JSON.stringify(mirror))});
} catch (e) {} })();`;

let fails = 0;
const ok = (cond, msg, extra = "") => { if (!cond) fails++; console.log(`  ${cond ? "✓" : "✗ FAIL"} ${msg}${extra ? "  ::  " + extra : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: VIEW[0], height: VIEW[1] }, hasTouch: VIEW[0] < 760, isMobile: VIEW[0] < 760 });
await installStubSupabase(ctx, { tables, session, wire: [], control: {} });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 200)));
await assertMeasurable(page, "verify-project-switcher-cards");

const open = async () => {
  await page.click('[data-testid="project-crumb"]:visible');
  await page.waitForSelector('[data-testid="project-list-scroll"]', { timeout: 8000 });
  await page.waitForTimeout(1500);
};
const gotoRoute = async (hash) => {
  await page.goto(`${BASE}${hash}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="project-crumb"]:visible', { timeout: 30000 });
  await page.waitForTimeout(2500);
};

await gotoRoute(`#/project/${CURRENT}/site`);
const served = await page.evaluate(async () => (await fetch("/version.json").then((r) => r.text()).catch(() => "")).slice(0, 120));
console.log(`viewport ${VIEW.join("x")} · theme ${THEME} · /version.json ${served}`);
console.log(`chunks: ${(await page.evaluate(() => [...document.querySelectorAll("script[src]")].map((s) => s.src.split("/").pop()).join(" "))).slice(0, 140)}`);
const theme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
ok(theme === THEME, `app is in ${THEME} mode`, String(theme));
await open();

// KNOWN-GOOD ARM
const binLabel = (await page.locator('[data-testid="project-bin-toggle"]').innerText().catch(() => "")).trim();
const rowCount = await page.locator('[data-testid^="project-row-"]').count();
if (rowCount < 60 || !/\(57\)/.test(binLabel)) {
  console.log(`\nVOID — the probe did not see the seeded data (rows=${rowCount}, bin="${binLabel}"). Not scoring.`);
  await browser.close();
  process.exit(2);
}
ok(true, "KNOWN-GOOD ARM: 65 projects rendered and the footer reads the real deleted count", binLabel);

console.log("\n1. No section labels; ONE card; pinned first");
const text = await page.locator(".psw-panel").innerText();
ok(!/\bPINNED\b|\bRECENT\b/i.test(text.replace(/Recently deleted/i, "")), "no PINNED / RECENT label anywhere in the panel");
const order = await page.evaluate(() => [...document.querySelectorAll('[data-testid="project-card"] [data-testid^="project-row-"]')].map((r) => {
  const id = r.getAttribute("data-testid").slice("project-row-".length);
  return { id, pinned: document.querySelector(`[data-testid="project-pin-${id}"]`).getAttribute("data-pinned") === "1" };
}));
ok(order.length >= 60 && (await page.locator('[data-testid="project-card"]').count()) === 1, "every project is in ONE card", `${order.length} rows`);
ok(order[0].id === CURRENT, "current project leads");
const pinnedIdx = order.map((r, i) => (r.pinned ? i : -1)).filter((i) => i >= 0);
ok(pinnedIdx.length === PINNED.length && pinnedIdx.every((v, i) => v === i + 1), "pinned rows come next, before everything else", order.slice(0, 5).map((r) => r.id).join(","));
const recents = order.slice(1 + PINNED.length).map((r) => r.id);
const expectRecent = ids.filter((id) => id !== CURRENT && !PINNED.includes(id)).sort((a, b) => localSites[b].updatedAt - localSites[a].updatedAt);
ok(recents.join() === expectRecent.join(), "everything else is newest-opened first");

console.log("\n2. Pin icons");
await page.mouse.move(2, 2);
const pinState = await page.evaluate((pinned) => {
  const st = (id) => { const b = document.querySelector(`[data-testid="project-pin-${id}"]`); const cs = getComputedStyle(b); return { opacity: Number(cs.opacity), color: cs.color, filled: !!b.querySelector("svg path[fill], svg [fill]:not([fill='none'])") }; };
  const dot = document.createElement("i"); dot.style.color = "var(--accent-site)"; document.body.appendChild(dot);
  const green = getComputedStyle(dot).color; dot.remove();
  return { pinned: pinned.map(st), unpinned: st("pj12"), green };
}, PINNED);
ok(pinState.pinned.every((p) => p.opacity === 1), "pinned rows show their pin at rest");
ok(pinState.pinned.every((p) => p.color === pinState.green), "…in the app's green", `${pinState.pinned[0].color} vs ${pinState.green}`);
ok(pinState.unpinned.opacity === 0, "an unpinned row's pin is hidden at rest");
if (VIEW[0] >= 760) {
  await page.locator('[data-testid="project-row-pj12"]').scrollIntoViewIfNeeded();
  await page.locator('[data-testid="project-row-pj12"]').hover();
  await page.waitForTimeout(250);
  ok(Number(await page.locator('[data-testid="project-pin-pj12"]').evaluate((e) => getComputedStyle(e).opacity)) === 1, "…and appears on hover");
}

console.log("\n3. Panel sits above the page: no page dim, surface, border, shadow");
const look = await page.evaluate(() => {
  const panel = document.querySelector(".psw-panel"); const cs = getComputedStyle(panel);
  // Any full-page fixed overlay (a dim/scrim) other than the panel's own dismiss layer.
  const dim = [...document.body.querySelectorAll("*")].filter((e) => { const c = getComputedStyle(e); const r = e.getBoundingClientRect(); return c.position === "fixed" && r.width >= innerWidth - 1 && r.height >= innerHeight - 1 && c.backgroundColor !== "rgba(0, 0, 0, 0)" && !e.closest(".psw-panel"); }).length;
  const header = document.querySelector("header, [data-testid='app-header']") || document.body;
  const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
  const card = document.querySelector('[data-testid="project-card"]');
  const chromeBg = getComputedStyle(document.documentElement).getPropertyValue("--chrome-bg");
  const probe = document.createElement("i"); probe.style.background = "var(--chrome-bg)"; document.body.appendChild(probe);
  const chrome = getComputedStyle(probe).backgroundColor; probe.remove();
  return { panelBg: cs.backgroundColor, panelBorder: cs.borderTopWidth + " " + cs.borderTopStyle, shadow: cs.boxShadow, dim,
    cardBg: getComputedStyle(card).backgroundColor, chrome, panelDarkerThanChrome: lum(cs.backgroundColor) < lum(chrome), cardLighterThanPanel: lum(getComputedStyle(card).backgroundColor) > lum(cs.backgroundColor) };
});
ok(look.dim === 0, "the page is NOT dimmed behind the open dropdown (no full-page overlay)", String(look.dim));
ok(/^1px solid/.test(look.panelBorder) && look.shadow !== "none", "thin border + drop shadow", `${look.panelBorder} · ${look.shadow.slice(0, 40)}`);
if (THEME === "dark") ok(look.panelDarkerThanChrome, "dark: panel surface is darker than the header", `${look.panelBg} vs header ${look.chrome}`);
ok(look.cardLighterThanPanel === (THEME === "dark" || true), "cards are raised against the panel", `${look.cardBg} on ${look.panelBg}`);

console.log("\n4. Exactly one scrollable element; footer inside the visible panel");
const scr = await page.evaluate(() => {
  const panel = document.querySelector(".psw-panel");
  const scrollers = [panel, ...panel.querySelectorAll("*")].filter((el) => /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1).map((el) => el.getAttribute("data-testid") || el.className || el.tagName);
  const r = (sel) => { const e = document.querySelector(sel); const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; };
  return { scrollers, panelScrolls: panel.scrollHeight > panel.clientHeight + 1, panel: r(".psw-panel"), nw: r('[data-testid="project-new"]'), bin: r('[data-testid="project-bin-toggle"]'), vh: innerHeight };
});
ok(scr.scrollers.length === 1 && scr.scrollers[0] === "project-list-scroll" && !scr.panelScrolls, "one scroller: the list", scr.scrollers.join(","));
const inside = (b) => b.top >= scr.panel.top - 0.5 && b.bottom <= scr.panel.bottom + 0.5 && b.bottom <= scr.vh;
ok(inside(scr.nw) && inside(scr.bin), "New project and Recently deleted are inside the visible panel with 65 projects", `new bottom ${scr.nw.bottom.toFixed(0)} / panel ${scr.panel.bottom.toFixed(0)} / viewport ${scr.vh}`);
const fullWidth = await page.evaluate(() => { const p = document.querySelector('[data-testid="project-footer"]').getBoundingClientRect(), b = document.querySelector('[data-testid="project-new"]').getBoundingClientRect(); return p.width - b.width; });
ok(fullWidth < 24, "New project is a full-width card button", `${fullWidth.toFixed(0)} less than the footer`);

console.log("\n5. Right-cluster columns line up on every row");
const cols = await page.evaluate(() => {
  const out = { pin: [], cal: [], time: [], menu: [], icon: [] };
  for (const r of document.querySelectorAll('[data-testid^="project-row-"]')) {
    const id = r.getAttribute("data-testid").slice("project-row-".length);
    const L = (sel) => { const e = document.querySelector(sel); return e ? e.getBoundingClientRect().left : null; };
    out.pin.push(L(`[data-testid="project-slot-pin-${id}"]`)); out.cal.push(L(`[data-testid="project-slot-cal-${id}"]`));
    out.time.push(L(`[data-testid="project-time-${id}"]`)); out.menu.push(L(`[data-testid="project-kebab-${id}"]`));
    const icon = document.querySelector(`[data-testid="project-cal-${id}"]`); if (icon) out.icon.push(icon.getBoundingClientRect().left);
  }
  return out;
});
const spread = (a) => Math.max(...a) - Math.min(...a);
for (const [k, label] of [["pin", "pin slot"], ["cal", "calendar slot"], ["time", "time slot"], ["menu", "three-dot menu"], ["icon", "schedule icon"]]) ok(spread(cols[k]) <= 1, `${label}: same left x on every row`, `${cols[k].length} rows, spread ${spread(cols[k]).toFixed(3)}`);
ok(cols.pin[0] < cols.cal[0] && cols.cal[0] < cols.time[0] && cols.time[0] < cols.menu[0], "order left→right is pin, calendar, time, menu");
const tcol = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="project-time-pj12"]')).color + "|" + getComputedStyle(document.documentElement).getPropertyValue("--text-secondary"));
console.log(`  (time text colour ${tcol.split("|")[0]})`);

console.log("\n6. Company card");
await page.fill('[data-testid="project-search"]', "");
const org = await page.evaluate(() => ({ name: document.querySelector('[data-testid="project-org-name"]')?.textContent, sub: document.querySelector('[data-testid="project-org-subtitle"]')?.textContent, text: document.querySelector('[data-testid="project-org"]')?.innerText, hasChevron: /[›>▸→]/.test(document.querySelector('[data-testid="project-org"]')?.innerText || "") }));
ok(org.name === ORG_NAME, "line one is the organization's actual name from Settings", org.name);
ok(org.sub === "Company workspace", "line two is 'Company workspace'", org.sub);
ok(!org.hasChevron && !/notes/i.test(org.text), "no chevron / arrow / destination text", JSON.stringify(org.text));
await page.fill('[data-testid="project-search"]', "creek");
await page.waitForTimeout(200);
ok((await page.locator('[data-testid="project-org"]').count()) === 0, "hidden while the search has non-matching text");
await page.fill('[data-testid="project-search"]', "acme");
await page.waitForTimeout(200);
ok((await page.locator('[data-testid="project-org"]').count()) === 1, "shown while the search text matches its name");
await page.fill('[data-testid="project-search"]', "");

if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/switcher-${THEME}-${VIEW[0]}.png` }); }

console.log("\n7. Clicking outside closes the dropdown (pre-#2040 behaviour: the press then reaches the page)");
await page.mouse.click(VIEW[0] - 6, VIEW[1] - 6);
await page.waitForTimeout(400);
ok((await page.locator('[data-testid="project-list-scroll"]').count()) === 0, "outside click closed the dropdown");

console.log("\n8. Company scope keeps the tab you are on");
const TABS = [["site", "site-planner"], ["notes", "notes"], ["library", "library"], ["schedule", "scheduler"], ["spreadsheet", "model"], ["markup", "doc-review"]];
for (const [slug, mod] of TABS) {
  await gotoRoute(`#/project/${CURRENT}/${slug}`);
  await open();
  await page.click('[data-testid="project-org"]');
  await page.waitForTimeout(1200);
  const hash = await page.evaluate(() => location.hash);
  ok(hash === `#/org/${slug}`, `from ${slug}: lands on company ${slug}, no project id`, hash);
  const crumb = (await page.locator('[data-testid="project-crumb"]:visible').first().innerText()).trim();
  ok(crumb.includes(ORG_NAME), `from ${slug}: the crumb reads the company name`, crumb);
}

console.log("\n9. Site tab at company scope = every site on a map");
await gotoRoute(`#/project/${CURRENT}/site`);
await open();
await page.click('[data-testid="project-org"]');
await page.waitForSelector('[data-testid="org-sites-view"]', { timeout: 15000 });
await page.waitForSelector('[data-testid="locations-map-host"]', { timeout: 20000 });
await page.waitForTimeout(2500);
const crumbs = await page.evaluate(() => [...document.querySelectorAll('[data-testid="org-sites-view"] [data-testid="dashboard-crumb"], [data-testid="org-sites-view"] [data-testid="project-crumb"]')].map((e) => e.innerText.trim()));
ok(crumbs.length === 2 && crumbs[0] === "Map" && crumbs[1].includes(ORG_NAME), "breadcrumb reads Map / <Company name>", crumbs.join(" / "));
const pins = await page.evaluate(() => [...document.querySelectorAll(".dash-map-marker")].map((m) => m.querySelector(".dash-map-label-text")?.textContent.trim()));
const EXPECT_PINS = Object.values(localSites).filter((s) => s.origin).map((s) => s.site);
ok(pins.length === EXPECT_PINS.length, `one pin per located project (${EXPECT_PINS.length})`, `${pins.length} pins`);
ok(await page.evaluate(() => !document.querySelector('[data-testid="org-sites-view"] [data-testid="locations-map-card"] [data-testid*="comps"]')), "no comps toggle at company scope");
const labelsShown = await page.evaluate(() => [...document.querySelectorAll(".dash-map-label-text")].filter((l) => l.style.display !== "none").length);
ok(labelsShown >= 1, "pins are labelled", `${labelsShown} labels visible`);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/company-sites-map-${THEME}-${VIEW[0]}.png` });
await page.locator(".dash-map-marker").first().click({ force: true });
await page.waitForTimeout(2500);
const landed = await page.evaluate(() => location.hash);
ok(/^#\/project\/pj0\d\/site$/.test(landed), "tapping a pin opens that project on the Site tab", landed);
ok((await page.locator('[data-testid="org-sites-view"]').count()) === 0, "the all-sites view is gone");

await browser.close();
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
