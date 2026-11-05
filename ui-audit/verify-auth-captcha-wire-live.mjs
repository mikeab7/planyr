/* B2619760 / V2064432 — WIRE SHAPE on the real deploy when this environment cannot reach Cloudflare.
 *   E2E_EMAIL=… node ui-audit/verify-auth-captcha-wire-live.mjs [https://planyr.io]
 * Some sandboxes deny challenges.cloudflare.com (egress policy), so the real widget cannot load and the real
 * check cannot be passed. This is NOT a stand-in for that check (V2064432 stays owed on a real browser): it
 * serves a FAKE Turnstile script that issues an obviously invalid token, then drives the REAL panel against the
 * REAL Supabase and proves (a) the token now travels on /token (before: none → "no captcha_token
 * found"), (b) GoTrue's answer to an invalid token is turned into plain words, never raw, in sign in.
 * (Forgot password is NOT checked here any more: since B2626128 it no longer calls Supabase's /recover at all — it asks
 * Planyr's own /api/auth/email-link route, which a made-up token cannot exercise and which would send real mail to a real
 * address; its live gate is ui-audit/verify-email-link-live.mjs.) We never solve, forge or route around Cloudflare: the token is deliberately invalid. */
import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const base = (process.argv[2] || "https://planyr.io").replace(/\/$/, "");
const email = process.env.E2E_EMAIL || "e2e@planyr.test";
const FAKE = `(function(){var n=0,w={};window.turnstile={render:function(el,o){var id='w'+(++n);w[id]=o;setTimeout(function(){o.callback('INVALID-TOKEN-'+(++n))},50);return id},reset:function(id){var o=w[id];if(o)setTimeout(function(){o.callback('INVALID-TOKEN-'+(++n))},50)},remove:function(id){delete w[id]}}})();`;
const exe = existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium";
const b = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const page = await (await b.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
await page.route("https://challenges.cloudflare.com/**", (r) => r.fulfill({ status: 200, contentType: "application/javascript", body: FAKE }));
const wire = [];
page.on("response", async (r) => { const u = new URL(r.url()); if (/^\/auth\/v1\/(token|recover)$/.test(u.pathname)) wire.push({ path: u.pathname, status: r.status(), sentToken: /INVALID-TOKEN/.test(r.request().postData() || ""), body: (await r.text().catch(() => "")).slice(0, 160) }); });
let bad = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) bad++; };
const dlg = page.getByRole("dialog");
await page.goto(`${base}/?app&auth=signin`, { waitUntil: "domcontentloaded" });
await dlg.waitFor({ timeout: 30000 });
await assertMeasurable(page, "verify-auth-captcha-wire-live");
console.log("build:", JSON.stringify(await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()))));
await page.waitForTimeout(500);
await dlg.getByLabel("Email").fill(email); await dlg.getByLabel("Password").fill("not-the-password-1");
await page.getByTestId("auth-submit").click();
await page.waitForTimeout(4000);
let t = await dlg.innerText();
ok(wire.some((w) => w.path === "/auth/v1/token" && w.sentToken), "sign in: the token is on the /token request");
ok(!/captcha_token found/.test(JSON.stringify(wire.filter((w) => w.path === "/auth/v1/token"))), "sign in: the server no longer says 'no captcha_token found'");
ok(!/captcha|disallowed|token/i.test(t) && /couldn't verify this browser/i.test(t), "sign in: the screen shows plain words, no raw captcha text");
console.log("wire:", JSON.stringify(wire.map((w) => ({ path: w.path, status: w.status, sentToken: w.sentToken, body: w.body.slice(0, 110) }))));
await b.close();
process.exit(bad ? 1 : 0);
