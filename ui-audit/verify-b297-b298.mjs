/* Verify B297 (profiles/name capture) + B298 (identity pill → account dropdown).
 *
 * The sandbox proxy CORS-blocks the Supabase network handshake, but supabase-js reads
 * its session from localStorage WITHOUT a network call. So we seed a well-formed local
 * session (far-future expiry) to exercise the SIGNED-IN UI headlessly: the name pill,
 * the account dropdown (Profile / Settings / Sign out + email), and the Profile/Settings
 * modal tabs. The profile-row fetch will fail (no network) and the hook falls back to the
 * session's user_metadata name — which is itself part of the never-blank rule we verify.
 * Phase 2 clears the session to verify the logged-out "Sign in" pill → signup First/Last.
 *
 * Build must bake a Supabase URL/key so supabaseConfigured() is true:
 *   VITE_SUPABASE_URL=https://demoref.supabase.co VITE_SUPABASE_ANON_KEY=demo-anon-key npm run build
 *   npx vite preview --host   (serves :4173)
 *   node ui-audit/verify-b271-b272.mjs
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const STORAGE_KEY = "sb-demoref-auth-token"; // sb-<urlhost first label>-auth-token

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

const session = {
  access_token: "fake.header.payload",
  refresh_token: "fake-refresh-token",
  token_type: "bearer",
  expires_in: 315360000,
  expires_at: Math.floor(Date.now() / 1000) + 315360000, // +10y, never "expired"
  user: {
    id: "demo-uid-b271",
    aud: "authenticated",
    role: "authenticated",
    email: "mike@demo.co",
    user_metadata: { first_name: "Mike", last_name: "Abbott", org: "Demo Dev Co" },
    app_metadata: { provider: "email", providers: ["email"] },
    created_at: "2026-01-01T00:00:00.000Z",
  },
};

const seedSession = (key, value) => `try { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(value))}); } catch (e) {}`;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

// text() of all visible buttons (for menu/modal assertions)
const visibleButtonTexts = (page) => page.evaluate(() =>
  [...document.querySelectorAll("button")]
    .filter((b) => b.offsetParent !== null)
    .map((b) => (b.textContent || "").replace(/\s+/g, " ").trim())
    .filter(Boolean));

const clickButton = async (page, re) => {
  const clicked = await page.evaluate((src) => {
    const rx = new RegExp(src);
    for (const b of document.querySelectorAll("button")) {
      if (b.offsetParent === null) continue;
      const t = (b.textContent || "").replace(/\s+/g, " ").trim();
      if (rx.test(t)) { b.click(); return t; }
    }
    return null;
  }, re.source);
  await page.waitForTimeout(350);
  return clicked;
};

/* ===================== PHASE 1 — signed in: name pill + dropdown ===================== */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  await ctx.addInitScript(seedSession(STORAGE_KEY, session));
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on("pageerror", (e) => jsErrors.push(String(e)));
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1800);

  // The pill shows the user's name (from the session metadata, the never-blank fallback).
  const pillText = await page.evaluate(() => {
    const b = [...document.querySelectorAll("header button")].find((x) => /Mike Abbott/.test(x.textContent || ""));
    return b ? b.textContent.replace(/\s+/g, " ").trim() : null;
  });
  log(!!pillText, `Row-1 pill shows the user's name (got: ${pillText || "—"})`);

  // Click the pill → account dropdown opens with Profile / Settings / Sign out + email.
  await clickButton(page, /Mike Abbott/);
  const menuBtns = await visibleButtonTexts(page);
  log(menuBtns.includes("Profile"), "Dropdown has a Profile item");
  log(menuBtns.includes("Settings"), "Dropdown has a Settings item");
  log(menuBtns.includes("Sign out"), "Dropdown has a Sign out item");
  const hasEmail = await page.evaluate(() => /mike@demo\.co/.test(document.body.innerText));
  log(hasEmail, "Dropdown shows the account email");
  const hasOrg = await page.evaluate(() => /Demo Dev Co/.test(document.body.innerText));
  log(hasOrg, "Dropdown shows the organization");
  await page.screenshot({ path: OUT + "b298-account-dropdown.png", clip: { x: 980, y: 0, width: 460, height: 340 } });

  // Escape closes the dropdown (shared AnchoredMenu affordance).
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  const closed = await page.evaluate(() => ![...document.querySelectorAll("button")].some((b) => b.offsetParent !== null && /^Sign out$/.test((b.textContent || "").trim())));
  log(closed, "Escape closes the account dropdown");

  // Re-open, then Profile → modal opens on the Profile tab (name fields populated + Save).
  await clickButton(page, /Mike Abbott/);
  await clickButton(page, /^Profile$/);
  const profileModal = await page.evaluate(() => {
    const vals = [...document.querySelectorAll("input")].map((i) => i.value);
    const txt = document.body.innerText;
    return { hasFirst: vals.includes("Mike"), hasLast: vals.includes("Abbott"),
      hasSave: /Save profile/.test(txt), hasOrg: vals.includes("Demo Dev Co") };
  });
  log(profileModal.hasFirst && profileModal.hasLast, "Profile modal pre-fills First + Last name");
  log(profileModal.hasSave, "Profile modal has a 'Save profile' action");
  await page.screenshot({ path: OUT + "b297-profile-modal.png", clip: { x: 470, y: 180, width: 500, height: 460 } });
  await clickButton(page, /Close ✕/);

  // Settings → modal opens on the Settings tab (Change password).
  await clickButton(page, /Mike Abbott/);
  await clickButton(page, /^Settings$/);
  const onSettings = await page.evaluate(() => /Change password/.test(document.body.innerText));
  log(onSettings, "Settings tab shows 'Change password'");
  await page.screenshot({ path: OUT + "b298-settings-tab.png", clip: { x: 470, y: 180, width: 500, height: 460 } });

  log(jsErrors.length === 0, `No uncaught JS errors during signed-in flow (${jsErrors.length})`);
  if (jsErrors.length) console.log("  errors:", jsErrors.slice(0, 4));
  await ctx.close();
}

/* ===================== PHASE 2 — logged out: Sign in pill → signup ===================== */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on("pageerror", (e) => jsErrors.push(String(e)));
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1500);

  const hasSignIn = await page.evaluate(() => [...document.querySelectorAll("header button")].some((b) => /Sign in/.test(b.textContent || "")));
  log(hasSignIn, "Logged-out pill shows 'Sign in'");

  await clickButton(page, /Sign in/);
  await clickButton(page, /Sign up/);
  const signup = await page.evaluate(() => {
    const ph = [...document.querySelectorAll("input")].map((i) => i.placeholder || "");
    return { first: ph.some((p) => /first name/i.test(p)), last: ph.some((p) => /last name/i.test(p)), org: ph.some((p) => /organization/i.test(p)) };
  });
  log(signup.first && signup.last, "Sign-up form has First + Last name fields (capture at signup)");
  await page.screenshot({ path: OUT + "b297-signup-form.png", clip: { x: 470, y: 120, width: 500, height: 560 } });

  log(jsErrors.length === 0, `No uncaught JS errors during logged-out flow (${jsErrors.length})`);
  if (jsErrors.length) console.log("  errors:", jsErrors.slice(0, 4));
  await ctx.close();
}

await browser.close();
console.log(fail === 0 ? "\nALL CHECKS PASSED" : `\n${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
