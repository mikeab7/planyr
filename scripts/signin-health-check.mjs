#!/usr/bin/env node
/* Outside-in sign-in health check (NEW-1, 2026-11-02) — run hourly by .github/workflows/signin-health.yml.
 *
 *   node scripts/signin-health-check.mjs [--base https://planyr.io] [--no-browser] [--no-report] [--retry-wait 240]
 *   node scripts/signin-health-check.mjs --drill              # the alarm DRILL (synthetic lane; sends [TEST] emails)
 *
 * What it does: runs the checks in scripts/lib/signinChecks.mjs from a clean machine; if the overall result is a FAIL it
 * waits `--retry-wait` seconds and runs them once more (so one network blip never alarms, and "twice in a row" is reached
 * in minutes, not hours); then POSTs what it saw to /api/ops/signin-health, authenticated by GitHub's OIDC token for this
 * workflow run (no stored secret). The ROUTE decides and emails. This script therefore exits 0 when sign-in is broken — a
 * red workflow nobody reads is not the alarm — and exits non-zero ONLY when the alarm channel itself failed:
 *   3  the route was unreachable / refused us / could not store (so nobody was told)
 *   4  the route decided to alert but the email did not go out (mail not configured, or Gmail refused)
 *   1  the drill's assertions failed
 * The workflow turns 3 and 4 into a GitHub issue that @-mentions the owner (a second channel that does not use Gmail).
 * Writes signin-health-result.json for the workflow's summary + fallback steps. */
import { writeFileSync, existsSync, appendFileSync } from "node:fs";
import {
  checkSiteKey, checkGate, checkEmailLink, extractSupabaseConfig, classifyPanel, classifySignIn, canReachTurnstile,
} from "./lib/signinChecks.mjs";
import { overallOf, CHECK_LABELS } from "../src/shared/auth/signinHealth.js";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d; };
const flag = (n) => process.argv.includes(n);
const BASE = (arg("--base", process.env.SIGNIN_BASE_URL || "https://planyr.io")).replace(/\/+$/, "");
const RETRY_WAIT_S = Number(arg("--retry-wait", "240"));
const ROUTE = `${BASE}/api/ops/signin-health`;
const OUT = arg("--out", "signin-health-result.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── Browser checks ───────────────────────────────────────────────────────────────────────────────────────────── */
async function browserChecks() {
  const { chromium } = await import("@playwright/test");
  const exe = existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium";
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const out = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    let tokenResponse = null, tokenSeen = false;
    page.on("response", async (r) => {
      try {
        if (!/\/auth\/v1\/token/.test(r.url())) return;
        const req = r.request();
        tokenSeen = /captcha_token/.test(req.postData() || "");
        let body = null; try { body = await r.json(); } catch (_) { /* not json */ }
        tokenResponse = { status: r.status(), errorCode: (body && (body.error_code || body.code)) || "" };
      } catch (_) { /* observation only */ }
    });
    const dlg = page.getByRole("dialog");

    // — panel-renders
    let opened = false;
    try { await page.goto(`${BASE}/?app&auth=signin`, { waitUntil: "domcontentloaded", timeout: 45000 }); await dlg.waitFor({ state: "visible", timeout: 30000 }); opened = true; } catch (_) { /* reported below */ }
    const vis = async (loc) => loc.first().isVisible().catch(() => false);
    const widgetAttr = async (a) => page.getByTestId("turnstile-widget").getAttribute(a).catch(() => null);
    if (opened) await sleep(7000); // let Cloudflare's script and widget settle
    const emailBox = dlg.getByLabel("Email"), pwBox = dlg.getByLabel("Password"), submit = page.getByTestId("auth-submit");
    // The button is disabled until both fields have content (the app's own e2e spec fills them first) — so "usable" is judged
    // AFTER typing a throwaway pair. Nothing is submitted.
    if (opened) { await emailBox.fill("signin-health-probe@invalid.example").catch(() => {}); await pwBox.fill("not-a-real-password-0").catch(() => {}); }
    const info = {
      opened, emailVisible: opened && await vis(emailBox), passwordVisible: opened && await vis(pwBox), submitVisible: opened && await vis(submit),
      submitEnabled: opened && await submit.isEnabled().catch(() => false),
      text: opened ? await dlg.innerText().catch(() => "") : "", widgetState: opened ? await widgetAttr("data-turnstile-state") : null, widgetError: opened ? await widgetAttr("data-turnstile-error") : null,
    };
    // Only worth asking when the script failed to load: is that this runner's network, or the site?
    const scriptReachable = info.widgetError === "script" ? await canReachTurnstile() : true;
    out.push(classifyPanel({ ...info, scriptReachable }));

    // — real-sign-in
    const email = process.env.E2E_EMAIL, pw = process.env.E2E_PASSWORD;
    if (!email || !pw) out.push({ name: "real-sign-in", status: "skipped", detail: "E2E_EMAIL / E2E_PASSWORD are not set for this job" });
    else if (!opened) out.push({ name: "real-sign-in", status: "unknown", detail: "the form did not open, so the sign-in was not attempted" });
    else {
      await emailBox.fill(email); await pwBox.fill(pw);
      tokenResponse = null; tokenSeen = false;
      await submit.click().catch(() => {});
      let signedIn = false;
      const deadline = Date.now() + 45000;
      while (Date.now() < deadline) {
        const hidden = !(await dlg.isVisible().catch(() => false));
        if (hidden) { signedIn = (await page.evaluate(async () => (await window.pfSupabase?.auth.getUser())?.data?.user?.email).catch(() => null)) === email; break; }
        if (tokenResponse && tokenResponse.status >= 400) break;
        await sleep(500);
      }
      out.push(classifySignIn({
        signedIn, tokenSeen, tokenResponse, widgetState: await widgetAttr("data-turnstile-state"), widgetError: await widgetAttr("data-turnstile-error"),
        text: await dlg.innerText().catch(() => ""), scriptReachable,
      }));
      // Tidy: end only THIS browser's session (never scope "global", which would sign out the test account everywhere).
      if (signedIn) await page.evaluate(() => window.pfSupabase.auth.signOut({ scope: "local" })).catch(() => {});
    }
  } finally { await browser.close().catch(() => {}); }
  return out;
}

/* ── One full pass ────────────────────────────────────────────────────────────────────────────────────────────── */
export async function runOnce({ withBrowser = true } = {}) {
  const sk = await checkSiteKey({ base: BASE });
  const cfg = extractSupabaseConfig(sk.texts, process.env);
  const checks = [sk.check, await checkGate({ supabaseUrl: cfg.url, anonKey: cfg.anon, siteKey: sk.siteKey })];
  if (withBrowser) {
    try { checks.push(...await browserChecks()); }
    catch (e) { checks.push({ name: "panel-renders", status: "unknown", detail: `the browser could not run: ${(e && e.message) || e}`.slice(0, 200) }); }
  }
  checks.push(await checkEmailLink({ base: BASE }));
  return { checks, overall: overallOf(checks) };
}

/* ── Talking to the alarm route ───────────────────────────────────────────────────────────────────────────────── */
async function oidcToken() {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL, tok = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !tok) return null;
  const r = await fetch(`${url}&audience=${encodeURIComponent("https://planyr.io")}`, { headers: { authorization: `bearer ${tok}` } });
  if (!r.ok) throw new Error(`GitHub would not issue an OIDC token (${r.status}) — the job needs permissions: id-token: write`);
  return (await r.json()).value;
}
async function post(payload) {
  let token;
  try { token = await oidcToken(); } catch (e) { return { ok: false, status: 0, error: e.message }; }
  if (!token) return { ok: false, status: 0, error: "no OIDC token in this environment (run it from the workflow)" };
  try {
    const res = await fetch(ROUTE, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(payload), signal: AbortSignal.timeout(60000) });
    let body = null; try { body = await res.json(); } catch (_) { /* not json */ }
    return { ok: res.ok && body && body.ok, status: res.status, body, error: res.ok ? null : (body && body.error) || `HTTP ${res.status}` };
  } catch (e) { return { ok: false, status: 0, error: (e && e.message) || String(e) }; }
}

const runUrl = () => (process.env.GITHUB_SERVER_URL && process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null);
const table = (checks) => checks.map((c) => `  ${c.status.toUpperCase().padEnd(8)} ${(CHECK_LABELS[c.name] || c.name).padEnd(62)} ${c.detail}`).join("\n");
function summary(md) { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n"); }

/* Map the route's answer to the channel verdict the workflow acts on. */
export function channelVerdict(resp) {
  // Setup not finished (the SQL has not been run): say so loudly, but do not go red every hour for it.
  if (!resp.ok && resp.status === 503 && resp.body && resp.body.reason === "not_migrated") return { status: "not-armed", code: 0, detail: resp.body.error };
  if (!resp.ok) return { status: "unreachable", code: 3, detail: `the alarm route refused or failed: ${resp.error} (HTTP ${resp.status})` };
  const d = resp.body.delivery;
  if (d === "failed" || d === "not-configured") return { status: d === "failed" ? "mail-failed" : "not-configured", code: 4, detail: `an alert was due but the email did not go out (${d}): ${(resp.body.mail && resp.body.mail.error) || ""}`.trim() };
  return { status: "ok", code: 0, detail: `delivery: ${d}` };
}

/* The drill's exit code for a channel verdict. "Not armed" (the SQL has not been run) gets its OWN code, 5: a manual drill that
 * could not run must still end RED so the person who ran it sees that, but it is a SETUP state, not a broken alarm channel — the
 * workflow raises no "alarm channel is not delivering" issue for it (found live 2026-11-02: the first drill opened one). */
export const DRILL_NOT_ARMED = 5;
export const drillExitCode = (v) => (v && v.status === "not-armed" ? DRILL_NOT_ARMED : (v && v.code) || 1);

/* ── The alarm drill: proves, live, "one incident sends ONE email, and a recovery note when it clears" ───────────── */
async function drill() {
  const step = (name, status) => ({ checks: [{ name, status, detail: "alarm drill (synthetic)" }] });
  const send = (attempts) => post({ synthetic: true, attempts, runUrl: runUrl() });
  const log = [];
  const expect = (label, got, want) => { const ok = want.includes(got); log.push({ label, got, want, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${label}: delivery=${got} (expected ${want.join(" or ")})`); return ok; };
  let bad = false;
  const reset = await send([step("server-gate", "pass")]);              // start from a clean synthetic lane
  if (!reset.ok) { const v = channelVerdict(reset); console.log("drill cannot reach the route:", v.detail); writeFileSync(OUT, JSON.stringify({ drill: true, channel: v, log }, null, 1)); return drillExitCode(v); }
  console.log("0 reset →", reset.body.delivery);
  const a = await send([step("server-gate", "fail"), step("server-gate", "fail")]);   // two failures in a row → ONE alert
  if (!a.ok) { const v = channelVerdict(a); console.log(v.detail); writeFileSync(OUT, JSON.stringify({ drill: true, channel: v, log }, null, 1)); return v.code; }
  if (a.body.delivery === "not-configured" || a.body.delivery === "failed") { const v = channelVerdict(a); console.log("ALERT NOT DELIVERED:", v.detail, "\n", JSON.stringify(a.body.mail)); writeFileSync(OUT, JSON.stringify({ drill: true, channel: v, log, mail: a.body.mail }, null, 1)); return v.code; }
  bad = !expect("1 two failures in a row → one alert email", a.body.delivery, ["sent"]) || bad;
  const b = await send([step("server-gate", "fail")]);                  // same incident, still failing → NO second email
  bad = !expect("2 still failing, same incident → no second email", b.body && b.body.delivery, ["not-needed"]) || bad;
  const c = await send([step("server-gate", "fail"), step("server-gate", "fail")]);
  bad = !expect("3 failing again → still no second email", c.body && c.body.delivery, ["not-needed"]) || bad;
  const d = await send([step("server-gate", "pass")]);                  // fresh pass → ONE recovery note
  bad = !expect("4 a passing check → one recovery note", d.body && d.body.delivery, ["recovery-sent"]) || bad;
  const e = await send([step("server-gate", "pass")]);
  bad = !expect("5 still passing → nothing more", e.body && e.body.delivery, ["not-needed"]) || bad;
  const ids = [a, d].map((r) => r.body && r.body.mail && r.body.mail.messageId).filter(Boolean);
  console.log("Gmail message ids:", ids.join(", ") || "(none)");
  summary(`### Sign-in alarm drill\n${log.map((l) => `- ${l.ok ? "✅" : "❌"} ${l.label} → \`${l.got}\``).join("\n")}\n\nGmail message ids: ${ids.join(", ") || "none"}`);
  writeFileSync(OUT, JSON.stringify({ drill: true, ok: !bad, log, messageIds: ids, channel: { status: "ok", code: 0 } }, null, 1));
  return bad ? 1 : 0;
}

/* ── main ─────────────────────────────────────────────────────────────────────────────────────────────────────── */
async function main() {
  if (flag("--drill")) return drill();
  const withBrowser = !flag("--no-browser");
  const attempts = [];
  let first = await runOnce({ withBrowser });
  attempts.push(first);
  console.log("attempt 1:", first.overall.toUpperCase(), "\n" + table(first.checks));
  if (first.overall === "fail" && !flag("--no-retry")) {
    console.log(`failed — checking again in ${RETRY_WAIT_S}s so a one-off blip is not an alarm…`);
    await sleep(RETRY_WAIT_S * 1000);
    const second = await runOnce({ withBrowser });
    attempts.push(second);
    console.log("attempt 2:", second.overall.toUpperCase(), "\n" + table(second.checks));
  }
  const last = attempts[attempts.length - 1];
  let channel = { status: "not-reported", code: 0, detail: "--no-report" };
  let resp = null;
  if (!flag("--no-report")) {
    resp = await post({ attempts: attempts.map((a) => ({ checks: a.checks })), runUrl: runUrl() });
    channel = channelVerdict(resp);
    console.log("alarm route:", channel.status, "-", channel.detail, resp.body ? JSON.stringify({ decision: resp.body.decision, failStreak: resp.body.failStreak }) : "");
  }
  if (channel.status === "not-armed") console.log(`::warning title=Sign-in alarm NOT ARMED::${channel.detail} Until then nothing is stored and nobody is emailed; the Ops page shows the check as never run.`);
  if (last.overall !== "pass") console.log(`::warning title=Sign-in check ${last.overall}::${last.checks.filter((c) => c.status === "fail" || c.status === "unknown").map((c) => `${c.name}: ${c.detail}`).join(" | ")}`);
  summary(`### Sign-in check: ${last.overall.toUpperCase()}\n| Check | Result | Detail |\n|---|---|---|\n${last.checks.map((c) => `| ${CHECK_LABELS[c.name] || c.name} | ${c.status} | ${c.detail} |`).join("\n")}\n\nAlarm channel: **${channel.status}** ${channel.detail || ""}`);
  writeFileSync(OUT, JSON.stringify({ overall: last.overall, checks: last.checks, attempts: attempts.length, channel, delivery: resp && resp.body && resp.body.delivery }, null, 1));
  return channel.code;
}

if (import.meta.url === `file://${process.argv[1]}`) main().then((c) => { process.exitCode = c; }, (e) => { console.error("signin-health-check crashed:", e); writeFileSync(OUT, JSON.stringify({ channel: { status: "crashed", code: 3, detail: String((e && e.message) || e) } })); process.exitCode = 3; });
