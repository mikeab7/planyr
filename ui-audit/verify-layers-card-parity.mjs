/* verify-layers-card-parity — B2391216 ×2: the planner's Imagery & Layers card and the map finder's card are the SAME component.
 *
 *   node ui-audit/verify-layers-card-parity.mjs [http://localhost:4173]            local preview, seeded located plan
 *   E2E_LOGIN_KEY=… node ui-audit/verify-layers-card-parity.mjs https://planyr.io  LIVE, signed in as the test account, on a
 *                                                                                   throwaway LOCATED plan it deletes (and verifies gone)
 *
 * For each of desktop / phone × light / dark it opens BOTH cards (the planner on a located plan; the finder on the map), asserts the
 * structure that must match, screenshots each card element, and pastes the pair side by side under ui-audit/screenshots/layers-card/.
 * Asserts (planner): the card holds ONLY the panel — no "Evidence tools", "Easement rules", "AI corridor scan" or "Layers sit beneath";
 * Map Base › Labels lists Road Names AND City Names; each label row has the standard anatomy (checkbox · swatch slot · name · status dot ·
 * the standard ▾ button) and the same row height as the finder's row; nothing is clipped sideways. Known-good arm: the finder's own Road
 * Names row must report the anatomy (an instrument that cannot see it could not vouch for the planner's). FOREGROUND-OR-VOID asserted first.
 * Live mode also reads /version.json IN THE SAME CALL as the assertions and (with --expect-sha) matches it to the merge commit. */
import { writeFileSync, mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) || "http://localhost:4173";
const live = !/localhost|127\.0\.0\.1/.test(base);
const expectSha = args.includes("--expect-sha") ? args[args.indexOf("--expect-sha") + 1] : null;
const OUT = new URL("./screenshots/layers-card/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

const ID = "zz-layers-card-" + Math.random().toString(36).slice(2, 8);
const SITE = {
  schemaVersion: 12, id: ID, groupId: ID, site: "zz Layers card check", name: "Plan 1", origin: { lat: 29.77938, lon: -95.89503 }, county: null, status: "active",
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 1320, y: 0 }, { x: 1320, y: 1320 }, { x: 0, y: 1320 }], active: true, z: 0 }],
  underlay: null, sheetOverlays: [], parcelDrawings: [], settings: {}, els: [], measures: [], markups: [], callouts: [],
  updatedAt: Date.now(), data: { status: "active" },
};

let page, close;
if (live) {
  const { openSignedIn } = await import("./lib/signedInSession.mjs");
  const s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
  page = s.page; close = () => s.close();
  console.log("signed in as", s.proof.email);
} else {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.PW_CHROME || undefined });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  page = await ctx.newPage();
  await page.addInitScript((j) => { try { localStorage.setItem("planarfit:sites:v1", j); window.__PLANYR_E2E = true; } catch (_) {} }, JSON.stringify({ [ID]: SITE }));
  await page.route(/\.(jpg|jpeg|png|webp)(\?|$)/, (r) => r.abort());
  close = () => browser.close();
}

/* The card element for a panel: the first ancestor that carries the card's own shadow. */
const cardOf = (panelLoc) => panelLoc.evaluateHandle((p) => { let n = p; while (n && n.parentElement) { n = n.parentElement; if (getComputedStyle(n).boxShadow !== "none") return n; } return p; });

/* The anatomy of one row, read from the DOM: the sequence of its parts, plus its box. */
const rowAnatomy = (panelLoc, id) => panelLoc.evaluate((p, rid) => {
  const row = p.querySelector(`[data-testid="layer-row-${rid}"]`);
  if (!row) return null;
  const line = row.firstElementChild;
  const parts = [];
  const visit = (el) => {
    for (const c of el.children) {
      if (c.matches('input[type="checkbox"]')) parts.push("checkbox");
      else if (c.hasAttribute("data-swatch")) parts.push("swatch");
      else if (c.hasAttribute("data-layer-dot")) parts.push("dot");
      else if (c.matches('button[data-testid^="layer-caret-"]')) parts.push("caret");
      else if (c.tagName === "SPAN" && c.getAttribute("title")) parts.push("name");
      else visit(c);
    }
  };
  visit(line);
  const caret = row.querySelector('button[data-testid^="layer-caret-"]');
  return { parts: parts.join(" · "), h: Math.round(line.getBoundingClientRect().height), caret: caret ? caret.textContent.trim() : null };
}, id);

const shots = {};
try {
  await assertMeasurable(page, "verify-layers-card-parity");
  if (live) {
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
  }

  const SIZES = { desktop: { width: 1280, height: 860 }, phone: { width: 390, height: 844 } };
  for (const [size, vp] of Object.entries(SIZES)) {
    for (const theme of ["light", "dark"]) {
      const tag = `${size}-${theme}`;
      await page.setViewportSize(vp);
      // ── planner ──
      await page.goto(`${base}/#/project/${ID}/site`, { waitUntil: "load" });
      await page.getByTestId("planner-canvas").waitFor({ timeout: 45000 });
      await page.waitForTimeout(1800);
      await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      const chip = page.getByTestId("layers-expand").filter({ visible: true });
      if (await chip.count()) await chip.first().click();
      const pp = page.locator('[data-testid="layer-panel"][data-surface="planner"]').first();
      await pp.waitFor({ state: "visible", timeout: 20000 });
      await pp.getByTestId("layer-group-base").click().catch(async () => { await pp.getByTestId("layer-group-select").selectOption("base").catch(() => {}); });
      await page.waitForTimeout(500);
      const pCard = (await cardOf(pp)).asElement();
      const text = (await pCard.textContent()) || "";
      check(`planner · ${tag}: the card carries only the panel (no Evidence tools / Easement rules / AI corridor scan / footer)`, !/Evidence tools|Easement rules|AI corridor scan|Layers sit beneath/i.test(text));
      const road = await rowAnatomy(pp, "road_names"), city = await rowAnatomy(pp, "city_names");
      check(`planner · ${tag}: Map Base lists Road Names AND City Names`, !!road && !!city);
      if (size === "desktop" && theme === "light") {
        // The things that left the card still WORK, from their new homes (V1829776 steps 3–4).
        check("rail: a Utility Evidence heading", (await page.locator(".rail-hdr", { hasText: "Utility Evidence" }).count()) === 1);
        for (const id of ["rail-ev-trace", "rail-ev-route-elec", "rail-ev-route-water", "rail-ev-infer-main", "rail-ev-xsec"]) check(`rail: ${id} is there`, (await page.getByTestId(id).count()) === 1);
        const trace = page.getByTestId("rail-ev-trace");
        await trace.click();
        check("rail: Trace overhead electric arms", (await trace.getAttribute("aria-pressed")) === "true");
        await trace.click();
        check("rail: …and disarms", (await trace.getAttribute("aria-pressed")) === "false");
        await page.getByRole("button", { name: "Easement options" }).click();
        await page.getByTestId("easement-rules-toggle").click();
        check("Easement ▾ → Easement rules opens the jurisdiction editor", (await page.getByTestId("easement-rules").count()) === 1);
        await page.keyboard.press("Escape");
        await page.getByTestId("rail-ev-route-water").click();
        await page.waitForTimeout(600);
        const flashed = await page.getByText(/pick one in the Easement ▾ menu/).count();
        const armed = (await page.getByTestId("rail-ev-route-water").getAttribute("aria-pressed")) === "true";
        check("Route water service: with no criteria it names the Easement ▾ menu and opens the rules there; with criteria it arms", (flashed === 1 && (await page.getByTestId("easement-rules").count()) === 1) || armed, `flash=${flashed} armed=${armed}`);
        await page.keyboard.press("Escape");
        await page.mouse.click(5, 300);
      }
      shots[`planner-${tag}`] = { buf: await pCard.screenshot(), road, city };
      writeFileSync(`${OUT}planner-${tag}.png`, shots[`planner-${tag}`].buf);
      // ── finder ──
      await page.goto(`${base}/#/site-planner`, { waitUntil: "load" });
      await page.waitForTimeout(2200);
      await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      const fchip = page.getByTestId("finder-layers-expand").filter({ visible: true });
      if (await fchip.count()) await fchip.first().click();
      const fp = page.locator('[data-testid="layer-panel"][data-surface="finder"]').first();
      await fp.waitFor({ state: "visible", timeout: 20000 });
      await fp.getByTestId("layer-group-base").click().catch(async () => { await fp.getByTestId("layer-group-select").selectOption("base").catch(() => {}); });
      await page.waitForTimeout(500);
      const fCard = (await cardOf(fp)).asElement();
      const froad = await rowAnatomy(fp, "road_names"), fcity = await rowAnatomy(fp, "city_names");
      check(`finder · ${tag}: known-good arm — the finder's own label rows report the anatomy`, !!froad && !!fcity && /checkbox · swatch · name/.test(froad.parts), JSON.stringify(froad));
      shots[`finder-${tag}`] = { buf: await fCard.screenshot() };
      writeFileSync(`${OUT}finder-${tag}.png`, shots[`finder-${tag}`].buf);
      for (const [nm, a, b] of [["Road Names", road, froad], ["City Names", city, fcity]]) {
        if (!a || !b) continue;
        check(`${tag}: ${nm} row — same anatomy on both surfaces`, a.parts === b.parts, `planner "${a.parts}" · finder "${b.parts}"`);
        check(`${tag}: ${nm} row — the standard ▾ button, same row height`, a.caret === "▾" && a.h === b.h, `caret "${a.caret}", ${a.h} vs ${b.h}`);
      }
      const clipped = await pCard.evaluate((c) => { const sc = c.querySelector('[data-testid="layer-panel"]'); return sc ? sc.scrollWidth - sc.clientWidth : 0; });
      check(`planner · ${tag}: nothing clipped sideways`, clipped <= 1, `${clipped}px`);
    }
  }
} finally {
  if (live) {
    const gone = await page.evaluate(async (id) => {
      try {
        for (const k of Object.keys(localStorage)) {
          if (!/^planarfit:sites:/.test(k)) continue;
          try { const m = JSON.parse(localStorage.getItem(k) || "{}"); if (m && m[id]) { delete m[id]; localStorage.setItem(k, JSON.stringify(m)); } } catch (_) {}
        }
        if (window.pfSupabase) { await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id); await window.pfSupabase.from("sites").delete().eq("id", id); }
        const q = window.pfSupabase ? await window.pfSupabase.from("sites").select("id").eq("id", id) : { data: [] };
        return { cloud: !(q.data && q.data.length) };
      } catch (e) { return { error: String(e) }; }
    }, ID).catch((e) => ({ error: String(e) }));
    check("throwaway plan deleted and verified gone", !!gone.cloud, JSON.stringify(gone));
  }
  await close();
}
console.log(failed ? `FAIL (${failed})` : "PASS");
process.exit(failed ? 1 : 0);
