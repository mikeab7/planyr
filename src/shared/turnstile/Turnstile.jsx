/* Cloudflare Turnstile widget (B1160720, NEW-1) — a small, config-gated CAPTCHA control.
 *
 * Loads Cloudflare's script lazily and only once (module-scope cached promise, the same
 * shape every lazy-import cache in this repo uses — e.g. terrainLazy.js's loadTerrain()),
 * so a page that never renders a signup form never fetches it. Three honest states while
 * mounted, reported via `onStateChange` so the caller (AuthPanel) can gate its own Submit
 * button rather than guessing from the token alone: "loading" (script/widget not ready
 * yet — the form must still render, just with Submit disabled) · "ready" (widget painted,
 * waiting on the user) · "error" (script failed to load or Cloudflare rejected the render —
 * Submit stays disabled with an explicit message, never a silent dead end).
 *
 * Turnstile tokens are single-use and expire in a few minutes, so this exposes an
 * imperative `reset()` (via ref) that BOTH the expired-callback and a failed submit call —
 * a stale token must never be resubmitted, and the widget must never be left showing a
 * green check for a token the server already rejected. */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { TURNSTILE_SITE_KEY } from "./turnstileConfig.js";

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptPromise = null;

function loadTurnstileScript() {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src^="${SCRIPT_SRC.split("?")[0]}"]`);
    const done = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile script loaded but window.turnstile is missing")));
    if (existing) { existing.addEventListener("load", done); existing.addEventListener("error", () => reject(new Error("Turnstile script failed to load"))); return; }
    const s = document.createElement("script");
    s.src = SCRIPT_SRC; s.async = true; s.defer = true;
    s.addEventListener("load", done);
    s.addEventListener("error", () => reject(new Error("Turnstile script failed to load")));
    document.head.appendChild(s);
  }).catch((e) => { scriptPromise = null; throw e; }); // a failed load isn't cached — a later retry (e.g. reopening the modal) tries again
  return scriptPromise;
}

const Turnstile = forwardRef(function Turnstile({ onToken, onStateChange }, ref) {
  const hostRef = useRef(null);
  const widgetIdRef = useRef(null);
  const [state, setState] = useState("loading"); // loading | ready | error

  const report = (s) => { setState(s); onStateChange && onStateChange(s); };

  useImperativeHandle(ref, () => ({
    reset() {
      try { widgetIdRef.current != null && window.turnstile && window.turnstile.reset(widgetIdRef.current); } catch (_) {}
    },
  }), []);

  useEffect(() => {
    let cancelled = false;
    loadTurnstileScript()
      .then((turnstile) => {
        if (cancelled || !hostRef.current) return;
        widgetIdRef.current = turnstile.render(hostRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          callback: (token) => onToken && onToken(token),
          "expired-callback": () => { onToken && onToken(""); report("ready"); }, // token gone; widget re-arms itself
          "error-callback": () => { onToken && onToken(""); report("error"); },
        });
        report("ready");
      })
      .catch(() => { if (!cancelled) report("error"); });
    return () => {
      cancelled = true;
      try { widgetIdRef.current != null && window.turnstile && window.turnstile.remove(widgetIdRef.current); } catch (_) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={hostRef} data-testid="turnstile-widget" data-turnstile-state={state} />;
});

export default Turnstile;
