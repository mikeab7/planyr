/* Playwright's Chromium raises navigator.webdriver, which the sign-in panel now reads as "an AI agent's browser"
 * (src/shared/auth/agentBrowser.js) and answers with the code-first layout. Specs that test the PERSON's password
 * form call this first so they keep testing what a person sees; e2e/auth-agent-browser.spec.js tests the agent view.
 * It also raises `window.__PLANYR_E2E`, the app's second "automated run" door, so everything else that keys on
 * automation (telemetry never written to production, `window.pfSupabase`, the raw-sites view) keeps working. */
export async function asHumanBrowser(page) {
  await page.addInitScript(() => {
    try { window.__PLANYR_E2E = true; } catch (_) { /* best effort */ }
    try { Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false, configurable: true }); } catch (_) { /* best effort */ }
  });
}
