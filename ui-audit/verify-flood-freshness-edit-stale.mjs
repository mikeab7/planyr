/* NEW-7 (owner live pass 2026-08-31, verbatim: "if I had run it and then changed elements") —
 * a site-element edit made AFTER the flood check ran must flip the Yield panel's freshness dot to
 * STALE (amber), keeping the ORIGINAL run date — never staying green and never resetting the clock.
 * Repro that found the gap: nudging one building 5 ft with the arrow keys (a real edit — Undo
 * armed) left the dot green and the header counting up unchanged from the original run.
 *
 * Drives the REAL app logged out on a seeded, georeferenced site carrying a REMEMBERED drainage
 * check — deliberately minimal (no `sig`, no `fetch` envelope) so the freshness read starts FRESH
 * on its own terms rather than depending on a hand-reproduced signature string; this harness is
 * about the EDIT trigger (`editedSinceCheck`), not the existing envelope/anchor-drift key, which
 * already has its own coverage in test/factsFreshness.test.js.
 *
 * Run: node ui-audit/verify-flood-freshness-edit-stale.mjs   (preview on :4173)
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";

const H = 660;
const PARCEL = [{ x: -H, y: -H }, { x: H, y: -H }, { x: H, y: H }, { x: -H, y: H }];
const CHECKED_AT = Date.now() - 5 * 60000; // 5 minutes ago
const site = {
  id: "s_edstale", groupId: "s_edstale", site: "Edit Stale Fixture", name: "Concept A", status: "active",
  origin: { lat: 29.7604, lon: -95.3698 }, county: "harris",
  parcels: [{ id: "pA", points: PARCEL, locked: true }],
  els: [
    { id: "b1", type: "building", cx: 0, cy: 0, w: 300, h: 200, rot: 0 },
  ],
  measures: [], callouts: [], markups: [], deletedIds: [],
  // Deliberately minimal lastCheck: `checkedAt` alone is enough for `floodChecked` — no `sig`
  // and no `fetch` envelope, so factsFreshness's two NETWORK-facing tests (signature match,
  // envelope containment) are both skipped (their guards are `lastCheck.sig &&` / `fetchRec &&`)
  // and the read starts FRESH on the `editedSinceCheck` axis alone.
  settings: { showSetback: false, drainage: { autoFacts: false, lastCheck: { checkedAt: CHECKED_AT } } },
  underlay: null, updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({ s_edstale: ${JSON.stringify(site)} }));
  localStorage.setItem('planarfit:currentSite:v1', 's_edstale');
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 980 }, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
await assertMeasurable(page, "verify-flood-freshness-edit-stale");
const errors = [];
const NOISE = /ERR_TUNNEL|ERR_CONNECTION|ERR_CERT|Failed to load resource|net::/i;
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !NOISE.test(m.text())) errors.push(m.text()); });
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(2600);

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

await page.getByRole("button", { name: /Yield/ }).first().click().catch(() => {});
await page.waitForTimeout(700);

const dot = page.locator("[data-drain-freshness]").first();
const before = await dot.getAttribute("data-drain-freshness").catch(() => null);
const beforeTitle = (await dot.getAttribute("title").catch(() => "")) || "";
log(before === "fresh", `starts FRESH (minimal remembered check, no sig/envelope) :: got "${before}"`);
log(!/edited|moved/i.test(beforeTitle), `fresh dot's tooltip carries no staleness reason :: "${beforeTitle}"`);

const undoBtn = page.locator('button[aria-label="Undo"], button[title*="Undo" i]').first();
const undoDisabledBefore = await undoBtn.getAttribute("aria-disabled").catch(() => null);

// Select Building 1, then nudge it 5 ft with a REAL key (SYNTHETIC-KEYS-DONT-EDIT: a synthetic
// KeyboardEvent never reaches the window-level handler — page.keyboard.press dispatches a real,
// trusted event).
await page.click('[data-el-id="b1"]');
await page.waitForTimeout(150);
for (let i = 0; i < 5; i++) { await page.keyboard.press("ArrowRight"); await page.waitForTimeout(60); }
await page.waitForTimeout(300);

const undoDisabledAfter = await undoBtn.getAttribute("aria-disabled").catch(() => null);
log(undoDisabledBefore !== "false" && undoDisabledAfter === "false", `Undo armed by the nudge (a real edit landed) :: before="${undoDisabledBefore}" after="${undoDisabledAfter}"`);

await page.waitForTimeout(200);
const after = await dot.getAttribute("data-drain-freshness").catch(() => null);
const afterTitle = (await dot.getAttribute("title").catch(() => "")) || "";
const ariaLabel = await dot.getAttribute("aria-label").catch(() => "");
log(after === "stale", `flips to STALE after the element edit :: got "${after}"`);
log(afterTitle.includes("a site element has moved since the last check"), `tooltip names the NEW-7 reason verbatim :: "${afterTitle}"`);
log(ariaLabel === "Flood check is out of date", `aria-label reads the stale state :: "${ariaLabel}"`);

// The run DATE must be preserved, never reset to "just now" by the edit alone (no re-check ran).
const headerLine = await page.locator('[data-testid="yield-panel"]').first().innerText().catch(() => "");
log(!/checking\.\.\./i.test(headerLine), `header never claims a check is running (nothing is fetching) :: contains "checking..." = ${/checking\.\.\./i.test(headerLine)}`);

log(errors.length === 0, `no console/page errors (${errors.length})` + (errors.length ? ` :: ${errors.slice(0, 2).join(" | ")}` : ""));
console.log(fail === 0 ? "\nALL PASS" : `\n${fail} CHECK(S) FAILED`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
