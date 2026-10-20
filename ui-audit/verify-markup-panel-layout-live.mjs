/* verify-markup-panel-layout-live — B2386752 / V1815136, driven LIVE as the test account (signedInSession).
 *
 * On a THROWAWAY plan (created here, deleted at the end — owner constraint #15): drop a Text box, open its Properties and check the
 * layout-"A" panel (✎ Edit text first and plain; Text → Appearance → Size & position; no "pt" beside Weight), turn on strikethrough +
 * all caps + bottom alignment, drag the bottom grip taller, then RELOAD and prove all three persisted (local copy AND the cloud row)
 * and still render. Then export a PDF twice — flattened, and with "Flatten markups" off — and prove the picture and the editable
 * annotation both carry the strikethrough and the capitals.
 *
 * KNOWN-GOOD ARM (CLAUDE.md DRIVER-SCROLL §6 clause 6): before the new fields are touched the box must draw its typed mixed-case text with
 * no decoration; if it does not, the run is VOID.
 *
 * Usage: BASE_URL=https://planyr.io E2E_LOGIN_KEY=… node ui-audit/verify-markup-panel-layout-live.mjs [--out <dir>] */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertMeasurable, pacedWait } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const BASE = (process.env.BASE_URL || "https://planyr.io").replace(/\/$/, "");
const OUT = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "/tmp/panel-layout-live";
mkdirSync(OUT, { recursive: true });
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let SITE_ID = null;
const s = await openSignedIn({ base: BASE });
const { browser, page } = s;
console.log("signed in as", s.proof.email, "| /version.json:", JSON.stringify(s.build));
const UID = await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id);
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
const T = (id) => page.getByTestId(id);
const panel = T("property-panel");

// Hooks armed BEFORE the app loads: the E2E flag (read-only export hooks) and a capture of every PDF blob the app hands to the browser.
await page.addInitScript(() => {
  window.__PLANYR_E2E = true;
  window.__pdfs = [];
  const real = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (b) => {
    try {
      if (b && b.type === "application/pdf") b.arrayBuffer().then((ab) => {
        let str = ""; const u = new Uint8Array(ab);
        for (let i = 0; i < u.length; i += 0x8000) str += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
        window.__pdfs.push(btoa(str));
      });
    } catch (_) {}
    return real(b);
  };
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.download) return; return click.call(this); };
});

const callout = () => page.evaluate(([uid, sid]) => {
  const m = JSON.parse(localStorage.getItem("planarfit:sites:cloud:" + uid) || "{}");
  const loc = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const site = m[sid] || loc[sid] || {};
  return (site.callouts || [])[0] || null;
}, [UID, SITE_ID]);
const cloudCallout = async () => page.evaluate(async (sid) => {
  const r = await window.pfSupabase.from("site_elements").select("data").eq("site_id", sid).eq("kind", "callout");
  if (r.error) return { error: r.error.message };
  const row = (r.data || [])[0];
  return row ? (row.data?.json || row.data) : null;
}, SITE_ID);
const draw = () => page.evaluate(() => {
  const g = document.querySelector('[data-testid^="callout-"][data-feature]');
  if (!g) return null;
  const rect = g.querySelector('[data-testid^="callout-box-"]').getBoundingClientRect();
  const t = g.querySelector("text");
  const tr = t.getBoundingClientRect();
  return { text: t.textContent, deco: t.getAttribute("text-decoration"), textBottom: tr.bottom, boxBottom: rect.bottom, boxTop: rect.top, boxH: rect.height };
});

try {
  await page.goto(BASE + "/#/site-planner", { waitUntil: "load" });
  await sleep(2500);
  await T("map-toolbar-draw").click();
  await T("planner-canvas").waitFor({ timeout: 25000 });
  await sleep(1500);
  const b0 = await T("planner-canvas").boundingBox();
  await page.getByRole("button", { name: /^Text\s/ }).click();
  const tx = b0.x + 380, ty = b0.y + 300;
  await page.mouse.click(tx, ty);
  await page.getByPlaceholder("Type…").waitFor({ state: "visible" });
  await page.keyboard.type("Typed in Mixed Case");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await sleep(1200);
  SITE_ID = await page.evaluate(() => localStorage.getItem("planarfit:currentSite:v1"));
  console.log("throwaway site id:", SITE_ID);
  ok("a throwaway text box exists", !!(await callout()));
  await assertMeasurable(page, "verify-markup-panel-layout-live");

  // KNOWN-GOOD ARM
  const d0 = await draw();
  ok("known-good arm: the untouched box draws the typed mixed case with no decoration", d0 && d0.text === "Typed in Mixed Case" && !d0.deco, JSON.stringify(d0 && { text: d0.text, deco: d0.deco }));
  if (!(d0 && d0.text === "Typed in Mixed Case" && !d0.deco)) throw new Error("VOID: known-good arm did not report its known value");

  // select it, open Properties
  await page.mouse.click(tx, ty);
  await sleep(400);
  await page.locator("button", { hasText: /^Properties$/ }).first().click();
  await panel.waitFor({ timeout: 10000 });
  const labels = await panel.locator("[data-panel-section]").evaluateAll((els) => els.map((e) => e.textContent.trim()));
  ok("sections run Text → Appearance → Size & position", JSON.stringify(labels) === JSON.stringify(["Text", "Appearance", "Size & position"]), JSON.stringify(labels));
  const edit = T("callout-edit-text"), textLabel = panel.locator('[data-panel-section="text"]');
  const eb = await edit.boundingBox(), lb = await textLabel.boundingBox();
  ok("✎ Edit text is at the very top, above the Text label", eb.y + eb.height <= lb.y + 1);
  const bg = (l) => l.evaluate((e) => getComputedStyle(e).backgroundColor);
  ok("Edit text is a plain button (same fill as the Lock chip)", (await bg(edit)) === (await bg(panel.getByRole("button", { name: /^(Lock|Unlock)$/ }).first())));
  const weightRow = (await panel.locator('[data-field-group="1"][data-row-align="1"]').filter({ has: page.getByText("Weight", { exact: true }) }).first().innerText()).replace(/\s+/g, " ");
  ok('no "pt" beside Weight', !/\bpt\b/.test(weightRow), weightRow);
  ok("pattern select is right-aligned", (await panel.locator('select[aria-label$="pattern"]').first().evaluate((e) => getComputedStyle(e).textAlignLast)) === "right");
  ok("no horizontal overflow", (await panel.evaluate((el) => el.scrollWidth - el.clientWidth)) <= 1);

  // the new fields
  await T("callout-strike").click();
  await T("callout-caps").click();
  await T("callout-valign-bottom").click();
  const grip = T("callout-handle-b");
  await grip.waitFor({ timeout: 8000 });
  const gb = await grip.boundingBox();
  const gx = gb.x + gb.width / 2, gy = gb.y + gb.height / 2;
  await page.mouse.move(gx, gy); await page.mouse.down();
  await page.mouse.move(gx, gy + 30, { steps: 6 }); await page.mouse.move(gx, gy + 60, { steps: 6 });
  await page.mouse.up();
  await sleep(1500);
  const c1 = await callout();
  ok("stored: strike + caps + bottom + a fixed height; the typed text is NOT rewritten", c1 && c1.strike === true && c1.caps === true && c1.valign === "bottom" && c1.boxH > 0 && c1.text === "Typed in Mixed Case", JSON.stringify(c1 && { strike: c1.strike, caps: c1.caps, valign: c1.valign, boxH: c1.boxH, text: c1.text }));
  const d1 = await draw();
  ok("renders: capitals, struck through, text at the foot of a taller box", d1 && d1.text === "TYPED IN MIXED CASE" && d1.deco === "line-through" && d1.boxBottom - d1.textBottom < d1.boxH * 0.35 && d1.textBottom - d1.boxTop > d1.boxH * 0.6, JSON.stringify(d1));

  // cloud persistence, then a RELOAD
  let cc = null;
  for (let i = 0; i < 30; i++) { cc = await cloudCallout(); if (cc && cc.strike === true && cc.boxH > 0) break; await sleep(1000); }
  ok("the cloud row carries strike + caps + valign + boxH", cc && cc.strike === true && cc.caps === true && cc.valign === "bottom" && cc.boxH > 0, JSON.stringify(cc && { strike: cc.strike, caps: cc.caps, valign: cc.valign, boxH: cc.boxH }));
  await page.reload({ waitUntil: "load" });
  await sleep(3000);
  if (!(await T("planner-canvas").isVisible().catch(() => false))) { await T("map-toolbar-draw").click().catch(() => {}); await T("planner-canvas").waitFor({ timeout: 25000 }); await sleep(1500); }
  const d2 = await draw();
  ok("after a reload: still capitals, struck through, bottom-aligned in the taller box", d2 && d2.text === "TYPED IN MIXED CASE" && d2.deco === "line-through" && d2.boxBottom - d2.textBottom < d2.boxH * 0.35, JSON.stringify(d2));
  const c2 = await callout();
  ok("after a reload the typed text is still mixed case", c2 && c2.text === "Typed in Mixed Case");

  // PDF-PARITY — the compose screen's picture is the clone of the canvas SVG
  const svgOk = await page.evaluate(async () => {
    const svg = window.__plannerExportSvg ? await window.__plannerExportSvg() : null;
    if (!svg) return null;
    const str = typeof svg === "string" ? svg : new XMLSerializer().serializeToString(svg);
    return { deco: /text-decoration="line-through"/.test(str), caps: str.includes("TYPED IN MIXED CASE"), mixed: str.includes("Typed in Mixed Case") };
  });
  if (svgOk) ok("the export clone carries the strikethrough and the capitals (and not the typed case)", svgOk.deco && svgOk.caps && !svgOk.mixed, JSON.stringify(svgOk));
  else console.log("NOTE — the E2E-gated export-clone hook returned nothing on production; PDF parity is judged from the two real PDF exports below");

  async function exportPdf(flatten) {
    await page.getByRole("button", { name: "File ▾" }).click();
    await page.getByRole("button", { name: "Download PDF / pick frame…" }).click();
    await pacedWait(page, 600);
    await page.getByRole("button", { name: "Continue ➜" }).click();
    await pacedWait(page, 1500);
    const box = page.getByLabel("Flatten markups");
    if ((await box.isChecked()) !== flatten) await box.click();
    const before = await page.evaluate(() => window.__pdfs.length);
    await page.getByRole("button", { name: /Download PDF/ }).first().click();
    for (let i = 0; i < 160; i++) { if ((await page.evaluate(() => window.__pdfs.length)) > before) break; await page.waitForTimeout(250); }
    const pdfs = await page.evaluate(() => window.__pdfs);
    if (pdfs.length <= before) throw new Error("no PDF was produced within 40s");
    const buf = Buffer.from(pdfs[pdfs.length - 1], "base64");
    await pacedWait(page, 800);
    return buf;
  }
  const flat = await exportPdf(true);
  writeFileSync(join(OUT, "flat.pdf"), flat);
  ok("flattened PDF: produced, and carries no annotations (the picture is the page)", flat.length > 5000 && !/\/Annots/.test(flat.toString("latin1")), `${flat.length} B`);
  const edit2 = await exportPdf(false);
  writeFileSync(join(OUT, "editable.pdf"), edit2);
  const txt = edit2.toString("latin1");
  ok("editable PDF: a FreeText annotation holds the capitals", /\/Subtype\s*\/FreeText/.test(txt) && txt.includes("TYPED IN MIXED CASE"));
  ok("editable PDF: the appearance stream draws the strikethrough rule (an extra stroked line beside the text)", /\bl S\b/.test(txt));
  ok("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) { console.error("HARNESS ERROR:", e.message); ok("harness ran to completion", false, e.message); }
finally {
  const gone = !SITE_ID ? true : await page.evaluate(async ([id, uid]) => {
    await window.pfSupabase.from("site_elements").delete().eq("site_id", id);
    await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    await window.pfSupabase.from("sites").delete().eq("id", id);
    const q = await window.pfSupabase.from("sites").select("id").eq("id", id);
    try { const k = "planarfit:sites:cloud:" + uid; const m = JSON.parse(localStorage.getItem(k) || "{}"); delete m[id]; localStorage.setItem(k, JSON.stringify(m)); } catch (e) {}
    return !q.error && (q.data || []).length === 0;
  }, [SITE_ID, UID]).catch(() => false);
  ok("throwaway site deleted and confirmed gone from the cloud", gone);
  await browser.close();
}
const fails = results.filter((r) => !r.pass);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
