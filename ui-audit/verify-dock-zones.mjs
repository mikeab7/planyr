/* Self-verification for the building-anchored dock-zone stack + on-building +/− controls
 * (B228 / B229 / B239 / B240). Seeds a cross-dock building, boots the planner logged-out,
 * selects the building, then exercises BOTH control surfaces:
 *   • the on-canvas "+ / −" pairs ON the building (dock sides walk court → trailer → buffer;
 *     non-dock ends do car parking) — the owner's "controls right on the building";
 *   • the panel's uniform "+ / −" rows (Dock zones / Car parking / Bump-outs).
 * Element types are read off the canvas by their plan-style fills:
 *   building #f3ece1 · court(paving) #d6d1c7 · trailer #e3d4b2 · buffer(landscape) #bcd3a6 · parking #cdd7dd */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const DEMO_ID = "verify-dock";
const els = [{ id: "b1", type: "building", cx: 0, cy: 0, w: 600, h: 300, rot: 0, dock: "cross" }];
const parcel = { id: "pc1", locked: false, points: [{ x: -800, y: -560 }, { x: 800, y: -560 }, { x: 800, y: 560 }, { x: -800, y: 560 }] };
const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Verify Dock Zones", name: "Plan 1",
  origin: null, county: null, parcels: [parcel], els, measures: [], callouts: [],
  markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [DEMO_ID]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(DEMO_ID)});
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.25, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1400);
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { console.warn("fit warn", e.message); }
await page.waitForTimeout(500);

const zones = () => page.evaluate(() => {
  const FILL = { "#f3ece1": "building", "#d6d1c7": "court", "#e3d4b2": "trailer", "#bcd3a6": "buffer", "#cdd7dd": "parking" };
  const out = [];
  for (const r of document.querySelectorAll("svg rect")) {
    const fill = (r.getAttribute("fill") || "").toLowerCase();
    if (!FILL[fill]) continue;
    const b = r.getBoundingClientRect();
    if (b.width < 15 || b.height < 4 || b.x < 260) continue;
    out.push({ kind: FILL[fill], cx: b.x + b.width / 2, cy: b.y + b.height / 2, w: b.width, h: b.height });
  }
  return out;
});
const counts = async () => (await zones()).reduce((m, e) => ((m[e.kind] = (m[e.kind] || 0) + 1), m), { building: 0, court: 0, trailer: 0, buffer: 0, parking: 0 });

// click a visible control (button OR svg <g> with a <title>) whose title/text matches `re`
const clickByTitle = async (re, { optional = false } = {}) => {
  const r = await page.evaluate((src) => {
    const rx = new RegExp(src);
    // panel buttons: match the button's own title, else its text
    for (const b of document.querySelectorAll("button")) {
      if (b.offsetParent === null) continue;
      const t = (b.getAttribute("title") || b.textContent || "").trim();
      if (rx.test(t) && !b.disabled) { b.click(); return t || "(btn)"; }
    }
    // on-canvas svg groups carry a <title> child
    for (const g of document.querySelectorAll("svg g")) {
      const ti = g.querySelector(":scope > title");
      if (ti && rx.test(ti.textContent || "")) {
        const rect = g.getBoundingClientRect();
        g.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 }));
        return ti.textContent;
      }
    }
    return null;
  }, re.source);
  await page.waitForTimeout(300);
  if (!r && !optional) throw new Error("control not found: " + re);
  return r;
};

// select the building (offset off-centre so we don't land on the centred dock-door marks)
const bsel = await page.evaluate(() => {
  const r = [...document.querySelectorAll("svg rect")].find((x) => (x.getAttribute("fill") || "").toLowerCase() === "#f3ece1");
  if (!r) return null; const b = r.getBoundingClientRect(); return { x: b.x + b.width * 0.35, y: b.y + b.height * 0.4 };
});
if (!bsel) { console.log("✗ building rect not found"); process.exit(1); }
await page.mouse.click(bsel.x, bsel.y);
await page.waitForTimeout(400);

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

const c0 = await counts();
log(c0.building >= 1 && c0.court === 0, `initial: ${JSON.stringify(c0)}`);

// ---- A) PANEL "+" (all dock sides at once): court → trailer parking → buffer, 2 of each ----
await clickByTitle(/Extend every dock side/);
const c1 = await counts();
log(c1.court === 2 && c1.trailer === 0, `panel "+" → truck court both sides: ${JSON.stringify(c1)}`);
await clickByTitle(/Extend every dock side/);
const c2 = await counts();
log(c2.court === 2 && c2.trailer === 2 && c2.buffer === 0, `panel "+" → trailer parking: ${JSON.stringify(c2)}`);
await clickByTitle(/Extend every dock side/);
const c3 = await counts();
log(c3.court === 2 && c3.trailer === 2 && c3.buffer === 2, `panel "+" → buffer: ${JSON.stringify(c3)}`);
await page.screenshot({ path: OUT + "dock-zones-full.png" });

// outward order on the TOP dock side (court nearest the wall → buffer farthest)
const z3 = await zones();
const bldg = z3.find((e) => e.kind === "building");
const top = z3.filter((e) => e.kind !== "building" && e.kind !== "parking" && e.cy < bldg.cy && Math.abs(e.cx - bldg.cx) < bldg.w).sort((p, q) => q.cy - p.cy);
log(JSON.stringify(top.map((e) => e.kind)) === JSON.stringify(["court", "trailer", "buffer"]), `top-side outward order: ${JSON.stringify(top.map((e) => e.kind))}`);
const bufferTopH = (top[2] || {}).h || 0;

// inline depth edit — buffer row shows 15; bump to 40 → both bands grow
const inpBox = await page.evaluate(() => {
  const ins = [...document.querySelectorAll("input")].filter((i) => i.value === "15");
  if (!ins.length) return null; const i = ins[ins.length - 1], b = i.getBoundingClientRect();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
});
if (inpBox) { await page.mouse.click(inpBox.x, inpBox.y); await page.keyboard.press("Control+A"); await page.keyboard.type("40"); await page.keyboard.press("Enter"); await page.waitForTimeout(400); }
const bufNewH = ((await zones()).filter((e) => e.kind === "buffer" && e.cy < bldg.cy).sort((p, q) => p.cy - q.cy)[0] || {}).h || 0;
log(!!inpBox && bufNewH > bufferTopH + 4, `buffer depth 15→40 grew the band: ${bufferTopH.toFixed(0)}px → ${bufNewH.toFixed(0)}px`);

// ---- B) PANEL "−" (all dock sides): pull in buffer → trailer → court ----
await clickByTitle(/Pull every dock side/);
const d1 = await counts();
log(d1.buffer === 0 && d1.trailer === 2 && d1.court === 2, `panel "−" → buffer off: ${JSON.stringify(d1)}`);
await clickByTitle(/Pull every dock side/);
const d2 = await counts();
log(d2.trailer === 0 && d2.court === 2, `panel "−" → trailer off: ${JSON.stringify(d2)}`);
await clickByTitle(/Pull every dock side/);
const d3 = await counts();
log(d3.court === 0, `panel "−" → court off (empty): ${JSON.stringify(d3)}`);

// ---- C) ON-CANVAS "+ / −" pair (per dock side): walks ONE side court → trailer, then pulls in ----
const onc1 = await clickByTitle(/Extend out/); // first dock side's "+" → its truck court
console.log("  on-canvas:", onc1);
const f1 = await counts();
log(f1.court === 1 && f1.trailer === 0, `on-canvas "+" → court on ONE side: ${JSON.stringify(f1)}`);
await clickByTitle(/Extend out/);            // same side's "+" now walks to trailer parking
const f2 = await counts();
log(f2.court === 1 && f2.trailer === 1, `on-canvas "+" again → trailer on that side (walks the stack): ${JSON.stringify(f2)}`);
await clickByTitle(/Pull in/);               // that side's "−" → removes the outer (trailer)
const f3 = await counts();
log(f3.trailer === 0 && f3.court === 1, `on-canvas "−" → outer zone off that side: ${JSON.stringify(f3)}`);
await page.screenshot({ path: OUT + "dock-zones-oncanvas.png" });

// ---- D) EMPLOYEE-SIDE build-out (non-dock side): "+" walks sidewalk → parking row → MORE rows ----
// sidewalk strips are thin (5′) and may rotate, so detect by fill with a long axis
const swCount = () => page.evaluate(() => [...document.querySelectorAll("svg rect")].filter((r) => { const b = r.getBoundingClientRect(); return (r.getAttribute("fill") || "").toLowerCase() === "#eceae3" && Math.max(b.width, b.height) > 12; }).length);
// the parking field's DEPTH is the SHORTER bbox side (it's rotated 90° on a short end)
const parkDepth = async () => { const p = (await zones()).filter((e) => e.kind === "parking").sort((a, b) => b.w * b.h - a.w * a.h)[0]; return p ? Math.min(p.w, p.h) : 0; };
await clickByTitle(/Add a .{0,3}sidewalk/);                  // 1st "+" → sidewalk (the one Michael lost)
log((await swCount()) >= 1, `employee "+" → sidewalk restored (${await swCount()})`);
await clickByTitle(/Add a parking row/);                     // 2nd "+" → first parking row
const pk1 = (await counts()).parking, pd1 = await parkDepth();
log(pk1 >= 1, `employee "+" again → first parking row (${pk1})`);
await clickByTitle(/Add another parking row/);               // 3rd "+" → MORE rows (the thing that was missing)
const pd2 = await parkDepth();
log(pd2 > pd1 + 2, `employee "+" again → adds MORE rows (field deepened ${pd1.toFixed(0)}px → ${pd2.toFixed(0)}px)`);
await page.screenshot({ path: OUT + "dock-zones-parking.png" });

console.log(errors.length ? `\nPAGE ERRORS:\n${errors.slice(0, 8).join("\n")}` : "\n(no page errors)");
console.log(fail === 0 ? "\n✓ ALL DOCK-ZONE CHECKS PASSED" : `\n✗ ${fail} CHECK(S) FAILED`);
await ctx.close();
await browser.close();
process.exit(fail === 0 ? 0 : 1);
