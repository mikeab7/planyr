/* verify-project-switcher-restyle — the breadcrumb project dropdown, measured in a real browser.
 *
 * Signed in against a STUB Supabase (the sandbox proxy blocks the real handshake — the standing
 * `Blocker: auth`; see lib/stubSupabase.mjs), with 65 projects (some with a schedule, three pinned)
 * and 57 soft-deleted ones, so the whole dropdown — including the "Recently deleted (57)" footer —
 * renders for real. Checks, each printed as PASS/FAIL:
 *
 *   1. NO FIRST-FRAME REORDER  — a MutationObserver armed BEFORE the click snapshots the row order on
 *      every DOM mutation batch; the first snapshot that has rows must already put the pinned
 *      projects right after the current one, and every later snapshot must be identical.
 *      (On the pre-restyle build the pinned ids arrived async, so the first frame was recency order.)
 *   2. SORT + TIME AGREE       — both groups newest-first, and the short time shown on each row never
 *      goes backwards within a group (same field for sort and label).
 *   3. ONE SCROLLER            — exactly one scrollable element inside the panel (the list); the panel
 *      itself does not scroll.
 *   4. FOOTER ALWAYS VISIBLE   — "New project" and "Recently deleted (57)" sit inside the panel's
 *      visible bounds and the viewport with 65 projects loaded.
 *   5. COLUMNS LINE UP         — the pin slot, calendar slot, time slot and menu button share the same
 *      left x on EVERY row (±1 px); the schedule icon itself lines up on rows that have one.
 *   6. PIN BUTTON              — invisible at rest, visible on hover, pins without opening the project
 *      and moves the row between groups immediately; no pin icon at rest.
 *   7. SEARCH                  — full-width, no focus ring, filters and highlights.
 *
 * KNOWN-GOOD ARM: the run is VOID (not scored) unless the stub actually served the project list
 * and the deleted-row count reads 57 — a probe that never saw the data proves nothing.
 *
 * Run:  VITE_SUPABASE_URL=https://stub.supabase.co VITE_SUPABASE_ANON_KEY=dummy npm run build \
 *       && npx vite preview --port 4173   (then)   node ui-audit/verify-project-switcher-restyle.mjs
 * Screenshots: SHOTS=dir node ui-audit/verify-project-switcher-restyle.mjs
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

const plan = (id, site, ts, sched) => ({
  id, groupId: id, site, name: "Concept A", origin: null, county: null, parcels: [], els: [], measures: [],
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
  localSites[id] = plan(id, name, NOW - hoursAgo * H, i % 3 === 0 || i === 9);
}
const PINNED = ["pj01", "pj03", "pj07"];
const CURRENT = "pj04";

const jwt = (payload) => { const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url"); return `${b({ alg: "HS256", typ: "JWT" })}.${b(payload)}.sig`; };
const session = {
  access_token: jwt({ sub: UID, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, aud: "authenticated" }),
  refresh_token: "stub-refresh", expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: "bearer",
  user: { id: UID, aud: "authenticated", role: "authenticated", email: "owner@example.com", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
};
const siteRow = (s, extra = {}) => ({ id: s.id, group_id: s.groupId, site: s.site, name: s.name, user_id: UID, team_id: null, share_locked: false,
  deleted_at: null, version: 1, updated_at: new Date(s.updatedAt).toISOString(), origin: null, county: null, parcels: [], els: [], measures: [], settings: {}, ...extra });
const tables = {
  sites: [
    ...Object.values(localSites).map((s) => siteRow(s)),
    ...Array.from({ length: 57 }, (_, i) => siteRow({ id: `del${i}`, groupId: `del${i}`, site: `Deleted ${i}`, name: "Concept A", updatedAt: NOW - 40 * 86400e3 },
      { deleted_at: new Date(NOW - (i + 1) * 3600e3).toISOString() })),
  ],
  profiles: [{ id: UID, prefs: { sitesPanel: { order: [], collapsed: {}, pinned: PINNED, sort: "recent" } } }],
  comps: [], site_elements: [], notes_trees: [], client_errors: [], doc_reviews: [], file_facts: [], upload_sessions: [],
};
const mirror = { sitesPanel: { order: [], collapsed: {}, pinned: PINNED, sort: "recent" } };
const seed = `(() => { try {
  localStorage.setItem('sb-stub-auth-token', ${JSON.stringify(JSON.stringify(session))});
  localStorage.setItem('planarfit:sites:cloud:${UID}', ${JSON.stringify(JSON.stringify(localSites))});
  localStorage.setItem('planarfit:current-site', ${JSON.stringify(CURRENT)});
  localStorage.setItem('planyr:userPrefs:v1', ${JSON.stringify(JSON.stringify(mirror))});
} catch (e) {} })();`;

let fails = 0;
const ok = (cond, msg, extra = "") => { if (!cond) fails++; console.log(`  ${cond ? "✓" : "✗ FAIL"} ${msg}${extra ? "  ::  " + extra : ""}`); };
const minutesOf = (label) => {
  const m = /^(\d+)([mhdw])$/.exec(label);
  if (label === "now") return 0;
  if (!m) return null;
  return Number(m[1]) * { m: 1, h: 60, d: 1440, w: 10080 }[m[2]];
};

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
await installStubSupabase(ctx, { tables, session, wire: [], control: {} });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 200)));
await assertMeasurable(page, "verify-project-switcher-restyle");

await page.goto(`${BASE}#/project/${CURRENT}/site`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="project-crumb"]:visible', { timeout: 30000 });
await page.waitForTimeout(3000); // let the signed-in warm/reconcile settle so the list is what a user sees

// ---- 1. first-frame order: arm the observer, THEN open ------------------------------------------
await page.evaluate(() => {
  window.__snaps = [];
  const snap = () => {
    const rows = [...document.querySelectorAll('[data-testid^="project-row-"]')].map((r) => r.getAttribute("data-testid").slice("project-row-".length));
    if (rows.length) window.__snaps.push(rows.join(","));
  };
  window.__mo = new MutationObserver(snap);
  window.__mo.observe(document.body, { childList: true, subtree: true, attributes: true });
});
const chunkHash = await page.evaluate(() => [...document.querySelectorAll("script[src]")].map((s) => s.src.split("/").pop()).join(" "));
await page.click('[data-testid="project-crumb"]:visible');
await page.waitForSelector('[data-testid="project-list-scroll"]', { timeout: 8000 });
await page.waitForTimeout(2500); // long enough for every async reconcile (pins, warm, reconcile, bin) to land
const snaps = await page.evaluate(() => window.__snaps);
console.log(`\nbuild chunks: ${chunkHash.slice(0, 160)}`);
console.log(`\nDropdown: ${await page.locator('[data-testid^="project-row-"]').count()} rows rendered, ${snaps.length} order snapshots`);

// KNOWN-GOOD ARM
const binLabel = (await page.locator('[data-testid="project-bin-toggle"]').innerText().catch(() => "")).trim();
const rowCount = await page.locator('[data-testid^="project-row-"]').count();
if (rowCount < 60 || !/\(57\)/.test(binLabel)) {
  console.log(`\nVOID — the probe did not see the seeded data (rows=${rowCount}, bin="${binLabel}"). Not scoring.`);
  await browser.close();
  process.exit(2);
}
ok(true, "KNOWN-GOOD ARM: 65 projects rendered and the footer reads the real deleted count", binLabel);

console.log("\n1. No first-frame reorder");
const first = snaps[0].split(",");
ok(first[0] === CURRENT, "the current project leads the very first snapshot", first[0]);
ok(PINNED.every((id) => first.slice(1, 1 + PINNED.length).includes(id)), "the pinned projects are ALREADY right after it in the very first snapshot", first.slice(0, 5).join(","));
const distinct = [...new Set(snaps)];
ok(distinct.length === 1, "every later snapshot has the identical row order (nothing moves between first and settled render)", `${distinct.length} distinct order(s) over ${snaps.length} snapshots`);

// ---- 2. sort + displayed time ------------------------------------------------------------------
console.log("\n2. Both groups newest-opened first; the time shown agrees with the sort");
const groups = await page.evaluate(() => {
  const pick = (sel) => [...document.querySelectorAll(`${sel} [data-testid^="project-row-"]`)].map((r) => {
    const id = r.getAttribute("data-testid").slice("project-row-".length);
    return { id, time: document.querySelector(`[data-testid="project-time-${id}"]`).innerText.trim() };
  });
  return { pinned: pick('[data-testid="project-group-pinned"]'), recent: pick('[data-testid="project-group-recent"]') };
});
for (const [g, list] of Object.entries(groups)) {
  const mins = list.map((r) => minutesOf(r.time));
  const mono = mins.every((m, i) => m != null && (i === 0 || mins[i - 1] <= m));
  ok(mono, `${g}: ${list.length} rows, times never go backwards`, list.slice(0, 8).map((r) => r.time).join(" "));
}
const expectRecent = ids.filter((id) => id !== CURRENT && !PINNED.includes(id))
  .sort((a, b) => localSites[b].updatedAt - localSites[a].updatedAt);
ok(groups.recent.map((r) => r.id).join() === expectRecent.join(), "recent group order equals the last-opened field order exactly");
const curTime = await page.locator(`[data-testid="project-time-${CURRENT}"]`).innerText();
ok(curTime.trim() === "Current", "the current row's time column reads 'Current'", curTime.trim());

// ---- 3. one scroller ---------------------------------------------------------------------------
console.log("\n3. Exactly one scrollable element");
const scr = await page.evaluate(() => {
  const panel = document.querySelector(".psw-panel");
  const all = [panel, ...panel.querySelectorAll("*")];
  const scrollers = all.filter((el) => {
    const cs = getComputedStyle(el);
    return /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1;
  }).map((el) => el.getAttribute("data-testid") || el.className || el.tagName);
  const panelCs = getComputedStyle(panel);
  return { scrollers, panelOverflowY: panelCs.overflowY, panelScrolls: panel.scrollHeight > panel.clientHeight + 1 };
});
ok(scr.scrollers.length === 1 && scr.scrollers[0] === "project-list-scroll", "exactly one element scrolls: the list", scr.scrollers.join(","));
ok(!scr.panelScrolls, "the outer panel itself does not scroll", `overflow-y:${scr.panelOverflowY}`);

// ---- 4. footer visible -------------------------------------------------------------------------
console.log("\n4. Footer always visible with 65 projects");
const foot = await page.evaluate(() => {
  const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
  return { panel: r(".psw-panel"), nw: r('[data-testid="project-new"]'), bin: r('[data-testid="project-bin-toggle"]'), vh: innerHeight };
});
const inside = (b, p) => b && b.top >= p.top - 0.5 && b.bottom <= p.bottom + 0.5 && b.bottom <= foot.vh;
ok(inside(foot.nw, foot.panel), "'New project' is within the panel's visible bounds and the viewport", `btn bottom ${foot.nw.bottom.toFixed(1)} / panel bottom ${foot.panel.bottom.toFixed(1)} / viewport ${foot.vh}`);
ok(inside(foot.bin, foot.panel), "'Recently deleted (57)' is within the panel's visible bounds and the viewport");
ok(foot.nw.top < foot.bin.top, "'New project' sits above 'Recently deleted'");

// ---- 5. column alignment ----------------------------------------------------------------------
console.log("\n5. Right-cluster columns line up on every row");
const cols = await page.evaluate(() => {
  const out = { pin: [], cal: [], time: [], menu: [], icon: [], timeRight: [] };
  for (const r of document.querySelectorAll('[data-testid^="project-row-"]')) {
    const id = r.getAttribute("data-testid").slice("project-row-".length);
    const L = (sel) => { const e = document.querySelector(sel); return e ? e.getBoundingClientRect().left : null; };
    out.pin.push(L(`[data-testid="project-slot-pin-${id}"]`));
    out.cal.push(L(`[data-testid="project-slot-cal-${id}"]`));
    out.time.push(L(`[data-testid="project-time-${id}"]`));
    out.menu.push(L(`[data-testid="project-kebab-${id}"]`));
    const icon = document.querySelector(`[data-testid="project-cal-${id}"]`);
    if (icon) out.icon.push(icon.getBoundingClientRect().left);
    const t = document.querySelector(`[data-testid="project-time-${id}"]`);
    out.timeRight.push(t.getBoundingClientRect().right);
  }
  return out;
});
const spread = (a) => Math.max(...a) - Math.min(...a);
console.log(`  measured over ${cols.cal.length} rows (${cols.icon.length} with a schedule icon):`);
for (const k of ["pin", "cal", "time", "menu", "icon", "timeRight"]) console.log(`    ${k.padEnd(9)} left x = ${Math.min(...cols[k]).toFixed(2)} … ${Math.max(...cols[k]).toFixed(2)}  (spread ${spread(cols[k]).toFixed(2)} px)`);
ok(cols.cal.length >= 60, "every row was measured");
for (const [k, label] of [["pin", "pin button slot"], ["cal", "calendar slot"], ["time", "time slot"], ["menu", "three-dot menu"], ["icon", "schedule icon on the rows that have one"]]) {
  ok(spread(cols[k]) <= 1, `${label}: same left x on every row (within 1 px)`, `spread ${spread(cols[k]).toFixed(3)} px`);
}
ok(cols.pin[0] < cols.cal[0] && cols.cal[0] < cols.time[0] && cols.time[0] < cols.menu[0], "order left→right is pin, calendar, time, menu");

// ---- 6. pin button ----------------------------------------------------------------------------
console.log("\n6. Pin button");
const target = "pj12"; // a recent-group row, not pinned, not current
const pinBtn = page.locator(`[data-testid="project-pin-${target}"]`);
await page.mouse.move(5, 5);
ok(Number(await pinBtn.evaluate((e) => getComputedStyle(e).opacity)) === 0, "invisible at rest");
ok((await page.locator('[data-testid^="project-row-"] svg[aria-label="Pinned"], [aria-label="Pinned"]').count()) === 0, "no pin icon shown on rows at rest");
await page.locator(`[data-testid="project-row-${target}"]`).scrollIntoViewIfNeeded();
await page.locator(`[data-testid="project-row-${target}"]`).hover();
await page.waitForTimeout(250);
ok(Number(await pinBtn.evaluate((e) => getComputedStyle(e).opacity)) === 1, "appears on row hover");
ok((await pinBtn.getAttribute("aria-label")) === `Pin ${localSites[target].site}`, "aria-label reads Pin <name>", await pinBtn.getAttribute("aria-label"));
const urlBefore = page.url();
await pinBtn.click();
await page.waitForTimeout(600);
ok(page.url() === urlBefore && (await page.locator('[data-testid="project-list-scroll"]').count()) === 1, "clicking Pin does not open the project or close the dropdown");
const nowPinned = await page.evaluate(() => [...document.querySelectorAll('[data-testid="project-group-pinned"] [data-testid^="project-row-"]')].map((r) => r.getAttribute("data-testid").slice(12)));
ok(nowPinned.includes(target), "the row moved into PINNED immediately", nowPinned.join(","));
await page.locator(`[data-testid="project-row-${target}"]`).hover();
ok((await page.locator(`[data-testid="project-pin-${target}"]`).getAttribute("aria-label")) === `Unpin ${localSites[target].site}`, "now reads Unpin");
await page.locator(`[data-testid="project-pin-${target}"]`).click();
await page.waitForTimeout(500);
const backRecent = await page.evaluate(() => [...document.querySelectorAll('[data-testid="project-group-recent"] [data-testid^="project-row-"]')].map((r) => r.getAttribute("data-testid").slice(12)));
ok(backRecent.includes(target), "Unpin moves it back to RECENT immediately");

// ---- 7. search ---------------------------------------------------------------------------------
console.log("\n7. Search");
const sb = await page.evaluate(() => {
  const i = document.querySelector('[data-testid="project-search"]'); const p = document.querySelector(".psw-panel");
  const ib = i.getBoundingClientRect(), pb = p.getBoundingClientRect();
  i.focus();
  const cs = getComputedStyle(i);
  return { placeholder: i.placeholder, outline: cs.outlineStyle, shadow: cs.boxShadow, rightGap: pb.right - ib.right, leftGap: ib.left - pb.left };
});
ok(sb.placeholder === "Search projects", "placeholder reads 'Search projects'", sb.placeholder);
ok(sb.outline === "none" && sb.shadow === "none", "no focus ring on focus", `outline:${sb.outline} shadow:${sb.shadow}`);
ok(sb.leftGap < 40 && sb.rightGap < 20, "spans the full panel width", `gaps ${sb.leftGap.toFixed(0)} / ${sb.rightGap.toFixed(0)}`);
await page.fill('[data-testid="project-search"]', "creek");
await page.waitForTimeout(300);
const found = await page.evaluate(() => ({ rows: document.querySelectorAll('[data-testid^="project-row-"]').length, hits: [...document.querySelectorAll('[data-hit="1"]')].map((h) => h.textContent) }));
ok(found.rows >= 1 && found.rows < 5 && found.hits.length === found.rows && found.hits.every((t) => t.toLowerCase() === "creek"), "filters by name and highlights the matched text", `${found.rows} row(s), hits=${found.hits.join("|")}`);
await page.fill('[data-testid="project-search"]', "");

// ---- footer link opens the existing bin view --------------------------------------------------
console.log("\nFooter → Recently deleted");
await page.click('[data-testid="project-bin-toggle"]');
await page.waitForSelector('[data-testid="project-bin"]', { timeout: 5000 });
const binRows = await page.locator('[data-testid^="project-restore-"]').count();
ok(binRows === 57, "opens the recently-deleted view listing the real 57", `${binRows}`);
const foot2 = await page.evaluate(() => { const p = document.querySelector(".psw-panel").getBoundingClientRect(); const n = document.querySelector('[data-testid="project-new"]').getBoundingClientRect(); return n.bottom <= p.bottom + 0.5; });
ok(foot2, "footer still visible in the bin view");
await page.click('[data-testid="project-bin-back"]');
await page.waitForSelector('[data-testid="project-group-recent"]', { timeout: 5000 });

if (SHOTS) {
  mkdirSync(SHOTS, { recursive: true });
  await page.locator(".psw-panel").screenshot({ path: `${SHOTS}/switcher-panel.png` });
  await page.screenshot({ path: `${SHOTS}/switcher-page.png`, clip: { x: 0, y: 0, width: 760, height: 620 } });
  await page.locator('[data-testid="project-list-scroll"]').evaluate((e) => { e.scrollTop = 0; });
  await page.locator(`[data-testid="project-row-pj06"]`).hover();
  await page.locator(".psw-panel").screenshot({ path: `${SHOTS}/switcher-panel-hover.png` });
  console.log(`\nscreenshots → ${SHOTS}`);
}

await browser.close();
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
