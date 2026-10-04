/* signedInSession — THE ONE shared sign-in for any session/harness that must verify a change
 * signed in as the throwaway test account (e2e@planyr.test) against a real deploy.
 *
 * Owner decision 2026-10-04: a session's own live signed-in check on the test account COUNTS as
 * verified. `Blocker: auth` no longer parks a check.
 *
 * Trust: the sandbox egress proxy re-signs HTTPS with its own CA. The environment setup script
 * imports that CA into $HOME/.pki/nssdb so Chromium trusts exactly what the shell trusts.
 * NEVER pass --ignore-certificate-errors* flags (ruled out by the owner). If Chromium reports
 * net::ERR_CERT_AUTHORITY_INVALID, check `certutil -d sql:$HOME/.pki/nssdb -L` for the proxy CA.
 *
 * Credentials come from E2E_EMAIL / E2E_PASSWORD (env). The password is never printed.
 *
 * Usage:
 *   const s = await openSignedIn({ base: "https://planyr.io" });   // or a *.planyr.pages.dev preview
 *   ... s.page ...; console.log(s.build);  await s.close();
 */
import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";

export const FIXTURE_SITE_ID = "e2e-fixture-site";

export async function openSignedIn({ base = "https://planyr.io", viewport = { width: 1440, height: 900 } } = {}) {
  const email = process.env.E2E_EMAIL, pw = process.env.E2E_PASSWORD;
  if (!email || !pw) throw new Error("signedInSession: E2E_EMAIL / E2E_PASSWORD not set");
  // Pinned-revision mismatch in this sandbox: fall back to the pre-installed Chromium (never download).
  const exe = existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium";
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] }); // no ignore-cert flags, ever
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + "/", { waitUntil: "domcontentloaded" });
  const emailField = page.locator('input[type="email"]');
  if (!(await emailField.count())) {
    await page.getByRole("button", { name: /sign in|account|log ?in/i }).first().click().catch(() => {});
  }
  await emailField.first().waitFor({ state: "visible", timeout: 20000 });
  await emailField.first().fill(email);
  const pwField = page.locator('input[type="password"]').first();
  await pwField.fill(pw);
  await pwField.press("Enter");
  // The module tabs are visible SIGNED OUT too, so they prove nothing. Signed in == the auth dialog is gone;
  // a rejected sign-in leaves the dialog open with the server's message (e.g. a captcha rejection).
  const gone = await emailField.first().waitFor({ state: "hidden", timeout: 30000 }).then(() => true, () => false);
  if (!gone) {
    const msg = (await page.locator('input[type="password"]').first().locator("xpath=ancestor::form[1]").innerText().catch(() => "")).split("\n").filter(Boolean).pop();
    throw new Error("signedInSession: sign-in rejected — " + (msg || "auth dialog still open"));
  }
  const build = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null));
  return { browser, context, page, build, errors, close: () => browser.close() };
}
