/* Self-verification for B247–B250 (the "deliberate Group" tranche):
 *   B247 — explicit Group tool: select ≥2 → Group → they move/select/copy as one unit;
 *          double-click a member drills in to edit it; Group/Ungroup commands.
 *   B248 — snap is pure positional ALIGNMENT only; dragging never bonds elements.
 *   B249 — snap defaults OFF each session (sessionStorage), not globally sticky.
 *   B250 — per-plan delete (inline confirm), never the last plan.
 * Seeds a plan with two separate elements (a building + a parking field), boots the
 * planner logged-out, and drives the SVG canvas + header menus.
 * Plan-style fills: building #f3ece1 · parking #cdd7dd */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

// ---- seed A: one site, one plan, two separated elements ----
const A_ID = "verify-grp";
const elsA = [
  { id: "b1", type: "building", cx: 60, cy: 0, w: 180, h: 140, rot: 0, dock: "none" },
  { id: "p1", type: "parking", cx: 380, cy: 0, w: 180, h: 140, rot: 0 },
];
const siteA = { id: A_ID, groupId: A_ID, site: "Verify Group", name: "Plan 1", origin: null, county: null,
  parcels: [], els: elsA, measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now() };

// ---- seed B: one site, TWO plans (for per-plan delete) ----
const B_GID = "verify-del";
const mkPlan = (id, name) => ({ id, groupId: B_GID, site: "Verify Delete", name, origin: null, county: null,
  parcels: [], els: [{ id: id + "-b", type: "building", cx: 0, cy: 0, w: 200, h: 150, rot: 0, dock: "none" }],
  measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now() });
const plansB = { "del-1": mkPlan("del-1", "Plan 1"), "del-2": mkPlan("del-2", "Plan 2") };

const seedScript = (sitesObj, currentId) => `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(sitesObj)}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(currentId)});
} catch (e) {} })();`;

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

/* ============================ PHASE 1 — Group / no-bond / snap ============================ */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  await ctx.addInitScript(seedScript({ [A_ID]: siteA }, A_ID));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1400);
  const fit = async () => { try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 4000 }); } catch (e) {} await page.waitForTimeout(400); };
  await fit();

  // center of the LARGEST svg rect with the given fill (skip the left rail at x<260)
  const centerOf = (fill) => page.evaluate((f) => {
    let best = null;
    for (const r of document.querySelectorAll("svg rect")) {
      if ((r.getAttribute("fill") || "").toLowerCase() !== f) continue;
      const b = r.getBoundingClientRect();
      if (b.width < 8 || b.height < 8) continue;
      if (!best || b.width * b.height > best.area) best = { x: b.x + b.width / 2, y: b.y + b.height / 2, area: b.width * b.height };
    }
    return best;
  }, fill);
  const hasGroupBox = () => page.evaluate(() => [...document.querySelectorAll("svg text")].some((t) => (t.textContent || "").includes("Group")));
  const clickByTitle = async (re) => {
    const r = await page.evaluate((src) => { const rx = new RegExp(src);
      for (const b of document.querySelectorAll("button")) { if (b.offsetParent === null || b.disabled) continue; const t = (b.getAttribute("title") || b.textContent || "").trim(); if (rx.test(t)) { b.click(); return t; } } return null;
    }, re.source);
    await page.waitForTimeout(300); return r;
  };
  const drag = async (from, to) => { await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2); await page.mouse.move(to.x, to.y); await page.mouse.move(to.x, to.y); await page.mouse.up(); await page.waitForTimeout(300); };
  const shiftClick = async (pt) => { await page.keyboard.down("Shift"); await page.mouse.click(pt.x, pt.y); await page.keyboard.up("Shift"); await page.waitForTimeout(200); };

  // --- B249: snap defaults OFF this session + old global key retired ---
  const snapInit = await page.evaluate(() => ({
    btn: [...document.querySelectorAll("button")].map((b) => (b.textContent || "").trim()).find((t) => /^Snap/.test(t)) || "",
    ls: localStorage.getItem("planarfit:snap"), ss: sessionStorage.getItem("planarfit:snap"),
  }));
  log(/Snap off/.test(snapInit.btn) && !snapInit.ls, `B249 snap defaults OFF, no global localStorage key (btn="${snapInit.btn}", ls=${snapInit.ls})`);
  await clickByTitle(/Snap only ALIGNS/);
  const snapOn = await page.evaluate(() => ({ btn: [...document.querySelectorAll("button")].map((b) => (b.textContent || "").trim()).find((t) => /^Snap/.test(t)) || "", ss: sessionStorage.getItem("planarfit:snap") }));
  log(/on/.test(snapOn.btn) && snapOn.ss === "1", `B249 toggling snap persists to sessionStorage only (btn="${snapOn.btn}", ss=${snapOn.ss})`);

  // --- B248: a plain drag flush onto a neighbour must NOT bond them ---
  await fit();
  let b = await centerOf("#f3ece1"), p = await centerOf("#cdd7dd");
  log(!!b && !!p, `two separate elements present (building ${!!b}, parking ${!!p})`);
  // drag the building toward the parking (flush), then drag it back away; parking must stay put
  const pBefore = await centerOf("#cdd7dd");
  await drag(b, { x: p.x - 140, y: p.y });           // building snaps flush near parking
  b = await centerOf("#f3ece1");
  await drag(b, { x: b.x - 220, y: b.y - 120 });      // pull the building away again
  const pAfter = await centerOf("#cdd7dd");
  const parkMoved = Math.hypot(pAfter.x - pBefore.x, pAfter.y - pBefore.y);
  log(parkMoved < 8, `B248 flush drag did NOT bond — parking stayed put while building moved away (parking Δ=${parkMoved.toFixed(1)}px)`);

  // --- B247: Group two elements → move as one unit → ungroup ---
  await fit();
  b = await centerOf("#f3ece1"); p = await centerOf("#cdd7dd");
  await page.keyboard.press("Escape"); await page.waitForTimeout(150); // clear any selection
  await shiftClick(b); await shiftClick(p);
  const grpBtn = await clickByTitle(/Group the selected items/);
  log(!!grpBtn, `B247 Group command available with 2 selected (clicked "${grpBtn}")`);
  log(await hasGroupBox(), "B247 group bounding-box (⊞ Group) renders after grouping");

  // move the group as one unit: click empty, then drag the building — BOTH should move
  await page.keyboard.press("Escape"); await page.waitForTimeout(150);
  const b0 = await centerOf("#f3ece1"), p0 = await centerOf("#cdd7dd");
  await drag(b0, { x: b0.x + 60, y: b0.y + 90 });
  const b1 = await centerOf("#f3ece1"), p1 = await centerOf("#cdd7dd");
  const bMoved = Math.hypot(b1.x - b0.x, b1.y - b0.y), pMoved = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  log(bMoved > 30 && pMoved > 30, `B247 dragging one member moved the WHOLE group (building Δ=${bMoved.toFixed(0)}px, parking Δ=${pMoved.toFixed(0)}px)`);

  // ungroup: select the group, click Ungroup → box disappears; then a member moves alone
  await page.mouse.click((await centerOf("#f3ece1")).x, (await centerOf("#f3ece1")).y);
  await page.waitForTimeout(150);
  const unBtn = await clickByTitle(/Ungroup/);
  log(!!unBtn && !(await hasGroupBox()), `B247 Ungroup removes the group box (clicked "${unBtn}")`);
  await page.keyboard.press("Escape"); await page.waitForTimeout(150);
  const ub0 = await centerOf("#f3ece1"), up0 = await centerOf("#cdd7dd");
  await drag(ub0, { x: ub0.x - 70, y: ub0.y });
  const up1 = await centerOf("#cdd7dd");
  log(Math.hypot(up1.x - up0.x, up1.y - up0.y) < 8, "B247 after Ungroup, members move independently again");

  await page.screenshot({ path: OUT + "b247-groups.png" });
  console.log(errors.length ? `PHASE1 page errors:\n${errors.slice(0, 6).join("\n")}` : "(phase1: no page errors)");
  if (errors.length) fail++;
  await ctx.close();
}

/* ============================ PHASE 2 — per-plan delete (B250) ============================ */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  await ctx.addInitScript(seedScript(plansB, "del-1"));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1400);

  // open the Plan ▾ menu
  const openPlanMenu = async () => { await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").includes("Switch or rename plan")); if (b) b.click(); }); await page.waitForTimeout(350); };
  await openPlanMenu();
  const planRows = () => page.evaluate(() => [...document.querySelectorAll("button")].map((b) => (b.textContent || "").trim()).filter((t) => /^Plan \d/.test(t)).length);
  const rows0 = await planRows();
  log(rows0 >= 2, `B250 two plans listed in the Plan menu (${rows0})`);

  // click the ✕ delete on a plan row → inline confirm appears, then click Delete
  const armed = await page.evaluate(() => { const x = [...document.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") || "").startsWith("Delete plan")); if (x) { x.click(); return true; } return false; });
  await page.waitForTimeout(250);
  const hasConfirm = await page.evaluate(() => [...document.querySelectorAll("*")].some((n) => /Delete .“|Delete “/.test(n.textContent || "") && n.children.length < 6));
  log(armed && hasConfirm, `B250 ✕ shows an inline "Delete …?" confirm (no browser dialog)`);
  await page.evaluate(() => { const d = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Delete"); if (d) d.click(); });
  await page.waitForTimeout(700);
  await openPlanMenu();
  const rows1 = await planRows();
  log(rows1 === rows0 - 1, `B250 a single plan was deleted (rows ${rows0} → ${rows1}); the app stayed alive`);
  // the only remaining plan must have NO ✕ (can't delete the last plan)
  const lastHasX = await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => (b.getAttribute("aria-label") || "").startsWith("Delete plan")));
  log(!lastHasX, "B250 the last remaining plan has no delete affordance (can't delete the only plan)");

  await page.screenshot({ path: OUT + "b250-plan-delete.png" });
  console.log(errors.length ? `PHASE2 page errors:\n${errors.slice(0, 6).join("\n")}` : "(phase2: no page errors)");
  if (errors.length) fail++;
  await ctx.close();
}

await browser.close();
console.log(fail === 0 ? "\n✓ ALL B247–B250 CHECKS PASSED" : `\n✗ ${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
