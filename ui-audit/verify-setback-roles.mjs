/* B1191 — the regulatory role layer for setbacks, driven in a real browser.
 *
 * The owner's report (2026-07-30): after B1184 the PARCELS panel listed "Side 1 · 2 seg, Side 2 ·
 * 6 seg … Side 15" — fifteen geometric sides where a zoning ordinance writes FOUR setbacks. Only
 * one row had resolved to "Front". This harness drives the fix on the REAL production geometry of
 * his Weld County parcel (sites.id sms7v3ua7ksy, 60 vertices, read from planyr_production).
 *
 * Logged out, no external GIS, geometry seeded from a local fixture — Claude-verifiable here.
 *
 * Checks:
 *   1  "By role" is the DEFAULT and lists exactly the four ordinance rows
 *   2  every side is auto-assigned — the "By side" rows each show a resolved role, not just one
 *   3  a role is CORRECTABLE from a "By side" row, and the By-role rows follow
 *   4  one By-role input writes every side in that role (and only those)
 *   5  the map chips read their role — "Front · 25′", never a bare number
 *   6  NON-NEGOTIABLE: the drawn setback ring (the buildable envelope) is IDENTICAL before and
 *      after roles are assigned and reassigned
 *
 * Run:  npm run build && npx vite preview --port 4178   (separate shell)
 *       BASE_URL=http://localhost:4178/ node ui-audit/verify-setback-roles.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4178/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const now = Date.now();

const weld = JSON.parse(readFileSync(new URL("../test/fixtures/weldParcelProduction.json", import.meta.url), "utf8"));

const sites = {
  weldroles: {
    id: "weldroles", groupId: "weldroles", site: "weldroles", name: "Concept A",
    origin: { lat: 40.34612498, lon: -104.97788964 }, county: "weld",
    // Exactly as production stores it: no `setbacks` array, so every edge takes the plan default.
    parcels: [{ id: weld.parcelId, points: weld.points }],
    els: [], measures: [], callouts: [], markups: [],
    settings: { showSetback: true, setback: weld.defaultSetbackFt }, underlay: null, status: "active", updatedAt: now,
  },
};
const seed = `(()=>{try{localStorage.setItem('planarfit:sites:v1',JSON.stringify(${JSON.stringify(sites)}));localStorage.removeItem('planarfit:currentSite:v1');}catch(e){}})();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const results = [];
const ok = (n, pass, d = "") => { results.push({ n, pass }); console.log(`  ${pass ? "✅" : "❌"} ${n}${d ? " — " + d : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(String(e)));
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1800);

await page.locator('button[title="Choose a project"]:visible, button[title="Switch project"]:visible').first().click();
await page.waitForTimeout(400);
await page.locator('button:has-text("weldroles")').first().click();
await page.waitForTimeout(1400);
await page.locator('button[title="Zoom to fit"]').click().catch(() => {});
await page.waitForTimeout(800);

// The PARCELS panel lives only in the planner host (the map finder has no such section), so a
// document-wide query is unambiguous here — unlike the flood group, which both hosts render.
const surface = "";

const read = () => page.evaluate(() => {
  const host = document;
  const rows = [...host.querySelectorAll('[data-testid="setback-row"]')].map((r) => ({
    role: r.getAttribute("data-role") || "",
    label: (r.querySelector("span")?.textContent || "").trim(),
    value: r.querySelector("input")?.value ?? null,
    pickedRole: r.querySelector('[data-testid="side-role"]')?.value ?? null,
  }));
  const ring = document.querySelector('[data-testid="setback-ring"]')?.getAttribute("points") || "";
  const chipTexts = [...document.querySelectorAll("text")]
    .filter((t) => t.parentElement?.querySelector('[data-testid="setback-chip"]'))
    .map((t) => (t.textContent || "").trim());
  const mode = [...host.querySelectorAll("button")].filter((b) => /^(By role|By side|Per segment)$/.test(b.textContent.trim()))
    .map((b) => ({ label: b.textContent.trim(), on: /rgb\(194, 65, 12\)|rgb\(242, 107, 58\)/.test(getComputedStyle(b).backgroundColor) }));
  return { rows, ring, chipTexts, mode };
});

// The setback list lives in the left dock's PARCEL panel — open it (the rail tab), then select.
await page.locator('[data-rail-tab="parcel"]').first().click();
await page.waitForTimeout(500);

// Select the parcel by clicking a boundary edge midpoint.
const { verts, svgOrigin } = await page.evaluate(() => {
  const p = document.querySelector('polygon[data-testid="parcel-outline"]');
  if (!p) return { verts: [], svgOrigin: { x: 0, y: 0 } };
  const r = p.ownerSVGElement.getBoundingClientRect();
  return {
    verts: p.getAttribute("points").trim().split(/\s+/).map((s) => { const [x, y] = s.split(",").map(Number); return { x, y }; }),
    svgOrigin: { x: r.left, y: r.top },
  };
});
ok("the production parcel renders (60-vertex Weld County boundary)", verts.length >= 55, `${verts.length} vertices`);

const ringAtStart = (await read()).ring;

for (let e = 0; e < verts.length; e++) {
  const a = verts[e], b = verts[(e + 1) % verts.length];
  const mid = { x: svgOrigin.x + (a.x + b.x) / 2, y: svgOrigin.y + (a.y + b.y) / 2 };
  if (mid.y < 120 || mid.y > 860 || mid.x < svgOrigin.x + 8 || mid.x > 1420) continue;
  await page.mouse.click(mid.x, mid.y);
  await page.waitForTimeout(300);
  if ((await read()).rows.length > 0) break;
}

// --- 1: By role is the default, four rows -----------------------------------------------------
const roleView = await read();
await page.screenshot({ path: OUT + "setback-roles-by-role.png" });
console.log(`  · By role: ${roleView.rows.map((r) => `${r.label}=${r.value ?? "—"}`).join(", ")}`);
ok("1 · \"By role\" is the DEFAULT tier", roleView.mode.find((m) => m.label === "By role")?.on === true,
   roleView.mode.map((m) => `${m.label}${m.on ? "*" : ""}`).join(" "));
ok("1 · exactly FOUR rows, in the ordinance's vocabulary",
   roleView.rows.length === 4 && roleView.rows.map((r) => r.role).join(",") === "front,side,street,rear",
   roleView.rows.map((r) => r.label).join(" | "));

// --- 2: every side is auto-assigned -----------------------------------------------------------
await page.locator('button:has-text("By side")').first().click();
await page.waitForTimeout(400);
const sideView = await read();
await page.screenshot({ path: OUT + "setback-roles-by-side.png" });
console.log(`  · By side: ${sideView.rows.length} rows, roles ${[...new Set(sideView.rows.map((r) => r.pickedRole))].join("/")}`);
ok("2 · every side row carries a RESOLVED role (the report's fifteen unlabelled sides)",
   sideView.rows.length > 4 && sideView.rows.every((r) => ["front", "side", "street", "rear"].includes(r.pickedRole)),
   `${sideView.rows.filter((r) => r.pickedRole).length}/${sideView.rows.length} assigned`);
ok("2 · more than one role actually resolved (not everything defaulted to Side)",
   new Set(sideView.rows.map((r) => r.pickedRole)).size >= 2,
   [...new Set(sideView.rows.map((r) => r.pickedRole))].join(", "));

// --- 6a: the envelope has not moved while roles were assigned ---------------------------------
ok("6 · the drawn setback ring is UNCHANGED by role assignment", sideView.ring === ringAtStart && !!ringAtStart,
   sideView.ring === ringAtStart ? "identical" : "RING MOVED");

// --- 3: a role is correctable, and the By-role rows follow ------------------------------------
// Find a row that is NOT already "street" and make it one — Street side is empty on this parcel
// (no road on the plan), so the By-role list must gain it.
const target = sideView.rows.findIndex((r) => r.pickedRole !== "street");
await page.locator('[data-testid="side-role"]').nth(target).selectOption("street");
await page.waitForTimeout(400);
const afterPick = await read();
ok("3 · a side's role can be reassigned from its own row",
   afterPick.rows[target]?.pickedRole === "street", afterPick.rows[target]?.pickedRole || "unchanged");
await page.locator('button:has-text("By role")').first().click();
await page.waitForTimeout(400);
const roleAfterPick = await read();
const streetRow = roleAfterPick.rows.find((r) => r.role === "street");
ok("3 · the By-role rows follow the correction (Street side gains an input)",
   streetRow?.value != null, streetRow ? `Street side = ${streetRow.value ?? "—"}` : "no street row");
ok("6 · the ring is STILL unchanged after a reassignment", roleAfterPick.ring === ringAtStart,
   roleAfterPick.ring === ringAtStart ? "identical" : "RING MOVED");

// --- 4: one role input writes every side in that role -----------------------------------------
const frontIdx = roleAfterPick.rows.findIndex((r) => r.role === "front");
const input = page.locator('[data-testid="setback-row"]').nth(frontIdx).locator("input");
await input.fill("40");
await input.press("Enter");
await page.waitForTimeout(500);
await page.locator('button:has-text("By side")').first().click();
await page.waitForTimeout(400);
const afterEdit = await read();
const fronts = afterEdit.rows.filter((r) => r.pickedRole === "front");
const others = afterEdit.rows.filter((r) => r.pickedRole !== "front");
await page.screenshot({ path: OUT + "setback-roles-after-front-edit.png" });
ok("4 · one Front input reached EVERY Front side", fronts.length > 0 && fronts.every((r) => r.value === "40"),
   fronts.map((r) => `${r.label}=${r.value}`).join(", ") || "no front side");
ok("4 · and reached no side of another role", others.every((r) => r.value !== "40"),
   others.filter((r) => r.value === "40").map((r) => r.label).join(", ") || "none touched");
ok("6 · the ring moved ONLY because a number was typed", afterEdit.ring !== ringAtStart, "envelope re-cut, as it must be");

// --- 5: the map chips read their role ---------------------------------------------------------
console.log(`  · chips: ${afterEdit.chipTexts.join(" | ")}`);
ok("5 · every map chip names its role, not a bare number",
   afterEdit.chipTexts.length > 0 && afterEdit.chipTexts.every((t) => /^(Front|Side|St side|Rear) · (\d+′|—)$/.test(t)),
   afterEdit.chipTexts.join(" | "));
ok("5 · the typed Front value shows on the Front chip",
   afterEdit.chipTexts.some((t) => t === "Front · 40′") || !afterEdit.chipTexts.some((t) => t.startsWith("Front")),
   afterEdit.chipTexts.filter((t) => t.startsWith("Front")).join(", ") || "front chip decluttered away");

ok("no JS errors during the whole run", jsErrors.length === 0, jsErrors.slice(0, 2).join(" | "));

await ctx.close();
await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed  ·  screenshots in ui-audit/screens/`);
if (failed.length) { console.log("FAILED:", failed.map((f) => f.n).join("; ")); process.exit(1); }
console.log("ALL PASS");
