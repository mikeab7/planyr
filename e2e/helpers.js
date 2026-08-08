/* Shared e2e helpers (B278). */
import { expect } from "@playwright/test";

export const E2E_EMAIL = process.env.E2E_EMAIL || "";
export const E2E_PASSWORD = process.env.E2E_PASSWORD || "";
export const hasAccount = !!(E2E_EMAIL && E2E_PASSWORD);

/* Where auth.setup.js saves the signed-in session for the auth-gated specs to reuse. */
export const STORAGE_STATE = "e2e/.auth/user.json";

/* Sign in with the seeded test account (B280). Opens the account/auth panel, fills the
 * email + password fields (targeted by their stable type + placeholder), submits, and waits
 * for the signed-in chrome. Call `test.skip(!hasAccount, …)` BEFORE this in any spec that
 * needs auth so a contributor without the secrets gets a clean skip, not a failure. */
export async function signIn(page) {
  // Open the auth panel from the header. The signed-out header shows a "Sign in" affordance;
  // clicking any control that reveals the email field is enough — we find it by role/text.
  const emailField = page.locator('input[type="email"]');
  if (!(await emailField.count())) {
    await page.getByRole("button", { name: /sign in|account|log ?in/i }).first().click().catch(() => {});
  }
  await expect(emailField.first()).toBeVisible();
  await emailField.first().fill(E2E_EMAIL);
  const pwField = page.locator('input[type="password"]').first();
  await pwField.fill(E2E_PASSWORD);
  // Submit via Enter on the password field. The form renders TWO "Sign in" buttons (a mode tab
  // + the submit), so a name-based click hit a strict-mode violation; and the auth-submit testid
  // only exists once this branch deploys. Enter commits the form on the CURRENT live build too,
  // so this works deploy-independently. (The auth-submit testid stays for explicit future use.)
  await pwField.press("Enter");
  // Signed-in: the email field is gone and the app chrome shows the module tabs.
  await expect(moduleTab(page, "site-planner")).toBeVisible({ timeout: 15_000 });
}

/* The ACTIVE workspace's module tab. Keep-alive keeps every visited workspace mounted —
 * each with its own (hidden) header — so a bare getByTestId can match several tabs and
 * trip Playwright's strict mode. Only the visible header's tab is the real one. */
export function moduleTab(page, moduleId) {
  return page.getByTestId(`module-tab-${moduleId}`).filter({ visible: true });
}

/* Switch to a workspace module by its tab. moduleId is the internal id
 * ("site-planner" | "doc-review" | …) — the user-facing label may differ ("Review").
 *
 * A transient overlay (a post-sign-in "cloud on"/sync toast, or a closing auth-panel backdrop)
 * can briefly sit over the header tabs and intercept the click. Retry the whole click→verify
 * until the tab actually becomes current, rather than failing on the first interception. */
export async function openModule(page, moduleId) {
  const tab = moduleTab(page, moduleId);
  await tab.waitFor({ state: "visible", timeout: 20_000 });
  await expect(async () => {
    await tab.click({ timeout: 3_000 });
    await expect(tab).toHaveAttribute("aria-current", "page", { timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
}

/* B266082 — "visible" is NOT "on screen", and that gap silently blessed a broken assertion.
 *
 * Playwright's toBeVisible() means "has a non-empty box and is not visibility:hidden". It says
 * NOTHING about where that box is. When the app enters real fullscreen the header slides to
 * y = −44: every module tab is still `visible` by that definition, unreachable by any user,
 * and unclickable by Playwright itself ("element is outside of the viewport"). So
 * `module-keepalive`'s "the chrome came back" assertion PASSED for weeks against a page whose
 * chrome had not come back — and the failure only surfaced one line later, on a click, which
 * is why the spec's real subject was never reached.
 *
 * Assert the box is inside the viewport when what you mean is "the user can see and click it".
 *
 * Both helpers POLL rather than sampling once: the header slides, so a single read taken the
 * instant the Exit-fullscreen control appears catches it mid-transition (measured: bottom edge
 * at 4.5 on the first frame, −1 once settled). Polling waits for the settled state and still
 * fails outright if it never arrives — it is a wait, not a relaxation. */
export async function expectOnScreen(page, locator, what = "element") {
  await expect(locator).toBeVisible();
  const size = page.viewportSize() || { width: 1280, height: 720 };
  await expect
    .poll(async () => {
      const b = await locator.boundingBox();
      return b ? Math.round(b.y) : null;
    }, { message: `${what} never came back on screen (viewport height ${size.height}) — "visible" is not "on screen"` })
    .toEqual(expect.any(Number));
  const box = await locator.boundingBox();
  await expect
    .poll(async () => {
      const b = await locator.boundingBox();
      return b && b.y + b.height > 0 && b.y < size.height;
    }, { message: `${what} is off screen (last seen y=${Math.round(box?.y ?? NaN)}) — "visible" is not "on screen"` })
    .toBe(true);
}

/* The inverse: present in the DOM but translated off screen — what a collapsed fullscreen
 * header actually does to the module tabs. */
export async function expectOffScreen(page, locator, what = "element") {
  await expect
    .poll(async () => {
      const b = await locator.boundingBox();
      return b ? b.y + b.height <= 0 : null;
    }, { message: `${what} is still on screen — the chrome did not collapse` })
    .toBe(true);
}


/* ---- Dissolved road network (NEW-1/NEW-2) ------------------------------------------------
 * The road connection is no longer a cover patch painted over a seam — it is a boolean UNION of
 * pavement (see src/workspaces/site-planner/lib/roadNetwork.js). So a spec should not ask "is there a
 * cover element / a mask hole"; it should ask what the owner actually sees: how many pavement regions
 * the junction dissolved to, whether any sliver holes survived, and how big the curb returns came out.
 * `armPlannerHooks` must run BEFORE page.goto — it arms the same `window.__PLANYR_E2E` gate the geo-map
 * hook uses, which exposes `window.__plannerRoadNet()`. */
export async function armPlannerHooks(page) {
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
}
export const roadNetwork = (page) => page.evaluate(() => (window.__plannerRoadNet ? window.__plannerRoadNet() : null));
export const netSurfaces = (p) => p.locator('[data-testid="road-network-surface"]');
export const netEdges = (p) => p.locator('[data-testid="road-network-edge"]');
/* |ring| area, for "did a sliver survive the dissolve" assertions. */
export const ringArea = (r) => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p.x * q.y - q.x * p.y; }, 0) / 2);
