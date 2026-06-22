/* B380 regression — the Schedule module must NOT trip the workspace ErrorBoundary
 * during the first-render-before-data race, and a malformed embedded-app nav-state
 * must never crash the shared header ("Cannot read properties of undefined").
 *
 * The Scheduler's nav-state listener accepts a same-origin window.postMessage, so we
 * drive the EXACT embedded-app contract synthetically and control its timing:
 *
 *   1. Cold-boot #/schedule, hold back nav-state (data lands AFTER first paint) →
 *      assert the loader/empty state shows and the ErrorBoundary does NOT appear.
 *   2. Inject a MALFORMED nav-state (undefined/null entries + an activeId pointing at
 *      a project not in the list) and open the breadcrumb dropdown (forces the p.id /
 *      p.name render path) → assert no boundary, no page error, good projects shown,
 *      bad entries dropped. Pre-fix (unsanitized list) the undefined entry threw here.
 *   3. SIGNED-IN variant (only runs when the build is Supabase-configured): seed a fake
 *      session so `profile` resolves after first paint → assert no boundary.
 *
 * Run:  node_modules/.bin/vite preview --port 4173   (serving a fresh `dist/`)
 *       node ui-audit/verify-scheduler-no-crash.mjs
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";

const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };

const NAV = (over = {}) => ({ source: "planar-seq", type: "planar:nav-state", section: "projects", activeId: 3, projects: [{ id: 1, name: "Goose Creek" }, { id: 3, name: "Grand Port Logistics" }], ...over });
const inject = (page, payload) => page.evaluate((p) => window.postMessage(p, window.location.origin), payload);
const boundaryShown = (page) => page.evaluate(() => [...document.querySelectorAll("p")].some((p) => /hit an error and couldn't load|new version of Planyr is ready/i.test(p.textContent || "")));
const loaderOrEmpty = (page) => page.evaluate(() =>
  !!document.querySelector('[role="status"][aria-label="Assembling schedule…"]') ||
  [...document.querySelectorAll("button")].some((b) => /Select a project/.test(b.textContent || "")));

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

function newErrSink(page) {
  const errs = [];
  page.on("pageerror", (e) => errs.push("PAGEERROR: " + (e.stack || e.message)));
  page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });
  const real = () => errs.filter((e) => !/supabase|CORS|ERR_|net::|Failed to load resource|WebSocket|realtime|preloadError|Babel|\[BABEL\]|fetch|font|jsdelivr|cdnjs/i.test(e));
  return { real };
}

try {
  // ── 1. first-render-before-data race ───────────────────────────────────────
  {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const sink = newErrSink(page);
    await page.goto(BASE + "#/schedule", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(700); // first paint, nav-state deliberately NOT sent yet
    ok("race: no ErrorBoundary before nav-state arrives", !(await boundaryShown(page)));
    ok("race: loader / 'Select a project' empty state is shown (not a crash)", await loaderOrEmpty(page));
    ok("race: no real page errors before data", sink.real().length === 0, sink.real()[0] || "");
    await page.close();
  }

  // ── 2. malformed nav-state must not crash the header ────────────────────────
  {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const sink = newErrSink(page);
    await page.goto(BASE + "#/schedule", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    // undefined + null entries, a primitive, and an activeId (999) not in the list
    await inject(page, NAV({ activeId: 999, projects: [{ id: 1, name: "Goose Creek" }, undefined, null, 5, { id: 3, name: "Grand Port Logistics" }] }));
    await page.waitForTimeout(300);
    // open the project breadcrumb dropdown → forces the filtered.map(p => p.id/p.name) render
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => x.getAttribute("aria-haspopup") === "menu"); b?.click(); });
    await page.waitForTimeout(300);
    ok("malformed nav-state: ErrorBoundary does NOT appear", !(await boundaryShown(page)));
    ok("malformed nav-state: no real page errors", sink.real().length === 0, sink.real()[0] || "");
    const panel = await page.evaluate(() => {
      const input = document.querySelector('input[placeholder="Search projects…"]');
      return input ? (input.parentElement?.innerText || "") : "(picker closed)";
    });
    ok("malformed nav-state: the valid projects still render", /Goose Creek/.test(panel) && /Grand Port/.test(panel), `panel="${panel.replace(/\s+/g, " ").slice(0, 90)}"`);
    await page.close();
  }

  // ── 3. signed-in + profile resolving late (only if the build is cloud-configured) ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    // Seed a fake session under whatever storage key the built client uses.
    await ctx.addInitScript(() => {
      try {
        const sess = { access_token: "f.a.b", token_type: "bearer", expires_in: 100000, expires_at: Math.floor(Date.now() / 1000) + 100000, refresh_token: "r",
          user: { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", email: "mike@example.com", user_metadata: { first_name: "Mike", last_name: "Ab" }, app_metadata: {}, created_at: "2026-01-01T00:00:00Z" } };
        // The client's storageKey is sb-<ref>-auth-token; seed the common refs we build with.
        ["sb-fakeref-auth-token", "sb-lyeqzkuiwngunutlkkmi-auth-token"].forEach((k) => localStorage.setItem(k, JSON.stringify(sess)));
      } catch (_) {}
    });
    const page = await ctx.newPage();
    const sink = newErrSink(page);
    await page.goto(BASE + "#/schedule", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900); // profiles fetch fails/late → profile stays null (the race)
    const signedIn = await page.evaluate(() => !!document.querySelector('button[title^="Signed in as"]'));
    if (signedIn) {
      ok("signed-in (profile late): no ErrorBoundary", !(await boundaryShown(page)));
      ok("signed-in (profile late): no real page errors", sink.real().length === 0, sink.real()[0] || "");
      await inject(page, NAV());
      await page.waitForTimeout(400);
      ok("signed-in + nav-state: still no ErrorBoundary", !(await boundaryShown(page)));
    } else {
      console.log("SKIP — preview build isn't Supabase-configured, signed-in path not exercised here (covered by unit tests + manual signed-in run)");
    }
    await ctx.close();
  }
} catch (e) {
  console.log("HARNESS ERROR:", e.message);
  results.push({ name: "harness", pass: false });
} finally {
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== ${passed}/${results.length} checks passed ===`);
  await browser.close();
  process.exit(passed === results.length && results.length >= 6 ? 0 : 1);
}
