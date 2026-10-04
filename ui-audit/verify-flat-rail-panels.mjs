/* verify-flat-rail-panels — the FLAT left-rail panel contract (owner NEW-1, "Option A: flat panel").
 *
 * Every panel that opens from the Site module's left rail (Land, Analysis, Drainage, Yield,
 * Properties, Overlays, Standards) must be ONE flat surface: one header row carrying the section
 * icon, title, a one-line site · plan subtitle, any section-level action and the ×; no empty strip
 * above it; no second bordered/rounded card inside it; and no status chip parked in a left gutter.
 *
 * It drives the REAL built app on a real owner-plan fixture (Silvestri, Concept D) at a phone width
 * AND a desktop width, and asserts per tab:
 *   1. HEADER      — the header row has visible title text (no empty × strip) and there is exactly one
 *                    close control, sitting inside that first row.
 *   2. NO CARD     — no descendant of the panel body is a full-width bordered + rounded container
 *                    (form controls, dashed drop zones and list rows that are not wrappers are exempt).
 *   3. NO GUTTER   — no "…" status chip in the left gutter; Drainage status rows read label-LEFT,
 *                    value-RIGHT.
 *
 * KNOWN-GOOD ARM (DRIVER-SCROLL §6): the DEFAULT BEFORE build (BASE_URL of a pre-change build) is
 * expected to FAIL, and `--expect-red` inverts the exit code so the instrument proves it can see the
 * defect. A run where NO tab produced a measurement is VOID and says so instead of printing a score.
 *
 * Run:  node ui-audit/verify-flat-rail-panels.mjs                (preview on :4173)
 *       BASE_URL=http://localhost:4174/ node ui-audit/verify-flat-rail-panels.mjs --expect-red --tag=before
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { fixtureSeed } from "./lib/planFixture.mjs";
import { readFixture } from "./lib/fixtureSeeding.mjs";

const { chromium } = pw;
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const EXPECT_RED = process.argv.includes("--expect-red");
const TAG = (process.argv.find((a) => a.startsWith("--tag=")) || "--tag=after").slice(6);
const TABS = ["parcel", "analysis", "drainage", "yield", "properties", "references", "standards"];
const VIEWPORTS = [{ name: "phone", width: 390, height: 844 }, { name: "desktop", width: 1440, height: 900 }];

const seed = fixtureSeed(readFixture("sylvestri"), { id: "verify-flat-rail", name: "Concept D", site: "Silvestri" });
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

/* Runs in the page. Returns the measured facts about the currently open left panel. */
const measure = () => {
  const panel = document.querySelector('[data-testid="left-menu-panel"]');
  if (!panel) return { open: false };
  const pr = panel.getBoundingClientRect();
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  // The header row = the element carrying the panel's × (PanelChrome, or Properties' own header).
  const closes = [...panel.querySelectorAll('button')].filter((b) => vis(b) && /^close\b/i.test(b.getAttribute("aria-label") || "") && !/^close (layers|banner)/i.test(b.getAttribute("aria-label") || ""));
  const close = closes[0] || null;
  let header = null;
  if (close) { header = close.parentElement.closest('[data-testid^="panel-chrome-"]') || close.parentElement; }
  const headerText = header ? header.innerText.replace(/[✕×]/g, "").trim() : "";
  const hr = header ? header.getBoundingClientRect() : null;
  const closeInHeader = !!(close && header && header.contains(close));
  const hitsOf = (el) => { if (!el) return true; const r = el.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!h && (el === h || el.contains(h)); };
  const closeReachable = hitsOf(close);
  const actionsReachable = [...panel.querySelectorAll('[data-panel-actions] button, [data-verdict-row] button')].every(hitsOf);
  const closeTopOffset = close && hr ? Math.round(close.getBoundingClientRect().top - pr.top) : null;
  // body = everything in the panel below the header row
  const isControl = (el) => /^(BUTTON|INPUT|SELECT|TEXTAREA|LABEL|A|SUMMARY)$/.test(el.tagName) || el.closest("button,select,textarea");
  const px = (v) => parseFloat(v) || 0;
  const cards = [];
  for (const el of panel.querySelectorAll("*")) {
    if (header && header.contains(el)) continue;
    if (isControl(el) || el.closest("svg")) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width < pr.width * 0.6 || r.height < 24) continue;
    const sides = ["Top", "Right", "Bottom", "Left"].filter((s) => px(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] === "solid" && !/rgba?\(\s*0,\s*0,\s*0,\s*0\)|transparent/.test(cs[`border${s}Color`]));
    const radius = px(cs.borderTopLeftRadius);
    if (sides.length >= 3 && radius >= 6) cards.push({ tag: el.tagName, testid: el.getAttribute("data-testid"), w: Math.round(r.width), h: Math.round(r.height), text: (el.innerText || "").slice(0, 40).replace(/\s+/g, " ") });
  }
  // left-gutter "…" chips: a tiny element whose whole text is "…" sitting in the left third of the panel
  const gutterChips = [...panel.querySelectorAll("span,div")].filter((el) => el.children.length === 0 && (el.textContent || "").trim() === "…" && vis(el) && el.getBoundingClientRect().left - pr.left < pr.width * 0.34 && el.getBoundingClientRect().width < 60).length;
  const rows = [...panel.querySelectorAll("[data-verdict-row]")].map((row) => {
    const l = row.querySelector("[data-verdict-label]"), v = row.querySelector("[data-verdict-value]");
    return { key: row.getAttribute("data-verdict-row"), labelLeftOfValue: !!(l && v && l.getBoundingClientRect().left < v.getBoundingClientRect().left), valueRight: !!(v && v.getBoundingClientRect().right > pr.left + pr.width * 0.6), text: row.innerText.replace(/\s+/g, " ").slice(0, 80) };
  });
  const overflowX = panel.scrollWidth - panel.clientWidth;
  return { open: true, headerText, headerHeight: hr ? Math.round(hr.height) : null, closeCount: closes.length, closeInHeader, closeReachable, actionsReachable, closeTopOffset, cards, gutterChips, rows, subtitle: header?.querySelector("[data-panel-subtitle]")?.textContent || null, hasIcon: !!header?.querySelector("[data-panel-icon]"), overflowX, panelW: Math.round(pr.width) };
};

let fail = 0, measured = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, ignoreHTTPSErrors: true, deviceScaleFactor: vp.name === "phone" ? 2 : 1 });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-flat-rail-panels");
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}#/project/verify-flat-rail/site`, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  for (const tab of TABS) {
    // close whatever is open, then press the rail tab through the page (the phone rail is a drawer)
    await page.evaluate(() => { document.querySelectorAll('[data-testid^="panel-chrome-"] [aria-label="Close panel"], [aria-label="Close properties"]').forEach((b) => b.click()); });
    await page.waitForTimeout(150);
    await page.evaluate((id) => document.querySelector(`[data-rail-tab="${id}"]`)?.click(), tab);
    await page.waitForTimeout(900);
    const m = await page.evaluate(measure);
    const label = `${vp.name} · ${tab}`;
    if (!m.open) { log(false, `${label}: panel did not open`); continue; }
    measured++;
    await page.screenshot({ path: `${OUT}flat-rail-${TAG}-${vp.name}-${tab}.png` });
    log(m.headerText.length > 0, `${label}: header row has visible text ("${m.headerText.replace(/\s+/g, " ").slice(0, 60)}")`);
    log(m.closeCount === 1 && m.closeInHeader, `${label}: exactly one close control, inside the header row (found ${m.closeCount})`);
    log(m.closeReachable && m.actionsReachable, `${label}: the × and every header/row action is the topmost element at its centre (not covered by other chrome)`);
    log(m.cards.length === 0, `${label}: no nested bordered card${m.cards.length ? " — " + JSON.stringify(m.cards.slice(0, 3)) : ""}`);
    log(m.gutterChips === 0, `${label}: no left-gutter "…" chips (${m.gutterChips})`);
    log(m.overflowX <= 1, `${label}: no horizontal overflow (${m.overflowX})`);
    if (tab === "drainage") {
      log(m.rows.length > 0, `${label}: verdict rows present (${m.rows.length})`);
      for (const r of m.rows) log(r.labelLeftOfValue && r.valueRight, `${label}: "${r.key}" row reads label-left / value-right → ${r.text}`);
      log(m.hasIcon && !!m.subtitle, `${label}: header carries icon + subtitle ("${m.subtitle}")`);
    }
  }
  if (errors.length) log(false, `${vp.name}: page errors: ${errors.slice(0, 2).join(" | ")}`);
  await ctx.close();
}
await browser.close();

if (measured === 0) { console.log("VOID — no panel was measured; nothing to report."); process.exit(2); }
console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${fail} failing check(s) across ${measured} panel renders (${TAG})`);
if (EXPECT_RED) { console.log(fail > 0 ? "expected-red arm: instrument sees the defect ✓" : "expected-red arm FAILED TO GO RED — the instrument cannot see this defect"); process.exit(fail > 0 ? 0 : 1); }
process.exit(fail === 0 ? 0 : 1);
