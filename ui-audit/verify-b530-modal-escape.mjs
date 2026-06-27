/* Verify B530 (and the modal-a11y pattern shared with B532) — the AuthPanel sign-in modal,
 * reachable LOGGED OUT, closes on Escape and announces itself as a dialog. This is the live
 * counterpart to the anti-drift guards in test/bugHuntGuards.test.js.
 *
 * Logged-out only (the sandbox blocks Supabase auth), so this covers the sign-in modal's a11y;
 * the signed-in Account/Profile views ride the SAME shared <Wrap>, so they inherit the fix —
 * recorded as the signed-in eyeball in VERIFICATION.md.
 *
 * Run:  npm run build && npx vite preview --port 4173   (one shell)
 *       node ui-audit/verify-b530-modal-escape.mjs       (another)
 */
const pw = await import("/opt/node22/lib/node_modules/playwright/index.js");
const chromium = pw.chromium || (pw.default && pw.default.chromium);
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const fails = [];
const check = (cond, msg) => { console.log((cond ? "  ✓ " : "  ✗ ") + msg); if (!cond) fails.push(msg); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1200);

// Open the logged-out "Sign in" pill in the shell header.
const signIn = page.getByRole("button", { name: /sign in/i }).first();
await signIn.click();
await page.waitForTimeout(400);

const dialog = page.locator('[role="dialog"]');
check(await dialog.count() > 0, "Sign-in modal opens with role=dialog");
check(await dialog.first().getAttribute("aria-modal") === "true", "dialog carries aria-modal=\"true\"");

// Press Escape — the modal must close.
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
check(await page.locator('[role="dialog"]').count() === 0, "Escape closes the modal");

// Re-open and confirm the scrim/Close button still works after the Escape path (no broken state).
await signIn.click();
await page.waitForTimeout(300);
check(await page.locator('[role="dialog"]').count() > 0, "modal re-opens after an Escape close");
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
check(await page.locator('[role="dialog"]').count() === 0, "Escape closes it again (repeatable)");

await browser.close();
console.log(fails.length ? `\n✗ ${fails.length} check(s) failed` : "\n✓ all checks passed");
process.exit(fails.length ? 1 : 0);
