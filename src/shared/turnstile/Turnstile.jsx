/* Cloudflare Turnstile widget (B1160720; shared by Sign in / Sign up / Forgot password — NEW-1).
 *
 * ONE widget component for every auth mode. It loads Cloudflare's script lazily and only once
 * (module-scope cached promise, the same shape every lazy-import cache in this repo uses), so a
 * page that never opens the auth panel never fetches it. It only REPORTS — the submit rules
 * (wait for a token, single-use, timeout, retry) live in the pure `captchaGate.js`:
 *   onToken(token)     a token arrived; "" = it was cleared (expired / reset / unmounted)
 *   onStateChange(s)   "loading" | "ready" | "interactive" (a visible challenge is up) | "error"
 *   onTimeout()        Cloudflare gave up on an interactive challenge
 * `appearance`: "always" (sign-up keeps its visible box) or "interaction-only" (sign-in / reset stay
 * invisible unless Cloudflare needs the person). Changing it re-renders the widget cleanly: the old
 * one is removed, its token cleared. Expired tokens are refreshed by Turnstile itself
 * (`refresh-expired: auto`); the callbacks are read through refs so a re-render never leaves the
 * widget holding a stale handler. A blocked / hanging script ends in "error" after SCRIPT_WAIT_MS,
 * never an endless "loading".
 * Tokens are single-use: `reset()` (via ref) asks Cloudflare for a fresh one. */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { TURNSTILE_SITE_KEY } from "./turnstileConfig.js";

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptPromise = null;
export const SCRIPT_WAIT_MS = 10000;

function loadTurnstileScript() {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  const base = SCRIPT_SRC.split("?")[0];
  scriptPromise = new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, v) => { if (settled) return; settled = true; clearTimeout(slow); fn(v); };
    const slow = setTimeout(() => finish(reject, new Error("Turnstile script timed out")), SCRIPT_WAIT_MS);
    const done = () => (window.turnstile ? finish(resolve, window.turnstile) : finish(reject, new Error("Turnstile script loaded but window.turnstile is missing")));
    const failed = () => finish(reject, new Error("Turnstile script failed to load"));
    let s = document.querySelector(`script[src^="${base}"]`);
    if (!s) {
      s = document.createElement("script");
      s.src = SCRIPT_SRC; s.async = true; s.defer = true;
      document.head.appendChild(s);
    }
    s.addEventListener("load", done);
    s.addEventListener("error", failed);
  }).catch((e) => {
    // A failed load isn't cached, and its dead <script> tag is removed so "Try again" really re-fetches.
    scriptPromise = null;
    document.querySelectorAll(`script[src^="${base}"]`).forEach((n) => n.remove());
    throw e;
  });
  return scriptPromise;
}

const Turnstile = forwardRef(function Turnstile({ onToken, onStateChange, onTimeout, appearance = "always" }, ref) {
  const hostRef = useRef(null);
  const widgetIdRef = useRef(null);
  const cb = useRef({});
  cb.current = { onToken, onStateChange, onTimeout };
  const [state, setState] = useState("loading");

  const report = (s) => { setState(s); cb.current.onStateChange && cb.current.onStateChange(s); };

  useImperativeHandle(ref, () => ({
    reset() {
      try { widgetIdRef.current != null && window.turnstile && window.turnstile.reset(widgetIdRef.current); } catch (_) {}
    },
  }), []);

  useEffect(() => {
    let cancelled = false;
    report("loading");
    cb.current.onToken && cb.current.onToken("");
    loadTurnstileScript()
      .then((turnstile) => {
        if (cancelled || !hostRef.current) return;
        widgetIdRef.current = turnstile.render(hostRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          appearance,
          "refresh-expired": "auto",
          callback: (token) => { cb.current.onToken && cb.current.onToken(token); report("ready"); },
          "expired-callback": () => { cb.current.onToken && cb.current.onToken(""); }, // Turnstile refreshes it itself
          "error-callback": () => { cb.current.onToken && cb.current.onToken(""); report("error"); },
          "timeout-callback": () => { cb.current.onToken && cb.current.onToken(""); cb.current.onTimeout && cb.current.onTimeout(); },
          "before-interactive-callback": () => report("interactive"),
          "after-interactive-callback": () => report("ready"),
        });
        report("ready");
      })
      .catch(() => { if (!cancelled) report("error"); });
    return () => {
      cancelled = true;
      try { widgetIdRef.current != null && window.turnstile && window.turnstile.remove(widgetIdRef.current); } catch (_) {}
      widgetIdRef.current = null;
      cb.current.onToken && cb.current.onToken("");
    };
  }, [appearance]);

  return <div ref={hostRef} data-testid="turnstile-widget" data-turnstile-state={state} data-turnstile-appearance={appearance} />;
});

export default Turnstile;
