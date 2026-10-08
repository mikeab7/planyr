/* B2175312 / V1588832 — signed in as the test account on a real deploy: every docked left-rail panel sits on the
 * --surface-overlay token, light and dark. Reads /version.json in the SAME call as the assertions.
 * Run: node ui-audit/verify-left-panel-surface-live.mjs [https://planyr.io] [expectedBuildPrefix] */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const base = process.argv[2] || "https://planyr.io";
const want = process.argv[3] || "";
let failed = 0;
const check = (n, ok, d = "") => { console.log(`${ok ? "✅" : "❌"} ${n}${d ? "  — " + d : ""}`); if (!ok) failed++; };
const TABS = ["parcel", "analysis", "drainage", "yield", "properties", "references", "standards"];
for (const theme of ["light", "dark"]) {
  const s = await openSignedIn({ base, initScripts: [[(t) => { try { localStorage.setItem("planyr.theme", t); } catch (e) {} }, theme]] });
  const { page } = s;
  await assertMeasurable(page, "verify-left-panel-surface-live");
  const build = await page.evaluate(async () => (await (await fetch("/version.json", { cache: "no-store" })).json()).build);
  check(`[${theme}] served build ${build}${want ? ` matches ${want}` : ""}`, !want || build.startsWith(want.slice(0, 7)));
  await page.goto(`${base}/#/project/e2e-fixture/site`, { waitUntil: "load" });
  await page.waitForTimeout(4000);
  const tok = await page.evaluate(() => { const d = document.createElement("div"); d.style.background = "var(--surface-overlay)"; document.body.appendChild(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c; });
  for (const id of TABS) {
    const btn = page.locator(`[data-rail-tab="${id}"]`).first();
    if (!(await btn.count())) { check(`[${theme}] ${id} tab exists`, false); continue; }
    await btn.click(); await page.waitForTimeout(700);
    const host = await page.evaluate(() => { const h = document.querySelector('[data-testid="left-menu-panel"]'); return h && getComputedStyle(h).backgroundColor; });
    check(`[${theme}] ${id}: panel surface is the overlay token`, host === tok, `${host} vs ${tok}`);
  }
  await s.close();
}
console.log(failed ? `\n${failed} FAILED` : "\nall passed"); process.exit(failed ? 1 : 0);
