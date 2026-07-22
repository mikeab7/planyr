/* v3 A1 — the Yield panel's "Assumptions & method (N)" disclosure must actually OPEN. Drives the
 * REAL app logged out on a georeferenced site carrying a REMEMBERED drainage check
 * (settings.drainage.lastCheck), so the DETENTION DETAIL group + its "Assumptions & method"
 * disclosure render with no GIS. Confirms: the header is a real <button> carrying aria-expanded;
 * it starts collapsed (aria-expanded="false", no method body in the DOM); a click opens it
 * (aria-expanded="true", the relocated method rows appear); and a keyboard toggle (Space on the
 * focused button) closes it again — the native-button activation A1 requires.
 * Run: node ui-audit/verify-assumptions-disclosure.mjs   (preview on :4173)
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const H = 660;
const PARCEL = [{ x: -H, y: -H }, { x: H, y: -H }, { x: H, y: H }, { x: -H, y: H }];
const POND = [{ x: -500, y: -500 }, { x: 100, y: -500 }, { x: 100, y: 100 }, { x: -500, y: 100 }];
const slim = {
  authority: { primaryReviewerId: "fortbend", channelAuthority: null, overlays: [], ambiguous: [], flags: [], mudState: null, jurisdiction: { city: [], county: ["Fort Bend"], etj: [] } },
  flood: { zones: [{ zone: "AE", subtype: "", staticBfeFt: 95, vdatum: "NAVD88" }], state: "loaded", ageMs: 0 },
  channel: null, watershed: null, groundElevFt: 90, groundDatum: "NAVD88",
};
const site = {
  id: "s_disc", groupId: "s_disc", site: "Tsakiris", name: "Concept A", status: "active",
  origin: { lat: 29.55, lon: -95.80 }, county: "fortbend",
  parcels: [{ id: "pA", points: PARCEL, locked: true }],
  els: [
    { id: "b1", type: "building", cx: 300, cy: 300, w: 300, h: 200, rot: 0 },
    { id: "p1", type: "pond", points: POND.map((p) => ({ ...p })), det: { depth: 8, freeboard: 1, slope: 3, tobElev: 94 } },
  ],
  measures: [], callouts: [], markups: [], deletedIds: [],
  settings: { showSetback: false, drainage: { autoFacts: false, lastCheck: { ...slim, sig: "seed-sig", checkedAt: Date.now() - 3 * 86400000, detSplit: { screened: true, fmZonesSig: "seed:1", byId: { p1: { wseFt: 95, inTrigger: true, estPoolDepthFt: null } } } } } },
  underlay: null, updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({ s_disc: ${JSON.stringify(site)} }));
  localStorage.setItem('planarfit:currentSite:v1', 's_disc');
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 980 }, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
const errors = [];
const NOISE = /ERR_TUNNEL|ERR_CONNECTION|ERR_CERT|Failed to load resource|net::/i;
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !NOISE.test(m.text())) errors.push(m.text()); });
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(2600);
await page.getByRole("button", { name: /Yield/ }).first().click().catch(() => {});
await page.waitForTimeout(700);

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

const toggle = page.locator('[data-testid="assumptions-method-toggle"]').first();
const bodyCount = () => page.locator('[data-testid="assumptions-method-body"]').count();

log((await toggle.count()) > 0, "the 'Assumptions & method' disclosure renders in DETENTION DETAIL");
log((await toggle.evaluate((e) => e.tagName)) === "BUTTON", "the disclosure header is a real <button>");
log((await toggle.getAttribute("aria-expanded")) === "false", "starts collapsed: aria-expanded='false'");
log((await bodyCount()) === 0, "no relocated method rows in the DOM while collapsed");

// A1 — a click OPENS it: aria-expanded flips and the relocated rows mount.
await toggle.click();
await page.waitForTimeout(200);
log((await toggle.getAttribute("aria-expanded")) === "true", "after click: aria-expanded='true'");
const openBody = page.locator('[data-testid="assumptions-method-body"]').first();
log((await openBody.count()) === 1, "after click: the relocated method rows are in the DOM");
const kids = await openBody.evaluate((el) => el.children.length).catch(() => 0);
log(kids > 0, `the opened body renders relocated rows (${kids} child node(s))`);

// A1 — keyboard toggle: focus the button and press Space to CLOSE it (native button activation).
await toggle.focus();
await page.keyboard.press(" ");
await page.waitForTimeout(200);
log((await toggle.getAttribute("aria-expanded")) === "false", "after Space: aria-expanded='false' (keyboard toggle closes)");
log((await bodyCount()) === 0, "after Space: the method rows are hidden again");

// A1 — Enter re-opens it (the other native activation key).
await toggle.focus();
await page.keyboard.press("Enter");
await page.waitForTimeout(200);
log((await toggle.getAttribute("aria-expanded")) === "true", "after Enter: aria-expanded='true' (keyboard toggle opens)");

await page.screenshot({ path: OUT + "assumptions-disclosure.png", clip: { x: 0, y: 96, width: 390, height: 900 } });
log(errors.length === 0, `no console/page errors (${errors.length})` + (errors.length ? ` :: ${errors.slice(0, 2).join(" | ")}` : ""));
console.log(fail === 0 ? "\nALL PASS" : `\n${fail} CHECK(S) FAILED`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
