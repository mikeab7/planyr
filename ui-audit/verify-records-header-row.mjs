/* verify-records-header-row.mjs — B2450464: the Records tab header row (RECORDS label + "＋ Paste comps" /
 * "⤒ Import (KML/KMZ)" / "＋ Site plan") must fit the rail at every width the app allows.
 *
 *   node ui-audit/verify-records-header-row.mjs [base] [--shots dir]          Chromium at the rail's min / mid / max width
 *   node ui-audit/verify-records-header-row.mjs [base] --phone [--landscape]  WebKit, iPhone 15 (say "WebKit", never "Safari")
 *   node ui-audit/verify-records-header-row.mjs https://planyr.io --live      same, SIGNED IN as the test account against a deploy
 *
 * Default base is a local `npx vite --port 5199` (signed out is enough: the Records tab renders its header with
 * no comps). The rail is `clamp(232px, 23vw, 440px)` wide on the Records tab (MapFinder.jsx), so the viewport
 * widths below land on its minimum, a middle value and its maximum.
 *
 * WHAT COUNTS AS A FAIL: any of the four items (label + three buttons) sticking out past the rail's right edge,
 * the Records scroller or the header scrolling sideways, a button label cut off or broken over two lines, or — when
 * the items do not all share one line — the buttons not sitting left-aligned directly under the label.
 * KNOWN-GOOD ARM (expected independently of the code under test): at the rail's maximum width the label and all
 * three buttons share ONE row; if they do not, the run is void.
 */
import { chromium, webkit, devices } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const live = args.includes("--live");
const phone = args.includes("--phone");
const landscape = args.includes("--landscape");
const shotIx = args.indexOf("--shots");
const shotDir = shotIx >= 0 ? args[shotIx + 1] : null;
const base = (args.find((a) => /^https?:/.test(a)) || "http://localhost:5199").replace(/\/$/, "");
const checks = [];
const ok = (name, pass, detail = "") => { checks.push({ name, pass: !!pass }); console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
if (shotDir) mkdirSync(shotDir, { recursive: true });

// Rail width = clamp(232, 23vw, 440): 900 → 232 (minimum), 1280 → 294, 2200 → 440 (maximum).
const WIDTHS = phone ? [null] : [{ w: 900, label: "min" }, { w: 1280, label: "mid" }, { w: 2200, label: "max" }];

async function open() {
  if (live) return openSignedIn({ base, engine: phone ? "webkit" : "chromium", device: phone ? (landscape ? "iPhone 15 landscape" : "iPhone 15") : null });
  const exe = existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium";
  const browser = phone ? await webkit.launch() : await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const ctx = await browser.newContext(phone ? devices[landscape ? "iPhone 15 landscape" : "iPhone 15"] : { viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(base + "/#/site", { waitUntil: "domcontentloaded" });
  return { page, close: () => browser.close(), build: "local" };
}

// One reading of the header, taken from the page itself. Pure DOM geometry — no app state is trusted.
const measure = () => {
  const header = document.querySelector("[data-records-header]");
  if (!header) return null;
  const scroller = header.parentElement;
  const rail = scroller.getBoundingClientRect();
  const label = header.children[0];
  const items = [label, ...header.children[1].children];
  const names = ["RECORDS", ...[...header.children[1].children].map((b) => b.innerText.replace(/\s+/g, " ").trim())];
  const rows = [];
  const rects = items.map((el, i) => {
    const r = el.getBoundingClientRect();
    let row = rows.findIndex((y) => Math.abs(y - r.top) < r.height / 2);
    if (row < 0) { rows.push(r.top); row = rows.length - 1; }
    const oneLine = el.scrollWidth <= el.clientWidth + 1 && r.height < 2 * parseFloat(getComputedStyle(el).fontSize) * 1.9;
    return { name: names[i], left: r.left, right: r.right, top: r.top, row, oneLine };
  });
  const labelRect = rects[0];
  const buttonRects = rects.slice(1);
  const below = buttonRects.filter((r) => r.row !== labelRect.row);
  return {
    railLeft: rail.left, railRight: rail.right, railW: Math.round(rail.width),
    scrollOverflow: scroller.scrollWidth - scroller.clientWidth,
    headerOverflow: header.scrollWidth - header.clientWidth,
    sticksOut: rects.filter((r) => r.right > rail.right + 0.5 || r.left < rail.left - 0.5).map((r) => r.name),
    broken: rects.filter((r) => !r.oneLine).map((r) => r.name),
    rowCount: rows.length,
    allOneRow: rows.length === 1,
    // when wrapped: the buttons that dropped below must start at the label's own left edge (clean, under the label)
    underLabelLeft: below.length ? Math.min(...below.map((r) => r.left)) - labelRect.left : 0,
  };
};

const s = await open();
const { page } = s;
let exit = 0;
try {
  await assertMeasurable(page, "verify-records-header-row");
  console.log("BUILD", s.build, live ? "(signed in, live)" : `(local ${base}, signed out)`, phone ? `WebKit iPhone 15 ${landscape ? "landscape" : "portrait"}` : "Chromium");
  for (const v of WIDTHS) {
    if (v) await page.setViewportSize({ width: v.w, height: 900 });
    await page.waitForTimeout(400);
    await page.getByRole("tab", { name: "Records" }).first().click({ timeout: 30000 }).catch(() => {});
    await page.locator("[data-records-header]").waitFor({ timeout: 30000, state: "attached" }).catch(() => {});
    await page.waitForTimeout(500);
    const m = await page.evaluate(measure);
    const tag = v ? `${v.label} (${v.w}px viewport)` : (landscape ? "iPhone landscape" : "iPhone portrait");
    if (!m) { ok(`${tag}: Records header found`, false, "no [data-records-header] — precondition failed, run void"); exit = 1; continue; }
    console.log(`  ${tag}: rail ${m.railW}px, ${m.rowCount} row(s)`);
    ok(`${tag}: no item sticks out past the rail`, m.sticksOut.length === 0, m.sticksOut.join(", "));
    ok(`${tag}: the Records scroller does not scroll sideways`, m.scrollOverflow <= 0, `overflow ${m.scrollOverflow}px`);
    ok(`${tag}: the header row does not overflow`, m.headerOverflow <= 0, `overflow ${m.headerOverflow}px`);
    ok(`${tag}: every label is whole on one line`, m.broken.length === 0, m.broken.join(", "));
    ok(`${tag}: if wrapped, the buttons sit directly under the label (left-aligned)`, m.allOneRow || Math.abs(m.underLabelLeft) <= 1, `offset ${m.underLabelLeft}px`);
    if (v?.label === "max") ok("KNOWN-GOOD: at the maximum rail the label and all three buttons share ONE row", m.allOneRow, `${m.rowCount} rows`);
    if (shotDir) await page.locator("[data-records-header]").locator("xpath=..").screenshot({ path: join(shotDir, `${live ? "live-" : ""}${phone ? (landscape ? "phone-landscape" : "phone-portrait") : v.label}.png`) });
  }
} catch (e) { console.log("ERROR", e.message); exit = 1; }
finally { await s.close(); }
const failed = checks.filter((c) => !c.pass).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(exit || (failed ? 1 : 0));
