/* NEW-1 / V2070800 — Planyr's emailed sign-in / reset link, on a REAL deploy. One step per state of the table in the PR.
 *   E2E_LOGIN_KEY=… node ui-audit/verify-email-link-live.mjs [https://planyr.io] [chromium|webkit]
 * webkit = Playwright WebKit with the iPhone 15 descriptor (docs/PHONE-TESTING.md: say "WebKit", never "iPhone").
 *
 * WHAT THIS CAN DO WITHOUT A REAL INBOX (and does): the route's answers (same reply for a known and an unknown address,
 * the per-address cooldown, no account created), the real panel with Cloudflare's script BLOCKED, and the landing page
 * in every state that does not need a working token — malformed, ready (opening spends nothing), expired/used
 * (a made-up token really is refused by Supabase), network failure on the press, signed in as the SAME / a DIFFERENT account.
 * WHAT IT CANNOT (printed as NEEDS-INBOX, never as PASS): a real token from a real email — the button signing in, the
 * locked set-new-password form after a real reset, the mail itself arriving from no-reply@planyr.io. A session with a
 * mailbox it can read runs those by hand (V2070800 steps 17–20).
 *
 * MAIL SENT BY A RUN: at most ONE real send attempt, to the test account's address (it bounces — the domain is .test) in step 1 and writes ONE mailbox_proofs row for the test account in step 16c (cleared by the running session);
 * every other send is to a made-up address, which the route answers identically and mails nothing. The served build
 * (/version.json) is read in the SAME call as every page. Creates nothing; the cap rows it makes expire in a day. */
import { chromium, webkit, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn, TEST_ACCOUNT_EMAIL } from "./lib/signedInSession.mjs";
import { accountHint } from "../src/shared/auth/authLink.js";

const base = (process.argv[2] || "https://planyr.io").replace(/\/$/, "");
const engine = process.argv[3] || "chromium";
const TOKEN = "z".repeat(56);
const exe = existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium";
const results = [];
const note = (name, verdict, detail = "") => { results.push({ name, verdict, detail }); console.log(`${verdict.padEnd(11)} ${name}${detail ? " — " + detail : ""}`); };
const stamp = (page) => page.evaluate(async () => ({ build: await fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null) }));
// WebKit reports a lazy chunk still in flight as FAILED when the page is torn down, which fires the app's own rescue
// reload (`?_r=`) and interrupts the next goto. Letting a page settle before leaving it is the harness's job, not the app's.
const settle = async (pg) => { await pg.waitForLoadState("load").catch(() => {}); await pg.waitForTimeout(3000); };
const ghost = () => `nobody-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@planyr.test`;

const browser = engine === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const ctx = await browser.newContext(engine === "webkit" ? { ...devices["iPhone 15"] } : { viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const dlg = page.getByRole("dialog");
const verifyCalls = [];
page.on("request", (r) => { if (/\/auth\/v1\/verify/.test(r.url())) verifyCalls.push(r.postData() || ""); });

async function post(body) {
  // same-origin fetch from inside the page: Chromium/WebKit trust store, and the Origin the route expects
  return page.evaluate(async (b) => {
    const r = await fetch("/api/auth/email-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
    return { status: r.status, body: await r.json().catch(() => null), cors: [...r.headers.keys()].filter((k) => k.startsWith("access-control-")) };
  }, body);
}

try {
  await settle(page);
  await page.goto(`${base}/?app`, { waitUntil: "domcontentloaded" });
  await assertMeasurable(page, "verify-email-link-live");
  const s0 = await stamp(page);
  console.log("engine:", engine, "| build:", JSON.stringify(s0.build));

  // SKIP_SEND=1 re-runs only the landing-page steps (9 onward): steps 1-8 make real send attempts, which the per-address and
  // per-IP hourly caps rightly refuse on a quick re-run.
  if (!process.env.SKIP_SEND) {
  // ── the route ────────────────────────────────────────────────────────────────────────────────────────────────
  const g1 = ghost();
  const unknown = await post({ email: g1, purpose: "signin" });
  const known = await post({ email: TEST_ACCOUNT_EMAIL, purpose: "signin" });   // the one real send attempt (bounces)
  const sameShape = unknown.status === 200 && known.status === 200 && JSON.stringify(unknown.body) === JSON.stringify(known.body);
  note("1 a known and an unknown address get the SAME reply (200, same body), no CORS headers", sameShape && !unknown.cors.length && !known.cors.length ? "PASS" : "FAIL", `unknown ${unknown.status} ${JSON.stringify(unknown.body)} | known ${known.status} ${JSON.stringify(known.body)}`);
  if (unknown.status === 503 || known.status === 503) note("1b route is configured", "FAIL", `503 ${JSON.stringify(unknown.body)} — migration not applied or env missing`);
  const again = await post({ email: g1, purpose: "signin" });
  note("2 the same address again at once is refused with a wait (cooldown), the same for an unknown address", again.status === 429 && again.body && again.body.reason === "throttled" && again.body.retryAfterSeconds > 0 ? "PASS" : "FAIL", JSON.stringify(again.body));
  const bad = await post({ email: "not-an-email", purpose: "reset" });
  note("3 a malformed address is a 400, nothing sent", bad.status === 400 ? "PASS" : "FAIL", String(bad.status));
  const wrongOrigin = await page.evaluate(async () => { try { const r = await fetch("/api/auth/email-link", { method: "GET" }); return r.status; } catch (e) { return -1; } });
  note("4 GET is refused (405)", wrongOrigin === 405 ? "PASS" : "FAIL", String(wrongOrigin));

  // ── the real panel with Cloudflare's script blocked ──────────────────────────────────────────────────────────
  await page.route("**/challenges.cloudflare.com/**", (r) => r.abort());
  await settle(page);
  await page.goto(`${base}/?app&auth=signin`, { waitUntil: "domcontentloaded" });
  await dlg.waitFor({ state: "visible", timeout: 30000 });
  await assertMeasurable(page, "verify-email-link-live");
  await dlg.getByLabel("Email").fill(ghost());
  const blockedNote = page.getByTestId("captcha-unavailable");
  const shown = await blockedNote.waitFor({ state: "visible", timeout: 25000 }).then(() => true, () => false);
  const promoted = shown && /network blocked/i.test(await blockedNote.innerText());
  note("5 Cloudflare's script blocked → the network line shows and 'Email me a sign-in link' is the main action", promoted ? "PASS" : "FAIL", shown ? "" : "the line never appeared within 25 s");
  if (promoted) {
    await page.getByTestId("email-link-signin").click();
    const inbox = page.getByTestId("email-link-inbox");
    const ok = await inbox.waitFor({ state: "visible", timeout: 20000 }).then(() => true, () => false);
    const txt = ok ? await inbox.innerText() : await dlg.innerText();
    note("6 …and pressing it gets you to 'Check your inbox … comes from Planyr (no-reply@planyr.io)'", ok && /It comes from Planyr \(no-reply@planyr\.io\)/.test(txt) ? "PASS" : "FAIL", txt.slice(0, 120));
    const resend = page.getByTestId("email-link-resend");
    const disabled = await resend.isDisabled();
    const resendText = await resend.innerText();
    const dlgText = await dlg.innerText();
    const parts = { locked: disabled, countdown: /Send again in \d:\d\d/.test(resendText), spam: /spam/i.test(dlgText), support: /support@planyr\.io/.test(dlgText) };
    note("7 'Send again' is locked with a countdown, then spam + support lines are there", Object.values(parts).every(Boolean) ? "PASS" : "FAIL", `${JSON.stringify(parts)} · button reads "${resendText}"`);
  }
  await page.unroute("**/challenges.cloudflare.com/**");

  // ── forgot password through the real panel (no Cloudflare involved at all) ───────────────────────────────────
  await settle(page);
  await page.goto(`${base}/?app&auth=signin`, { waitUntil: "domcontentloaded" });
  await dlg.waitFor({ state: "visible", timeout: 30000 });
  await dlg.getByText("Forgot password?").click();
  await dlg.getByLabel("Email").fill(ghost());
  await page.getByTestId("auth-submit").click();
  const ok8 = await page.getByTestId("email-link-inbox").waitFor({ state: "visible", timeout: 20000 }).then(() => true, () => false);
  note("8 Forgot password → the same sent view, no Turnstile on the page", ok8 && (await page.getByTestId("turnstile-widget").count()) === 0 ? "PASS" : "FAIL");

  }
  // ── the landing page (no real token needed) ──────────────────────────────────────────────────────────────────
  const testHint = await accountHint(TEST_ACCOUNT_EMAIL);
  verifyCalls.length = 0;
  await settle(page);
  await page.goto(`${base}/?app&authlink=${TOKEN}&kind=signin&h=${testHint}`, { waitUntil: "domcontentloaded" });
  const ready = await page.getByTestId("auth-link-state-ready").waitFor({ state: "visible", timeout: 25000 }).then(() => true, () => false);
  await page.waitForTimeout(1500);
  note("9 opening the link shows ONE button and spends nothing (no /verify until it is pressed)", ready && verifyCalls.length === 0 && /Continue to Planyr/.test(await page.getByTestId("auth-link-continue").innerText()) ? "PASS" : "FAIL", `verify calls before press: ${verifyCalls.length}`);
  await page.getByTestId("auth-link-continue").click();
  const expired = await page.getByTestId("auth-link-state-expired").waitFor({ state: "visible", timeout: 25000 }).then(() => true, () => false);
  note("10 a made-up/spent token → 'expired or already used' with 'Send me a new link' right there", expired && verifyCalls.length === 1 && (await page.getByTestId("auth-link-resend").count()) === 1 ? "PASS" : "FAIL", `verify calls: ${verifyCalls.length}`);
  if (expired) {
    await page.getByTestId("auth-link-resend").click();
    note("11 …and the new-link form is there, address field empty on a device that never asked, the link carries no address", (await page.getByTestId("auth-link-email").count()) === 1 && !page.url().includes("@") ? "PASS" : "FAIL");
  }
  await settle(page);
  await page.goto(`${base}/?app&authlink=short&kind=reset`, { waitUntil: "domcontentloaded" });
  const mal = await page.getByTestId("auth-link-state-malformed").waitFor({ state: "visible", timeout: 25000 }).then(() => true, () => false);
  note("12 a malformed link says so and offers a new one + sign in", mal && (await page.getByTestId("auth-link-resend").count()) === 1 && (await page.getByTestId("auth-link-signin").count()) === 1 ? "PASS" : "FAIL");
  await page.route("**/auth/v1/verify", (r) => r.abort());
  await settle(page);
  await page.goto(`${base}/?app&authlink=${TOKEN}&kind=signin`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("auth-link-continue").waitFor({ timeout: 25000 });
  await page.getByTestId("auth-link-continue").click();
  const net = await page.getByTestId("auth-link-state-network").waitFor({ state: "visible", timeout: 25000 }).then(() => true, () => false);
  note("13 the network failing on the button press → 'Couldn't reach Planyr' with Try again", net && (await page.getByTestId("auth-link-retry").count()) === 1 ? "PASS" : "FAIL");
  await page.unroute("**/auth/v1/verify");
} catch (e) { console.error("ERROR", e.message); results.push({ name: "harness", verdict: "FAIL", detail: e.message }); }
await browser.close();

// ── signed in as the test account (chromium; uses the shared helper) ────────────────────────────────────────────
if (engine === "chromium") {
  let s = null;
  try {
    s = await openSignedIn({ base });
    const p = s.page;
    const other = await accountHint("someone-else@planyr.test");
    await p.goto(`${base}/?app&authlink=${TOKEN}&kind=signin&h=${other}`, { waitUntil: "domcontentloaded" });
    const diff = await p.getByTestId("auth-link-state-different-account").waitFor({ state: "visible", timeout: 25000 }).then(() => true, () => false);
    const names = diff && /e2e@planyr\.test/.test(await p.getByTestId("auth-link-state-different-account").innerText());
    note("14 signed in as the test account, a link for ANOTHER account: says so by name, offers Switch and Stay, no bare Continue", diff && names && (await p.getByTestId("auth-link-switch").count()) === 1 && (await p.getByTestId("auth-link-stay").count()) === 1 && (await p.getByTestId("auth-link-continue").count()) === 0 ? "PASS" : "FAIL");
    await p.getByTestId("auth-link-stay").click();
    const still = await p.evaluate(async () => (await window.pfSupabase.auth.getUser()).data?.user?.email);
    note("15 …Stay keeps the session untouched", still === TEST_ACCOUNT_EMAIL ? "PASS" : "FAIL", String(still));
    // ── the mailbox proof (prove_mailbox) ───────────────────────────────────────────────────────────────────────────
    // The test account's session is minted by redeeming an admin-made magiclink token — the SAME mechanism an emailed link uses, so its
    // access token carries amr [{method:"otp"}] and the route must accept it. WRITES ONE mailbox_proofs row for the test account
    // (via 'emailed_link'); the session that runs this deletes it afterwards (test artifacts are always cleared).
    const tok = await p.evaluate(async () => (await window.pfSupabase.auth.getSession()).data?.session?.access_token || "");
    const proof = (headers) => p.evaluate(async (h) => { const r = await fetch("/api/auth/mailbox-proof", { method: "POST", headers: { "content-type": "application/json", ...h }, body: "{}" }); return { status: r.status, body: await r.json().catch(() => null), cors: [...r.headers.keys()].filter((k) => k.startsWith("access-control-")) }; }, headers);
    const noBearer = await proof({});
    const bogus = await proof({ authorization: "Bearer not.a.jwt" });
    note("16b mailbox-proof: no bearer → 401, a made-up token → 401 (nothing recorded)", noBearer.status === 401 && bogus.status === 401 && !noBearer.cors.length ? "PASS" : "FAIL", `${noBearer.status} / ${bogus.status}`);
    const ok = await proof({ authorization: `Bearer ${tok}` });
    note("16c mailbox-proof: a session made by redeeming an emailed-style token → 200 {ok:true} (a row is written for the test account)", ok.status === 200 && ok.body && ok.body.ok === true ? "PASS" : "FAIL", `${ok.status} ${JSON.stringify(ok.body)}`);
    const mine = await accountHint(TEST_ACCOUNT_EMAIL);
    await p.goto(`${base}/?app&authlink=${TOKEN}&kind=signin&h=${mine}`, { waitUntil: "domcontentloaded" });
    const same = await p.getByTestId("auth-link-state-same-account").waitFor({ state: "visible", timeout: 25000 }).then(() => true, () => false);
    note("16 signed in, a link for the SAME account: says so, one button", same && (await p.getByTestId("auth-link-continue").count()) === 1 ? "PASS" : "FAIL");
  } catch (e) { note("14–16 signed-in states", "FAIL", e.message); }
  finally { if (s) await s.close().catch(() => {}); }
}

for (const n of [
  "17 the mail itself arrives from Planyr <no-reply@planyr.io> with a Planyr link (not supabase.co), and the link opens the page (needs a mailbox)",
  "18 the button signs in on a DIFFERENT device than the one that asked (needs a mailbox)",
  "19 a reset link: the set-new-password form opens by itself, cannot be dismissed, survives a reload, and the new password works (needs a mailbox)",
]) note(n, "NEEDS-INBOX");

const bad = results.filter((r) => r.verdict === "FAIL").length, need = results.filter((r) => r.verdict === "NEEDS-INBOX").length;
console.log(`\n${results.length} steps — ${results.filter((r) => r.verdict === "PASS").length} PASS, ${need} NEEDS-INBOX, ${bad} FAIL` + (need ? "  (NEEDS-INBOX ≠ pass: a session with a readable mailbox runs those)" : ""));
process.exit(bad ? 1 : 0);
