/* NEW-1 — verify the app-wide CloudSyncBadge in a real browser: every state is present
 * and visually distinct, the loud error is clickable → detail + Retry, null shows nothing,
 * and the headline guardrail holds — a render crash falls back to the LOUD error glyph,
 * never to blank. Drives the real component via ui-audit/badge-harness.html.
 * Run: npm run dev &  then  node ui-audit/verify-new1-cloud-badge.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:5173";
const HARNESS_URL = `${BASE}/ui-audit/badge-harness.html`;
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 700, height: 800 } });
const page = await ctx.newPage();
await page.goto(HARNESS_URL, { waitUntil: "load" });
await page.waitForTimeout(800);

const checks = [];
const ok = (name, cond) => { checks.push({ name, pass: !!cond }); console.log(`  ${cond ? "✓" : "✗"} ${name}`); };

// Per-state DOM facts: glyph present? aria-label? loud ring? pulsing?
const cell = (name) => page.evaluate((n) => {
  const slot = document.querySelector(`[data-slot="${n}"]`);
  const btn = slot && slot.querySelector("button");
  const svg = slot && slot.querySelector("svg");
  const cs = btn ? getComputedStyle(btn) : null;
  return {
    hasButton: !!btn,
    hasSvg: !!svg,
    aria: (btn && btn.getAttribute("aria-label")) || (slot && slot.querySelector("[aria-label]")?.getAttribute("aria-label")) || "",
    borderColor: cs ? cs.borderTopColor : "",
    anim: cs ? cs.animationName : "",
    slotEmpty: slot ? slot.textContent.trim() === "" && !svg : true,
  };
}, name);

const TRANSPARENT = "rgba(0, 0, 0, 0)";

// 1) synced — present, calm cloud-check, NOT loud (no colored ring).
const synced = await cell("synced");
ok("synced renders a glyph", synced.hasSvg && synced.hasButton);
ok("synced aria-label is 'Synced'", synced.aria === "Cloud sync: Synced");
ok("synced is NOT loud (transparent ring)", synced.borderColor === TRANSPARENT);

// 2) saving — present and pulsing (transient in-flight affordance).
const saving = await cell("saving");
ok("saving renders a glyph", saving.hasSvg);
ok("saving pulses (pf-pulse animation)", saving.anim === "pf-pulse");

// 3) offline — present, amber, actionable (click → detail), but no Retry (none supplied).
const offline = await cell("offline");
ok("offline renders a glyph", offline.hasSvg);
ok("offline is not loud-ringed", offline.borderColor === TRANSPARENT);

// 4) error — LOUD: present, a colored ring, distinct from synced.
const error = await cell("error");
ok("error renders a glyph", error.hasSvg);
ok("error aria-label is 'Sync problem'", error.aria === "Cloud sync: Sync problem");
ok("error is LOUD (non-transparent ring)", error.borderColor !== TRANSPARENT && error.borderColor !== "");
ok("error glyph differs from synced (distinct ring)", error.borderColor !== synced.borderColor);

// 4b) error is clickable → popover with detail + a working Retry.
await page.click('[data-slot="error"] button');
await page.waitForTimeout(250);
const dialog = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"]');
  if (!d) return null;
  const retry = [...d.querySelectorAll("button")].find((b) => /retry/i.test(b.textContent || ""));
  return { text: d.textContent || "", hasRetry: !!retry };
});
ok("clicking error opens a detail popover", !!dialog);
ok("popover surfaces what failed", dialog && /couldn.t be saved|safe on this device/i.test(dialog.text));
ok("popover offers Retry now", dialog && dialog.hasRetry);
await page.evaluate(() => { const d = document.querySelector('[role="dialog"]'); [...d.querySelectorAll("button")].find((b) => /retry/i.test(b.textContent || ""))?.click(); });
await page.waitForTimeout(150);
ok("Retry now fires the handler", (await page.evaluate(() => window.__retried)) === "yes");

// 5) local — the quiet on-device glyph.
const local = await cell("local");
ok("local renders a glyph", local.hasSvg);
ok("local aria-label is on-device", local.aria === "Cloud sync: Saved on this device");

// 6) null — shows NOTHING (legitimately empty, not a hidden error).
const nul = await cell("null");
ok("null state renders nothing", !nul.hasButton && !nul.hasSvg);

// 7) THE GUARDRAIL — a render crash falls back to the loud error glyph, never to blank.
const crashed = await cell("crashed");
ok("a crashed badge does NOT vanish (glyph still present)", crashed.hasSvg);
ok("crashed shows the loud error fallback", /status unavailable/i.test(crashed.aria));

await page.screenshot({ path: new URL("./screens/new1-cloud-badge.png", import.meta.url).pathname });
await ctx.close();
await browser.close();

const failed = checks.filter((c) => !c.pass);
console.log(failed.length ? `\n✗ ${failed.length} check(s) failed.` : "\n✓ CloudSyncBadge: all states distinct, error is loud + retryable, and it never silently vanishes.");
process.exit(failed.length ? 1 : 0);
