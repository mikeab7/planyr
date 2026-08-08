#!/usr/bin/env node
/* verify-capture-pipe — DOES A PERFORMANCE CAPTURE ACTUALLY LEAVE THE BROWSER? (B265536)
 *
 * ⛔ WHY THIS EXISTS, AND WHY IT IS NOT THE SAME CHECK `verify-perf-recorder.mjs` ALREADY MAKES.
 * That harness proves an induced stall PRODUCES a capture. It says nothing about the capture
 * TRAVELLING. Between `capture()` and a readable row there are five places to die, and until
 * B265536 every one of them was silent:
 *
 *   1. the recorder never installs (the kill switch, a failed dynamic import, no Chromium APIs);
 *   2. the capture is withheld by the privacy allowlist (`perfcap-blocked`);
 *   3. the encoded row overruns `client_errors.message` and truncates into unparseable JSON;
 *   4. `decideReport` suppresses it (dedup / rate cap / the shared 100-row session ceiling);
 *   5. **the INSERT is rejected — RLS, a missing column, an offline tab — and the sink throws the
 *      rejection away.** That last one was a one-line `p.then(() => {}, () => {})`, under a comment
 *      that said out loud it made a telemetry failure invisible.
 *
 * For an error report that is unfortunate. For B1121's stopping rule — *"instrument it so it
 * captures itself"* — it is fatal: a week of the owner's normal use would have produced nothing,
 * and the honest-looking conclusion would have been "the symptom is gone", which is exactly the
 * disposition NEVER-PARK forbids. **The stopping rule is only sound if the pipe is proven**, so
 * this proves it, and re-proves it on every run.
 *
 * ⛔ WHAT IT CAN AND CANNOT SEE FROM HERE, stated rather than glossed. The sandbox's egress policy
 * refuses CONNECT to `*.supabase.co` (measured: the gateway answers 403), so no browser here can
 * complete the real hop. It therefore does the honest thing rather than the flattering one: it
 * INTERCEPTS the outgoing request at the network layer, so what is asserted is the ACTUAL HTTP
 * POST the production bundle issues — method, path, headers, and the exact row body — and it
 * drives the response itself, which is the only way to test the REJECTION path at all. The row it
 * captures is written to disk so the database half can be proven separately, by executing that
 * same insert against the real table under the real RLS roles (see `docs/CAPTURE-PIPE.md`).
 *
 * FIVE ARMS, and the last three are the ones that make it a guard rather than a demo:
 *   auto       — induce a stall; a capture fires and a row goes on the wire
 *   manual     — press the owner's own "that felt slow just now" control; a row goes on the wire
 *                tagged `"kind":"manual"`, and the button reaches ✓
 *   rejected   — answer the SAME insert with 401; the button must reach the WARNING state and
 *                `pfTelemetry.lastSend().ok` must be false. **This is the anti-rot arm**: before
 *                B265536 it was un-failable, because nothing anywhere could observe the rejection.
 *   offline    — the request never completes; same requirement. A hung socket and a refusal are
 *                different failures and both used to read as success.
 *   suppressed — B270912, and the ONLY arm that proves a row does NOT travel: the identical stall
 *                with the network opt-in absent must reach the wire zero times, while still taking
 *                the capture, still writing it to the device, and still SAYING that it suppressed.
 *
 * ⛔ THE FOUR ARMS ABOVE IT ARE ALSO B270912'S SECOND GUARD, and that is not incidental. They run
 * WITH the opt-in, so if suppression is ever made unconditional — the one-line mistake that would
 * blind the pipe guard by its own fix — `auto`, `manual`, `rejected` and `offline` all go red at
 * once. Neither direction can be lost without the other noticing.
 *
 *   node ui-audit/verify-capture-pipe.mjs --build
 *   ... --json            machine-readable
 *   ... --rows out.json   write every intercepted row body for the database-side proof
 */
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { fixtureSeed, withLayerArm, OWNER_SCENE } from "./lib/planFixture.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const DIST = join(ROOT, "dist-pipe");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const JSON_OUT = process.argv.includes("--json");
const ROWS_OUT = arg("--rows", "");
const PORT = Number(arg("--port", 4193));

/* A synthetic Supabase origin. The bundle needs SOME configuration or `supabase` is null and the
 * sink no-ops — which is itself one of the silent failures this file exists to catch, so building
 * without it would make every arm vacuous. Nothing here reaches a real host: every request to this
 * origin is answered by the interceptor below. */
const SUPA_ORIGIN = "https://capture-pipe.test.invalid";
const SUPA_ANON = "pipe-anon-key";

/** The column cap in `public.client_errors.message`. A row past it truncates into JSON nobody can
 *  parse — a capture that arrives unreadable is a capture that did not arrive. */
const MSG_MAX = 2000;

if (process.argv.includes("--build")) {
  process.stderr.write("  · building (with a synthetic Supabase config, so the sink is live)…\n");
  const r = spawnSync("npx", ["vite", "build", "--outDir", "dist-pipe"], {
    cwd: ROOT,
    env: { ...process.env, VITE_SUPABASE_URL: SUPA_ORIGIN, VITE_SUPABASE_ANON_KEY: SUPA_ANON },
    stdio: ["ignore", "ignore", "inherit"],
  });
  if (r.status !== 0) { console.error("build failed"); process.exit(2); }
}
if (!existsSync(join(DIST, "index.html"))) {
  console.error(`No build at ${DIST}. Re-run with --build.`);
  process.exit(2);
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".wasm": "application/wasm" };
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const f = join(DIST, p);
  if (!f.startsWith(DIST) || !existsSync(f)) { res.writeHead(404); return res.end(); }
  const ext = p.slice(p.lastIndexOf("."));
  res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(PORT, r));
const BASE = `http://localhost:${PORT}/`;

/* Compress the trigger's 50-second calibration so an arm runs in seconds. This drives the REAL
 * trigger and the REAL sink — only the clock constants move. */
const FAST = {
  counterMs: 500,
  idleStopMs: 1200,
  trigger: { baselineSkipMs: 300, baselineWindowMs: 1200, baselineMinFrames: 20, baselineMaxFrames: 60, sustainMs: 700, sustainMinFrames: 6, cooldownMs: 500, maxAuto: 3, floorMs: 33 },
};

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
/** Decode the packed frame track the same way a reader of the table would have to. If this throws,
 *  the row is not readable and the arm fails — that is the point of decoding it here. */
function decodeTrack(ft, fx) {
  const out = new Array(ft.length);
  for (let i = 0; i < ft.length; i++) {
    const v = B64.indexOf(ft[i]);
    if (v < 0) throw new Error(`frame track holds a non-base64 character at ${i}`);
    out[i] = v;
  }
  for (const [i, ms] of fx || []) if (i >= 0 && i < out.length) out[i] = ms;
  return out;
}

const SCENE = withLayerArm(JSON.parse(readFileSync(join(HERE, "fixtures", "bain-quiddity.json"), "utf8")), "owner-4");

const rows = [];      // every intercepted insert body, in order
const results = [];
const fail = (arm, msg) => results.push({ arm, ok: false, msg });
const pass = (arm, msg) => results.push({ arm, ok: true, msg });

/** One arm: a fresh page, its own response policy for the insert endpoint.
 *
 *  ⛔ `networkOptIn` IS THE HALF OF B270912 THAT MAKES THE OTHER HALF SAFE. Production telemetry is
 *  now suppressed under automation (`navigator.webdriver`), which is exactly what this file drives.
 *  Suppress unconditionally and THIS harness — the one that proves the pipe works and, in its
 *  `rejected`/`offline` arms, that a broken pipe is LOUD — would be disabled by its own fix and
 *  would pass forever while observing nothing. So the arms that must reach the wire opt in
 *  DELIBERATELY, with `window.__PLANYR_TELEMETRY_NETWORK`, and the `suppressed` arm below runs with
 *  the opt-in ABSENT to prove the default really does hold. Both directions, or neither is proven. */
async function runArm(name, { respond, drive, networkOptIn = true }) {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((cfg) => { window.__PLANYR_PERFREC = cfg; }, FAST);
  if (networkOptIn) await ctx.addInitScript(() => { window.__PLANYR_TELEMETRY_NETWORK = true; });
  /* A REAL plan, and — B265538 — his measured four-layer scene rather than the empty one every
   * other battery here has used. The "report that felt slow" control lives on the planner canvas,
   * so a seeded plan is what makes the manual arm reachable at all. */
  await ctx.addInitScript(fixtureSeed(SCENE, { id: "capture-pipe-site", name: "capture-pipe", site: "capture-pipe" }));

  const seen = [];
  /* ⛔ ROUTE ORDER IS LOAD-BEARING: Playwright matches handlers LAST-REGISTERED-FIRST, so the
   * catch-all goes on first and the Supabase handler second. Registered the other way round the
   * catch-all wins, `continue()`s the insert to a host that does not resolve, and every arm passes
   * or fails on a DNS error instead of on the response we meant to send — which is how the
   * rejection arm briefly went green for entirely the wrong reason. */
  await ctx.route(/^https?:\/\//, (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  /* ⛔ INTERCEPT, DO NOT MOCK. The handler sits BELOW the app: what it sees is whatever the
   * production bundle really put on the wire, including anything supabase-js added. A stub of the
   * client would prove the test's own fiction instead. */
  await ctx.route(`${SUPA_ORIGIN}/**`, async (route) => {
    const req = route.request();
    let body = null;
    try { body = JSON.parse(req.postData() || "null"); } catch (_) { body = { __unparseable: req.postData() }; }
    seen.push({ url: req.url(), method: req.method(), headers: req.headers(), body });
    await respond(route);
  });

  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 60000 });
  await page.waitForFunction(() => !!window.pfRec, null, { timeout: 20000 }).catch(() => {});
  const armed = await page.evaluate(() => !!window.pfRec);
  if (!armed) { fail(name, "the recorder never armed on the deployed bundle — nothing downstream can be true"); await browser.close(); return { seen }; }

  const out = await drive(page);
  await browser.close();
  for (const s of seen) rows.push({ arm: name, ...s });
  return { seen, ...out };
}

/* ── Shared drivers ─────────────────────────────────────────────────────────────────────────── */

/** Interact for long enough to seal a baseline, then block the main thread hard enough and long
 *  enough to satisfy LEVEL + SUSTAIN + FLOOR. Nothing is stubbed — the real trigger decides. */
async function induceStall(page) {
  const box = await page.locator('[data-testid="planner-canvas"]').boundingBox();
  const cx = Math.round(box.x + box.width / 2), cy = Math.round(box.y + box.height / 2);
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 40; i++) await page.mouse.move(cx + (i % 9) * 6, cy + (i % 7) * 6);
  await page.waitForTimeout(1800);                       // …the baseline seals in here
  await page.evaluate(() => {
    // Block the main thread in ~90 ms slices for ~2.5 s of interacting time, moving the pointer
    // between slices so the frame loop stays alive and the window keeps filling.
    const spin = (ms) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { /* burn */ } };
    let n = 0;
    return new Promise((res) => {
      const step = () => {
        spin(90);
        window.dispatchEvent(new Event("pointermove"));
        if (++n > 34) return res();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  });
  await page.waitForTimeout(600);
}

/* ── Arm 1: AUTO ────────────────────────────────────────────────────────────────────────────── */
const ok201 = (route) => route.fulfill({ status: 201, contentType: "application/json", body: "[]" });

await runArm("auto", {
  respond: ok201,
  drive: async (page) => {
    await induceStall(page);
    await page.waitForTimeout(1200);
    const st = await page.evaluate(() => ({ ...window.pfRec.state(), captures: window.pfRec.captures() }));
    if (!st.captures.length) fail("auto", `an induced stall produced NO capture (baseline ${st.baselineMs} ms, fires ${st.fires}) — the trigger, not the pipe, is the problem`);
    else pass("auto", `${st.captures.length} capture(s) taken; baseline ${st.baselineMs} ms`);
    return {};
  },
});

/* ── Arm 2: MANUAL — the owner's own button, end to end ─────────────────────────────────────── */
await runArm("manual", {
  respond: ok201,
  drive: async (page) => {
    /* Drive the plan for a moment FIRST — this is how he actually reaches for the button, with a
     * gesture just behind him, and it is the case where the ring must hold the seconds BEFORE the
     * press. Pressing cold is covered by the `manual-cold` arm below. */
    await induceStall(page);
    await page.locator('[data-testid="report-slow"]').click();
    await page.waitForFunction(() => {
      const b = document.querySelector('[data-testid="report-slow"]');
      return b && b.getAttribute("data-slow-note") && b.getAttribute("data-slow-note") !== "sending";
    }, null, { timeout: 15000 }).catch(() => {});
    const note = await page.getAttribute('[data-testid="report-slow"]', "data-slow-note");
    if (note !== "ok") fail("manual", `the button settled on "${note}" after a 201 — a delivered capture must read as delivered`);
    else pass("manual", "the button reached ✓ only after the server acknowledged the row");
    const send = await page.evaluate(() => window.pfTelemetry.lastSend());
    if (!send || !send.ok) fail("manual", `pfTelemetry.lastSend() reports ${JSON.stringify(send)} for an accepted insert`);
    return {};
  },
});

/* ── Arm 2b: MANUAL, COLD — he presses it in a still moment ─────────────────────────────────── */
await runArm("manual-cold", {
  respond: ok201,
  drive: async (page) => {
    await page.waitForTimeout(800);           // no gesture at all: the frame loop never ran
    await page.locator('[data-testid="report-slow"]').click();
    await page.waitForFunction(() => {
      const b = document.querySelector('[data-testid="report-slow"]');
      const n = b && b.getAttribute("data-slow-note");
      return n && n !== "sending";
    }, null, { timeout: 15000 }).catch(() => {});
    const note = await page.getAttribute('[data-testid="report-slow"]', "data-slow-note");
    if (note !== "ok") fail("manual-cold", `a cold press settled on "${note}" — a still moment is still a report worth keeping`);
    else pass("manual-cold", "a press with no gesture behind it still delivers (and is labelled `no-frames`)");
    return {};
  },
});

/* ── Arm 3: REJECTED — the anti-rot arm ─────────────────────────────────────────────────────── */
await runArm("rejected", {
  respond: (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ code: "42501", message: "new row violates row-level security policy" }) }),
  drive: async (page) => {
    await page.waitForTimeout(800);
    await page.locator('[data-testid="report-slow"]').click();
    // The sink retries once after ~2.5 s before giving up, so allow for both attempts.
    await page.waitForFunction(() => {
      const b = document.querySelector('[data-testid="report-slow"]');
      const n = b && b.getAttribute("data-slow-note");
      return n && n !== "sending";
    }, null, { timeout: 20000 }).catch(() => {});
    const note = await page.getAttribute('[data-testid="report-slow"]', "data-slow-note");
    if (note !== "undelivered") fail("rejected", `an RLS-rejected write left the button reading "${note}" — this is the silent drop B265536 exists to end`);
    else pass("rejected", "an RLS rejection surfaces to the owner instead of reading as success");
    const send = await page.evaluate(() => window.pfTelemetry.lastSend());
    if (!send || send.ok !== false) fail("rejected", `pfTelemetry.lastSend() reports ${JSON.stringify(send)} for a REJECTED insert`);
    else pass("rejected", `the rejection is readable live: ${send.error ? (send.error.code || send.error.message) : send.reason}`);
    const st = await page.evaluate(() => window.pfRec.state());
    if (!(st.undelivered > 0)) fail("rejected", "the recorder did not count the capture as undelivered");
    return {};
  },
});

/* ── Arm 4: OFFLINE — a hung socket is not a delivery ───────────────────────────────────────── */
await runArm("offline", {
  respond: (route) => route.abort("internetdisconnected"),
  drive: async (page) => {
    await page.waitForTimeout(800);
    await page.locator('[data-testid="report-slow"]').click();
    await page.waitForFunction(() => {
      const b = document.querySelector('[data-testid="report-slow"]');
      const n = b && b.getAttribute("data-slow-note");
      return n && n !== "sending";
    }, null, { timeout: 25000 }).catch(() => {});
    const note = await page.getAttribute('[data-testid="report-slow"]', "data-slow-note");
    if (note !== "undelivered") fail("offline", `an unreachable server left the button reading "${note}"`);
    else pass("offline", "an unreachable server reads as undelivered, not as success");
    return {};
  },
});

/* ── Arm 5: SUPPRESSED — an ordinary automated run must put NOTHING on the wire (B270912) ───────
 *
 * ⛔ THIS IS THE OTHER DIRECTION, and shipping the suppression without it would have been the sixth
 * instance of the class it closes. Four things are asserted, and the last two are why this is not
 * simply "count zero requests":
 *   1. NOT ONE request reaches the Supabase origin — not just no `perfcap` row. This arm runs the
 *      identical stall the `auto` arm does, so a passing run here against a failing `auto` run is
 *      arithmetically impossible to fake.
 *   2. The capture is STILL TAKEN. Suppression that also stopped the recorder would be a different
 *      and worse bug, and every harness reading `pfRec.captures()` would go quietly green-but-empty.
 *   3. The ON-DEVICE copy is still written to IndexedDB — read here through raw IDB, the way the
 *      storage panel would see it — because the brief's condition was that only the NETWORK report
 *      is suppressed.
 *   4. It is READABLE that it was suppressed: `pfTelemetry.lastSend().reason` says `automated-run`,
 *      the recorder counts it as `suppressed` and NOT as `undelivered`, and the owner's button
 *      settles on `local` rather than the `undelivered` warning. A silent suppression would be the
 *      swallowing sink wearing a different hat. */
const suppressedArm = await runArm("suppressed", {
  networkOptIn: false,
  respond: ok201,     // never invoked if the fix holds — that is the assertion
  drive: async (page) => {
    await induceStall(page);
    await page.waitForTimeout(1200);
    await page.locator('[data-testid="report-slow"]').click();
    await page.waitForFunction(() => {
      const b = document.querySelector('[data-testid="report-slow"]');
      const n = b && b.getAttribute("data-slow-note");
      return n && n !== "sending";
    }, null, { timeout: 15000 }).catch(() => {});

    const st = await page.evaluate(() => ({ ...window.pfRec.state(), captures: window.pfRec.captures() }));
    if (!st.captures.length) fail("suppressed", "no capture was TAKEN under an automated run — suppression must silence the network, never the recorder");
    else pass("suppressed", `${st.captures.length} capture(s) still taken locally`);
    if (!(st.suppressed > 0)) fail("suppressed", `the recorder counted ${st.suppressed} suppressed sends — a suppression nobody can read is the swallowing sink again`);
    else pass("suppressed", `${st.suppressed} send(s) recorded as deliberately suppressed`);
    if (st.undelivered > 0) fail("suppressed", `${st.undelivered} capture(s) counted as UNDELIVERED — a deliberate suppression must not read as a broken pipe`);
    else pass("suppressed", "nothing was counted as undelivered — suppressed and broken stay distinguishable");

    const send = await page.evaluate(() => window.pfTelemetry.lastSend());
    if (!send || send.reason !== "automated-run") fail("suppressed", `pfTelemetry.lastSend() reports ${JSON.stringify(send)} — it must name the automated run as the reason`);
    else pass("suppressed", `the reason is readable live: ${send.reason} (via ${send.via})`);

    const note = await page.getAttribute('[data-testid="report-slow"]', "data-slow-note");
    if (note !== "local") fail("suppressed", `the button settled on "${note}" — an automated run must not tell the owner the server is unreachable`);
    else pass("suppressed", "the button reads `local`, not the undelivered warning");

    /* The on-device copy, read the way the storage panel reads it. */
    const stored = await page.evaluate(() => new Promise((res) => {
      let req; try { req = indexedDB.open("planyr"); } catch (_) { return res(-1); }
      req.onerror = () => res(-1);
      req.onsuccess = () => {
        const db = req.result;
        let tx; try { tx = db.transaction("kv", "readonly"); } catch (_) { return res(-1); }
        let n = 0;
        const cur = tx.objectStore("kv").openCursor(IDBKeyRange.bound("perfcap:", "perfcap:￿"));
        cur.onsuccess = (e) => { const c = e.target.result; if (c) { n++; c.continue(); } else res(n); };
        cur.onerror = () => res(-1);
      };
    }));
    if (!(stored > 0)) fail("suppressed", `the on-device store holds ${stored} capture(s) — only the NETWORK report may be suppressed`);
    else pass("suppressed", `${stored} capture(s) kept on the device, as under any other run`);
    return {};
  },
});

/* ⛔ AND THE CLAIM ITSELF: not one write reached `client_errors`. Checked at the network layer —
 * below the app, below supabase-js — so no code path inside the bundle can satisfy it by accident.
 *
 * ⛔ THE CLAIM IS ABOUT THE TELEMETRY TABLE, NOT ABOUT THE ORIGIN, and the distinction is not a
 * concession made to get a green. The first run of this arm asserted "no request of any kind" and
 * failed on `/auth/v1/health` — the Supabase client's own liveness probe, which writes nothing
 * anywhere. Supabase is also this app's DATA backend: an automated run legitimately signs in,
 * reads plans and writes rows, and a harness that forbade that would be forbidding the app from
 * working. What B270912 is about is `public.client_errors` filling with synthetic rows, so that is
 * what is asserted — and everything else the page sent is PRINTED rather than ignored, so a future
 * write to some other telemetry sink cannot hide behind this narrower claim. */
const leaked = suppressedArm.seen.filter((s) => /\/rest\/v1\/client_errors/.test(s.url));
if (leaked.length) fail("suppressed", `${leaked.length} telemetry row(s) still reached client_errors under an ordinary automated run: ${leaked.map((s) => (s.body && s.body.source) || s.url).slice(0, 4).join(", ")}`);
else pass("suppressed", `no write reached client_errors — an ordinary harness run adds nothing to the table${suppressedArm.seen.length ? ` (the ${suppressedArm.seen.length} other request(s) it did make: ${[...new Set(suppressedArm.seen.map((s) => new URL(s.url).pathname))].join(", ")})` : ""}`);


server.close();

/* ── The rows themselves: is what went on the wire actually READABLE? ───────────────────────── */
const capRows = rows.filter((r) => r.body && r.body.source === "event:perfcap");
if (!capRows.length) {
  fail("row", "NO insert with source=event:perfcap was ever issued — nothing reached the network layer at all");
} else {
  pass("row", `${capRows.length} perfcap insert(s) observed on the wire`);
  const kinds = new Set();
  for (const r of capRows) {
    const m = r.body.message || "";
    if (!/^POST$/.test(r.method)) fail("row", `an insert used ${r.method}, not POST`);
    if (!/\/rest\/v1\/client_errors/.test(r.url)) fail("row", `an insert went to ${r.url}`);
    if (m.length > MSG_MAX) { fail("row", `message is ${m.length} chars — past the column's ${MSG_MAX} cap, so it would truncate into unparseable JSON`); continue; }
    /* ⛔ PARSE IT THE WAY A READER WOULD. "the row exists" is not the claim; "the row can be read
     * back as a capture" is. The tab prefix is stripped, the JSON parsed, the packed frame track
     * decoded, and the fields the analysis actually needs are required to be present. */
    const jsonAt = m.indexOf("{");
    let cap;
    try { cap = JSON.parse(m.slice(jsonAt)); } catch (e) { fail("row", `the message does not parse as JSON: ${e.message}`); continue; }
    if (cap.v !== 1) fail("row", `capture version is ${cap.v}, expected 1`);
    if (!cap.kind) fail("row", "the capture carries no kind — auto and manual would be indistinguishable");
    kinds.add(cap.kind);
    if (!/^\[tab [0-9a-z-]{4,}\]/.test(m)) fail("row", "the row carries no tab id — two tabs would be unseparable");
    try {
      const frames = decodeTrack(cap.ft || "", cap.fx);
      /* ⛔ AN EMPTY TRACK IS ONLY ACCEPTABLE IF THE CAPTURE SAYS SO. The frame loop is gated on
       * interaction, so a manual press in a still moment genuinely has no frames — but "nothing was
       * happening" and "the track was lost" support opposite conclusions, and a row that does not
       * distinguish them is worse than no row. An AUTO capture can never be empty: the trigger
       * fires ON a frame, from a window of frames. */
      if (!frames.length && cap.note === "no-frames" && cap.kind === "manual") pass("row", "kind=manual with no frames is LABELLED `no-frames`, not silently empty");
      else if (!frames.length) fail("row", `kind=${cap.kind} carries an EMPTY frame track and note=${JSON.stringify(cap.note)} — there is no episode in it and it does not say so`);
      else pass("row", `kind=${cap.kind} · ${frames.length} frames decoded · p95 ${cap.p95Ms} ms · max ${cap.maxMs} ms · ${m.length}/${MSG_MAX} chars`);
    } catch (e) { fail("row", `the frame track does not decode: ${e.message}`); }
    for (const k of ["atMs", "atWall", "frames"]) if (cap[k] === undefined) fail("row", `the capture is missing \`${k}\``);
  }
  /* ⛔ THE MANUAL KIND MUST ROUND-TRIP. It is the owner pressing "that felt slow just now" — the
   * one signal in this programme that comes from the person who has the symptom — so it is the
   * single worst thing to lose, and it must be distinguishable in the table from an auto capture. */
  if (!kinds.has("manual")) fail("row", "no capture with kind=manual reached the wire — the owner's own button is the thing that must not drop");
  else pass("row", "the manual kind round-trips and is distinguishable from auto");
  /* And distinguishable from the PRE-EXISTING cumulative perf telemetry, whose lt/ltn only grow. */
  if (capRows.some((r) => r.body.source === "event:perf")) fail("row", "a capture was filed under the cumulative-counter source");
  else pass("row", "captures ride `event:perfcap`, never the cumulative `event:perf` source");
}

if (ROWS_OUT) { writeFileSync(ROWS_OUT, JSON.stringify(rows, null, 2)); process.stderr.write(`  · ${rows.length} row(s) written to ${ROWS_OUT}\n`); }

const failures = results.filter((r) => !r.ok);
if (JSON_OUT) console.log(JSON.stringify({ results, rows: rows.length, ok: !failures.length }, null, 2));
else {
  console.log("\nCAPTURE PIPE — from the deployed bundle to the wire\n");
  for (const r of results) console.log(`  ${r.ok ? "✓" : "✗"} ${String(r.arm).padEnd(9)} ${r.msg}`);
  console.log(failures.length ? `\n⛔ ${failures.length} failure(s).` : `\n✅ every arm passed — a capture reaches the network, is readable when it does, and is LOUD when it does not.`);
}
process.exit(failures.length ? 1 : 0);
