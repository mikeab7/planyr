/* B915 verification — the shared viewport-aware ContextMenu, in a REAL browser (Chromium).
 *
 * The reported bug: right-click a project near the BOTTOM of the map; the menu anchored top-left
 * at the cursor and ran off the bottom edge, so "Delete project…" was clipped and unreachable.
 *
 * The MapFinder site-row handler opens its menu at the EVENT's clientX/clientY (openSiteMenu(s,
 * e.clientX, e.clientY)), so we drive the exact repro deterministically: dispatch a real
 * `contextmenu` on a seeded site row with the cursor pinned to each viewport EDGE / CORNER, then
 * assert the whole menu — including its last ("Delete project…") row — lands fully inside the
 * viewport with the 8px margin. A pre-B915 assumed-height clamp would leave the bottom rows
 * off-screen at the bottom edge.
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";

const mk = (i) => {
  const id = `zz-b915-${i}`;
  return [id, { id, groupId: id, site: `ZZ B915 Site ${i}`, name: "Plan 1", origin: null, county: null, parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now() - i * 1000 }];
};
const sites = Object.fromEntries(Array.from({ length: 8 }, (_, i) => mk(i + 1)));
const seed = `(() => { try { localStorage.setItem('planarfit:sites:v1', ${JSON.stringify(JSON.stringify(sites))}); } catch (e) {} })();`;

const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const M = 8;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 640 }, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error" && !/ERR_|Failed to load resource/.test(m.text())) console.log("  [console.error]", m.text().slice(0, 160)); });

// Open the status menu at an arbitrary cursor point by dispatching a real contextmenu on a row,
// then read back the menu panel + its Delete row geometry.
const openAt = (cx, cy) => page.evaluate(({ cx, cy }) => {
  const row = [...document.querySelectorAll('div')].find((d) => /ZZ B915 Site \d+/.test(d.textContent || "") && /right-click/.test(d.getAttribute("title") || ""));
  if (!row) return { err: "no row" };
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 2 }));
  return { ok: true };
}, { cx, cy });

const readMenu = () => page.evaluate(() => {
  const del = [...document.querySelectorAll('button')].find((b) => /Delete project/.test(b.textContent || ""));
  if (!del) return null;
  let p = del; while (p && p !== document.body && getComputedStyle(p).position !== "fixed") p = p.parentElement;
  const pr = p.getBoundingClientRect(), dr = del.getBoundingClientRect();
  return { panel: { left: pr.left, top: pr.top, right: pr.right, bottom: pr.bottom, h: pr.height }, del: { left: dr.left, top: dr.top, right: dr.right, bottom: dr.bottom }, vw: window.innerWidth, vh: window.innerHeight };
});
const closeMenu = async () => { await page.keyboard.press("Escape"); await page.waitForTimeout(120); };
const inView = (r, vw, vh) => r.left >= M - 1 && r.top >= M - 1 && r.right <= vw - M + 1 && r.bottom <= vh - M + 1;

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('button[title^="All projects —"]', { timeout: 20000 });
  await page.waitForTimeout(700);

  const vw = 1200, vh = 640;

  // 1. Bottom-right corner (the repro + right-edge): both flips must fire.
  await openAt(vw - 6, vh - 6);
  await page.waitForTimeout(200);
  let m = await readMenu();
  ok("Menu opens on a right-click near the bottom-right corner", !!m);
  if (m) {
    ok("BOTTOM-RIGHT: whole menu panel is inside the viewport", inView(m.panel, m.vw, m.vh), `panel=${JSON.stringify(m.panel).slice(0,90)} vh=${m.vh}`);
    ok("BOTTOM-RIGHT: 'Delete project…' row is fully on-screen (the bug)", inView(m.del, m.vw, m.vh), `del.bottom=${m.del.bottom.toFixed(0)} vh=${m.vh}`);
  }
  await closeMenu();

  // 2. Top-left region: no flip needed — opens at the cursor.
  await openAt(30, 30);
  await page.waitForTimeout(200);
  m = await readMenu();
  ok("Menu opens near the top-left", !!m);
  if (m) {
    ok("TOP-LEFT: menu opens at the cursor and stays in view", inView(m.panel, m.vw, m.vh), `panel.top=${m.panel.top.toFixed(0)}`);
  }
  await closeMenu();

  // 3. Bottom edge, mid-width: vertical flip only.
  await openAt(vw / 2, vh - 4);
  await page.waitForTimeout(200);
  m = await readMenu();
  ok("Menu opens on a bottom-edge right-click", !!m);
  if (m) {
    ok("BOTTOM-EDGE: menu flips up so the last row is reachable", inView(m.del, m.vw, m.vh) && m.panel.bottom <= m.vh - M + 1, `panel.bottom=${m.panel.bottom.toFixed(0)} vh=${m.vh}`);
  }
  await closeMenu();
  m = await readMenu();
  ok("Escape closes the menu", m === null);

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nB915 — ${passed}/${results.length} checks passed`);
  await browser.close();
  process.exit(results.every((r) => r.pass) ? 0 : 1);
} catch (e) {
  console.log("ERROR", e && e.message);
  await browser.close();
  process.exit(2);
}
