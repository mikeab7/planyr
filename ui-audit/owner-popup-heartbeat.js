/* owner-popup-heartbeat — measure a COLD LOAD of planyr.io on the real signed-in account, from the very first script (B2236000 round 6).
 *
 * WHY THIS SHAPE (the owner's method, 2026-10-09, proven on his Chrome). planyr.io sends `frame-ancestors 'none'` + `X-Frame-Options: DENY`, so it
 * cannot be framed — but it sends NO `Cross-Origin-Opener-Policy`. A page that `window.open`s the app WITHOUT `noopener` therefore shares ONE
 * event loop with it: a MessageChannel heartbeat running in the OPENER sees every main-thread gap of the popup, including the ones before any app
 * script could install its own heartbeat (the in-page rig's view starts at the first script too, but cannot run on his real account and data).
 * A reload is `popup.location.href = <same URL, cache-busted>`; the opener's heartbeat survives it.
 *
 * HOW (paste into the DevTools console of https://planyr.io/version.json — same origin as the app, so `popup.eval` works):
 *   1. paste this file; a "Launch Planyr" button appears — CLICK it (a trusted click, so the popup is allowed). Default size 1183×569.
 *   2. `await perf.selfTest()`   → the known-good arm: a 200 ms busy loop run INSIDE the popup must read ≈ 200 ms here, else nothing is trusted.
 *   3. `await perf.reload()`     → a cold load of the same route; resolves 15 s later with { navAt, gaps: [[msAfterNav, gapMs], …] } (gaps > 50 ms).
 *      Repeat 3 a few times. `perf.route = "#/project/<id>/site"` picks the plan (default: whatever the popup currently shows).
 *   4. `perf.switchMark()` just before clicking a plan in the popup, then `await perf.window(6000)` → gaps after that moment (a switch).
 * Every result is also kept on `perf.runs`. FOREGROUND-OR-VOID still applies to the POPUP's drawing, not to this heartbeat: the gaps are
 * main-thread time, which a MessageChannel measures in a hidden tab too (that is why it, and not rAF, is the clock). */
(() => {
  const BASE = "https://planyr.io/";
  const gaps = []; let last = performance.now();
  const ch = new MessageChannel();
  ch.port1.onmessage = () => { const t = performance.now(), g = t - last; if (g > 30) gaps.push([t - g, g]); last = t; ch.port2.postMessage(0); };
  ch.port2.postMessage(0);
  const sleep = (ms) => new Promise((r) => { const t0 = performance.now(); const tick = () => (performance.now() - t0 >= ms ? r() : setTimeout(tick, 50)); tick(); });
  const since = (t0, ms) => gaps.filter(([s, g]) => s >= t0 - 2 && s <= t0 + ms && g > 50).map(([s, g]) => [Math.round(s - t0), Math.round(g)]);
  const perf = {
    popup: null, route: "", runs: [], gaps,
    launch(w = 1183, h = 569) { this.popup = window.open(BASE + (this.route || ""), "planyrPerf", `width=${w},height=${h}`); return this.popup; },
    async selfTest() { if (!this.popup) throw new Error("launch first"); const t0 = performance.now(); this.popup.eval("(()=>{const t=performance.now();while(performance.now()-t<200);})()"); await sleep(400); const g = Math.max(0, ...since(t0, 400).map((x) => x[1])); const ok = g >= 150; console.log(`[perf] known-good arm: ${g} ms ${ok ? "OK" : "— VOID: the heartbeat cannot see the popup"}`); return { ok, gapMs: g }; },
    async reload(windowMs = 15000) {
      if (!this.popup) throw new Error("launch first");
      const route = this.route || (() => { try { return this.popup.location.hash; } catch (_) { return ""; } })();
      const navAt = performance.now();
      this.popup.location.href = `${BASE}?cb=${Date.now()}${route}`;
      await sleep(windowMs);
      const r = { kind: "reload", route, navAt: Math.round(navAt), gaps: since(navAt, windowMs) };
      r.sumOver50 = r.gaps.reduce((s, g) => s + g[1], 0); r.worst = Math.max(0, ...r.gaps.map((g) => g[1]));
      this.runs.push(r); console.log(`[perf] reload ${route}: worst ${r.worst} ms, sum ${r.sumOver50} ms — ` + r.gaps.map((g) => g.join(":")).join(", ")); return r;
    },
    switchMark() { this._mark = performance.now(); },
    async window(ms = 6000) { const t0 = this._mark || performance.now(); await sleep(Math.max(0, t0 + ms - performance.now())); const r = { kind: "window", gaps: since(t0, ms) }; this.runs.push(r); console.log("[perf] gaps:", JSON.stringify(r.gaps)); return r; },
  };
  window.perf = perf;
  const b = document.createElement("button");
  b.textContent = "Launch Planyr"; b.style.cssText = "position:fixed;top:12px;left:12px;z-index:9;padding:8px 14px;font:14px system-ui";
  b.onclick = () => perf.launch();
  document.body.appendChild(b);
  console.log("[perf] ready — click 'Launch Planyr', then: await perf.selfTest(); await perf.reload()");
})();
