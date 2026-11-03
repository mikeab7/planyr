/* NEW-1 (2026-11-02) — the alarm ROUTE, whole flow, with an in-memory store, a fake verifier and a fake mail sender.
 * The headline property: ONE incident sends ONE email, then ONE recovery note. */
import { describe, it, expect, vi } from "vitest";
import { handleSigninHealth, normaliseAttempts, createPostgrestStore, mailConfigured } from "../functions/api/lib/signinHealthRoute.js";

function memStore({ events = [] } = {}) {
  const s = { checks: [], incidents: [], snaps: {}, pruned: 0, eventsRows: events, failAt: null };
  const guard = (stage) => { if (s.failAt === stage) throw new Error("db down"); };
  return Object.assign(s, {
    async insertChecks(rows) { guard("store-checks"); rows.forEach((r) => s.checks.push({ ...r, id: s.checks.length + 1 })); },
    async recentChecks({ synthetic, limit }) { return s.checks.filter((c) => !!c.synthetic === !!synthetic).sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id).slice(0, limit); },
    async openIncident({ synthetic }) { return s.incidents.find((i) => !i.closed_at && !!i.synthetic === !!synthetic) || null; },
    async lastAlertAt({ synthetic }) { const t = s.incidents.filter((i) => i.alert_emailed_at && !!i.synthetic === !!synthetic).map((i) => i.alert_emailed_at).sort(); return t[t.length - 1] || null; },
    async eventCounts() { return s.eventsRows; },
    async createIncident(row) { const r = { id: "i" + (s.incidents.length + 1), opened_at: new Date().toISOString(), closed_at: null, alert_emailed_at: null, recovery_emailed_at: null, ...row }; s.incidents.push(r); return r; },
    async updateIncident(id, patch) { Object.assign(s.incidents.find((i) => i.id === id), patch); },
    async setSnapshot(k, p) { s.snaps[k] = p; },
    async prune() { s.pruned++; },
  });
}
const ENV = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "SVC", GMAIL_SERVICE_ACCOUNT_JSON: "{}", INVITE_SENDER: "mike@planyr.io" };
const check = (status, name = "server-gate") => ({ name, status, detail: status === "pass" ? "" : "no site key" });
const body = (...statuses) => ({ attempts: statuses.map((s) => ({ checks: [check(s)] })), runUrl: "https://github.com/mikeab7/planyr/actions/runs/9" });

function harness({ env = ENV, store = memStore(), mailOk = true, verifyOk = true } = {}) {
  const sent = [];
  let t = Date.parse("2026-11-02T12:00:00Z");
  const send = vi.fn(async (m) => { sent.push(m); return mailOk ? { ok: true, id: "msg" + sent.length } : { ok: false, error: "Gmail refused the send (403)" }; });
  const post = async (b, { synthetic = false, method = "POST", auth = true } = {}) => {
    t += 3600_000;
    const req = new Request("https://planyr.io/api/ops/signin-health", { method, headers: auth ? { authorization: "Bearer tok" } : {}, body: method === "POST" ? JSON.stringify({ ...b, synthetic }) : undefined });
    const res = await handleSigninHealth({ request: req, env, store, verify: async () => (verifyOk ? { ok: true } : { ok: false, error: "bad" }), send, now: () => new Date(t).toISOString() });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  return { post, sent, send, store };
}

describe("authorization", () => {
  it("a caller GitHub did not vouch for gets 401 and writes nothing", async () => {
    const h = harness({ verifyOk: false });
    const r = await h.post(body("fail"));
    expect(r.status).toBe(401); expect(h.store.checks).toHaveLength(0); expect(h.sent).toHaveLength(0);
  });
  it("only POST", async () => { expect((await harness().post({}, { method: "GET" })).status).toBe(405); });
  it("a malformed body is a 400, not a stored row", async () => {
    const h = harness();
    for (const b of [{}, { attempts: [] }, { attempts: [{ checks: [{ name: "BAD NAME", status: "pass" }] }] }, { attempts: [{ checks: [{ name: "a", status: "maybe" }] }] }, { attempts: [1, 2, 3, 4].map(() => ({ checks: [check("pass")] })) }]) {
      expect((await h.post(b)).status).toBe(400);
    }
    expect(h.store.checks).toHaveLength(0);
  });
  it("the overall verdict is computed server-side — a client-supplied one is ignored", () => {
    const n = normaliseAttempts({ attempts: [{ overall: "pass", checks: [check("fail")] }] });
    expect(n.attempts[0].overall).toBe("fail");
  });
});

describe("one incident, one email", () => {
  it("two failures in the SAME report → exactly one alert; the incident is stored emailed", async () => {
    const h = harness();
    const r = await h.post(body("fail", "fail"));
    expect(r.json).toMatchObject({ ok: true, overall: "fail", delivery: "sent", incidentOpen: true, decision: { action: "open", email: "alert" } });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].to).toBe("michael@planyr.io");
    expect(h.sent[0].subject).toMatch(/^Planyr alarm: Sign-in looks broken/);
    expect(h.store.incidents[0].alert_emailed_at).toBeTruthy();
  });
  it("a single failure is a blip: nothing sent, no incident", async () => {
    const h = harness();
    expect((await h.post(body("fail"))).json).toMatchObject({ delivery: "not-needed", incidentOpen: false });
    expect(h.sent).toHaveLength(0);
  });
  it("hour after hour of failing → still ONE email in total", async () => {
    const h = harness();
    await h.post(body("fail", "fail"));
    for (let i = 0; i < 6; i++) expect((await h.post(body("fail", "fail"))).json.delivery).toBe("not-needed");
    expect(h.sent).toHaveLength(1);
    expect(h.store.incidents).toHaveLength(1);
  });
  it("a passing run sends ONE recovery note and closes the incident; later passes send nothing", async () => {
    const h = harness();
    await h.post(body("fail", "fail"));
    const rec = await h.post(body("pass"));
    expect(rec.json).toMatchObject({ delivery: "recovery-sent", incidentOpen: false });
    expect(h.sent.map((m) => m.subject)).toEqual([expect.stringMatching(/^Planyr alarm: /), expect.stringMatching(/^Planyr alarm cleared: /)]);
    expect((await h.post(body("pass"))).json.delivery).toBe("not-needed");
    expect(h.sent).toHaveLength(2);
    expect(h.store.incidents[0].closed_at).toBeTruthy();
  });
  it("an 'unknown' run never closes an incident", async () => {
    const h = harness();
    await h.post(body("fail", "fail"));
    expect((await h.post(body("unknown"))).json).toMatchObject({ incidentOpen: true, delivery: "not-needed" });
  });
});

describe("the mail channel failing is loud, never silent", () => {
  it("mail not configured → delivery 'not-configured', incident open, NOT marked emailed — and it retries once configured", async () => {
    const h = harness({ env: { ...ENV, GMAIL_SERVICE_ACCOUNT_JSON: undefined } });
    const a = await h.post(body("fail", "fail"));
    expect(a.json).toMatchObject({ delivery: "not-configured", incidentOpen: true, mail: { configured: false } });
    expect(h.store.incidents[0].alert_emailed_at).toBeNull();
    expect(mailConfigured(ENV)).toBe(true);
  });
  it("Gmail refusing the send → delivery 'failed' with the reason; the next report retries and then sends once", async () => {
    const store = memStore();
    const bad = harness({ store, mailOk: false });
    const a = await bad.post(body("fail", "fail"));
    expect(a.json).toMatchObject({ delivery: "failed", mail: { error: expect.stringMatching(/403/) } });
    const good = harness({ store, mailOk: true });
    store.checks.forEach((c) => { c.at = "2026-11-02T11:00:00.000Z"; });
    const b = await good.post(body("fail", "fail"));
    expect(b.json).toMatchObject({ delivery: "sent", decision: { action: "retry-alert" } });
    expect(good.sent).toHaveLength(1);
  });
  it("the migration not being applied is a distinct 503 'not_migrated' (a setup state), not a 502 outage", async () => {
    const store = memStore();
    store.insertChecks = async () => { const e = new Error("store-checks: HTTP 404 {\"code\":\"PGRST205\",\"message\":\"Could not find the table 'public.signin_health_checks' in the schema cache\"}"); e.status = 404; e.detail = e.message; throw e; };
    const r = await harness({ store }).post(body("fail", "fail"));
    expect(r.status).toBe(503); expect(r.json).toMatchObject({ ok: false, reason: "not_migrated" });
  });
  it("a database failure is a 502 naming the stage — not a 200", async () => {
    const store = memStore(); store.failAt = "store-checks";
    const r = await harness({ store }).post(body("fail", "fail"));
    expect(r.status).toBe(502); expect(r.json.error).toMatch(/store failure at store-checks/);
  });
});

describe("client-reported refusals", () => {
  const rows = (o) => Object.entries(o).map(([k, n]) => ({ source: "event:auth-" + k, n }));
  it("a rate of server refusals alarms even while the outside check passes", async () => {
    const h = harness({ store: memStore({ events: rows({ "captcha-refused": 5, ok: 1 }) }) });
    expect((await h.post(body("pass"))).json).toMatchObject({ delivery: "sent", decision: { kind: "client-rate" } });
  });
  it("wrong passwords and blocked scripts in any volume send nothing", async () => {
    const h = harness({ store: memStore({ events: rows({ "wrong-password": 99, "captcha-blocked": 99, "captcha-widget-error": 99 }) }) });
    expect((await h.post(body("pass"))).json).toMatchObject({ delivery: "not-needed", incidentOpen: false });
    expect(h.sent).toHaveLength(0);
  });
});

describe("the alarm drill lane", () => {
  it("is separate from real state: its own history and incident, '[TEST]' mail, snapshot under another key", async () => {
    const h = harness();
    await h.post(body("pass"));                                                  // real: healthy
    const d = await h.post(body("fail", "fail"), { synthetic: true });
    expect(d.json).toMatchObject({ delivery: "sent" });
    expect(h.sent[0].subject).toMatch(/^\[TEST\]/);
    expect(h.store.snaps.signin_drill.drill).toBe(true);
    expect(h.store.snaps.signin.incident).toBeNull();                            // the real snapshot is untouched by the drill
    const real = await h.post(body("pass"));
    expect(real.json.incidentOpen).toBe(false);
  });
  it("the drill sequence proves one email per incident and one recovery", async () => {
    const h = harness();
    const out = [];
    out.push((await h.post(body("pass"), { synthetic: true })).json.delivery);
    out.push((await h.post(body("fail", "fail"), { synthetic: true })).json.delivery);
    out.push((await h.post(body("fail"), { synthetic: true })).json.delivery);
    out.push((await h.post(body("fail", "fail"), { synthetic: true })).json.delivery);
    out.push((await h.post(body("pass"), { synthetic: true })).json.delivery);
    out.push((await h.post(body("pass"), { synthetic: true })).json.delivery);
    expect(out).toEqual(["not-needed", "sent", "not-needed", "not-needed", "recovery-sent", "not-needed"]);
    expect(h.sent).toHaveLength(2);
  });
  it("a drill ignores real browsers' events", async () => {
    const h = harness({ store: memStore({ events: [{ source: "event:auth-captcha-refused", n: 50 }] }) });
    expect((await h.post(body("pass"), { synthetic: true })).json.delivery).toBe("not-needed");
  });
});

describe("coverage gaps through the route (owner decision 2026-11-03)", () => {
  const runWithGap = (rs = "unknown") => ({ attempts: [{ checks: [check("pass", "site-key-in-bundle"), check("pass", "server-gate"), check("pass", "panel-renders"), { name: "real-sign-in", status: rs, uncovered: true, detail: "Cloudflare challenge" }, { name: "email-link", status: "skipped", detail: "" }] }], runUrl: "https://github.com/mikeab7/planyr/actions/runs/9" });
  it("an uncovered real sign-in is stored, the overall is PASS, and the snapshot lists the gap", async () => {
    const h = harness();
    const r = await h.post(runWithGap());
    expect(r.json).toMatchObject({ ok: true, overall: "pass", delivery: "not-needed", unknownStreak: 0 });
    expect(h.store.snaps.signin.gaps).toEqual([expect.objectContaining({ name: "real-sign-in" })]);
    expect(h.store.snaps.signin.checks.find((c) => c.name === "real-sign-in")).toMatchObject({ status: "unknown", uncovered: true });
  });
  it("two days of hourly runs with the gap send NO email and open NO incident", async () => {
    const h = harness();
    for (let i = 0; i < 48; i++) await h.post(runWithGap());
    expect(h.sent).toHaveLength(0);
    expect(h.store.incidents).toHaveLength(0);
  });
  it("the flag is honoured ONLY on an unknown step — a client cannot hide a fail or a pass behind it", () => {
    const n = normaliseAttempts({ attempts: [{ checks: [{ name: "real-sign-in", status: "fail", uncovered: true }, { name: "server-gate", status: "pass", uncovered: true }, { name: "panel-renders", status: "unknown", uncovered: true }] }] });
    expect(n.attempts[0].checks.map((c) => c.uncovered)).toEqual([undefined, undefined, true]);
    expect(n.attempts[0].overall).toBe("fail");
  });
  it("a day of GENUINELY unknown runs still sends the one blind email (the alarm for a check that cannot confirm sign-in)", async () => {
    const h = harness();
    let last;
    for (let i = 0; i < 24; i++) last = await h.post({ attempts: [{ checks: [check("unknown", "server-gate")] }] });
    expect(last.json).toMatchObject({ delivery: "sent", decision: { kind: "blind", action: "open" } });
    expect(h.sent).toHaveLength(1);
  });
});

describe("snapshot", () => {
  it("every real report refreshes the 'signin' snapshot with lastCheckAt (the dead-man's-switch input) and prunes", async () => {
    const h = harness();
    await h.post(body("pass"));
    expect(h.store.snaps.signin).toMatchObject({ overall: "pass", failStreak: 0 });
    expect(h.store.snaps.signin.lastCheckAt).toBeTruthy();
    expect(h.store.pruned).toBe(1);
  });
});

describe("the PostgREST store speaks to the right tables with the service role", () => {
  it("builds the expected requests", async () => {
    const calls = [];
    const f = vi.fn(async (url, init) => { calls.push({ url, method: init.method || "GET", headers: init.headers, body: init.body }); return new Response(init.method === "DELETE" || init.method === "PATCH" ? null : "[]", { status: init.method === "DELETE" || init.method === "PATCH" ? 204 : 200 }); });
    const s = createPostgrestStore(ENV, f);
    await s.recentChecks({ synthetic: false, limit: 60 });
    await s.openIncident({ synthetic: true });
    await s.eventCounts(60);
    await s.setSnapshot("signin", { a: 1 }, "T");
    await s.updateIncident("abc", { closed_at: "T" });
    await s.prune("2026-08-01T00:00:00.000Z");
    expect(calls.map((c) => c.method + " " + c.url.replace("https://x.supabase.co/rest/v1/", ""))).toEqual([
      "GET signin_health_checks?select=overall,at,checks,run_url&synthetic=eq.false&order=at.desc,id.desc&limit=60",
      "GET signin_incidents?select=*&closed_at=is.null&synthetic=eq.true&limit=1",
      "POST rpc/signin_event_counts",
      "POST ops_snapshots?on_conflict=key",
      "PATCH signin_incidents?id=eq.abc",
      "DELETE signin_health_checks?at=lt.2026-08-01T00%3A00%3A00.000Z",
    ]);
    expect(calls.every((c) => c.headers.apikey === "SVC" && c.headers.authorization === "Bearer SVC")).toBe(true);
    expect(JSON.parse(calls[3].body)).toEqual({ key: "signin", payload: { a: 1 }, updated_at: "T" });
  });
  it("a refused request throws (so the route answers 502)", async () => {
    const s = createPostgrestStore(ENV, async () => new Response("denied", { status: 401 }));
    await expect(s.recentChecks({ synthetic: false, limit: 1 })).rejects.toThrow(/history: HTTP 401/);
  });
});
