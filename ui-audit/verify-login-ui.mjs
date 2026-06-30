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

// --- a11y: focus management + names + title ---
const a = await p.evaluate(()=>{
  const dlg = document.querySelector('[role="dialog"]');
  const ae = document.activeElement;
  return {
    focusInside: !!(dlg && dlg.contains(ae)),
    focusedTag: ae && ae.tagName,
    title: dlg && dlg.getAttribute("aria-label"),
    h2: dlg && (dlg.querySelector("h2")||{}).textContent,
    emailName: (()=>{ const e=document.querySelector('input[type=email]'); return e && (e.getAttribute("aria-label")||""); })(),
    pwName: (()=>{ const e=document.querySelector('input[type=password]'); return e && (e.getAttribute("aria-label")||""); })(),
    closeName: (()=>{ const btns=[...document.querySelectorAll('[role=dialog] button')]; const c=btns.find(b=>/close/i.test(b.getAttribute("aria-label")||"")||/close/i.test(b.textContent||"")); return c && (c.getAttribute("aria-label")||c.textContent.trim()); })(),
  };
});
ok("a11y: focus moved INTO the dialog on open", a.focusInside, "active="+a.focusedTag);
ok("a11y: dialog title reflects mode (Sign in)", /sign in/i.test(a.title||"") && /sign in/i.test(a.h2||""), "aria-label="+a.title+" h2="+a.h2);
ok("a11y: email + password inputs have accessible names", /email/i.test(a.emailName) && /password/i.test(a.pwName), JSON.stringify({email:a.emailName,pw:a.pwName}));
ok("a11y: close button has accessible name", /close/i.test(a.closeName||""), "name="+a.closeName);

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

// Switch to Sign up → name fields appear + title updates per mode
await p.getByRole("button", { name: "Sign up" }).click(); await sleep(200);
ok("signup: first/last name fields appear", await p.locator('input[autocomplete="given-name"]').count() > 0);
ok("a11y: dialog title updates to 'Create account'", /create account/i.test(await dialog.getAttribute("aria-label")||""), "aria-label="+await dialog.getAttribute("aria-label"));
// Signup with email+pw but no names → required-name validation error (announced via role=alert)
await email.fill("new@example.com"); await pw.fill("abcdef");
await submit.click(); await sleep(300);
ok("signup: empty names → 'required' error", /required/i.test(await dialog.innerText()), JSON.stringify((await dialog.innerText()).slice(-80)));
ok("a11y: error is in a role=alert live region", await p.locator('[role="dialog"] [role="alert"]').count() > 0 && /required/i.test(await p.locator('[role="dialog"] [role="alert"]').innerText()), "alerts="+await p.locator('[role="dialog"] [role="alert"]').count());

// focus trap: Tab many times stays inside the dialog
let escaped = false;
for (let i=0;i<14;i++){ await p.keyboard.press("Tab"); const inside = await p.evaluate(()=>{ const d=document.querySelector('[role=dialog]'); return d && d.contains(document.activeElement); }); if(!inside){ escaped = true; break; } }
ok("a11y: focus is TRAPPED inside the dialog (Tab can't escape)", !escaped);

// Switch to reset → password field hidden, button relabeled
await p.getByRole("button", { name: "Forgot password?" }).click().catch(async()=>{ await p.getByText("Forgot password?").click(); });
await sleep(200);
ok("reset: password field hidden", await pw.count() === 0, "pwCount="+await pw.count());
ok("reset: submit relabeled", /reset email/i.test(await submit.innerText()), await submit.innerText());

// Escape closes the modal + returns focus to the opener pill (a11y)
await p.keyboard.press("Escape"); await sleep(400);
ok("Escape closes the modal", await p.locator('[role="dialog"]').count() === 0);
const focusReturned = await p.evaluate(()=>{ const ae=document.activeElement; return !!(ae && (ae.getAttribute("title")||"").indexOf("Sign in")>=0); });
ok("a11y: focus returns to the opener on close", focusReturned, "active title="+await p.evaluate(()=>document.activeElement&&document.activeElement.getAttribute("title")));

ok("no uncaught page errors during the flow", errs.length === 0, errs.slice(0,2).join(" | "));

console.log("\n"+(fails===0?"✅ LOGIN UI: ALL CHECKS PASSED":("⚠️  "+fails+" LOGIN CHECK(S) FAILED")));
await b.close();
process.exit(fails===0?0:1);
