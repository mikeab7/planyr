/* verify-api-auth-refresh-live — NEW-1 (B2671206): the Library's one-time folder organizer no longer shows
 * "Invalid or expired session (403)" when the access token it holds is dead. SIGNED IN as the test account on the
 * real deploy (read /version.json in the same run and compare it to --sha).
 *
 *   A  KNOWN-GOOD   a valid token: the organizer finishes, every /api/folders answer is 2xx, NO refresh was needed
 *                   (this arm must pass or the others are blind).
 *   B  SERVER REFUSES ONCE  a good sign-in; the first /api/folders call is answered 401 (injected on the wire — a garbage
 *                   token cannot stand in, supabase-js's own database calls reject it before /api/folders is reached).
 *                   The refresh (a REAL refresh_token request) and the retry (REAL server, new token) must follow, exactly
 *                   one refresh, and the banner must stay the running status.
 *   C  DEAD SIGN-IN  every /api/folders call is 401 and the refresh is refused: nothing may print a status code or a
 *                   project name; the person is told their sign-in expired; ONE call only (no loop).
 * Only the FIRST /api/folders exchange is observed (the test account holds ~100 leftover projects, so the full walk takes minutes);
 * the done-marker itself is pinned by test/apiAuthRefresh.test.js. The page is closed as soon as the exchange is seen.
 * Run: E2E_LOGIN_KEY=… node ui-audit/verify-api-auth-refresh-live.mjs [base] [--sha=<merge commit>]  */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.argv.slice(2).find((a) => a.startsWith("http")) || "https://planyr.io";
const SHA = (process.argv.find((a) => a.startsWith("--sha=")) || "").slice(6);
let failures = 0;
const brief = (rows) => JSON.stringify(rows.slice(0, 4)) + (rows.length > 4 ? ` …(+${rows.length - 4} more)` : "");
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); if (!cond) failures++; };

const s = await openSignedIn({ base: BASE });
const { page } = s;
try {
  await assertMeasurable(page, "verify-api-auth-refresh-live");
  const build = (await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()))).build;
  console.log(`served build: ${build}  account: ${s.proof.email}`);
  if (SHA) ok("the deploy serves the merge commit", String(build).startsWith(SHA.slice(0, 7)) || String(SHA).startsWith(String(build).slice(0, 7)), `${build} vs ${SHA}`);

  const net = [];
  const authUrls = [];
  page.on("request", (rq) => { if (/\/auth\/v1\//.test(rq.url())) authUrls.push(rq.method() + " " + rq.url().replace(/^https?:\/\/[^/]+/, "").slice(0, 70)); });
  page.on("response", (r) => {
    const u = r.url();
    if (/\/api\/folders/.test(u)) net.push({ kind: "folders", status: r.status(), auth: (r.request().headers().authorization || "").slice(-12) });
    else if (/\/auth\/v1\/token\?grant_type=refresh_token/.test(u)) net.push({ kind: "refresh", status: r.status() });
  });

  const uid = await page.evaluate(async () => (await window.pfSupabase.auth.getSession()).data.session.user.id);
  const markerKey = `planyr:treeMigrateV1:${uid}`;
  const sbKey = await page.evaluate(() => Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k)));
  if (!sbKey) throw new Error("no sb-*-auth-token key — cannot plant a token");
  // Plant tokens in storage and clear the done-marker, then open the Library fresh (a new page load reads storage).
  const plant = (patch) => page.evaluate(([k, mk, p]) => {
    const v = JSON.parse(localStorage.getItem(k));
    Object.assign(v, p);
    localStorage.setItem(k, JSON.stringify(v));
    localStorage.removeItem(mk);
  }, [sbKey, markerKey, patch]);
  // The test account holds ~100 leftover projects, so the organizer's full walk takes minutes. What this fix is about is
  // the FIRST /api/folders exchange, so wait for that (and the refresh/retry that follows it) and then stop looking.
  const settledWhen = async (pred, ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (pred()) return true; await page.waitForTimeout(500); }
    return pred();
  };
  const openLibrary = async (pred = () => net.some((n) => n.kind === "folders"), ms = 120000) => {
    net.length = 0;
    await page.goto(`${BASE}/?cb=${Date.now()}#/library`, { waitUntil: "load" });
    await settledWhen(pred, ms);
    await page.waitForTimeout(1500);
  };
  const banner = async () => page.evaluate(() => {
    const el = document.querySelector('[role="alert"], [role="status"]');
    const bar = [...document.querySelectorAll('[role="alert"],[role="status"]')].map((e) => e.innerText).join(" | ");
    return { text: bar, signIn: !!document.querySelector('[data-testid="library-organizer-signin"]'), body: document.body.innerText };
  });
  const marker = () => page.evaluate((mk) => localStorage.getItem(mk), markerKey);

  // ── A: known-good ──
  await plant({});
  await openLibrary();
  const aStat = net.filter((n) => n.kind === "folders");
  ok("A known-good: the organizer reached /api/folders and was answered 2xx", aStat.length > 0 && aStat[0].status < 300, brief(aStat));
  ok("A known-good: no refresh request was needed", net.filter((n) => n.kind === "refresh").length === 0);
  ok("A known-good: no error banner", !/expired|couldn.t finish|403/i.test((await banner()).text));

  // ── B: the server refuses the held token ONCE (as it did for the owner: valid for the database, refused by the
  // session check), the sign-in itself is good. The 401 is injected on the wire; the refresh and the retry are REAL. ──
  // (A garbage token cannot stand in: supabase-js's own database calls reject it before /api/folders is ever reached.)
  await page.unroute("**/api/folders").catch(() => {});
  let injected = 0;
  await page.route("**/api/folders", async (route) => {
    if (injected === 0) {
      injected++;
      // (the page's own "response" listener records this fulfilled answer — do not record it twice)
      return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ ok: false, error: "Invalid or expired session (403)." }) });
    }
    return route.continue();
  });
  await plant({});
  await openLibrary(() => net.filter((n) => n.kind === "folders").length >= 2);
  const bStat = net.filter((n) => n.kind === "folders");
  ok("B PRECONDITION: the first /api/folders call was refused with 401 (the owner's condition)", !!bStat[0] && bStat[0].status === 401 && injected === 1, brief(bStat));
  if (!net.some((n) => n.kind === "refresh")) console.log("   (auth requests seen: " + JSON.stringify(authUrls.slice(-8)) + ")");
  ok("B the session was refreshed (a REAL refresh_token request, 2xx)", net.some((n) => n.kind === "refresh" && n.status < 300), brief(net.filter((n) => n.kind === "refresh")));
  ok("B the retry was sent ONCE with a DIFFERENT token than the refused one", bStat.length >= 2 && bStat[1].auth !== bStat[0].auth, brief(bStat));
  ok("B the REAL server accepted the retried token (2xx)", !!bStat[1] && bStat[1].status < 300, brief(bStat));
  ok("B exactly one refresh (no loop)", net.filter((n) => n.kind === "refresh").length === 1, String(net.filter((n) => n.kind === "refresh").length));
  const b = await banner();
  ok("B the banner is the running status, not an error", !/expired|couldn.t finish|403|HTTP/i.test(b.text) && /Organizing/i.test(b.text), b.text);
  await page.unroute("**/api/folders").catch(() => {});

  // ── C: a genuinely dead sign-in — the server refuses every /api/folders call AND the sign-in refresh is refused ──
  await page.route("**/api/folders", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ ok: false, error: "Invalid or expired session (403)." }) }));
  await page.route(/\/auth\/v1\/token\?grant_type=refresh_token/, (route) => route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" }) }));
  await plant({ expires_at: Math.floor(Date.now() / 1000) + 3000 });
  await openLibrary(() => net.filter((n) => n.kind === "folders").length >= 1);
  await page.waitForTimeout(8000);
  const c = await banner();
  const said = /sign-in expired|signed out|sign in/i.test(c.body);
  ok("C the person is told it is their sign-in (banner / signed-out notice / sign-in panel)", said, c.text);
  ok("C nothing prints a status code, 'HTTP' or 'Invalid or expired session'", !/\(\d{3}\)|HTTP \d{3}|Invalid or expired session/i.test(c.body));
  ok("C only ONE /api/folders call was made before giving up (no retry loop)", net.filter((n) => n.kind === "folders").length === 1, brief(net.filter((n) => n.kind === "folders")));
  ok("C no done-marker was written over the failure", !(await marker()));
} catch (e) {
  console.error("ERROR", e.message);
  failures++;
} finally {
  await s.close();
}
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
