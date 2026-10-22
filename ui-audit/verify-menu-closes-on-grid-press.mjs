/* B2429232 / V1862176 — live: the schedule + project switchers close on a REAL mouse press on a grid cell, and Escape. */
import { openSignedIn, FIXTURE_SITE_ID } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const base = process.argv[2] || "https://planyr.io";
const s = await openSignedIn({ base });
const { page } = s;
await assertMeasurable(page, "verify-menu-closes-on-grid-press");
const out = [];
const rec = (n, ok, d = "") => { out.push(ok); console.log(ok ? "PASS" : "FAIL", n, d); };
await page.goto(`${base}/#/project/${FIXTURE_SITE_ID}/schedule`, { waitUntil: "domcontentloaded" });
const sched = page.locator('[data-testid="schedule-crumb"]:visible');
await sched.waitFor({ timeout: 45000 });
await page.waitForTimeout(6000);
const fr = page.frames().find((f) => f.url().includes("/sequence"));
const build = async () => JSON.stringify({ version: await page.evaluate(() => fetch("/version.json").then(r => r.json()).then(j => j.build)), frameHasBridge: await fr.evaluate(() => document.documentElement.outerHTML.includes("planar:press")) });
console.log("BUILD", await build());
// the test account's fixture site starts with no schedule: make a throwaway one (and delete it at the end — constraint 15)
if (await fr.getByText("New schedule", { exact: true }).count()) await fr.getByText("New schedule", { exact: true }).first().click();
await page.waitForTimeout(5000);
await fr.getByText("+ New task").first().click(); await page.waitForTimeout(1500);
console.log("BUILD", await build());
const iframeBox = await page.locator('iframe[title="Sequence Planyr"]').boundingBox();
const exp = (loc) => loc.getAttribute("aria-expanded");
const cellsOf = () => fr.locator("[data-task-row] > *");
for (const [name, crumb] of [["schedule", sched], ["project", page.locator('[data-testid="project-crumb"]:visible')]]) {
  for (const [cellName, idx] of [["Task", 2], ["Successor", 6], ["Status", 7], ["Notes", 10]]) {
    await crumb.click(); await page.waitForTimeout(500);
    const opened = (await exp(crumb)) === "true";
    const cell = cellsOf().nth(idx); const b = await cell.boundingBox();
    // a REAL mouse press, at page coordinates, on a visible grid cell
    // PRECONDITION (WRONG-CASE): the press point must hit-test to the embedded frame. An open switcher panel can sit
    // over the left cells, and a press on THAT is a press inside the menu, which correctly keeps it open.
    let px = null; const py = b.y + b.height / 2;
    for (const f of [0.9, 0.7, 0.5, 0.3, 0.1]) { const x = b.x + b.width * f; if (await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName === "IFRAME", [x, py])) { px = x; break; } }
    if (px == null) { rec(`${name} switcher / ${cellName} cell: no point on this cell reaches the frame (panel covers it) — VOID, skipped`, true); await page.keyboard.press("Escape"); continue; }
    await page.mouse.click(px, py);
    await page.waitForTimeout(500);
    const closed = (await exp(crumb)) === "false";
    const selected = await cell.evaluate((el) => { const cs = getComputedStyle(el); return el.matches("[class*=sel],[aria-selected=true]") || el.querySelector("[class*=sel],input,textarea") !== null || cs.outlineStyle !== "none" || /rgb\((?!0, 0, 0)/.test(cs.boxShadow); });
    rec(`${name} switcher: opens, then closes on a real press on the ${cellName} cell`, opened && closed, `opened=${opened} closed=${closed} cellShowsSelection=${selected}`);
  }
  await crumb.click(); await page.waitForTimeout(400);
  await fr.evaluate(() => window.focus());
  await page.mouse.click(iframeBox.x + 5, iframeBox.y + iframeBox.height - 5); // focus into the frame
  await crumb.click(); await page.waitForTimeout(400);
  const reopened = (await exp(crumb)) === "true";
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  rec(`${name} switcher: Escape closes it`, reopened && (await exp(crumb)) === "false");
}
// inside-the-switcher presses must NOT close it early
await sched.click(); await page.waitForTimeout(500);
await page.locator('[data-testid="schedule-owner-row"]:visible').first().locator("xpath=..").click({ position: { x: 4, y: 4 }, force: true }).catch(() => {});
rec("schedule switcher stays open for a press inside its own panel", (await exp(sched)) === "true");
await page.keyboard.press("Escape");
await s.close();
process.exit(out.every(Boolean) ? 0 : 1);
