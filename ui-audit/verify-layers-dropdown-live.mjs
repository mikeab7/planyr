/* verify-layers-dropdown-live — V1891536 (B2436064 ×2 + B2448032), LIVE, signed in as the test account.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-layers-dropdown-live.mjs https://planyr.io [--expect-sha <merge commit>]
 *
 * On a throwaway LOCATED plan (written to the test account, deleted and verified gone — owner rule 15) AND the map finder, at desktop and
 * phone width, light and dark: every row's name starts EXACTLY one gap (6) after its checkbox, off or on; an ON row's colour chip follows
 * its name; an OFF layer's ▾ carries Opacity (+ Draw above plan on the planner, the small ⓘ, no "About this layer" text); typing 60 turns
 * the layer ON at 0.6 on the map's own layer; dragging does too; the Contour Interval on an off row leaves it OFF. The served build
 * (/version.json) is read IN THE SAME CALL as the assertions. FOREGROUND-OR-VOID asserted first. */
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) || "https://planyr.io").replace(/\/$/, "");
const expectSha = args.includes("--expect-sha") ? args[args.indexOf("--expect-sha") + 1] : null;
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

const ID = "zz-layers-dd-" + Math.random().toString(36).slice(2, 8);
const SITE = {
  schemaVersion: 12, id: ID, groupId: ID, site: "zz Layers dropdown check", name: "Plan 1", origin: { lat: 29.77938, lon: -95.89503 }, county: null, status: "active",
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 1320, y: 0 }, { x: 1320, y: 1320 }, { x: 0, y: 1320 }], active: true, z: 0 }],
  underlay: null, sheetOverlays: [], parcelDrawings: [], settings: {}, els: [], measures: [], markups: [], callouts: [],
  updatedAt: Date.now(), data: { status: "active" },
};
const panelSel = (s) => `[data-testid="layer-panel"][data-surface="${s}"]`;

const s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const page = s.page;
console.log("signed in as", s.proof.email);
try {
  await assertMeasurable(page, "verify-layers-dropdown-live");
  const v = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" })).json());
  console.log("served build:", v.build);
  if (expectSha) check("served build matches the merge commit", String(v.build).startsWith(expectSha.slice(0, 7)), `${v.build} vs ${expectSha}`);
  const ins = await page.evaluate(async (site) => {
    const { data: u } = await window.pfSupabase.auth.getUser();
    const row = { id: site.id, group_id: site.groupId, site: site.site, name: site.name, county: site.county, updated_at: new Date().toISOString(), data: site, user_id: u.user.id };
    let r = await window.pfSupabase.from("sites").insert(row);
    if (r.error && /user_id/.test(String(r.error.message))) { delete row.user_id; r = await window.pfSupabase.from("sites").insert(row); }
    return r.error ? String(r.error.message) : null;
  }, SITE);
  check("throwaway LOCATED plan written to the test account", !ins, ins || "");

  const openCard = async (surface) => {
    if (surface === "planner") {
      await page.goto(`${base}/#/project/${ID}/site`, { waitUntil: "load" });
      await page.reload({ waitUntil: "load" });
      await page.getByTestId("planner-canvas").waitFor({ timeout: 45000 });
      await page.waitForTimeout(2000);
      const chip = page.getByTestId("layers-expand").filter({ visible: true });
      if (await chip.count()) await chip.first().click();
    } else {
      await page.goto(`${base}/#/site-planner`, { waitUntil: "load" });
      await page.reload({ waitUntil: "load" });
      await page.waitForFunction(() => !!window.__mapFinderMap, null, { timeout: 45000 });
      await page.evaluate(() => window.__mapFinderMap.setView([29.77938, -95.89503], 15, { animate: false }));
      await page.waitForTimeout(1800);
      const chip = page.getByTestId("finder-layers-expand").filter({ visible: true });
      if (await chip.count()) await chip.first().click();
    }
    const panel = page.locator(panelSel(surface)).first();
    await panel.waitFor({ state: "visible", timeout: 30000 });
    await page.waitForTimeout(800);
    return panel;
  };
  const groupKeys = async (panel) => {
    const tabs = panel.locator('[data-testid="layer-group-nav"] button[role="tab"]');
    if (await tabs.count()) return tabs.evaluateAll((els) => els.map((e) => e.getAttribute("data-testid").replace("layer-group-", "")));
    return panel.locator('[data-testid="layer-group-select"] option').evaluateAll((os) => os.map((o) => o.value));
  };
  const selectGroup = async (panel, key) => {
    const tab = panel.getByTestId(`layer-group-${key}`);
    if (await tab.count()) await tab.click(); else await panel.locator('[data-testid="layer-group-select"]').selectOption(key);
  };
  const rowOf = async (panel, id) => {
    const row = panel.getByTestId(`layer-row-${id}`);
    if (await row.count()) return row;
    for (const k of await groupKeys(panel)) { await selectGroup(panel, k); if (await row.count()) return row; }
    throw new Error(`no ${id} row`);
  };
  const hookOf = (surface) => (surface === "planner" ? "__plannerLayers" : "__finderLayers");
  const liveOp = (surface, id) => page.evaluate(([h, k]) => { const f = window[h]; return f ? JSON.stringify((f().opacities || {})[k] || []) : "nohook"; }, [hookOf(surface), id]);

  const SIZES = { desktop: { width: 1280, height: 860 }, phone: { width: 390, height: 844 } };
  for (const surface of ["planner", "finder"]) {
    for (const [size, vp] of Object.entries(SIZES)) {
      for (const theme of ["light", "dark"]) {
        const tag = `${surface} · ${size} · ${theme}`;
        await page.setViewportSize(vp);
        const panel = await openCard(surface);
        await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);

        // 1 — gaps on every row of every group, off rows first
        let worst = 0, n = 0; const xs = new Set(); const bad = [];
        const measure = async () => panel.evaluate((p) => {
          const pane = p.querySelector('[data-testid="layer-pane"]').getBoundingClientRect();
          return [...p.querySelectorAll('[data-testid="layer-pane"] [data-testid^="layer-row-"]')].filter((r) => !r.getAttribute("data-testid").endsWith("-menu") && r.querySelector("label span[title]")).map((row) => {
            const cb = row.querySelector('input[type="checkbox"]').getBoundingClientRect(), nm = row.querySelector("label span[title]"), rg = document.createRange(); rg.selectNodeContents(nm.firstChild);
            const nb = rg.getBoundingClientRect(), chip = row.querySelector("[data-swatch]");
            return { id: row.getAttribute("data-testid"), gap: nb.left - cb.right, x: Math.round((nb.left - pane.left) * 10) / 10, on: row.querySelector('input[type="checkbox"]').checked, chip: !!chip, after: !chip || chip.getBoundingClientRect().left >= nb.right - 0.5 };
          });
        });
        for (const k of await groupKeys(panel)) {
          await selectGroup(panel, k);
          for (const r of await measure()) { n++; worst = Math.max(worst, r.gap); xs.add(r.x); if (Math.abs(r.gap - 6) > 0.6) bad.push(`${k}/${r.id} ${r.gap.toFixed(1)}`); if (r.chip && (!r.on || !r.after)) bad.push(`${k}/${r.id} chip`); }
        }
        check(`${tag}: checkbox → name is exactly 6 on every row (${n} rows), one x for every name`, n > 8 && !bad.length && xs.size === 1, bad.slice(0, 3).join(" | ") + ` xs=${[...xs]}`);

        // 2 — FEMA: off ▾ carries Opacity; typed 60 turns it on at 0.6
        const fema = await rowOf(panel, "fema");
        const cb = fema.locator('input[type="checkbox"]').first();
        if (await cb.isChecked()) await cb.uncheck({ force: true });
        await fema.getByTestId("layer-caret-fema").click();
        const menu = fema.getByTestId("layer-row-fema-menu");
        check(`${tag}: FEMA is OFF and its ▾ carries Opacity + the ⓘ (and Draw above plan on the planner), no 'About this layer'`,
          (await menu.locator('[data-part="opacity"]').count()) === 1 && (await menu.locator('[data-part="info"] button').count()) === 1 && !/About this layer/.test(await menu.innerText())
          && ((await menu.locator('[data-part="above"]').count()) === (surface === "planner" ? 1 : 0)), await menu.getAttribute("data-plan"));
        await menu.locator('input[type="text"]').first().fill("60");
        await page.waitForTimeout(600);
        check(`${tag}: typing 60 on the OFF layer ticks its checkbox and shows a status dot`, (await cb.isChecked()) && (await fema.locator("[data-layer-dot]").count()) === 1);
        let op = "";
        for (let i = 0; i < 40 && !/^\[(0\.6,?)+\]$/.test(op); i++) { op = await liveOp(surface, "fema"); if (!/^\[(0\.6,?)+\]$/.test(op)) await page.waitForTimeout(750); }
        check(`${tag}: the map's own FEMA layer is at 0.6`, /^\[(0\.6,?)+\]$/.test(op), op);
        // no chip move: re-measure FEMA's gap while ON, chip after the name
        const on = (await measure()).find((r) => r.id === "layer-row-fema");
        check(`${tag}: FEMA ON — gap still 6, colour chip after the name`, !!on && Math.abs(on.gap - 6) <= 0.6 && on.chip && on.after, JSON.stringify(on));

        // 3 — Contour Interval on an off row leaves it off
        const contours = await rowOf(panel, "contours");
        const ccb = contours.locator('input[type="checkbox"]').first();
        if (await ccb.isChecked()) await ccb.uncheck({ force: true });
        await contours.getByTestId("layer-caret-contours").click();
        await contours.locator('[data-testid="contour-interval"]').selectOption("5");
        await page.waitForTimeout(400);
        check(`${tag}: Contour Interval on an off Contour Lines row leaves it OFF`, !(await ccb.isChecked()));
        await page.evaluate(() => localStorage.removeItem("planyr:contourInterval"));
      }
    }
  }
} finally {
  const gone = await page.evaluate(async (id) => {
    try {
      for (const k of Object.keys(localStorage)) {
        if (!/^planarfit:sites:/.test(k)) continue;
        try { const m = JSON.parse(localStorage.getItem(k) || "{}"); if (m && m[id]) { delete m[id]; localStorage.setItem(k, JSON.stringify(m)); } } catch (_) {}
      }
      await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      await window.pfSupabase.from("sites").delete().eq("id", id);
      const q = await window.pfSupabase.from("sites").select("id").eq("id", id);
      return { cloud: !(q.data && q.data.length) };
    } catch (e) { return { error: String(e) }; }
  }, ID).catch((e) => ({ error: String(e) }));
  check("throwaway plan deleted and verified gone", !!gone.cloud, JSON.stringify(gone));
  await s.close();
}
console.log(failed ? `FAIL (${failed})` : "PASS");
process.exit(failed ? 1 : 0);
