/* B2619760 / V2064432 — the REAL sign-in panel on a real deploy, behind the real Turnstile + Supabase captcha.
 *   E2E_EMAIL=… E2E_PASSWORD=… node ui-audit/verify-auth-captcha-live.mjs [https://planyr.io] [chromium|webkit]
 * webkit = Playwright WebKit with the iPhone 15 descriptor (docs/PHONE-TESTING.md: say "WebKit", never "iPhone").
 * Steps: panel opens quiet · wrong password → plain message · right password signs in · forgot password confirms ·
 * sign-up renders its check. Each step prints PASS / FAIL / REFUSED. REFUSED means NO token was produced (Cloudflare withheld it, or the environment's egress policy denies
 * challenges.cloudflare.com — `curl` it first) — that is NOT a pass (the live check on a real browser stays owed) and we do
 * not route around it. The served build (/version.json) and chunk hashes are read in the SAME call as every
 * assertion's page. Creates nothing: sign-up is opened, never submitted; the only mail is one reset for the test account. */
import { chromium, webkit, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const base = (process.argv[2] || "https://planyr.io").replace(/\/$/, "");
const engine = process.argv[3] || "chromium";
const email = process.env.E2E_EMAIL, goodPw = process.env.E2E_PASSWORD;
if (!email || !goodPw) { console.error("set E2E_EMAIL and E2E_PASSWORD"); process.exit(2); }

const exe = existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium";
const browser = engine === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const ctx = await browser.newContext(engine === "webkit" ? { ...devices["iPhone 15"] } : { viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const wire = [];
page.on("response", async (r) => {
  const u = r.url();
  if (/\/auth\/v1\/(token|recover|signup)/.test(u)) wire.push({ path: new URL(u).pathname, status: r.status(), body: (await r.text().catch(() => "")).slice(0, 200), reqHasToken: /captcha_token/.test(r.request().postData() || "") });
});
const results = [];
const note = (name, verdict, detail = "") => { results.push({ name, verdict, detail }); console.log(`${verdict.padEnd(8)} ${name}${detail ? " — " + detail : ""}`); };
const dlg = page.getByRole("dialog");
const stamp = async () => page.evaluate(async () => ({
  build: await fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
  chunks: [...document.querySelectorAll("script[src]")].map((s) => s.src.split("/").pop()).filter((n) => /AppHeader|index|Shell/.test(n)).slice(0, 4),
}));
const refusedFor = (path) => wire.filter((w) => w.path === path && /captcha/i.test(w.body));

async function openPanel(mode = "signin") {
  await page.goto(`${base}/?app&auth=${mode}`, { waitUntil: "domcontentloaded" });
  await dlg.waitFor({ state: "visible", timeout: 30000 });
  await assertMeasurable(page, "verify-auth-captcha-live");
}
async function tokenReady() {
  // interaction-only hides the widget; give Cloudflare a few seconds to answer so a failure below is the app's, not a race
  await page.waitForTimeout(4000);
}

try {
  await openPanel("signin");
  const s0 = await stamp();
  console.log("engine:", engine, "| build:", JSON.stringify(s0.build), "| chunks:", s0.chunks.join(","));
  const quiet = await dlg.innerText();
  note("1 sign-in panel opens with nothing added", /verif|captcha|robot/i.test(quiet) ? "FAIL" : "PASS", /verif|captcha|robot/i.test(quiet) ? quiet.slice(0, 80) : "");
  const wState = await page.getByTestId("turnstile-widget").getAttribute("data-turnstile-state").catch(() => null);
  console.log("   widget state:", wState);

  await tokenReady();
  await dlg.getByLabel("Email").fill(email);
  await dlg.getByLabel("Password").fill("definitely-wrong-password-1");
  await page.getByTestId("auth-submit").click();
  await page.waitForTimeout(6000);
  const t2 = await dlg.innerText();
  if (/captcha|disallowed|captcha_token/i.test(t2)) note("2 wrong password → plain message", "FAIL", "raw captcha wording on screen: " + t2.slice(-120));
  else if (/Invalid login credentials/i.test(t2)) note("2 wrong password → plain message", "PASS", "Invalid login credentials");
  else if (/couldn't verify this browser|couldn't run the browser check/i.test(t2) || refusedFor("/auth/v1/token").length) note("2 wrong password → plain message", "REFUSED", "no token was produced (widget state: " + wState + " — Cloudflare withholding the check, OR this environment denying challenges.cloudflare.com); screen said: " + t2.split("\n").slice(-2).join(" | "));
  else note("2 wrong password → plain message", "FAIL", t2.slice(-120));

  await dlg.getByLabel("Password").fill(goodPw);
  await page.getByTestId("auth-submit").click();
  const closed = await dlg.waitFor({ state: "hidden", timeout: 20000 }).then(() => true, () => false);
  if (closed) {
    const who = await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data?.user?.email);
    note("3 right password after a wrong one signs in", who === email ? "PASS" : "FAIL", "signed in as " + who);
  } else {
    const tx = await dlg.innerText();
    note("3 right password after a wrong one signs in", /couldn't verify|couldn't run/i.test(tx) ? "REFUSED" : "FAIL", tx.split("\n").slice(-2).join(" | "));
  }
  const tokenSeen = wire.filter((w) => w.path === "/auth/v1/token");
  console.log("   /token requests:", JSON.stringify(tokenSeen.map((w) => ({ status: w.status, reqHasToken: w.reqHasToken }))));

  // 4: signed-out fast tap
  await page.evaluate(() => window.pfSupabase.auth.signOut());
  await openPanel("signin");
  await dlg.getByLabel("Email").fill(email);
  await dlg.getByLabel("Password").fill(goodPw);
  await page.getByTestId("auth-submit").click(); // immediately — token may not exist yet
  const closed4 = await dlg.waitFor({ state: "hidden", timeout: 30000 }).then(() => true, () => false);
  const t4 = closed4 ? "" : await dlg.innerText();
  note("4 fill and tap at once signs in (Verifying… then through)", closed4 ? "PASS" : /couldn't verify|couldn't run/i.test(t4) ? "REFUSED" : "FAIL", t4.split("\n").slice(-2).join(" | "));
  await page.evaluate(() => window.pfSupabase.auth.signOut()).catch(() => {});

  // 5: forgot password
  await openPanel("signin");
  await tokenReady();
  await dlg.getByText("Forgot password?").click();
  await dlg.getByLabel("Email").fill(email);
  await tokenReady();
  await page.getByTestId("auth-submit").click();
  await page.waitForTimeout(6000);
  const t5 = await dlg.innerText();
  const rec = wire.filter((w) => w.path === "/auth/v1/recover");
  console.log("   /recover:", JSON.stringify(rec.map((w) => ({ status: w.status, reqHasToken: w.reqHasToken, body: w.body.slice(0, 80) }))));
  if (/captcha|disallowed/i.test(t5)) note("5 forgot password confirms", "FAIL", t5.slice(-120));
  else if (rec.some((w) => w.status === 200) && /reset|email/i.test(t5)) note("5 forgot password confirms", "PASS", t5.split("\n").slice(-1)[0].slice(0, 100));
  else note("5 forgot password confirms", /couldn't verify|couldn't run/i.test(t5) ? "REFUSED" : "FAIL", t5.split("\n").slice(-2).join(" | "));

  // 6: sign up still renders (never submitted)
  await openPanel("signup");
  const su = await dlg.innerText();
  const hasWidget = (await page.getByTestId("turnstile-widget").count()) === 1;
  const app = await page.getByTestId("turnstile-widget").getAttribute("data-turnstile-appearance").catch(() => null);
  note("6 sign-up renders with its visible check", hasWidget && app === "always" && /Create account/.test(su) ? "PASS" : "FAIL", `widget=${hasWidget} appearance=${app}`);

  const s1 = await stamp();
  console.log("build at end:", JSON.stringify(s1.build));
} catch (e) { console.error("ERROR", e.message); results.push({ name: "harness", verdict: "FAIL", detail: e.message }); }
await browser.close();
const bad = results.filter((r) => r.verdict === "FAIL").length, ref = results.filter((r) => r.verdict === "REFUSED").length;
console.log(`\n${results.length} steps — ${results.filter((r) => r.verdict === "PASS").length} PASS, ${ref} REFUSED, ${bad} FAIL` + (ref ? "  (REFUSED ≠ pass: the real-browser check is still owed)" : ""));
process.exit(bad ? 1 : 0);
