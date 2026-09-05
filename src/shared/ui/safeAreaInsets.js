/* safeAreaInsets.js — B1176480: read the real iOS/Android safe-area-inset-* values (the
 * unsafe strip around a notch/dynamic island/home-indicator, set via `env()` — a CSS-only
 * primitive) as NUMBERS, for a caller that needs to feed them into pixel math in JS.
 *
 * Every other safe-area consumer in this app (Food's `BottomSheet.jsx`, the site-planner phone
 * FABs, B1168128) writes `env(safe-area-inset-bottom)` straight into a CSS string and never
 * needs the number in JS — that's the right, simpler answer when the offset is a fixed literal.
 * `HelpReportControl.jsx` can't do that: its offset is DYNAMIC (`cornerClearanceFromBottom`
 * measures real DOM occupants — Leaflet's controls, the Site Planner's own narrow-width FAB
 * stack — and picks whichever needs the most clearance), and that occupant-overlap check does
 * its own math in JS against `window.innerWidth`. A CSS-only `calc()` would position the button
 * correctly but leave the OVERLAP math blind to the inset — in landscape, where
 * `safe-area-inset-right` is genuinely non-zero (the notch/dynamic island sits on a side edge
 * once rotated), the column the button occupies would be computed as if it were flush against
 * the true edge when it is actually shifted in by the inset, which is exactly the kind of
 * "measure the real thing, don't assume" bug B1167120 fixed for the constant-292px case. So the
 * inset has to reach JS as a number, not stay CSS-only.
 *
 * The standard trick: a hidden, non-interactive probe element whose padding is set from `env()`,
 * then read back via `getComputedStyle` — `env()` has no JS-readable form of its own. Every value
 * defaults to 0 wherever `env()` is unsupported or resolves to nothing (desktop browsers, and —
 * per this repo's own standing WebKit-gap note in VERIFICATION.md — every headless-Chromium
 * check run in this sandbox, which has no notch to inset around and reports 0 exactly like an
 * unsupported browser would).
 */

let cachedDoc = null;
let probeEl = null;

function getProbe() {
  if (typeof document === "undefined") return null;
  if (probeEl && cachedDoc === document) return probeEl;
  try {
    const el = document.createElement("div");
    el.setAttribute("data-safe-area-probe", "");
    el.style.position = "fixed";
    el.style.top = "0";
    el.style.left = "0";
    el.style.width = "0";
    el.style.height = "0";
    el.style.pointerEvents = "none";
    el.style.visibility = "hidden";
    el.style.paddingTop = "env(safe-area-inset-top, 0px)";
    el.style.paddingRight = "env(safe-area-inset-right, 0px)";
    el.style.paddingBottom = "env(safe-area-inset-bottom, 0px)";
    el.style.paddingLeft = "env(safe-area-inset-left, 0px)";
    (document.body || document.documentElement).appendChild(el);
    probeEl = el;
    cachedDoc = document;
    return el;
  } catch (_) {
    return null;
  }
}

/** Returns { top, right, bottom, left } in CSS px, all defaulting to 0. Never throws. */
export function safeAreaInsets() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  try {
    const el = getProbe();
    if (!el) return { top: 0, right: 0, bottom: 0, left: 0 };
    const cs = window.getComputedStyle(el);
    return {
      top: parseFloat(cs.paddingTop) || 0,
      right: parseFloat(cs.paddingRight) || 0,
      bottom: parseFloat(cs.paddingBottom) || 0,
      left: parseFloat(cs.paddingLeft) || 0,
    };
  } catch (_) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
}
