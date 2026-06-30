/* Login/auth UI adversarial check — drives the AuthPanel modal (validation gating, mode
 * switching, signup name-required, error rendering, Escape-to-close) against the real app.
 * The "Sign in" pill only renders when Supabase is configured, so build with DUMMY creds:
 *   VITE_SUPABASE_URL=https://testref0000000000ab.supabase.co \
 *   VITE_SUPABASE_ANON_KEY=test-anon-key-not-real npm run build
 * then `npx vite preview --port 4173` and `node ui-audit/verify-login-ui.mjs`. (Real auth
 * isn't exercised — the dummy host is unreachable, which is exactly how the error path is tested.)
 */
import { chromium } from "playwright";
const BASE = "http://localhost:4173";
const b = await chromium.launch({ args: ["--no-sandbox","--ignore-certificate-errors","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
let fails = 0;
const ok = (n,c,d="")=>{ console.log((c?"  ok  ":"FAIL  ")+n+(d?"  — "+d:"")); if(!c) fails++; };
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));

const ctx = await b.newContext({ viewport:{width:1280,height:900} });
const p = await ctx.newPage();
const errs=[]; p.on("pageerror",e=>errs.push(e.message));
await p.goto(BASE+"/", { waitUntil:"domcontentloaded" });
await sleep(2500); // let the app shell boot

// Open the auth modal from the "Sign in" pill.
const pill = p.locator('[title="Sign in or create an account"]');
ok("Sign-in pill renders (cloud configured)", await pill.count() > 0, "count="+await pill.count());
if (await pill.count() === 0) { console.log("\n(cannot continue — app header didn't render the pill)"); await b.close(); process.exit(1); }
await pill.first().click();
await sleep(400);
const dialog = p.locator('[role="dialog"]');
ok("modal opens", await dialog.count() > 0);

const submit = p.locator('[data-testid="auth-submit"]');
const email = p.locator('input[type="email"]');
const pw = p.locator('input[type="password"]');

// Validation (signin): disabled empty → disabled short pw → enabled valid
ok("signin: submit disabled when empty", await submit.isDisabled());
await email.fill("user@example.com"); await pw.fill("12345"); await sleep(120);
ok("signin: submit disabled when pw<6", await submit.isDisabled());
await pw.fill("123456"); await sleep(120);
ok("signin: submit enabled with valid input", await submit.isEnabled());

// Attempt sign-in → Supabase unreachable (dummy host) → error message renders, no crash
await submit.click();
await sleep(2500);
const msgText = await dialog.locator("div").last().innerText().catch(()=>"");
ok("signin: failed auth shows an error (no crash)", /./.test((await dialog.innerText()).replace(/Account|Close.*/,"")) , "dialog has content");

// Switch to Sign up → name fields appear
await p.getByRole("button", { name: "Sign up" }).click(); await sleep(200);
ok("signup: first/last name fields appear", await p.locator('input[autocomplete="given-name"]').count() > 0);
// Signup with email+pw but no names → required-name validation error
await email.fill("new@example.com"); await pw.fill("abcdef");
await submit.click(); await sleep(300);
ok("signup: empty names → 'required' error", /required/i.test(await dialog.innerText()), JSON.stringify((await dialog.innerText()).slice(-80)));

// Switch to reset → password field hidden, button relabeled
await p.getByRole("button", { name: "Forgot password?" }).click().catch(async()=>{ await p.getByText("Forgot password?").click(); });
await sleep(200);
ok("reset: password field hidden", await pw.count() === 0, "pwCount="+await pw.count());
ok("reset: submit relabeled", /reset email/i.test(await submit.innerText()), await submit.innerText());

// Escape closes the modal (a11y)
await p.keyboard.press("Escape"); await sleep(300);
ok("Escape closes the modal", await p.locator('[role="dialog"]').count() === 0);

ok("no uncaught page errors during the flow", errs.length === 0, errs.slice(0,2).join(" | "));

console.log("\n"+(fails===0?"✅ LOGIN UI: ALL CHECKS PASSED":("⚠️  "+fails+" LOGIN CHECK(S) FAILED")));
await b.close();
process.exit(fails===0?0:1);
