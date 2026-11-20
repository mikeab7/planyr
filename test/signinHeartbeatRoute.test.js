/* NEW-1 (2026-11-04, B2650848) — the FAST sign-in check route, whole flow, with a fake live site, a fake Supabase, an in-memory
 * store and a fake mail sender. Headline properties: it takes no secret and nothing from the caller; it refuses to run twice in a
 * few minutes; a failure is re-checked once and then alarms ONCE; the report is stored as the "edge" source. */
import { describe, it, expect, vi } from "vitest";
import { handleSigninHeartbeat, runEdgeChecks, EDGE_RETRY_WAIT_MS } from "../functions/api/lib/signinHeartbeatRoute.js";
import { THRESHOLDS } from "../src/shared/auth/signinHealth.js";

const KEY = "0x4AAAAAAAFFjERHSPvI4t-dJ";
const SB = "https://abcdefghijklmnopqrst.supabase.co";
const ANON = "sb_publishable_ABCDEFGHIJKLMNOPQRSTUV";
const ENV = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "SVC", GMAIL_SERVICE_ACCOUNT_JSON: "{}", INVITE_SENDER: "mike@planyr.io" };

/** A fake planyr.io + Supabase. `world` flips what is "live": keyInBundle, gate ("on"|"off"|500), emailRoute. */
function world(w = {}) {
  const live = { keyInBundle: true, gate: "on", emailRoute: "json", ...w };
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url); calls.push(u.origin + u.pathname);
    if (u.origin === "https://planyr.io" && u.pathname === "/") return new Response('<script type="module" src="/assets/index-A.js"></script>', { headers: { "content-type": "text/html" } });
    if (u.pathname === "/assets/index-A.js") return new Response(`const u="${SB}",k="${ANON}"${live.keyInBundle ? `,t="${KEY}"` : ""}`, { headers: { "content-type": "application/javascript" } });
    if (u.pathname === "/auth/v1/token") {
      if (live.gate === 500) return new Response("boom", { status: 500 });
      return live.gate === "on" ? new Response(JSON.stringify({ error_code: "captcha_failed", msg: "captcha verification process failed" }), { status: 400 }) : new Response(JSON.stringify({ error_code: "invalid_credentials", msg: "Invalid login credentials" }), { status: 400 });
    }
    if (u.pathname === "/api/auth/email-link") return live.emailRoute === "json" ? new Response("{}", { status: 400, headers: { "content-type": "application/json" } }) : new Response("", { status: 503, headers: { "content-type": "application/json" } });
    return new Response("nope", { status: 404 });
  };
  return { live, fetchImpl, calls };
}

function memStore() {
  const s = { checks: [], incidents: [], snaps: {}, stops: {} };
  return Object.assign(s, {
    async insertChecks(rows) { rows.forEach((r) => s.checks.push({ ...r, id: s.checks.length + 1 })); },
    async recentChecks({ synthetic, limit, source }) { return s.checks.filter((c) => !!c.synthetic === !!synthetic && (!source || c.source === source)).sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id).slice(0, limit); },
    async lastCheckAt({ synthetic, source }) { const r = await s.recentChecks({ synthetic, limit: 1, source }); return r[0] ? r[0].at : null; },
    async stopStates() { return JSON.parse(JSON.stringify(s.stops)); },
    async setStop(source, patch) { s.stops[source] = { ...(s.stops[source] || { source }), ...patch }; },
    async openIncident({ synthetic }) { return s.incidents.find((i) => !i.closed_at && !!i.synthetic === !!synthetic) || null; },
    async lastAlertAt() { const t = s.incidents.map((i) => i.alert_emailed_at).filter(Boolean).sort(); return t[t.length - 1] || null; },
    async eventCounts() { return []; },
    async createIncident(row) { const r = { id: "i" + (s.incidents.length + 1), opened_at: new Date().toISOString(), closed_at: null, alert_emailed_at: null, ...row }; s.incidents.push(r); return r; },
    async updateIncident(id, patch) { Object.assign(s.incidents.find((i) => i.id === id), patch); },
    async setSnapshot(k, p) { s.snaps[k] = p; },
    async prune() {},
  });
}

function rig(w) {
  const wd = world(w), store = memStore(), sent = []; let t = Date.parse("2026-11-04T12:00:00Z");
  const sleep = vi.fn(async (ms) => { t += ms; });
  const send = async (m) => { sent.push(m); return { ok: true, id: "m" + sent.length }; };
  const beat = async (minutes = 15, method = "POST") => {
    t += minutes * 60000;
    const res = await handleSigninHeartbeat({ request: new Request("https://planyr.io/api/ops/signin-heartbeat", { method, body: method === "POST" ? "{}" : undefined }), env: ENV, store, fetchImpl: wd.fetchImpl, send, sleep, now: () => new Date(t).toISOString() });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  return { ...wd, store, sent, beat, sleep };
}

describe("the three network checks, run from the server", () => {
  it("healthy: site key found, gate agrees, email route answers → pass", async () => {
    const { fetchImpl } = world();
    const r = await runEdgeChecks({ fetchImpl });
    expect(r.overall).toBe("pass");
    expect(r.checks.map((c) => c.name)).toEqual(["site-key-in-bundle", "server-gate", "email-link"]);
  });
  it("the October outage shape (gate on, no key in the bundle) → fail, naming it", async () => {
    const r = await runEdgeChecks({ fetchImpl: world({ keyInBundle: false }).fetchImpl });
    expect(r.overall).toBe("fail"); expect(r.checks.find((c) => c.name === "server-gate").detail).toMatch(/nobody can sign in/);
  });
  it("reads the Supabase address and key from the LIVE bundle, never from this server's own env", async () => {
    const w = world();
    await runEdgeChecks({ fetchImpl: w.fetchImpl });
    expect(w.calls).toContain(SB + "/auth/v1/token"); expect(w.calls.join(" ")).not.toContain("x.supabase.co");
  });
});

describe("the route", () => {
  it("only POST; nothing in the body or headers matters (no secret, nothing to forge)", async () => {
    const x = rig();
    expect((await x.beat(15, "GET")).status).toBe(405);
    const res = await handleSigninHeartbeat({ request: new Request("https://planyr.io/x", { method: "POST", body: JSON.stringify({ attempts: [{ checks: [{ name: "server-gate", status: "fail" }] }], overall: "fail", synthetic: true }) }), env: ENV, store: x.store, fetchImpl: x.fetchImpl, send: async () => ({ ok: true }), sleep: async () => {}, now: () => "2026-11-04T13:00:00.000Z" });
    const j = await res.json();
    expect(j).toMatchObject({ ok: true, overall: "pass", source: "edge" });          // the caller's claim of a failure was ignored
    expect(x.store.checks.every((c) => c.synthetic === false)).toBe(true);           // and it cannot write the drill lane
  });
  it("a healthy beat is stored as the 'edge' source and writes the snapshot's fast-check clock", async () => {
    const x = rig();
    const r = await x.beat();
    expect(r.json).toMatchObject({ ok: true, overall: "pass", delivery: "not-needed", source: "edge" });
    expect(x.store.checks).toHaveLength(1); expect(x.store.checks[0].source).toBe("edge");
    expect(x.store.snaps.signin.sources.edge.lastAt).toBeTruthy();
    expect(x.sleep).not.toHaveBeenCalled();
  });
  it("refuses to run twice inside the minimum gap — and does no network work doing so", async () => {
    const x = rig();
    await x.beat();
    const n = x.calls.length;
    const again = await x.beat(THRESHOLDS.edgeMinGapMin - 1);
    expect(again.json).toMatchObject({ ok: true, skipped: "too-soon" });
    expect(x.calls.length).toBe(n); expect(x.store.checks).toHaveLength(1);
    expect((await x.beat(THRESHOLDS.edgeMinGapMin + 1)).json.skipped).toBeUndefined();
  });
  it("a failure is re-checked once after a short wait; both attempts are stored; ONE alert email goes out", async () => {
    const x = rig({ keyInBundle: false });
    const r = await x.beat();
    expect(x.sleep).toHaveBeenCalledTimes(1); expect(x.sleep).toHaveBeenCalledWith(EDGE_RETRY_WAIT_MS);
    expect(x.store.checks).toHaveLength(2);
    expect(r.json).toMatchObject({ overall: "fail", delivery: "sent", decision: { action: "open", kind: "outside-in" } });
    expect(x.sent).toHaveLength(1); expect(x.sent[0].to).toBe("michael@planyr.io");
    // Every later beat while it stays broken: no second email.
    for (let i = 0; i < 5; i++) expect((await x.beat()).json.delivery).toBe("not-needed");
    expect(x.sent).toHaveLength(1);
    // Fixed → one recovery note.
    x.live.keyInBundle = true;
    expect((await x.beat()).json.delivery).toBe("recovery-sent");
    expect(x.sent).toHaveLength(2);
  });
  it("a one-off blip (fails, then passes on the re-check) alarms nobody", async () => {
    const x = rig({ gate: 500 });
    let n = 0; const orig = x.live;
    const flaky = async (u, i) => { if (new URL(u).pathname === "/auth/v1/token" && n++ >= 1) orig.gate = "on"; return x.fetchImpl(u, i); };
    const res = await handleSigninHeartbeat({ request: new Request("https://planyr.io/x", { method: "POST" }), env: ENV, store: x.store, fetchImpl: flaky, send: async () => ({ ok: true }), sleep: async () => {}, now: () => "2026-11-04T13:00:00.000Z" });
    expect((await res.json())).toMatchObject({ overall: "pass", delivery: "not-needed", incidentOpen: false });
  });
  it("a fast check stuck on 'unknown' (Supabase rate-limiting the probe for good) is not silent: after a day's worth of beats-worth of runs, ONE 'cannot confirm' email", async () => {
    const x = rig();
    x.live.gate = "limited";
    const orig = x.fetchImpl;
    const limited = async (u, i) => (new URL(u).pathname === "/auth/v1/token" ? new Response("{}", { status: 429 }) : orig(u, i));
    let last, emails = 0;
    for (let n = 0; n < 30; n++) {
      const res = await handleSigninHeartbeat({ request: new Request("https://planyr.io/x", { method: "POST" }), env: ENV, store: x.store, fetchImpl: limited, send: async () => { emails++; return { ok: true, id: "m" }; }, sleep: async () => {}, now: () => new Date(Date.parse("2026-11-04T12:00:00Z") + n * 15 * 60000).toISOString() });
      last = await res.json();
    }
    expect(emails).toBe(1); expect(x.store.incidents[0]).toMatchObject({ kind: "blind" }); expect(last.incidentOpen).toBe(true);
  });
  it("the tables not being migrated is a distinct 503, not an outage", async () => {
    const x = rig();
    x.store.lastCheckAt = async () => { const e = new Error('last-check: HTTP 400 {"message":"column signin_health_checks.source does not exist"}'); e.detail = e.message; throw e; };
    const r = await x.beat();
    expect(r.status).toBe(503); expect(r.json.reason).toBe("not_migrated");
  });
  it("a database failure is a 502, never a quiet 200", async () => {
    const x = rig();
    x.store.insertChecks = async () => { throw new Error("db down"); };
    const r = await x.beat();
    expect(r.status).toBe(502); expect(r.json.error).toMatch(/store failure at store-checks/);
  });
  it("it also watches the browser check: silent past its limit → one email naming GitHub", async () => {
    const x = rig();
    x.store.checks.push({ id: 99, at: "2026-11-03T20:00:00.000Z", overall: "pass", checks: [{ name: "panel-renders", status: "pass", detail: "" }], source: "runner", synthetic: false });
    const r = await x.beat();
    expect(r.json.stops).toEqual([{ source: "runner", action: "open" }]); expect(r.json.stopDelivery).toBe("sent");
    expect(x.sent[0].text).toMatch(/GitHub/);
  });
});
