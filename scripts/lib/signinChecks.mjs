/* The outside-in sign-in checks — pure classifiers + the network probes (network injected) (NEW-1, 2026-11-02).
 *
 * Run hourly from a clean GitHub runner by scripts/signin-health-check.mjs. The point of "outside-in" is that it needs
 * NO client to report anything: a TOTAL break (the B2619760 outage) may send no events at all, because nobody can get far
 * enough to send one. Each check returns { name, status: pass|fail|unknown|skipped, detail }. `unknown` is "this
 * runner could not tell" — NEVER a pass (see src/shared/auth/signinHealth.js).
 *
 *   site-key-in-bundle  the live JS carries a Cloudflare Turnstile SITE key (and not a Cloudflare TEST key)
 *   server-gate         Supabase's token endpoint, asked with NO token, answers captcha_failed — and that AGREES with
 *                       the site key: both on (healthy) · key but no gate · gate but no key (= B2619760) · neither
 *   panel-renders       (browser) the sign-in form opens, its fields + button are usable, no raw error text, and the
 *                       bot-check widget did not report a configuration error
 *   real-sign-in        (browser) a real sign-in as the test account through the panel
 *   email-link          POST /api/auth/email-link answers (without sending mail) — skipped until that route exists */

/* Cloudflare Turnstile site keys start 0x4 + a letter (e.g. 0x4AAAAAAA…); the always-passes TEST keys are 1x/2x/3x + zeros. */
export const SITE_KEY_RE = /0x4[A-Z][A-Za-z0-9_-]{16,40}/;
export const TEST_KEY_RE = /\b[123]x0{10,}[A-Za-z0-9_-]*/;

/** → { found: "0x4…"|null, testKey: bool } over one script's text. */
export function scanForSiteKey(text) {
  const t = String(text || "");
  const m = SITE_KEY_RE.exec(t);
  return { found: m ? m[0] : null, testKey: TEST_KEY_RE.test(t) && /turnstile|cloudflare|sitekey/i.test(t) && !m };
}

/** Supabase url + publishable key as the bundle ships them (env wins when given). */
export function extractSupabaseConfig(texts, env = {}) {
  let url = env.VITE_SUPABASE_URL || null, anon = env.VITE_SUPABASE_ANON_KEY || null;
  for (const t of texts) {
    if (!url) { const m = /https:\/\/[a-z0-9]{20}\.supabase\.co/.exec(t); if (m) url = m[0]; }
    if (!anon) {
      const m = /sb_publishable_[A-Za-z0-9_-]{20,}/.exec(t);
      if (m) anon = m[0];
      else {
        for (const j of t.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g) || []) {
          try { if (JSON.parse(Buffer.from(j.split(".")[1], "base64url").toString()).role === "anon") { anon = j; break; } } catch (_) { /* not a JWT */ }
        }
      }
    }
    if (url && anon) break;
  }
  return { url, anon };
}

const timeoutSignal = (ms) => (typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);

/** Fetch the entry page and the scripts it names, then follow chunk references (bounded) until the site key turns up. */
export async function fetchBundleTexts(base, fetchImpl = fetch, { maxFiles = 40, stopWhen } = {}) {
  const origin = base.replace(/\/+$/, "");
  const get = async (p) => { const r = await fetchImpl(origin + p, { signal: timeoutSignal(20000), headers: { "user-agent": "planyr-signin-health/1" } }); if (!r.ok) throw new Error(`${p} answered ${r.status}`); return r.text(); };
  const html = await get("/");
  const entry = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]);
  if (!entry.length) throw new Error("the home page names no scripts");
  const seen = new Map();
  const queue = [...new Set(entry)];
  while (queue.length && seen.size < maxFiles) {
    const p = queue.shift();
    if (seen.has(p)) continue;
    let t;
    try { t = await get(p); } catch (_) { seen.set(p, null); continue; }
    seen.set(p, t);
    if (stopWhen && stopWhen([...seen.values()].filter(Boolean))) break;
    for (const m of t.matchAll(/["'`]\.?\/?((?:assets\/)?[A-Za-z0-9_.-]+\.js)["'`]/g)) {
      const q = m[1].startsWith("assets/") ? "/" + m[1] : "/assets/" + m[1];
      if (!seen.has(q) && !queue.includes(q)) queue.push(q);
    }
  }
  return [...seen.values()].filter(Boolean);
}

export async function checkSiteKey({ base, fetchImpl = fetch }) {
  const name = "site-key-in-bundle";
  try {
    let hit = null, test = false;
    const texts = await fetchBundleTexts(base, fetchImpl, { stopWhen: (ts) => ts.some((t) => scanForSiteKey(t).found) });
    for (const t of texts) { const s = scanForSiteKey(t); if (s.found) { hit = s.found; break; } if (s.testKey) test = true; }
    if (hit) return { check: { name, status: "pass", detail: `site key ${hit.slice(0, 10)}… is in the live bundle` }, siteKey: hit, texts };
    if (test) return { check: { name, status: "fail", detail: "the live bundle carries a Cloudflare TEST key (always passes) instead of the real site key" }, siteKey: null, texts };
    return { check: { name, status: "fail", detail: "no Turnstile site key in the live bundle (the sign-in form sends no bot-check token)" }, siteKey: null, texts };
  } catch (e) {
    return { check: { name, status: "fail", detail: `could not read the live site: ${(e && e.message) || e}`.slice(0, 200) }, siteKey: null, texts: [] };
  }
}

/** Interpret the token endpoint's answer to a request with NO captcha token. Pure. */
export function classifyGateAnswer({ status, body }) {
  const code = String((body && (body.error_code || body.code)) || "").toLowerCase();
  const msg = String((body && (body.msg || body.message || body.error_description || "")) || "");
  if (status === 400 && (code === "captcha_failed" || /captcha/i.test(msg))) return "on";
  if (status === 400 && (code === "invalid_credentials" || /invalid login credentials/i.test(msg))) return "off";
  if (status === 429) return "limited";
  return "error";
}

export function combineGate({ gate, siteKey, status }) {
  const name = "server-gate";
  if (gate === "limited") return { name, status: "unknown", detail: "Supabase rate-limited the probe (429); could not read its bot-check setting" };
  if (gate === "error") return { name, status: "fail", detail: `Supabase's token endpoint answered ${status} instead of a bot-check refusal — an outage or a changed setting` };
  const key = !!siteKey;
  if (gate === "on" && key) return { name, status: "pass", detail: "Supabase demands the bot-check token and the site sends one" };
  if (gate === "on" && !key) return { name, status: "fail", detail: "Supabase demands a bot-check token but the live site has no site key — nobody can sign in (the 2026-10 outage)" };
  if (gate === "off" && key) return { name, status: "fail", detail: "the site shows the bot check but Supabase's captcha protection is OFF — a settings change" };
  return { name, status: "fail", detail: "Supabase's captcha protection is OFF and the site has no site key — sign-in and sign-up are unprotected" };
}

export async function checkGate({ supabaseUrl, anonKey, siteKey, fetchImpl = fetch }) {
  const name = "server-gate";
  if (!supabaseUrl || !anonKey) return { name, status: "unknown", detail: "could not find the Supabase address/key to probe" };
  try {
    const res = await fetchImpl(`${supabaseUrl.replace(/\/+$/, "")}/auth/v1/token?grant_type=password`, {
      method: "POST", signal: timeoutSignal(20000),
      headers: { apikey: anonKey, "content-type": "application/json" },
      body: JSON.stringify({ email: "signin-health-probe@invalid.example", password: "not-a-real-password-0" }),
    });
    let body = null; try { body = await res.json(); } catch (_) { /* not json */ }
    return combineGate({ gate: classifyGateAnswer({ status: res.status, body }), siteKey, status: res.status });
  } catch (e) {
    return { name, status: "fail", detail: `Supabase did not answer: ${(e && e.message) || e}`.slice(0, 200) };
  }
}

/** /api/auth/email-link: skipped while the route does not exist; fail on 5xx / no answer; otherwise it answers. */
export async function checkEmailLink({ base, fetchImpl = fetch }) {
  const name = "email-link";
  try {
    const res = await fetchImpl(base.replace(/\/+$/, "") + "/api/auth/email-link", {
      method: "POST", signal: timeoutSignal(20000), headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "" }),
    });
    const ct = String(res.headers.get("content-type") || "");
    // Measured 2026-11-02: a POST to a path with no Function behind it is answered by the static-asset handler with a bare
    // 405 (or 404 / the home page) and NO JSON. A real route answers JSON, so "JSON content-type" is the existence test.
    const isJson = /application\/json/i.test(ct);
    if (!isJson && res.status < 500) return { name, status: "skipped", detail: `the route does not exist yet (answered ${res.status}, no JSON)` };
    if (res.status >= 500) return { name, status: "fail", detail: `the route answered ${res.status}` };
    return { name, status: "pass", detail: `the route answers (${res.status}, JSON) without sending mail` };
  } catch (e) {
    return { name, status: "fail", detail: `the route did not answer: ${(e && e.message) || e}`.slice(0, 200) };
  }
}

/* ── Browser-observed classification (the browser itself lives in scripts/signin-health-check.mjs) ───────────────── */
/* Cloudflare error codes that mean OUR configuration is wrong (a real user would hit them too):
 * 110100 / 110110 invalid or missing sitekey · 110200 domain not allowed for this key · 400020 invalid sitekey. */
export const CONFIG_ERROR_CODES = new Set(["110100", "110110", "110200", "400020", "400070"]);
export const RAW_ERROR_RE = /captcha protection|request disallowed|captcha_token|\[object|undefined|TypeError|Unexpected token|NaN/i;

/** Can THIS machine fetch Cloudflare's bot-check script at all? Separates "the runner's network" from "the site's script". */
export async function canReachTurnstile(fetchImpl = fetch) {
  try {
    const r = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", { signal: timeoutSignal(15000) });
    return r.ok;
  } catch (_) { return false; }
}

/** `scriptReachable` only changes the WORDS, never the verdict. A script that did not load is a FAIL either way: GitHub-hosted
 * runners have open egress and the site + Supabase were just reached, so if challenges.cloudflare.com is unreachable from here a
 * Cloudflare outage or block is stopping EVERY visitor signing in (an outage that was "unknown" would be the one no alarm ever
 * saw). One network blip is absorbed by the in-run re-check ~4 minutes later. */
export function classifyPanel({ opened, emailVisible, passwordVisible, submitVisible, submitEnabled, text, widgetState, widgetError, scriptReachable = true }) {
  const name = "panel-renders";
  if (!opened) return { name, status: "fail", detail: "the sign-in form did not open" };
  if (!emailVisible || !passwordVisible || !submitVisible) return { name, status: "fail", detail: "the sign-in form is missing its email, password or button" };
  if (!submitEnabled) return { name, status: "fail", detail: "the sign-in button is disabled" };
  if (RAW_ERROR_RE.test(text || "")) return { name, status: "fail", detail: `raw error text on the form: ${String(text).slice(-100).replace(/\s+/g, " ")}` };
  if (widgetState === "error") {
    if (widgetError === "script") {
      return scriptReachable === false
        ? { name, status: "fail", detail: "the bot-check script did not load: Cloudflare's bot-check host (challenges.cloudflare.com) is unreachable from the runner while planyr.io and Supabase answer — an outage or block there stops everyone signing in" }
        : { name, status: "fail", detail: "the Cloudflare bot-check script did not load on the sign-in form (the runner can reach it, so a visitor's browser should too)" };
    }
    if (CONFIG_ERROR_CODES.has(String(widgetError))) return { name, status: "fail", detail: `Cloudflare rejected our bot-check configuration (error ${widgetError}) — the key or allowed-domain list is wrong` };
    return { name, status: "unknown", detail: `the bot-check widget reported error ${widgetError || "?"}; a datacenter browser may be refused, so this is not read as a break` };
  }
  return { name, status: "pass", detail: "the form opens with its fields and button, no raw error" };
}

/**
 * The real sign-in. tokenSeen = the widget produced a token the app sent; tokenResponse = { status, errorCode } of the
 * /auth/v1/token call the panel made (null if none was made).
 */
export function classifySignIn({ signedIn, tokenSeen, tokenResponse, widgetState, widgetError, text, scriptReachable = true }) {
  const name = "real-sign-in";
  if (signedIn) return { name, status: "pass", detail: "signed in as the test account through the real form" };
  const r = tokenResponse;
  if (r && (r.status >= 500 || r.status === 0)) return { name, status: "fail", detail: `Supabase answered ${r.status} to the sign-in` };
  if (r && String(r.errorCode).toLowerCase() === "captcha_failed") {
    return tokenSeen
      ? { name, status: "fail", detail: "Supabase refused the bot-check token the real widget produced — its Cloudflare secret or settings are wrong" }
      : { name, status: "fail", detail: "Supabase refused the sign-in for a missing bot-check token" };
  }
  if (widgetState === "error" && CONFIG_ERROR_CODES.has(String(widgetError))) return { name, status: "fail", detail: `Cloudflare rejected our bot-check configuration (error ${widgetError})` };
  if (widgetState === "error" && widgetError === "script") return { name, status: "fail", detail: scriptReachable === false ? "the bot-check script did not load and Cloudflare's bot-check host is unreachable from the runner" : "the Cloudflare bot-check script did not load" };
  if (r && String(r.errorCode).toLowerCase() === "invalid_credentials") return { name, status: "unknown", detail: "the bot check passed but the test account's password was rejected — the check's own credentials need refreshing" };
  // No sign-in request was made: the bot check never produced a token for this browser (Cloudflare put up a challenge a datacenter
  // browser cannot finish). That is a standing COVERAGE GAP, not an outage and not "the check is blind" — flagged `uncovered` so it is
  // left out of the overall verdict (it never feeds the blind email) and reported in the daily sweep instead. Never a pass.
  if (!r) return { name, status: "unknown", uncovered: true, detail: `no sign-in request was made (widget: ${widgetState || "?"}${widgetError ? " " + widgetError : ""}); Cloudflare withholds the bot check from GitHub's datacenter browser — real sign-in is NOT covered from this runner (not a pass, not a break)` };
  return { name, status: "unknown", detail: `sign-in did not complete (HTTP ${r.status} ${r.errorCode || ""})`.trim() };
}
