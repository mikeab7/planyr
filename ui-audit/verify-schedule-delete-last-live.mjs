/* B2429233 / V1873392 — deleting the LAST schedule works on a real deploy, signed in as the test account.
 *   E2E_LOGIN_KEY=… node ui-audit/verify-schedule-delete-last-live.mjs https://planyr.io <expected-build-sha>
 * Reads /version.json in the SAME call as the assertion and refuses to score a build that is not the
 * expected one. Only ever deletes schedules named "Project <n>" on the throwaway test account (the
 * leftover from B2429232's check, then one it creates itself) — it ABORTS if any other schedule is
 * listed, so a real project can never be touched. Known-good arm: the account is proven signed in. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const base = process.argv[2] || "https://planyr.io";
const want = process.argv[3] || "";
const THROWAWAY = /^Project \d+$/;
const out = []; let bad = 0;
const check = (name, ok, extra = "") => { out.push(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); if (!ok) bad++; };

const s = await openSignedIn({ base });
const { page } = s;
try {
  await assertMeasurable(page, "verify-schedule-delete-last-live");
  const build = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()));
  const sha = String(build.build || "");
  console.log("build:", JSON.stringify(build));
  if (want && !sha.startsWith(want.slice(0, 7))) throw new Error(`served build ${sha} is not the expected ${want} — void, not scored`);
  check("signed in as the test account (known-good arm)", s.proof.email === "e2e@planyr.test", s.proof.email);

  const rowsLoc = () => page.locator('[data-testid="schedule-owner-row"]:visible');
  // The test account's fixture project: its "no schedule here" panel lists every schedule (org-owned
  // ones included) with the per-row menu, which is the surface the delete is driven from.
  const ROUTE = `${base}/#/project/e2e-fixture-site/schedule`;
  const openList = async () => {
    await page.goto(ROUTE, { waitUntil: "domcontentloaded" });
    // "loaded" must be PROVEN (known-good): the embedded app has reported its list — either rows are
    // listed, or its own "No schedules yet" state is up. An empty read taken before that is void.
    await page.waitForFunction(() => {
      if (document.querySelector('[data-testid="schedule-crumb"]') || document.querySelectorAll('[data-testid="schedule-owner-row"]').length) return true;
      const f = document.querySelector("iframe");
      try { return !!(f && f.contentDocument && f.contentDocument.querySelector("[data-schedule-empty]")); } catch { return false; }
    }, null, { timeout: 60000 });
    await page.waitForTimeout(2500);
    const crumb = page.locator('[data-testid="schedule-crumb"]:visible');
    if (!(await rowsLoc().count()) && await crumb.count()) { await crumb.first().click(); await page.waitForTimeout(800); }
  };
  const names = async () => (await rowsLoc().allInnerTexts()).map((t) => t.split("\n")[0].trim());

  await openList();
  const before = await names();
  console.log("schedules listed before:", JSON.stringify(before));
  const foreign = before.filter((n) => !THROWAWAY.test(n));
  if (foreign.length) throw new Error("ABORT — a non-throwaway schedule is listed, nothing deleted: " + JSON.stringify(foreign));

  // Delete every throwaway row, last one included.
  for (let guard = 0; guard < 6 && (await rowsLoc().count()) > 0; guard++) {
    const n = await rowsLoc().count();
    const label = (await names())[0];
    await rowsLoc().first().locator('[data-testid="schedule-owner-kebab"]').click();
    await page.locator('[data-testid="schedule-owner-delete"]:visible').click();
    await page.locator('[data-testid="schedule-owner-delete-confirm"]:visible').click();
    await page.waitForTimeout(1500);
    let gone = false;
    try { await page.waitForFunction((c) => document.querySelectorAll('[data-testid="schedule-owner-row"]').length < c, n, { timeout: 8000 }); gone = true; } catch {}
    const crumbOpen = await rowsLoc().count();
    check(`delete "${label}" (list had ${n}) — the row is gone`, gone || crumbOpen < n, `rows now ${crumbOpen}`);
    if (!(await rowsLoc().count())) break;
  }
  check("no failure notice shown for a delete that worked", (await page.locator('[data-testid="schedule-delete-failed"]').count()) === 0);

  // Reload: the cloud soft-delete must have taken (a refused one would bring the row back).
  await openList();
  const after = await names();
  check("after reload the account has no schedules", after.length === 0, JSON.stringify(after));
  await page.screenshot({ path: "/tmp/delete-last-live.png" });
} catch (e) { out.push("FAIL " + e.message); bad++; }
finally { console.log(out.join("\n")); await s.close(); process.exit(bad ? 1 : 0); }
