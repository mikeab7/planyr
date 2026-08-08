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


/* ---- Detention-pond inspector (B266088) ---------------------------------------------------
 * SIX pond specs each carried their own private copy of a helper block written against the FLAT
 * pond inspector, and every copy went stale on the same day for the same reason. The inspector
 * was reorganised into collapsible groups and the copies were not updated:
 *
 *   • 7ef3d3a5 (B934, PR #744, 2026-07-21) — the "Top-of-bank elev. (ft)" Field was removed and
 *     its `det.tobElev` binding moved to the always-visible "Rim" glance row (same NumInput,
 *     same onCommit, same clear button; only the label and the position changed). Every
 *     engineering input — Freeboard, Drainage area, Impervious %, Allowable release — moved
 *     inside the "Engineering assumptions" <Collapse>, and the outlet controls inside
 *     "Outlet & storms". Both groups are CLOSED by default.
 *   • d4595625 / c105648e (B969 / B970, PR #779 / #780, 2026-07-23) — that first group was
 *     renamed "Sizing & criteria" → "Engineering assumptions" and pinned closed on every load
 *     (`persist={false}`), so a spec cannot rely on a stored open state either.
 *   • 85f9062b (B1188, PR #873, 2026-07-30) — a single click SELECTS; only a double click opens
 *     Properties. A spec that clicks once gets a selected pond and a closed inspector.
 *
 * The E2E workflow's last green run was 2026-07-21 and it has been red every scheduled run from
 * 2026-07-22 — the morning after the first of those. Keeping the knowledge here, once, is the
 * point: the next reorganisation is one edit, not six.
 *
 * NOTE: these helpers deliberately do NOT touch any engineering value. They open groups and
 * address fields; what the fields then compute is what the specs are for. */

export const POND_GROUP = {
  sizing: "Engineering assumptions",   // freeboard · side slope · drainage area · impervious % · allowable release
  outlet: "Outlet & storms",           // rate control · outlet stages · the routed per-storm table
  flood: "Flood & datum",
  district: "Drainage district",
  appearance: "Appearance",
};

/* A pond-inspector <Collapse> header, addressed by its title. The accessible name is
 * "<title> <closed-state summary>", so match on the leading title only. */
export const pondGroupHeader = (page, title) =>
  page.getByRole("button", { name: new RegExp(`^${title}`, "i") }).first();

/* Open one of the inspector's collapsed groups. Idempotent — an already-open group is left
 * alone rather than toggled shut, so callers can open the same group twice safely. */
export async function openPondGroup(page, title) {
  const header = pondGroupHeader(page, title);
  await header.scrollIntoViewIfNeeded();
  if ((await header.getAttribute("aria-expanded")) !== "true") await header.click();
  await expect(header).toHaveAttribute("aria-expanded", "true");
}

/* A `Field`-rendered input inside the inspector: <div><span>{label}</span>{children}</div>,
 * no label[for], so locate by the label text's parent container. */
export const pondFieldInput = (page, labelText) =>
  page.getByText(labelText, { exact: true }).first().locator("xpath=ancestor::div[1]").locator("input").first();

export async function fillPondField(page, labelText, value) {
  const input = pondFieldInput(page, labelText);
  await input.scrollIntoViewIfNeeded();
  await input.fill(String(value));
  await input.press("Tab");
}

/* The pond's top-of-bank anchor (`det.tobElev`) — the "Rim" glance row since B934. It is
 * addressed by id rather than by label text because the label span also carries its ⓘ button,
 * which is exactly why the release field beside it has always been addressed the same way. */
export const pondRimInput = (page) => page.locator('[id^="pond-rim-field-"] input').first();
export const pondReleaseInput = (page) => page.locator('[id^="pond-release-field-"] input').first();

export async function setPondRim(page, elevFt) {
  const input = pondRimInput(page);
  await input.scrollIntoViewIfNeeded();
  await input.fill(String(elevFt));
  await input.press("Tab");
}

/* Draw a detention-pond rectangle on the canvas and open its inspector (double click — B1188).
 * Returns the pond's screen centre so a spec can re-open it after a reload. */
export async function drawAndOpenPond(page, { x1 = 320, y1 = 250, x2 = 560, y2 = 420 } = {}) {
  const box = await page.getByTestId("planner-canvas").boundingBox();
  await page.getByRole("button", { name: "Detention Pond", exact: true }).click();
  const ax = box.x + x1, ay = box.y + y1, bx = box.x + x2, by = box.y + y2;
  await page.mouse.move(ax, ay);
  await page.mouse.down();
  await page.mouse.move(ax + 60, ay + 40, { steps: 5 });
  await page.mouse.move(bx, by, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press("Escape"); // back to the Select tool
  const centre = { cx: Math.round((ax + bx) / 2), cy: Math.round((ay + by) / 2) };
  await page.mouse.dblclick(centre.cx, centre.cy);
  return centre;
}

/* Draw a pond, anchor it (rim elevation) and give it a tributary area — the setup every
 * outlet/routing spec needs before the rate-control section will resolve. Leaves BOTH the
 * "Engineering assumptions" and "Outlet & storms" groups open. */
export async function drawAnchoredPond(page, { rimFt = 100, drainageAcres = null, impervPct = null, ...box } = {}) {
  const centre = await drawAndOpenPond(page, box);
  await setPondRim(page, rimFt);
  // Always open BOTH groups: the release field lives in the first and the outlet controls in the
  // second, and a spec that touches neither still costs nothing by having them open.
  await openPondGroup(page, POND_GROUP.sizing);
  if (drainageAcres != null) await fillPondField(page, "Drainage area (ac)", drainageAcres);
  if (impervPct != null) await fillPondField(page, "Impervious %", impervPct);
  await openPondGroup(page, POND_GROUP.outlet);
  return centre;
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
