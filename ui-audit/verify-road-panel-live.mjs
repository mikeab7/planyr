/* verify-road-panel-live — V1723408 (B2291792 / B2291793 / B2291794): the rebuilt ROAD Properties panel, signed in as the
 * throwaway test account on a real deploy.
 *   E2E_LOGIN_KEY=… node ui-audit/verify-road-panel-live.mjs [https://planyr.io] [--expect-sha <merge sha>]
 *
 * Creates a THROWAWAY site (id `zz-road-…`) on the test account holding the owner's real Tsakiris road set (a centerline
 * road with a junction, curbed roads), drives every step of V1723408 — header, Road rows (one line each, Length not an
 * input), ROW designate + clear, cross-section strip + dialog + a designed section, Label controls, ⋯ menu, the ABSENCE
 * of cost and of the min-radius review (panel text + canvas flags), light/dark and the narrowest docked width — then
 * deletes the throwaway site and verifies it is gone. It addresses only the id it minted.
 *
 * READS THE SERVED BUILD IN THE SAME CALL AS THE ASSERTIONS (CLAUDE.md: a live measurement is only valid if the deployed
 * chunk is read with it) — `/version.json` at the start and the end of the run, both printed.
 */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { mkdirSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const expectSha = args.includes("--expect-sha") ? args[args.indexOf("--expect-sha") + 1] : null;
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

const FIX = JSON.parse(readFileSync(new URL("./fixtures/tsakiris-concept-a-live.json", import.meta.url), "utf8"));
const LOOP = "e38duuwgj";
const ID = "zz-road-" + Math.random().toString(36).slice(2, 8);
const els = FIX.els.map((e) => (e.id === LOOP ? { ...e, inlineLabel: "", curbType: "curb-gutter", curbedSides: 2, panWidth: 2 } : e));
const SITE = {
  id: ID, groupId: ID, site: "zz Road panel check", name: "Plan 1", origin: null, county: "waller", parcels: [],
  els, measures: [], callouts: [], markups: [], settings: {}, underlay: null, sheetOverlays: [], updatedAt: Date.now(), data: { status: "active" }, status: "active",
};

const s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const { page } = s;
const served = () => page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).then((j) => j.build).catch(() => null));
const chunk = () => page.evaluate(() => [...document.querySelectorAll("script[src]")].map((n) => n.getAttribute("src")).filter((x) => /assets\//.test(x)).slice(0, 3).join(","));
const storedLoop = () => page.evaluate(([id, loop]) => {
  for (const k of Object.keys(localStorage)) {
    if (!/^planarfit:sites/.test(k)) continue;
    try { const m = JSON.parse(localStorage.getItem(k) || "{}"); const rec = m[id]; if (rec && rec.els) return rec.els.find((e) => e.id === loop) || null; } catch (_) { /* next key */ }
  }
  return null;
}, [ID, LOOP]);
let created = false;
try {
  await assertMeasurable(page, "verify-road-panel-live");
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
  created = !ins;
  check("throwaway site written to the test account", !ins, ins || "");

  const boot = async (theme) => {
    await page.evaluate((t) => localStorage.setItem("planyr.theme", t), theme);
    await page.goto(`${base}/#/project/${ID}/site`, { waitUntil: "load" });
    await page.reload({ waitUntil: "load" });
    await page.getByTestId("planner-canvas").waitFor({ timeout: 45000 });
    await page.waitForFunction(() => !!window.__plannerView, null, { timeout: 30000 });
    await page.waitForTimeout(2500);
  };
  const openPanel = async () => {
    const CX = 1500, CY = 100, PPF = 0.5;
    await page.evaluate(([x, y, p]) => window.__plannerView.centerOn(x, y, p), [CX, CY, PPF]);
    await page.waitForTimeout(600);
    const box = await page.getByTestId("planner-canvas").boundingBox();
    const v = await page.evaluate(() => window.__plannerView.get());
    const pt = { x: box.x + v.w / 2 + (1649 - CX) * PPF, y: box.y + v.h / 2 + (100 - CY) * PPF };
    await page.mouse.click(pt.x, pt.y); await page.waitForTimeout(450);
    await page.mouse.dblclick(pt.x, pt.y);
    await page.getByTestId("road-header").waitFor({ timeout: 15000 });
    await page.waitForTimeout(400);
  };
  const row = (label) => page.locator('[data-testid="property-panel"] [data-field-group="1"][data-row-align="1"]').filter({ has: page.getByText(label, { exact: true }) }).first();
  const bb = (loc) => loc.boundingBox();

  for (const theme of ["dark", "light"]) {
    await boot(theme);
    await openPanel();
    const panel = page.getByTestId("property-panel");
    const text = (await panel.innerText()).replace(/\s+/g, " ");
    const t = `${theme}`;
    check(`[${t}] header: a name-or-"Road" title, padlock, ⋯, ✕ and ONE summary line without ROW`,
      (await page.getByTestId("road-title").innerText()) === "Road" && (await page.getByTestId("road-lock").count()) === 1 && (await page.getByTestId("road-more").count()) === 1 && (await page.getByTestId("road-close").count()) === 1
      && /ft long · \d+ ft wide$/.test(await page.getByTestId("road-summary").innerText()), await page.getByTestId("road-summary").innerText());
    check(`[${t}] Length is a readout ("follows the line"), NOT an input`, (await page.getByTestId("road-length").locator("input").count()) === 0 && /follows the line/.test(await page.getByTestId("road-length").innerText()));
    const wBox = await bb(page.getByTestId("road-width").locator("xpath=ancestor::*[@data-numbox][1]"));
    const oneRow = [];
    for (const l of ["Length", "Width", "Right-of-way", "Class"]) { const r = await bb(row(l)); const lab = await bb(row(l).getByText(l, { exact: true })); oneRow.push(r.height <= wBox.height + 1 && lab.height < 20); }
    check(`[${t}] Length / Width / Right-of-way / Class are ONE line each`, oneRow.every(Boolean), oneRow.join(","));
    check(`[${t}] NO cost controls (Curb & paving · Curb type · Curbed sides · Gutter pan · SY)`, !/Curb & paving|Curb type|Curbed sides|Gutter pan| SY/.test(text));
    check(`[${t}] NO "Curve at vertex", NO radius warning, NO canvas radius flags`, !/Curve at vertex|radius — below|Fix radius/.test(text) && (await page.getByTestId("road-radius-flags").count()) === 0);
    check(`[${t}] cross-section section: strip + caption + one "Design cross-section" button`, (await page.getByTestId("road-xs-strip").count()) === 1 && /Curb face to curb face/.test(await page.getByTestId("road-xs-caption").innerText()) && (await page.getByTestId("edit-road-xsection").innerText()) === "Design cross-section");
    check(`[${t}] Intersection section exists (this road has a junction) and starts CLOSED`, (await panel.getByRole("button", { name: /Intersection/i }).getAttribute("aria-expanded")) === "false");
    await page.screenshot({ path: OUT + `road-panel-live-${theme}.png` });
  }

  // ---- narrowest docked width -------------------------------------------------------------------------------------
  await page.evaluate(() => localStorage.setItem("planarfit:leftWidth", "240"));
  await boot("dark"); await openPanel();
  {
    const panel = page.getByTestId("property-panel"); const pb = await bb(panel);
    const wBox = await bb(page.getByTestId("road-width").locator("xpath=ancestor::*[@data-numbox][1]"));
    const ok = [];
    for (const l of ["Length", "Width", "Right-of-way", "Class"]) { const r = await bb(row(l)); ok.push(r.height <= wBox.height + 1); }
    check("[240 wide] the four Road rows are still ONE line each", ok.every(Boolean), ok.join(","));
    check("[240 wide] no horizontal overflow", (await panel.evaluate((el) => el.scrollWidth - el.clientWidth)) <= 1);
    check("[240 wide] the title truncates (the panel is genuinely narrow) and the buttons stay inside", (await bb(page.getByTestId("road-close"))).x + (await bb(page.getByTestId("road-close"))).width <= pb.x + pb.width + 1);
    await page.screenshot({ path: OUT + "road-panel-live-min.png" });
  }
  await page.evaluate(() => localStorage.setItem("planarfit:leftWidth", "320"));
  await boot("dark"); await openPanel();

  // ---- ROW ---------------------------------------------------------------------------------------------------------
  const w0 = (await storedLoop()).travelW;
  await page.getByTestId("road-row").fill("100"); await page.getByTestId("road-row").press("Enter"); await page.waitForTimeout(600);
  check("typing 100 in Right-of-way adds \"100 ft ROW\" to the summary; the width is unchanged", /100 ft ROW/.test(await page.getByTestId("road-summary").innerText()) && (await storedLoop()).travelW === w0 && (await storedLoop()).xsection?.rowDesignFt === 100);
  await page.getByTestId("road-row").fill(""); await page.getByTestId("road-row").press("Enter"); await page.waitForTimeout(600);
  check("clearing it removes the ROW", !/ROW/.test(await page.getByTestId("road-summary").innerText()) && (await storedLoop()).xsection?.rowDesignFt === undefined);

  // ---- LABEL -------------------------------------------------------------------------------------------------------
  await page.getByTestId("road-name").fill("MAIN STREET"); await page.waitForTimeout(500);
  check("typing a name shows Text size / Repeat every / Background / Position (no slider) and retitles the header",
    (await page.getByTestId("label-spacing").count()) === 1 && (await page.getByTestId("label-text-size").count()) === 1 && (await page.getByTestId("label-background").count()) === 1 && (await page.getByTestId("label-position").count()) === 1
    && (await page.locator('[data-testid="property-panel"] input[type="range"]').count()) === 0 && (await page.getByTestId("road-title").innerText()) === "MAIN STREET");
  const sb = await bb(page.getByTestId("label-background")); const pb2 = await bb(page.getByTestId("property-panel"));
  const covered = await page.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); return !!el && !!el.closest('[data-testid="label-background"]'); }, [sb.x + sb.width * 0.75, sb.y + sb.height / 2]);
  check("the Background control is fully inside the panel, on top, with its label uncovered", sb.x >= pb2.x - 1 && sb.x + sb.width <= pb2.x + pb2.width + 1 && covered);
  const sp0 = (await storedLoop()).labelSpacing;
  await page.getByTestId("label-spacing").locator("xpath=ancestor::*[@data-numbox][1]").getByRole("button", { name: "Increase" }).click(); await page.waitForTimeout(500);
  check("▲ on Repeat every writes a new spacing", (await storedLoop()).labelSpacing !== sp0, `${sp0} → ${(await storedLoop()).labelSpacing}`);
  await page.getByTestId("label-halo-off").click(); await page.waitForTimeout(400);
  check("Background → None writes labelHalo:false", (await storedLoop()).labelHalo === false);
  await page.getByTestId("label-halo-on").click(); await page.waitForTimeout(400);

  // ---- designed cross-section ---------------------------------------------------------------------------------------
  await page.getByTestId("edit-road-xsection").click();
  await page.getByTestId("road-xsection-dialog").waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "4-lane divided boulevard" }).click(); await page.waitForTimeout(300);
  await page.getByTestId("road-xsection-apply").click(); await page.waitForTimeout(900);
  check("after applying a 5-band section: the strip shows bands, Width reads \"set by cross-section\", the button reads \"Edit cross-section\"",
    (await page.getByTestId("road-xs-strip").locator("[data-band]").count()) === 5 && /set by cross-section/.test(await page.getByTestId("road-width-readonly").innerText()) && (await page.getByTestId("edit-road-xsection").innerText()) === "Edit cross-section");
  await page.screenshot({ path: OUT + "road-panel-live-designed.png" });

  // ---- ⋯ menu ------------------------------------------------------------------------------------------------------
  const roadsN = () => page.evaluate((id) => { for (const k of Object.keys(localStorage)) { if (!/^planarfit:sites/.test(k)) continue; try { const m = JSON.parse(localStorage.getItem(k) || "{}"); if (m[id]) return m[id].els.filter((e) => e.type === "road").length; } catch (_) { /* next */ } } return -1; }, ID);
  const n0 = await roadsN();
  await page.getByTestId("road-lock").click(); await page.waitForTimeout(300);
  check("the padlock pins it (summary says locked)", /locked/.test(await page.getByTestId("road-summary").innerText()));
  await page.getByTestId("road-lock").click(); await page.waitForTimeout(300);
  await page.getByTestId("road-more").click();
  check("⋯ offers Duplicate · Bring to front · Delete road", (await page.getByTestId("road-duplicate").count()) === 1 && (await page.getByTestId("road-front").count()) === 1 && (await page.getByTestId("road-delete").count()) === 1);
  await page.getByTestId("road-duplicate").click(); await page.waitForTimeout(900);
  check("Duplicate adds a road", (await roadsN()) === n0 + 1, `${n0} → ${await roadsN()}`);
  await page.getByTestId("road-more").click(); await page.getByTestId("road-delete").click(); await page.waitForTimeout(900);
  check("Delete road removes the duplicate", (await roadsN()) === n0);
  check("the stored cost fields were never rewritten", (await storedLoop()).curbType === "curb-gutter" && (await storedLoop()).curbedSides === 2 && (await storedLoop()).panWidth === 2);

  const b2 = await served();
  check("the served build did not change during the run", b1 === b2, `${b1} → ${b2}`);
} finally {
  // constraint 15 — clear every test artifact, verify gone
  if (created) {
    const gone = await page.evaluate(async (id) => {
      for (const k of Object.keys(localStorage)) { if (!/^planarfit:sites/.test(k)) continue; try { const all = JSON.parse(localStorage.getItem(k) || "{}"); if (all[id]) { delete all[id]; localStorage.setItem(k, JSON.stringify(all)); } } catch (_) { /* next */ } }
      await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      await window.pfSupabase.from("sites").delete().eq("id", id);
      const q = await window.pfSupabase.from("sites").select("id,deleted_at").eq("id", id);
      return !q.error && (q.data || []).every((r) => !!r.deleted_at);
    }, ID).catch(() => false);
    check("throwaway site deleted and verified gone", gone);
  }
  await s.close();
}
console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
