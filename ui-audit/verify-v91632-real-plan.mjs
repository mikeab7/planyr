/* verify-v91632-real-plan.mjs — V91632, run on the OWNER'S OWN PLAN rather than on a test scene.
 *
 * ⛔ WHY THIS FILE EXISTS AT ALL, since `audit-element-parity.mjs` already checks ordering.
 * V91632 carries `Blocker: real-data`, and that blocker is not a formality. The parity audit runs
 * on a fixture built to make z-order OBSERVABLE — four tidy overlapping rectangles, two text boxes
 * already seeded, no parcels, no rasters, no settings. That scene proves the MODEL works. It cannot
 * prove the thing the owner actually reported, because his report was about HIS plan: forty-seven
 * elements, five georeferenced parcels, a sheet overlay, an aerial underlay, real rotations, a
 * dissolved eight-road network, and a pond that is the only one of its type. Every one of those is
 * a way a feature that passes on a clean scene can still be unreachable on a real one — a probe
 * point that lands on a parcel, chrome that only exists at this density, an Arrange row greyed by
 * the wrong peer set.
 *
 * So this harness opens **Bain / "Concept - Original"** (`smr9olizi5ue`) — the owner's real saved
 * plan, pulled from `public.sites` JOINED to `public.site_elements`, coordinates verbatim
 * (`fixtures/bain-concept-original.json`; provenance and the redaction list are in its own
 * `_note` / `_redacted`) — and runs V91632's three checks on it, in the order the V lists them.
 *
 * ⛔ WHAT THIS RUN IS, AND WHAT IT IS NOT — stated here so no reader has to infer it. It is the
 * owner's REAL PLAN DATA driven through a REAL BROWSER against a REAL BUILD. It is NOT his live
 * signed-in production tab: this sandbox's proxy CORS-blocks Supabase sign-in, so no run from here
 * can be a signed-in one. What that leaves untested is the CLOUD round trip of these edits (the
 * `site_elements` write path), not the ordering behaviour, which is what V91632 asks about. The
 * bytes-level persistence of an ordering edit IS checked below, on device.
 *
 * ⛔ AND THE THING THE DATABASE SAID THAT THE V ASSUMED OTHERWISE: he has no plan with two text
 * boxes on it. Across all 65 of his plans the maximum callout count is ONE. So the text-box case
 * cannot be "find the two he already has" — it is exactly what the V instructs, DROP two onto a
 * real plan with the real tool and order them there. That is what happens below.
 *
 * Rules this harness follows, from /CLAUDE.md: every reading comes from the RENDERED DOM in
 * document order (paint order in SVG IS DOM order — a state read is what would call a dead feature
 * green); FOREGROUND-OR-VOID's `assertMeasurable` gates every measurement; and a probe point is
 * confirmed by the app's own hit resolver rather than by the harness re-implementing it.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { readFixture, buildFixtureState } from "./lib/fixtureSeeding.mjs";

const BASE = process.env.PLANYR_URL || "http://localhost:5173/";
const EXEC = process.env.PLAYWRIGHT_CHROMIUM || "/opt/pw-browsers/chromium";
const SITE_ID = "v91632-bain";
const CACHE = fileURLToPath(new URL("../.cache/raster", import.meta.url));

const results = [];
const ok = (name, pass, extra = "") => {
  results.push({ name, pass: !!pass });
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`);
};

mkdirSync(CACHE, { recursive: true });
const fixture = readFixture("bain");
const pond = (fixture.els || []).find((e) => e.type === "pond");
const buildings = (fixture.els || []).filter((e) => e.type === "building");
if (!pond) throw new Error("the Bain fixture has no pond — the lone-instance case cannot be run");

console.log(`\n=== THE OWNER'S REAL PLAN =================================================`);
console.log(`  ${fixture.site} / ${fixture.name}  ·  ${fixture._source?.siteId} (pulled ${fixture._source?.pulledAt})`);
console.log(`  ${(fixture.els || []).length} elements · ${(fixture.parcels || []).length} parcels · ` +
  `${(fixture.callouts || []).length} callouts · lone pond ${pond.id}`);
console.log(`  by type: ${JSON.stringify(fixture._census?.byType || {})}`);

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
let ctx, page;
try {
  const built = await buildFixtureState(browser, { base: BASE, fixture, siteId: SITE_ID, cacheDir: CACHE });
  ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true, storageState: built.state });
  await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
  /* No egress: the underlay's src is a live ArcGIS export URL and the sheet overlay's bytes live in
   * IndexedDB. Letting real requests out would make this run depend on the network, and a blocked
   * one would look like a rendering failure. */
  await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  page = await ctx.newPage();
  await assertMeasurable(page, "verify-v91632-real-plan");
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 30000 });
  await page.waitForTimeout(2500);
  if (pageErrors.length) {
    console.log("\n⛔ THE REAL PLAN CRASHED THE RENDER — every result below would be meaningless:");
    pageErrors.slice(0, 3).forEach((e) => console.log("   " + e.slice(0, 250)));
    process.exit(1);
  }

  /* Paint order, read from the DOM in document order — the ONLY honest reading of "what is on top". */
  const paintOrder = () => page.evaluate(() => {
    const out = [];
    const svg = document.querySelector('[data-testid="planner-canvas"]') || document;
    svg.querySelectorAll("[data-feature]").forEach((n) => {
      const id = n.getAttribute("data-feature");
      if (id && !out.includes(id)) out.push(id);
    });
    return out;
  });

  const canvasBox = await page.locator('[data-testid="planner-canvas"]').boundingBox();
  const fit = async () => {
    const fits = page.locator('button[title="Zoom to fit"]');
    for (let i = (await fits.count()) - 1; i >= 0; i--) {
      await fits.nth(i).click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(600);
    }
  };
  await fit();

  const census = await page.evaluate(() => {
    const s = new Set();
    document.querySelectorAll("[data-feature]").forEach((n) => s.add(n.getAttribute("data-feature")));
    return [...s];
  });
  ok("the owner's real plan opens and renders its features",
    census.filter((k) => k.startsWith("el:")).length >= 40 && census.some((k) => k.startsWith("parcel:")),
    `${census.length} distinct features on screen`);

  /* Right-click and read the menu rows verbatim. Deselect first — CHROME-NEVER-EATS-A-PRESS: a
   * prior selection mounts grips that a corner-ish probe point then lands on. */
  /* ⛔ ARRIVE AT THE POINT, ALWAYS, AND THROUGH ONE OPENER. Playwright dispatches no mousemove when
   * the pointer is ALREADY where you are clicking, and this app arms hover-scoped chrome on movement
   * (CHROME-NEVER-EATS-A-PRESS clause 7). So the same coordinates opened the pond's menu on the
   * first right-click and something else on the second — which produced a confident FAIL against a
   * feature that works, and then, once every read went through the arrival, a confident FAIL against
   * a feature that was genuinely broken. Both were the harness holding the pointer still in a way no
   * hand does. ONE opener, used by every read AND every click, so the two can never diverge again. */
  async function openMenuAt(x, y) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    await page.mouse.move(x + 220, y + 180);
    await page.waitForTimeout(120);
    await page.mouse.move(x, y);
    await page.waitForTimeout(160);
    await page.mouse.click(x, y, { button: "right" });
    await page.waitForTimeout(400);
  }
  async function menuAt(x, y) {
    await openMenuAt(x, y);
    const rows = await page.evaluate(() => {
      const menu = [...document.querySelectorAll(".menu")].filter((m) => m.getBoundingClientRect().width > 0).pop();
      if (!menu) return null;
      return [...menu.querySelectorAll("button")].map((b) => ({
        text: (b.textContent || "").trim(), disabled: b.disabled === true, title: b.getAttribute("title") || "",
      })).filter((r) => r.text && r.text.length < 80);
    });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    return rows;
  }

  /* A point the APP ITSELF resolves to `want`. Asking `window.__plannerHitTarget` beats a harness
   * re-implementing the hit test, which would only ever test the harness's copy of the rule. */
  const pointOnFeature = (want) => page.evaluate((w) => {
    const n = document.querySelector(`[data-feature="${w}"]`);
    if (!n) return null;
    const r = n.getBoundingClientRect();
    const asks = typeof window.__plannerHitTarget === "function";
    for (const a of [0.5, 0.4, 0.6, 0.35, 0.65, 0.3, 0.7, 0.45, 0.55]) {
      for (const b of [0.5, 0.4, 0.6, 0.35, 0.65, 0.3, 0.7, 0.45, 0.55]) {
        const x = Math.round(r.x + r.width * a), y = Math.round(r.y + r.height * b);
        if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
        const hit = document.elementFromPoint(x, y);
        const own = hit && hit.closest("[data-feature]");
        const id = own && own.getAttribute("data-feature");
        if (id !== w) continue;
        if (!asks) return { x, y, resolved: id };
        let t = null;
        try { t = window.__plannerHitTarget(x, y); } catch (e) { /* ignore */ }
        const rid = t && (t.id || t.feature || "");
        if (!rid || String(w).includes(String(rid))) return { x, y, resolved: rid || id };
      }
    }
    return null;
  }, want);

  /* ── V91632 CASE 1 — TWO OVERLAPPING TEXT BOXES ON A REAL PLAN ──────────────────────────────
   * "The text-box case is the one to run first, because it is the one that was structurally
   * impossible before." Drawn with the real tool, on his real plan, over his real geometry. */
  console.log("\n=== V91632 · case 1 — two overlapping text boxes, drawn on the real plan ===");
  const placeText = async (x, y, body) => {
    await page.getByRole("button", { name: /^Text\s/ }).click();
    await page.waitForTimeout(200);
    await page.mouse.click(x, y);
    await page.getByPlaceholder("Type…").waitFor({ state: "visible", timeout: 8000 });
    await page.keyboard.type(body);
    await page.keyboard.press("Escape");   // commit the text
    await page.keyboard.press("Escape");   // deselect
    await page.waitForTimeout(400);
  };
  const tx = Math.round(canvasBox.x + canvasBox.width * 0.5);
  const ty = Math.round(canvasBox.y + canvasBox.height * 0.5);
  await placeText(tx, ty, "NOTE ALPHA");
  await placeText(tx + 26, ty + 16, "NOTE BRAVO");

  const callouts = await page.evaluate(() =>
    [...document.querySelectorAll('[data-feature^="callout:"]')].map((n) => n.getAttribute("data-feature")));
  ok("two text boxes now exist on the real plan and OVERLAP each other", callouts.length === 2 && await page.evaluate(([a, b]) => {
    const ra = document.querySelector(`[data-feature="${a}"]`).getBoundingClientRect();
    const rb = document.querySelector(`[data-feature="${b}"]`).getBoundingClientRect();
    return !(ra.right < rb.left || rb.right < ra.left || ra.bottom < rb.top || rb.bottom < ra.top);
  }, callouts), callouts.join(", "));

  if (callouts.length === 2) {
    const [cA, cB] = callouts;
    const seeded = await paintOrder();
    const lower = seeded.indexOf(cA) < seeded.indexOf(cB) ? cA : cB;   // the one currently BEHIND
    const upper = lower === cA ? cB : cA;
    const p = await pointOnFeature(lower);
    ok("a point can be found that addresses the LOWER text box", !!p, JSON.stringify(p));

    if (p) {
      const rows = await menuAt(p.x, p.y);
      const front = (rows || []).find((r) => /^Bring to Front/i.test(r.text));
      ok("the lower text box's menu offers Bring to Front on the real plan", !!front && !front.disabled,
        front ? `disabled=${front.disabled}` : "row absent");

      await openMenuAt(p.x, p.y);
      await page.locator(".menu button", { hasText: "Bring to Front" }).first().click();
      await page.waitForTimeout(700);
      const after = await paintOrder();
      ok("V91632 (1): the text box sent to the front actually PAINTS on top of the other one",
        after.indexOf(lower) > after.indexOf(upper),
        `${lower} ${seeded.indexOf(lower)}→${after.indexOf(lower)} · ${upper} ${seeded.indexOf(upper)}→${after.indexOf(upper)}`);

      /* ── CASE 3 (run here, on the same object) — "Send behind the plan". ─────────────────── */
      const p2 = await pointOnFeature(lower);
      await openMenuAt(p2.x, p2.y);
      const behind = page.locator(".menu button", { hasText: "Send behind the plan" }).first();
      ok("the real plan's text-box menu offers 'Send behind the plan'", (await behind.count()) > 0);
      if (await behind.count()) {
        await behind.click();
        await page.waitForTimeout(700);
        const cb = await paintOrder();
        const firstEl = cb.findIndex((k) => k.startsWith("el:"));
        ok("V91632 (3): sent behind the plan, the text box renders BEFORE the site elements — his buildings draw over it",
          cb.indexOf(lower) >= 0 && firstEl >= 0 && cb.indexOf(lower) < firstEl,
          `text box at ${cb.indexOf(lower)}, first element at ${firstEl}`);
      }
    }
  }

  /* ── V91632 CASE 2 — THE LONE INSTANCE ─────────────────────────────────────────────────────
   * "the case that read as 'broken': right-click something that is the only one of its type on the
   * plan." His Bain plan has exactly one pond, which is the real instance of that case. */
  console.log("\n=== V91632 · case 2 — the lone pond on the real plan ===");
  const pp = await pointOnFeature(`el:${pond.id}`);
  ok("a point can be found that addresses the lone pond", !!pp, JSON.stringify(pp));

  /* ⛔ NEW-3 — THE DEFECT THIS REAL PLAN SURFACED AND NO FIXTURE COULD, asserted explicitly rather
   * than left implicit in the row below it. The parcel acreage badge becomes a hit target on HOVER
   * (B1327, so it can be dragged), so merely ARRIVING at the pond puts the badge's rect above it in
   * the stack. B280402 taught the DOUBLE-CLICK resolver to look through `data-chrome`; the
   * right-click was a plain DOM handler and never went through it, so right-clicking his pond
   * opened the PARCEL menu — "Merge parcels · Hide acreage label · Delete parcel" — with a
   * destructive row standing where the pond's own menu belongs.
   *
   * Two assertions, and the FIRST one is what stops this row rotting green: it proves the harness is
   * actually exercising the condition. If the badge ever stops entering the stack on hover, this
   * check must say so rather than quietly pass because there was nothing to swallow the press. */
  if (pp) {
    const readStack = () => page.evaluate(({ x, y }) => document.elementsFromPoint(x, y).map((n) => {
      const f = n.closest && n.closest("[data-feature]");
      return { feature: f ? f.getAttribute("data-feature") : null, chrome: !!(n.closest && n.closest("[data-chrome]")) };
    }), pp);
    await page.keyboard.press("Escape");
    await page.mouse.move(pp.x + 220, pp.y + 180);
    await page.waitForTimeout(150);
    const cold = await readStack();
    await page.mouse.move(pp.x, pp.y);           // …and now let the cursor merely REST on it
    await page.waitForTimeout(400);
    const armed = { cold, after: await readStack() };
    console.log(`  stack COLD  : ${JSON.stringify(cold.slice(0, 2))}`);
    console.log(`  stack HOVER : ${JSON.stringify(armed.after.slice(0, 2))}`);
    const top = armed.after[0] || {};
    ok("NEW-3 precondition: with the cursor resting on it, hover-armed parcel chrome IS above the pond",
      top.chrome === true && String(top.feature || "").startsWith("parcel:"),
      JSON.stringify(armed.after.slice(0, 3)));
    const rows0 = await menuAt(pp.x, pp.y);
    const isParcelMenu = (rows0 || []).some((r) => /Delete parcel|Merge parcels|acreage label/i.test(r.text));
    ok("NEW-3: right-clicking the pond opens the POND's menu, not the parcel's — the chrome forwards the press",
      !!rows0 && !isParcelMenu && rows0.some((r) => /Pond settings/i.test(r.text)),
      isParcelMenu ? "the PARCEL menu opened — the press was swallowed" : `${(rows0 || []).length} rows`);
  }
  if (pp) {
    const rows = await menuAt(pp.x, pp.y);
    console.log("  the pond's menu, verbatim:");
    console.log((rows || []).map((r) => `    ${r.disabled ? "[grey] " : ""}${r.text}`).join("\n"));
    const arrange = (rows || []).filter((r) => /^(Bring to Front|Bring Forward|Send Backward|Send to Back)/i.test(r.text));
    ok("V91632 (2): the lone pond STILL SHOWS all four Arrange rows — present and greyed, not hidden",
      arrange.length === 4 && arrange.every((r) => r.disabled),
      `${arrange.length} rows, ${arrange.filter((r) => r.disabled).length} greyed`);
    ok("…and each greyed row carries a hover REASON, so a disabled control is not indistinguishable from a broken one",
      arrange.length === 4 && arrange.every((r) => /only .* on the plan|nothing to reorder/i.test(r.title)),
      JSON.stringify(arrange.map((r) => r.title.slice(0, 60))));

    /* ── NEW-1, ON THE SAME REAL PLAN. The escape hatch has to work where he works, not only on a
     * fixture built to show it. His lone pond is the strongest case: it is the object the greyed
     * rows above say has nothing to reorder against, and the hatch is the answer to that. */
    console.log("\n=== NEW-1 · the escape hatch, on the same real plan ===");
    const bId = `el:${buildings[0].id}`;
    const base = await paintOrder();
    ok("DEFAULT UNCHANGED on the real plan: the pond renders under the buildings, untouched",
      base.indexOf(`el:${pond.id}`) < base.indexOf(bId),
      `pond ${base.indexOf(`el:${pond.id}`)}, building ${base.indexOf(bId)}`);

    /* B845584 — "Force on top/underneath" moved from this menu into the Properties panel's
     * persistent "Draw order" control (a submenu-only override left the owner able to end up stuck
     * out of band with no visible way to see why). Reach it the same way a person would: open the
     * pond's menu, click Properties…, then use the panel's own testids. */
    await openMenuAt(pp.x, pp.y);
    const propsRow = page.locator(".menu button", { hasText: "Properties…" }).first();
    ok("the real plan's element menu can open Properties", (await propsRow.count()) > 0);
    if (await propsRow.count()) {
      await propsRow.click();
      await page.waitForTimeout(400);
      const forced = await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="el-band-force"]');
        if (!btn) return false;
        btn.click();
        return true;
      });
      ok("the real plan's Properties panel carries the explicit cross-band Front control", forced);
      if (forced) {
        await page.waitForTimeout(700);
        const forcedOrder = await paintOrder();
        ok("NEW-1: forced, the pond RENDERS above his buildings on his own plan",
          forcedOrder.indexOf(`el:${pond.id}`) > forcedOrder.indexOf(bId),
          `pond ${forcedOrder.indexOf(`el:${pond.id}`)}, building ${forcedOrder.indexOf(bId)}`);
        ok("…and every other element kept its relative order",
          JSON.stringify(forcedOrder.filter((k) => k !== `el:${pond.id}`)) === JSON.stringify(base.filter((k) => k !== `el:${pond.id}`)));

        const stored = await page.evaluate(() => {
          try { return JSON.stringify(JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}")).includes('"bandForce"'); }
          catch (e) { return null; }
        });
        ok("NEW-1: the override is written into the saved plan record", stored === true, `stored=${stored}`);

        const restoreClicked = await page.evaluate(() => {
          const btn = document.querySelector('[data-testid="el-band-restore"]');
          if (!btn) return false;
          btn.click();
          return true;
        });
        ok("the forced element's panel offers the way back", restoreClicked);
        if (restoreClicked) {
          await page.waitForTimeout(700);
          const restored = await paintOrder();
          ok("NEW-1: reversible — the pond is back under his buildings, and the plan reads as it did",
            restored.indexOf(`el:${pond.id}`) < restored.indexOf(bId)
            && JSON.stringify(restored) === JSON.stringify(base),
            `pond ${restored.indexOf(`el:${pond.id}`)}, building ${restored.indexOf(bId)}`);
        }
      }
    }
  }
} finally {
  if (browser) await browser.close();
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} pass — the owner's real Bain plan, in a real browser`);
console.log("⛔ NOT a signed-in production run: Supabase sign-in is CORS-blocked from this sandbox, so the");
console.log("   CLOUD round trip of these edits is out of scope here. Ordering + on-device persistence ARE covered.");
process.exit(failed ? 1 : 0);
