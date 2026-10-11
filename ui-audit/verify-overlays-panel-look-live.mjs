/* verify-overlays-panel-look-live — V1634128 (B2215024): the RESTYLED OVERLAYS panel on a real deploy, signed in as the
 * throwaway test account: computed (size, weight) pairs, no orange, scale group row-or-column, and screenshots of the
 * open row at the narrowest and ~400 docked widths.
 *   E2E_LOGIN_KEY=… node ui-audit/verify-overlays-panel-look-live.mjs [https://planyr.io] [--expect-sha <merge sha>]
 *
 * Creates a THROWAWAY site (id `zz-ovl-…`) on the test account, drives every item of the acceptance list, then removes
 * the overlays it added through the app (which releases their Storage objects) and deletes the throwaway site, and
 * verifies it is gone. It NEVER touches overlay row aa2d8163-7d45-4929-8a05-dad94ba2528d, the Goose Creek master site
 * plan, or plan sms93j3sfc04 — it addresses only the id it minted.
 *
 * READS THE SERVED BUILD IN THE SAME CALL AS THE ASSERTIONS (CLAUDE.md: a live measurement is only valid if the
 * deployed chunk is read with it) — `/version.json` at the start and the end of the run, both printed.
 */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { mkdirSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const expectSha = args.includes("--expect-sha") ? args[args.indexOf("--expect-sha") + 1] : null;
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

const ID = "zz-ovl-" + Math.random().toString(36).slice(2, 8);
const SITE = {
  id: ID, groupId: ID, site: "zz Overlays panel check", name: "Plan 1", origin: { lat: 29.86, lon: -95.17 }, county: "harris",
  parcels: [{ id: "pc1", active: true, locked: false, points: [{ x: -500, y: -500 }, { x: 500, y: -500 }, { x: 500, y: 500 }, { x: -500, y: 500 }] }],
  els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, sheetOverlays: [], updatedAt: Date.now(), data: { status: "active" }, status: "active",
};
const PDF = new URL("../test/fixtures/site-plan-crop/e-size-title-block.pdf", import.meta.url).pathname;
const PNG = "/tmp/zz-ovl-live.png";
writeFileSync(PNG, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC", "base64"));

const s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const { page } = s;
const served = () => page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).then((j) => j.build).catch(() => null));
const chunk = () => page.evaluate(() => [...document.querySelectorAll("script[src]")].map((n) => n.getAttribute("src")).filter((x) => /assets\//.test(x)).slice(0, 3).join(","));
let KEY = null;
try {
  await assertMeasurable(page, "verify-overlays-panel-look-live");
  const b1 = await served(); const c1 = await chunk();
  console.log("signed in as", s.proof.email, "| served build", b1, "| chunks", c1);
  if (expectSha) check("the deploy is serving the merge commit", String(b1 || "").startsWith(expectSha.slice(0, 7)), `served ${b1}`);

  const ins = await page.evaluate(async (site) => {
    const { data: u } = await window.pfSupabase.auth.getUser();
    const row = { id: site.id, group_id: site.groupId, site: site.site, name: site.name, county: site.county, updated_at: new Date().toISOString(), data: site, user_id: u.user.id };
    let r = await window.pfSupabase.from("sites").insert(row);
    if (r.error && /user_id/.test(String(r.error.message))) { delete row.user_id; r = await window.pfSupabase.from("sites").insert(row); }
    return r.error ? String(r.error.message) : null;
  }, SITE);
  check("throwaway site written to the test account", !ins, ins || "");
  await page.goto(`${base}/#/project/${ID}/site`, { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await page.getByTestId("planner-canvas").waitFor({ timeout: 45000 });
  await page.waitForTimeout(3000);
  KEY = await page.evaluate(() => Object.keys(localStorage).find((k) => /^planarfit:sites:cloud:/.test(k)) || "planarfit:sites:v1");
  await page.evaluate(() => { if (!document.querySelector('[data-testid="overlays-panel"]')) document.querySelector('[data-rail-tab="references"]')?.click(); });
  await page.waitForTimeout(900);
  await page.locator('[data-testid="overlay-file-input"]').setInputFiles(PDF);
  await page.waitForFunction(() => document.querySelectorAll("[data-overlay-row]").length >= 1, null, { timeout: 60000 });
  await page.waitForTimeout(3000);
  const id = await page.evaluate(() => document.querySelector("[data-overlay-row]").getAttribute("data-overlay-row"));
  if (!(await page.locator(`[data-testid="overlay-open-${id}"]`).count())) await page.locator(`[data-testid="reference-open-${id}"]`).click();
  await page.waitForTimeout(500);

  const grip = page.locator('[title="Drag to resize"]').first();
  const panelLeft = await page.evaluate(() => document.querySelector('[data-testid="left-menu-panel"]')?.getBoundingClientRect().left ?? 0);
  for (const target of [240, 400]) {
    const gb = await grip.boundingBox();
    await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2); await page.mouse.down();
    await page.mouse.move(panelLeft + target + gb.width / 2, gb.y + gb.height / 2, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(800);
    const m = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="overlays-panel"]');
      const probe = document.createElement("i"); probe.style.cssText = "color:var(--accent)"; root.appendChild(probe); const orange = getComputedStyle(probe).color; probe.remove();
      const bad = [], orangeHits = [];
      for (const el of root.querySelectorAll("*")) {
        if (el.closest("svg")) continue; const cs = getComputedStyle(el); if (cs.display === "none" || !el.getBoundingClientRect().width) continue;
        const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
        const txtIn = (el.tagName === "INPUT" && !["checkbox", "range", "file", "radio"].includes(el.type)) || el.tagName === "SELECT";
        if (own || txtIn) {
          const pair = `${cs.fontSize}/${cs.fontWeight}`; const isName = el.getAttribute("data-testid") === "overlay-row-name"; const sec = cs.textTransform === "uppercase";
          if (!(pair === "12px/400" || (pair === "12px/500" && isName) || (pair === "10.5px/600" && sec) || (pair === "10.5px/400" && !sec))) bad.push((el.getAttribute("data-testid") || el.textContent.trim().slice(0, 14)) + " " + pair);
          if (cs.color === orange) orangeHits.push("text " + (el.getAttribute("data-testid") || el.textContent.trim().slice(0, 14)));
        }
        if (cs.backgroundColor === orange || cs.accentColor === orange) orangeHits.push("fill " + (el.getAttribute("data-testid") || el.tagName));
      }
      const g = root.querySelector('[data-testid="overlay-scale-group"]');
      const tops = g ? Array.from(g.children).map((b) => Math.round(b.getBoundingClientRect().top)) : [];
      const per = {}; tops.forEach((t) => { per[t] = (per[t] || 0) + 1; });
      const lab = Array.from(root.querySelectorAll("label")).find((l) => /Knock out white paper/.test(l.textContent));
      return { w: Math.round(root.getBoundingClientRect().width), bad, orangeHits, counts: Object.values(per), n: tops.length, layout: g && g.getAttribute("data-layout"), knockBottom: lab ? Math.round(lab.getBoundingClientRect().bottom) : null, vh: innerHeight };
    });
    check(`panel at ${m.w}px: every text is an allowed (size, weight) pair`, m.bad.length === 0, m.bad.slice(0, 4).join("; "));
    check(`panel at ${m.w}px: no orange text or fill`, m.orangeHits.length === 0, m.orangeHits.slice(0, 4).join("; "));
    check(`panel at ${m.w}px: scale group is one row or one column, never a split`, m.counts.length === 1 || m.counts.every((c) => c === 1), `${m.layout} ${m.counts}`);
    await page.locator('[data-testid="overlays-panel"]').screenshot({ path: OUT + `overlays-look-live-${target}.png` });
    await page.screenshot({ path: OUT + `overlays-look-live-${target}-full.png` });
  }
  const b2 = await served();
  console.log(`served build at the end: ${b2} (start ${b1})`);
} finally {
  // remove the overlays THROUGH THE APP (releases their Storage objects), then delete the throwaway site and verify it is gone
  try {
    for (let i = 0; i < 6; i++) {
      const id = await page.evaluate(() => document.querySelector("[data-overlay-row]")?.getAttribute("data-overlay-row") || null).catch(() => null);
      if (!id) break;
      await page.locator(`[data-testid="reference-more-${id}"]`).click({ timeout: 4000 }); await page.waitForTimeout(250);
      await page.locator("[role=menuitem]", { hasText: /^Remove overlay$/ }).click({ timeout: 4000 }); await page.waitForTimeout(700);
    }
  } catch (_) { /* best effort — the site delete below still runs */ }
  await page.waitForTimeout(2500);
  const gone = await page.evaluate(async ([id, k]) => {
    try {
      const all = JSON.parse(localStorage.getItem(k) || "{}"); delete all[id]; localStorage.setItem(k, JSON.stringify(all));
      if (window.pfSupabase) { await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id); await window.pfSupabase.from("sites").delete().eq("id", id); }
      const q = window.pfSupabase ? await window.pfSupabase.from("sites").select("id").eq("id", id) : { data: [] };
      return { local: !JSON.parse(localStorage.getItem(k) || "{}")[id], cloud: !(q.data && q.data.length) };
    } catch (e) { return { error: String(e) }; }
  }, [ID, KEY || "planarfit:sites:v1"]).catch((e) => ({ error: String(e) }));
  check("throwaway site deleted (local + cloud) and verified gone", !!gone.local && !!gone.cloud, JSON.stringify(gone));
  await s.close();
}
console.log(failed ? `FAIL (${failed})` : "PASS");
process.exit(failed ? 1 : 0);
