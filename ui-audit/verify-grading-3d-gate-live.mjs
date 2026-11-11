/* verify-grading-3d-gate-live — NEW-1 (2026-11-11), the NEGATIVE half of V2115879, run signed in as the TEST account on the deployed site.
 * The 3D grading viewer is owner-only (constraint #25). The test account has no admin row, so on planyr.io it must see: no Grading panel,
 * no "View in 3D", and the viewer's lazy chunk (the only code that carries three.js) must never be requested. Also proves the chunk IS
 * deployed and served (the owner's positive check can only fail for a reason other than a missing file). The served build is read from
 * /version.json in the SAME page evaluation as the assertions.
 *   E2E_LOGIN_KEY=… node ui-audit/verify-grading-3d-gate-live.mjs [https://planyr.io] [expectedBuildPrefix] */
import { openSignedIn, FIXTURE_SITE_ID } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.argv[2] || "https://planyr.io", WANT = process.argv[3] || "";
const fails = [], notes = [];
const check = (n, ok, x = "") => (ok ? notes : fails).push(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`);
const s = await openSignedIn({ base: BASE });
try {
  const page = s.page;
  const requested = [];
  page.on("request", (r) => { const u = r.url(); if (/Grading3DViewer|\/three[-.]/i.test(u)) requested.push(u); });
  await assertMeasurable(page, "verify-grading-3d-gate-live");
  await page.goto(`${BASE}/?cb=${Date.now()}#/project/e2e-fixture/site`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="left-menu-panel"], [data-testid="site-planner"], svg', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(6000);
  const r = await page.evaluate(async () => {
    const build = await fetch("/version.json", { cache: "no-store" }).then((x) => x.json()).catch(() => null);
    const txt = document.body.innerText;
    return { build, viewIn3d: /View in 3D/.test(txt), gradingPanel: !!document.querySelector('[data-testid="grading-panel"], [data-testid="grading-metrics"]'), railGrading: [...document.querySelectorAll("button")].some((b) => /^\s*Grading\s*$/.test(b.textContent || "")), email: window.pfSupabase && window.pfSupabase.auth ? "has-client" : "no-client", res: performance.getEntriesByType("resource").map((e) => e.name).filter((n) => /\/assets\/(SitePlanner|SitePlannerApp)-/.test(n)) };
  });
  check("signed in as the test account (proof from the helper)", !!s.proof && s.proof.email === "e2e@planyr.test", JSON.stringify(s.proof && s.proof.email));
  check(`served build is ${WANT || "(any)"}`, !WANT || (r.build && String(r.build.build).startsWith(WANT)), JSON.stringify(r.build));
  check("the plan editor chunk was loaded (the planner really rendered — a known-good arm)", r.res.some((n) => /SitePlanner-/.test(n)), r.res.map((n) => n.split("/").pop()).join(", "));
  check("no \"View in 3D\" anywhere on the page", !r.viewIn3d);
  check("no Grading panel in the DOM for a non-owner", !r.gradingPanel);
  check("the viewer chunk / three.js was NEVER requested while the planner ran", requested.length === 0, requested.join(", "));
  // the chunk is deployed and served: find its name from the served plan-editor chunk
  const plannerUrl = r.res.find((n) => /SitePlanner-/.test(n));
  if (plannerUrl) {
    const info = await page.evaluate(async (u) => {
      const t = await (await fetch(u)).text();
      const m = /Grading3DViewer-[A-Za-z0-9_-]+\.js/.exec(t);
      if (!m) return { name: null };
      const res = await fetch(new URL(m[0], u).href);
      const body = await res.text();
      return { name: m[0], status: res.status, bytes: body.length, hasThree: /WebGLRenderer/.test(body) && /PerspectiveCamera/.test(body), inPlanner: /WebGLRenderer/.test(t) };
    }, plannerUrl);
    check("the plan editor names the viewer's chunk (it is wired)", !!info.name, JSON.stringify(info));
    check("the chunk is served (200) and is the one that carries three.js", info.status === 200 && info.hasThree, `${info.bytes} bytes`);
    check("the plan editor chunk itself carries no three.js", info.inPlanner === false);
  }
  console.log(notes.join("\n")); if (fails.length) { console.log("\nFAILURES:\n" + fails.join("\n")); process.exitCode = 1; } else console.log(`\nverify-grading-3d-gate-live: all ${notes.length} checks passed`);
} finally { await s.close(); }
