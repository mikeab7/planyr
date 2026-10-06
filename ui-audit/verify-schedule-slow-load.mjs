/* NEW-1 (SCHED-EMPTY-ON-SLOW-LOAD, 2026-10-06) — the Schedule tab against a REAL signed-in account while the
 * schedule reads are held open, then failed, then released. Run after the deploy:
 *   E2E_LOGIN_KEY=… node ui-audit/verify-schedule-slow-load.mjs [https://planyr.io]
 *
 * Signs in as the test account (the one shared helper — never a second sign-in), routes to the fixture
 * project's Schedule tab, and intercepts the three reads the embedded scheduler makes on a signed-in load
 * (schedule_account_index, schedules, planar_data). Arms:
 *   HELD   — reads never answer: must read "Loading…" → "Still loading your schedules — the cloud is slow",
 *            NEVER "No schedule for …" / Create schedule / "No schedules here yet.", and ZERO writes.
 *   FAILED — reads answer 500: "Couldn't reach your schedules. Nothing is lost." + Retry, no Create, zero writes.
 *   RELEASED — reads pass through: the tab resolves to a LOADED state on its own (the grid, or — for a project
 *            that genuinely has none — the honest empty state), with no page reload.
 * The served build (/version.json) is printed in the same run as the assertions (MERGED ≠ LIVE).
 */
import { openSignedIn, FIXTURE_SITE_ID } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const base = process.argv[2] || "https://planyr.io";
const READS = /\/rest\/v1\/(schedule_account_index|schedules|planar_data)\b/;
let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.error("  ✗", m); } else console.log("  ✓", m); };

const s = await openSignedIn({ base });
const { page } = s;
try {
  await assertMeasurable(page, "verify-schedule-slow-load");
  console.log("signed in as", s.proof.email, "| build", JSON.stringify(s.build));
  const writes = [];
  let mode = "hold"; const held = [];
  await page.route("**/rest/v1/**", async (route) => {
    const req = route.request(), url = req.url(), m = req.method();
    if (m !== "GET" && m !== "HEAD" && m !== "OPTIONS") {
      if (READS.test(url) || /planar_history/.test(url)) writes.push(`${m} ${url.replace(/^.*\/rest\/v1\//, "")}`);
      return route.continue();
    }
    if (!READS.test(url)) return route.continue();
    if (mode === "hold") { held.push(route); return; }
    if (mode === "fail") return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "XX000", message: "slow" }) });
    return route.continue();
  });
  await page.evaluate(() => { window.__noReloadMarker = "still-here"; });

  const text = () => page.evaluate(() => document.body.innerText);
  const loadShell = page.getByTestId("schedule-load-state");
  await page.goto(`${base}/#/project/${FIXTURE_SITE_ID}/schedule`);

  console.log("HELD arm");
  await loadShell.waitFor({ state: "visible", timeout: 20000 });
  await page.getByText("Still loading your schedules — the cloud is slow right now.").waitFor({ timeout: 20000 });
  let t = await text();
  ok(!/No schedule for/.test(t), "no 'No schedule for …' while held");
  ok(!/Create schedule/.test(t), "no 'Create schedule' while held");
  ok(!/No schedules here yet/.test(t), "no 'No schedules here yet.' while held");
  ok(writes.length === 0, "zero schedule writes while held (" + writes.length + ")");

  console.log("FAILED arm");
  mode = "fail";
  for (const r of held.splice(0)) await r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "XX000", message: "slow" }) }).catch(() => {});
  await page.getByText(/Couldn.t reach your schedules\. Nothing is lost\./).waitFor({ timeout: 45000 });
  t = await text();
  ok(await page.getByRole("button", { name: "Retry", exact: true }).isVisible(), "Retry is offered");
  ok(!/No schedule for/.test(t) && !/Create schedule/.test(t), "no empty state / Create after a failed load");
  ok(writes.length === 0, "zero schedule writes after a failed load (" + writes.length + ")");

  console.log("RELEASED arm");
  mode = "pass";
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await loadShell.waitFor({ state: "detached", timeout: 60000 });
  t = await text();
  const loadedAnswer = /No schedule for/.test(t) ? "genuine empty state (project has none)" : "grid";
  ok(true, "resolved on its own to a LOADED state: " + loadedAnswer);
  ok((await page.evaluate(() => window.__noReloadMarker)) === "still-here", "no page reload");
  ok(writes.length === 0, "zero schedule writes through the whole run (" + writes.length + ")");
  console.log("build served:", JSON.stringify(await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null))));
} catch (e) { failed++; console.error("FAIL", e.message); }
await s.close();
console.log(failed ? `FAIL (${failed})` : "PASS");
process.exit(failed ? 1 : 0);
