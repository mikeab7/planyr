/* verify-overlays-panel-live — V1573328 (B2158080): the redesigned OVERLAYS panel, signed in as the throwaway test
 * account on a real deploy.
 *   E2E_LOGIN_KEY=… node ui-audit/verify-overlays-panel-live.mjs [https://planyr.io] [--expect-sha <merge sha>]
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
  await assertMeasurable(page, "verify-overlays-panel-live");
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
  check("the Overlays panel opens (header OVERLAYS + site · plan)", (await page.locator('[data-testid="panel-chrome-references"]').innerText()).replace(/\s+/g, " ").includes("zz Overlays panel check · Plan 1"));
  check("no '?' help button and no explanatory paragraphs", !(await page.locator('[data-testid="overlays-panel"]').innerText()).match(/Map overlays are managed here|Drop a site-plan|PDF, image or CAD/) && (await page.locator('[data-testid="panel-chrome-references"] [aria-label*="elp"]').count()) === 0);

  const order = () => page.evaluate(() => Array.from(document.querySelectorAll("[data-overlay-row]")).map((n) => n.getAttribute("data-overlay-row")));
  const names = () => page.evaluate(() => Array.from(document.querySelectorAll("[data-overlay-row] [data-testid=overlay-row-name]")).map((n) => n.textContent));
  const sub = (id) => page.locator(`[data-overlay-row="${id}"] [data-testid="overlay-row-sub"]`).first().innerText();
  const undo = async () => { await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur()); await page.locator('button[aria-label="Undo"]').click(); await page.waitForTimeout(450); };
  const stored = () => page.evaluate(([k, id]) => { const m = JSON.parse(localStorage.getItem(k) || "{}"); const r = Object.values(m).find((x) => x && (x.id === id)); return (r && r.sheetOverlays) || []; }, [KEY, ID]);
  const cloud = () => page.evaluate(async (id) => { const q = await window.pfSupabase.from("sites").select("data").eq("id", id).single(); return (q.data && q.data.data && q.data.data.sheetOverlays || []).map((o) => o.id); }, ID);

  // ---- 1. add a PDF and an image -------------------------------------------------------------------------
  await page.locator('[data-testid="overlay-file-input"]').setInputFiles(PDF);
  await page.waitForFunction(() => document.querySelectorAll("[data-overlay-row]").length >= 1, null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  const pdfId = (await order())[0];
  await page.locator('[data-testid="overlay-file-input"]').setInputFiles(PNG);
  await page.waitForFunction(() => document.querySelectorAll("[data-overlay-row]").length >= 2, null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  const imgId = (await order())[0];
  check("a PDF and an image were added", !!pdfId && !!imgId && pdfId !== imgId, `${pdfId} / ${imgId}`);
  const pdfSub0 = await sub(pdfId), imgSub0 = await sub(imgId);
  check("the PDF row reads either its ratio or amber 'not scaled' (it depends on whether the sheet carried a scale note)", /^1" = |^not scaled/.test(pdfSub0), pdfSub0);
  check("the IMAGE row shows NO ratio and says 'not scaled'", imgSub0 === "not scaled", imgSub0);
  await page.screenshot({ path: OUT + "overlays-live-1-added.png" });

  // ---- 2. image: Trace a length clears the amber ----------------------------------------------------------------
  await page.locator(`[data-testid="reference-open-${imgId}"]`).click(); await page.waitForTimeout(400);
  check("the image's Placement offers exactly Trace + Match (no Set scale, no ratio)", (await page.locator('[data-testid="overlay-scale-trace"]').count()) === 1 && (await page.locator('[data-testid="overlay-scale-set"]').count()) === 0 && (await page.locator('[data-testid="overlay-scale-ratio"]').count()) === 0);
  await page.locator('[data-testid="overlay-scale-trace"]').click(); await page.waitForTimeout(400);
  const cv = await page.getByTestId("planner-canvas").boundingBox();
  await page.mouse.click(cv.x + cv.width * 0.45, cv.y + cv.height * 0.5); await page.waitForTimeout(300);
  await page.mouse.click(cv.x + cv.width * 0.45 + 140, cv.y + cv.height * 0.5); await page.waitForTimeout(500);
  const ne = page.locator("input.num-edit-field");
  if (await ne.count()) { await ne.fill("100"); await ne.press("Enter"); }
  await page.waitForTimeout(800);
  check("Trace a length clears the amber (row and box)", (await sub(imgId)) !== "not scaled" && (await page.locator('[data-testid="overlay-not-scaled"]').count()) === 0, await sub(imgId));

  // ---- 3. PDF: Set scale preset changes the ratio; reload keeps it ------------------------------------------------
  await page.locator(`[data-testid="reference-open-${pdfId}"]`).click(); await page.waitForTimeout(400);
  await page.locator('[data-testid="overlay-scale-set"]').click(); await page.waitForTimeout(300);
  await page.locator('[data-testid="overlay-scale-preset"]').selectOption("eng-60"); await page.waitForTimeout(600);
  check("Set scale → 1\" = 60' changes the ratio on the row and in Placement", (await sub(pdfId)).startsWith(`1" = 60'`) && (await page.locator('[data-testid="overlay-scale-ratio"]').innerText()) === `1" = 60'`, await sub(pdfId));
  await page.waitForTimeout(2500);
  await page.reload({ waitUntil: "load" }); await page.getByTestId("planner-canvas").waitFor({ timeout: 45000 }); await page.waitForTimeout(3500);
  await page.evaluate(() => { if (!document.querySelector('[data-testid="overlays-panel"]')) document.querySelector('[data-rail-tab="references"]')?.click(); }); await page.waitForTimeout(900);
  check("after a reload the PDF keeps its scale", (await sub(pdfId)).startsWith(`1" = 60'`), await sub(pdfId));

  // ---- 4. rotation ------------------------------------------------------------------------------------------------
  if ((await page.locator('[data-testid="overlay-rotation"]').count()) === 0) await page.locator(`[data-testid="reference-open-${pdfId}"]`).click();
  await page.waitForTimeout(300);
  const rot = () => page.locator('[data-testid="overlay-rotation"]').inputValue();
  await page.locator('[data-testid="overlay-rot-plus"]').click(); await page.waitForTimeout(300);
  const r1 = await rot(); await page.locator('[data-testid="overlay-rot-cw90"]').click(); await page.waitForTimeout(300);
  const r2 = await rot(); await page.locator('[data-testid="overlay-rot-ccw90"]').click(); await page.waitForTimeout(300);
  const r3 = await rot();
  check("rotation: + is 1°, 90° clockwise adds 90, 90° anticlockwise subtracts 90", r1 === "1" && r2 === "91" && r3 === "1", `${r1} → ${r2} → ${r3}`);
  await undo(); const u1 = await rot(); await undo(); const u2 = await rot(); await undo(); const u3 = await rot();
  check("each rotation undoes in ONE step", u1 === "91" && u2 === "1" && u3 === "0", `${u1} → ${u2} → ${u3}`);

  // ---- 5. crop: ONE control, Edit + Reset, trim fields inside the dialog ----------------------------------------------
  check("ONE crop control (Edit + Reset) and a shape line", (await page.locator('[data-testid="overlay-crop-open"]').count()) === 1 && (await page.locator('[data-testid="overlay-crop-shape"]').innerText()) === "Not cropped");
  await page.locator('[data-testid="overlay-crop-open"]').click(); await page.waitForTimeout(800);
  const dlg = page.locator('[data-testid="overlay-crop-dialog"]');
  const trim = dlg.locator('input[aria-label="Crop Left edge"]');
  check("the four trim-by-feet fields are inside the Crop dialog", (await dlg.locator('input[aria-label^="Crop "]').count()) === 4);
  await trim.fill("120"); await page.waitForTimeout(700);
  const cropStored = (await stored()).find((o) => o.id === pdfId);
  check("a trim field writes a rectangle crop", !!(cropStored && cropStored.crop && (cropStored.crop.kind === "rect" || cropStored.crop.kind === undefined) && cropStored.crop.x > 0), JSON.stringify(cropStored && cropStored.crop));
  await dlg.locator("button", { hasText: "Cancel" }).click(); await page.waitForTimeout(400);
  check("the Crop section now says Rectangle", (await page.locator('[data-testid="overlay-crop-shape"]').innerText()) === "Rectangle");
  await page.locator('[data-testid="overlay-crop-reset"]').click(); await page.waitForTimeout(500);
  check("Reset returns the whole sheet", (await page.locator('[data-testid="overlay-crop-shape"]').innerText()) === "Not cropped");

  // ---- 6. Draws / drag / Move up-down / reload keeps the order --------------------------------------------------------
  await page.locator(`[data-testid="reference-above-${pdfId}"]`).click(); await page.waitForTimeout(400);
  check("Draws → In front puts the PDF in the front band", (await page.locator(`[data-overlay-row="${pdfId}"]`).getAttribute("data-reference-band")) === "above");
  await page.locator(`[data-testid="reference-below-${pdfId}"]`).click(); await page.waitForTimeout(400);
  const o0 = await order();
  await page.locator(`[data-overlay-row="${o0[o0.length - 1]}"] [data-overlay-drag-handle]`).dragTo(page.locator(`[data-overlay-row="${o0[0]}"] [data-overlay-drag-handle]`), { targetPosition: { x: 40, y: 3 } });
  await page.waitForTimeout(700);
  const o1 = await order();
  check("dragging a row reorders the list", JSON.stringify(o1) !== JSON.stringify(o0), `${o0} → ${o1}`);
  await page.locator(`[data-testid="reference-more-${o1[o1.length - 1]}"]`).click(); await page.waitForTimeout(250);
  await page.locator("[role=menuitem]", { hasText: /^Move up$/ }).click(); await page.waitForTimeout(500);
  const o2 = await order();
  check("⋯ → Move up moves the row one place", JSON.stringify(o2) !== JSON.stringify(o1) && o2[o2.length - 2] === o1[o1.length - 1], `${o1} → ${o2}`);
  await page.waitForTimeout(3500);
  const draw2 = (await stored()).map((o) => o.id).reverse();
  const cloud2 = (await cloud()).reverse();
  check("the new order is in the device store AND in the CLOUD row (the boot-heal bug, B2158081)", JSON.stringify(draw2) === JSON.stringify(o2) && JSON.stringify(cloud2) === JSON.stringify(o2), `store ${draw2} · cloud ${cloud2} · panel ${o2}`);
  await page.reload({ waitUntil: "load" }); await page.getByTestId("planner-canvas").waitFor({ timeout: 45000 }); await page.waitForTimeout(3500);
  await page.evaluate(() => { if (!document.querySelector('[data-testid="overlays-panel"]')) document.querySelector('[data-rail-tab="references"]')?.click(); }); await page.waitForTimeout(900);
  check("a reload keeps the order", JSON.stringify(await order()) === JSON.stringify(o2), `${await order()}`);

  // ---- 7. ⋯ → Remove overlay; Undo brings it back ----------------------------------------------------------------------
  const victim = (await order())[0];
  await page.locator(`[data-testid="reference-more-${victim}"]`).click(); await page.waitForTimeout(250);
  const items = await page.locator("[role=menuitem]").allInnerTexts();
  check("the ⋯ menu lists the owner's items, Remove overlay last", items[0] === "Rename…" && items[items.length - 1] === "Remove overlay" && ["Lock in place", "Hide", "Zoom to", "Size to view", "Copy", "Duplicate", "Align to parcel edge", "Move up", "Move down"].every((t) => items.includes(t)), items.join(" | "));
  await page.locator("[role=menuitem]", { hasText: /^Remove overlay$/ }).click(); await page.waitForTimeout(600);
  check("⋯ → Remove overlay removes it", !(await order()).includes(victim));
  await undo();
  check("Undo brings it back", (await order()).includes(victim));

  // ---- 8. resize the panel narrowest → widest with an overlay open: nothing clips or scrolls sideways ------------------------
  if ((await page.locator('[data-testid="overlay-scale-group"]').count()) === 0) await page.locator(`[data-testid="reference-open-${pdfId}"]`).click();
  const grip = page.locator('[title="Drag to resize"]').first();
  const gb = await grip.boundingBox();
  const panelLeft = await page.evaluate(() => document.querySelector('[data-testid="left-menu-panel"]')?.getBoundingClientRect().left ?? 0);
  const widthsSeen = [];
  for (const target of [240, 300, 400, 520, 620, 240]) {
    const gb2 = await grip.boundingBox();
    await page.mouse.move(gb2.x + gb2.width / 2, gb2.y + gb2.height / 2); await page.mouse.down();
    await page.mouse.move(panelLeft + target + gb2.width / 2, gb2.y + gb2.height / 2, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(600);
    const m = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="overlays-panel"]'); const rr = root.getBoundingClientRect(); const sc = root.closest("[data-panel-body]");
      const poke = [], clipped = [];
      for (const el of root.querySelectorAll("*")) { if (el.closest("svg")) continue; const r = el.getBoundingClientRect(); if (!r.width) continue; if (r.left < rr.left - 1 || r.right > rr.right + 1) poke.push(el.tagName + ":" + (el.getAttribute("data-testid") || "")); if (el.scrollWidth > el.clientWidth + 1 && !["INPUT", "SELECT"].includes(el.tagName) && getComputedStyle(el).display !== "inline" && el.clientWidth > 0) clipped.push(el.tagName + ":" + (el.getAttribute("data-testid") || (el.textContent || "").slice(0, 12))); }
      return { w: Math.round(rr.width), overflow: sc ? sc.scrollWidth - sc.clientWidth : 0, poke: poke.slice(0, 3), clipped: clipped.slice(0, 3) };
    });
    widthsSeen.push(m.w);
    check(`panel at ${m.w}px: no sideways scroll, nothing pokes out, no clipped text`, m.overflow <= 0 && m.poke.length === 0 && m.clipped.length === 0, JSON.stringify(m));
  }
  check("the resize really swept the range (instrument saw both ends)", Math.min(...widthsSeen) <= 220 && Math.max(...widthsSeen) >= 590, widthsSeen.join(","));
  await page.screenshot({ path: OUT + "overlays-live-8-narrow.png" });

  const b2 = await served();
  check("the build served at the end is the build served at the start", b2 === b1, `${b1} → ${b2}`);
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
