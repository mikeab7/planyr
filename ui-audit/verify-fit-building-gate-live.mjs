/* verify-fit-building-gate-live — NEW-1 (2026-11-11, B2671230), the NEGATIVE half of V2115882, run signed in as the TEST account on the deployed site.
 * "Fit the biggest building" is owner-only (constraint #25, the grading layer). The test account has no admin row, so on planyr.io it must see: no
 * Grading panel, no "Fit the biggest building" button, and the lazy grading chunk that carries the search UI (GradingController / GradingPanels) must
 * never be requested while the planner runs. The served build is read from /version.json in the SAME page evaluation as the assertions.
 *   E2E_LOGIN_KEY=… node ui-audit/verify-fit-building-gate-live.mjs [https://planyr.io] [expectedBuildPrefix] */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.argv[2] || "https://planyr.io", WANT = process.argv[3] || "";
const fails = [], notes = [];
const check = (n, ok, x = "") => (ok ? notes : fails).push(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`);
const s = await openSignedIn({ base: BASE });
try {
  const page = s.page;
  const requested = [];
  page.on("request", (r) => { const u = r.url(); if (/GradingController|GradingPanels|terrainWorker/i.test(u)) requested.push(u.split("/").pop()); });
  await assertMeasurable(page, "verify-fit-building-gate-live");
  await page.goto(`${BASE}/?cb=${Date.now()}#/project/e2e-fixture/site`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="left-menu-panel"], [data-testid="site-planner"], svg', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(6000);
  const r = await page.evaluate(async () => {
    const build = await fetch("/version.json", { cache: "no-store" }).then((x) => x.json()).catch(() => null);
    const txt = document.body.innerText;
    return {
      build, fitText: /Fit the biggest building/.test(txt), fitButton: !!document.querySelector('[data-testid="grading-fit-building"], [data-section="fit-building"]'),
      gradingPanel: !!document.querySelector('[data-testid="grading-panel"], [data-testid="grading-metrics"]'),
      res: performance.getEntriesByType("resource").map((e) => e.name).filter((n) => /\.js(\?|$)/.test(n)),
    };
  });
  check("signed in as the test account (proof from the helper)", !!s.proof && s.proof.email === "e2e@planyr.test", JSON.stringify(s.proof && s.proof.email));
  check(`served build is ${WANT || "(any)"}`, !WANT || (r.build && String(r.build.build).startsWith(WANT)), JSON.stringify(r.build));
  check("the plan editor chunk was loaded (the planner really rendered — a known-good arm)", r.res.some((n) => /SitePlanner-/.test(n)), r.res.length + " scripts");
  check('no "Fit the biggest building" text anywhere on the page', !r.fitText);
  check("no Fit button / Fit row in the DOM", !r.fitButton);
  check("no Grading panel in the DOM for a non-owner", !r.gradingPanel);
  check("the lazy grading chunks and the terrain worker were NEVER requested while the planner ran", requested.length === 0 && !r.res.some((n) => /GradingController|GradingPanels/.test(n)), requested.join(", "));
  // the chunk that carries the search UI is deployed and served (so the owner's positive check can only fail for a reason other than a missing file)
  const plannerUrl = r.res.find((n) => /SitePlanner-/.test(n));
  if (plannerUrl) {
    const info = await page.evaluate(async (u) => {
      const t = await (await fetch(u)).text();
      const m = /GradingController-[A-Za-z0-9_-]+\.js/.exec(t);
      if (!m) return { name: null, planner: t.length };
      const res = await fetch(new URL(m[0], u).href);
      const body = await res.text();
      return { name: m[0], status: res.status, bytes: body.length, hasFit: /Fit the biggest|fit-building-failed/.test(body) || /fitBuildingJob/.test(body), inPlanner: /fit-building-failed|fitBuildingJob/.test(t) };
    }, plannerUrl);
    check("the plan editor names the grading controller chunk (it is wired)", !!info.name, JSON.stringify(info));
    check("the controller chunk is served (200) and carries the fit code", info.status === 200 && info.hasFit, `${info.bytes} bytes`);
    check("the plan editor chunk itself carries none of the search", info.inPlanner === false);
  }
  console.log(notes.join("\n")); if (fails.length) { console.log("\nFAILURES:\n" + fails.join("\n")); process.exitCode = 1; } else console.log(`\nverify-fit-building-gate-live: all ${notes.length} checks passed`);
} finally { await s.close(); }
