/* verify-univer-theme-live — is the Univer grid READABLE in both themes on a REAL deploy? (B2566048, NEW-2)
 * Signed in as the throwaway test account on a THROWAWAY project (nothing of the owner's is read or written; everything made is
 * deleted and the database is asked again to prove it). Same pixel measurements as the sandbox run
 * (ui-audit/lib/univerThemeContrast.mjs), taken on the real app after the deploy, with the served build read in the SAME call.
 *
 * is_admin is answered `true` by a network intercept for THIS browser only (the switch is a visibility gate, not a security
 * boundary); the choice of theme goes through the app's own storage key (`planyr.theme`, read by ThemeProvider at load), and
 * the two flip-while-open scenarios set the same `data-theme` attribute ThemeProvider writes.
 * KNOWN-GOOD ARM: the bottom sheet tab must read on a fresh mount, or the run is VOID.
 * Run: E2E_LOGIN_KEY=… node ui-audit/verify-univer-theme-live.mjs [base=https://planyr.io] [--json out.json] */
import { writeFileSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { LIVE_PREFIX, seedThrowawayPlan, cleanupLive } from "./lib/liveFixtures.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { scenario, setTheme } from "./lib/univerThemeContrast.mjs";

const args = process.argv.slice(2);
const BASE = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const JSON_OUT = (() => { const i = args.indexOf("--json"); return i >= 0 ? args[i + 1] : null; })();
const PROJECT = `${LIVE_PREFIX}univer-theme-${Date.now().toString(36)}`;
const SWITCH_KEY = "planyr:model:univerGrid", THEME_KEY = "planyr.theme";
let failures = 0, voided = false;
const all = [];

const s = await openSignedIn({ base: BASE });
const { page } = s;
try {
  await assertMeasurable(page, "verify-univer-theme-live");
  const build = (await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()))).build;
  console.log(`served build: ${build}  account: ${s.proof.email}  base: ${BASE}`);
  await seedThrowawayPlan(page, PROJECT);
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  let hits = 0;
  await page.route("**/rest/v1/rpc/is_admin*", (route) => { hits++; route.fulfill({ status: 200, contentType: "application/json", body: "true" }); });
  const url = () => `${BASE}/?cb=${Date.now()}#/project/${PROJECT}/spreadsheet`;
  const mount = async (theme) => {
    await page.evaluate(([k, v, sk]) => { localStorage.setItem(k, v); localStorage.setItem(sk, "1"); }, [THEME_KEY, theme, SWITCH_KEY]);
    await page.goto(url(), { waitUntil: "load" });
    await page.waitForSelector('[data-testid="univer-grid"] canvas', { timeout: 120000 });
    await page.waitForFunction(() => { const a = window.__planyrUniverRead && window.__planyrUniverRead.api(); return !!(a && a.getActiveWorkbook() && a.getActiveWorkbook().getActiveSheet()); }, null, { timeout: 90000, polling: 250 });
    await page.waitForTimeout(1800);
  };
  const plans = [
    { name: "mounted in light", start: "light", then: [] },
    { name: "mounted in dark", start: "dark", then: [] },
    { name: "light → dark while open", start: "light", then: ["dark"] },
    { name: "dark → light while open", start: "dark", then: ["light"] },
  ];
  for (const plan of plans) {
    await mount(plan.start);
    const dataTheme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    if (dataTheme !== plan.start) { voided = true; throw new Error(`VOID — asked for ${plan.start}, the app is in ${dataTheme}`); }
    for (const t of plan.then) await setTheme(page, t);
    all.push(await scenario(page, plan.name, plan.then));
  }
  if (!hits) { voided = true; throw new Error("VOID — the is_admin intercept never fired"); }

  for (const sc of all) {
    console.log(`\n── ${sc.name}  [data-theme=${sc.colours.theme} univer-dark=${sc.colours.univerDark}]  icon ${sc.colours.toolbarIconColor} on ${sc.colours.toolbarBg} · strip ${sc.colours.stripBg}`);
    for (const r of sc.results) { console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.label}  — ${r.detail}`); if (!r.ok) { if (r.id === "known-good-arm") voided = true; else failures++; } }
  }
} catch (e) { console.log(String(e.message).split("\n")[0]); if (!voided) failures++; }
try {
  await page.evaluate(([k, sk]) => { localStorage.removeItem(k); localStorage.removeItem(sk); }, [THEME_KEY, SWITCH_KEY]).catch(() => {});
  const out = await page.evaluate(async (id) => { const c = window.pfSupabase; await c.from("model_sheets").delete().eq("id", id); return ((await c.from("model_sheets").select("id").eq("id", id)).data || []).length; }, PROJECT);
  const gone = await cleanupLive(page, { planId: PROJECT }).catch((e) => ({ errors: [String(e)] }));
  const clean = out === 0 && !(gone.errors || []).length && gone.left?.site === 0;
  console.log(`\n${clean ? "PASS" : "FAIL"} — cleanup: the throwaway workbook row and plan are gone (re-read from the database)  ::  model_sheets rows left ${out}; ${JSON.stringify(gone).slice(0, 160)}`);
  if (!clean) failures++;
} catch (e) { console.log("FAIL — cleanup", String(e.message).split("\n")[0]); failures++; }
await s.close();
console.log(`\n${voided ? "VOID" : failures ? "FAILED" : "PASSED"} — ${failures} failure(s)`);
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ at: new Date().toISOString(), base: BASE, failures, voided, all }, null, 2));
process.exit(voided ? 2 : failures ? 1 : 0);
