/* verify-markup-opacity-rotation-live — B2386752 / V1815136 step 5, driven LIVE as the test account (signedInSession).
 *
 * On a THROWAWAY plan (created here, deleted at the end — owner constraint #15): draw a LINE and a RECTANGLE with the real tools,
 * type a value into each one's opacity box, prove the stored value AND the painted drawing change, RELOAD and prove both survive.
 * Then tilt the rectangle with a quarter-turn button and prove the Level button exists ONLY while tilted and sets the angle back to 0.
 *
 * KNOWN-GOOD ARM: before anything is typed the line paints at full strength and the rectangle's Level button is absent; if not, VOID.
 *
 * Usage: BASE_URL=https://planyr.io E2E_LOGIN_KEY=… node ui-audit/verify-markup-opacity-rotation-live.mjs */
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const BASE = (process.env.BASE_URL || "https://planyr.io").replace(/\/$/, "");
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
await page.addInitScript(() => { window.__PLANYR_E2E = true; });

const markups = () => page.evaluate(([uid, sid]) => {
  const m = JSON.parse(localStorage.getItem("planarfit:sites:cloud:" + uid) || "{}");
  const loc = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  return ((m[sid] || loc[sid] || {}).markups || []).map((k) => ({ ...k }));
}, [UID, SITE_ID]);
const cloudMarkups = () => page.evaluate(async (sid) => {
  const r = await window.pfSupabase.from("site_elements").select("data").eq("site_id", sid).eq("kind", "markup");
  return r.error ? { error: r.error.message } : (r.data || []).map((x) => x.data?.json || x.data);
}, SITE_ID);
const kind = async (k) => (await markups()).find((m) => m.kind === k);
// painted opacity of the markup's real stroke node(s): the lowest stroke-opacity that is not the invisible hit target
const painted = (id) => page.evaluate((mid) => {
  const g = document.querySelector(`[data-markup="${mid}"]`);
  if (!g) return null;
  const vals = [...g.querySelectorAll("line, rect, path, polyline")].filter((n) => n.getAttribute("stroke") && !/0\.001/.test(n.getAttribute("stroke")) && n.getAttribute("stroke") !== "none").map((n) => Number(n.getAttribute("stroke-opacity") ?? 1));
  return vals.length ? Math.min(...vals) : null;
}, id);
async function drawWith(toolName, dx1, dy1, dx2, dy2) {
  const b = await T("planner-canvas").boundingBox();
  await page.getByRole("button", { name: new RegExp("^" + toolName + "\\b") }).click();
  await page.mouse.move(b.x + dx1, b.y + dy1); await page.mouse.down();
  await page.mouse.move((b.x + dx1 + b.x + dx2) / 2, (b.y + dy1 + b.y + dy2) / 2, { steps: 6 });
  await page.mouse.move(b.x + dx2, b.y + dy2, { steps: 6 }); await page.mouse.up();
  await sleep(700);
  await page.keyboard.press("Escape"); await sleep(300);
}
async function selectAndOpen(x, y) {
  const b = await T("planner-canvas").boundingBox();
  await page.mouse.click(b.x + x, b.y + y); await sleep(500);
  const p = page.locator("button", { hasText: /^Properties$/ }).first();
  if (await p.isVisible().catch(() => false)) await p.click();
  await panel.waitFor({ timeout: 10000 });
}
const bootCanvas = async () => {
  if (!(await T("planner-canvas").isVisible().catch(() => false))) { await T("map-toolbar-draw").click().catch(() => {}); await T("planner-canvas").waitFor({ timeout: 25000 }); }
  await sleep(1500);
};

try {
  await page.goto(BASE + "/#/site-planner", { waitUntil: "load" });
  await sleep(2500);
  await T("map-toolbar-draw").click();
  await T("planner-canvas").waitFor({ timeout: 25000 });
  await sleep(1500);
  // a first real write materialises the throwaway site (lazy creation, constraint #5): draw the line, then read the site id
  await drawWith("Line", 300, 250, 560, 250);
  SITE_ID = await page.evaluate(() => localStorage.getItem("planarfit:currentSite:v1"));
  console.log("throwaway site id:", SITE_ID);
  await drawWith("Rectangle", 300, 380, 520, 500);
  await assertMeasurable(page, "verify-markup-opacity-rotation-live");
  let line = await kind("line"), rect = await kind("rect");
  ok("a throwaway line and rectangle exist (drawn with the real tools)", !!line && !!rect, JSON.stringify({ line: !!line, rect: !!rect }));
  if (!line || !rect) throw new Error("VOID: shapes were not drawn");

  // KNOWN-GOOD ARM
  const p0 = await painted(line.id);
  ok("known-good arm: the untouched line paints at full strength", p0 === 1, String(p0));
  if (p0 !== 1) throw new Error("VOID: known-good arm did not report its known value");

  // LINE opacity
  await selectAndOpen(430, 250);
  const lineBox = panel.getByLabel("Line opacity");
  ok("the line panel shows an Opacity % box (typed, not a slider)", (await lineBox.count()) === 1 && (await panel.locator('input[type="range"]').count()) === 0);
  await lineBox.fill("40"); await lineBox.press("Enter"); await sleep(1200);
  line = await kind("line");
  ok("line: typing 40 stores strokeOpacity 0.4", line && Math.abs(line.strokeOpacity - 0.4) < 1e-6, String(line && line.strokeOpacity));
  const p1 = await painted(line.id);
  ok("line: the drawing dims (painted stroke-opacity 0.4, was 1)", p1 !== null && Math.abs(p1 - 0.4) < 1e-6, String(p1));

  // RECTANGLE opacity (outline and fill)
  await page.keyboard.press("Escape"); await sleep(300);
  await selectAndOpen(410, 440);
  const outBox = panel.getByLabel("Outline opacity"), fillBox = panel.getByLabel("Fill opacity");
  ok("the rectangle panel has typed Outline and Fill opacity boxes, no slider", (await outBox.count()) === 1 && (await fillBox.count()) === 1 && (await panel.locator('input[type="range"]').count()) === 0);
  await outBox.fill("50"); await outBox.press("Enter"); await sleep(600);
  await fillBox.fill("25"); await fillBox.press("Enter"); await sleep(1200);
  rect = await kind("rect");
  ok("rectangle: stores strokeOpacity 0.5 and fillOpacity 0.25", rect && Math.abs(rect.strokeOpacity - 0.5) < 1e-6 && Math.abs(rect.fillOpacity - 0.25) < 1e-6, JSON.stringify(rect && { s: rect.strokeOpacity, f: rect.fillOpacity }));
  const pr = await painted(rect.id);
  ok("rectangle: the drawing's outline dims (painted 0.5)", pr !== null && Math.abs(pr - 0.5) < 1e-6, String(pr));

  // ROTATION — Level only while tilted
  ok("known-good arm: the untilted rectangle has NO Level button", (await T("rotation-level").count()) === 0 && (await T("rotation-glyph").count()) === 1);
  await T("rotation-quarter-right").click(); await sleep(900);
  rect = await kind("rect");
  ok("a quarter turn tilts it to 90 and the Level button appears", rect && rect.rot === 90 && (await T("rotation-level").count()) === 1, String(rect && rect.rot));
  ok("the angle glyph reads 90", (await T("rotation-glyph").getAttribute("data-angle")) === "90");
  await T("rotation-level").click(); await sleep(900);
  rect = await kind("rect");
  ok("Level sets the angle back to 0 and the button goes away again", rect && (rect.rot || 0) === 0 && (await T("rotation-level").count()) === 0, String(rect && rect.rot));
  await T("rotation-quarter-left").click(); await sleep(900);   // leave it tilted (270) so persistence is checked on a non-default angle too
  rect = await kind("rect");
  ok("a quarter turn the other way reads 270 (Level back)", rect && rect.rot === 270 && (await T("rotation-level").count()) === 1, String(rect && rect.rot));

  // cloud row, then RELOAD
  let cm = null;
  for (let i = 0; i < 30; i++) { cm = await cloudMarkups(); if (Array.isArray(cm) && cm.some((m) => m.kind === "rect" && m.rot === 270) && cm.some((m) => m.kind === "line" && m.strokeOpacity === 0.4)) break; await sleep(1000); }
  const cl = Array.isArray(cm) && cm.find((m) => m.kind === "line"), cr = Array.isArray(cm) && cm.find((m) => m.kind === "rect");
  ok("the cloud rows carry the line's 0.4, the rectangle's 0.5 / 0.25 and its 270", cl && cr && cl.strokeOpacity === 0.4 && cr.strokeOpacity === 0.5 && cr.fillOpacity === 0.25 && cr.rot === 270, JSON.stringify(Array.isArray(cm) ? { l: cl && cl.strokeOpacity, rs: cr && cr.strokeOpacity, rf: cr && cr.fillOpacity, rr: cr && cr.rot } : cm));
  await page.reload({ waitUntil: "load" }); await sleep(3000); await bootCanvas();
  line = await kind("line"); rect = await kind("rect");
  ok("after a reload the stored values are unchanged", line && rect && line.strokeOpacity === 0.4 && rect.strokeOpacity === 0.5 && rect.fillOpacity === 0.25 && rect.rot === 270, JSON.stringify({ l: line && line.strokeOpacity, rs: rect && rect.strokeOpacity, rf: rect && rect.fillOpacity, rr: rect && rect.rot }));
  const pl2 = await painted(line.id), pr2 = await painted(rect.id);
  ok("after a reload the drawing is still dimmed (line 0.4, rectangle outline 0.5)", pl2 !== null && Math.abs(pl2 - 0.4) < 1e-6 && pr2 !== null && Math.abs(pr2 - 0.5) < 1e-6, JSON.stringify({ pl2, pr2 }));
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
