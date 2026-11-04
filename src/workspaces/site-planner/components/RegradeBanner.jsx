/* RegradeBanner — NEW-1 (owner 2026-11-04): a small dark pill, centred at the bottom of the map, that reads "Regrading…" with a thin
 * progress bar under it while the owner-only grading layer rebuilds. Chosen by the owner from three mockups (a sweep across the land,
 * tiles filling in, a banner): "don't change anything on the map, just do a banner centered at the bottom." So it draws NOTHING over
 * the land — no dimming, no sweep — and takes no presses (`pointer-events: none` on every layer of it). The old picture stays until
 * the new one is ready, exactly as before.
 *
 * WHEN: the pure machine in lib/regradeProgress.js — never for a rebuild under SHOW_AFTER_MS, then at least MIN_VISIBLE_MS, then a
 * fade. THE BAR: real work only (the chunked generators' own column fractions; an indeterminate step slides a short bar; never a
 * timer). COST: no rAF and no interval of its own; the store hands it a progress tick at most every PROGRESS_THROTTLE_MS and this
 * leaf is the only thing that re-renders; the fill moves by a CSS transform transition. Mounted by SitePlanner ONLY while the
 * grading gate is on (gradingGate.js), so with grading off — every other account — it does not exist.
 * Guard: repo-root `test/` **regradeBanner**; ui-audit **verify-regrade-banner**. */
import React, { useEffect, useState } from "react";
import * as regrade from "../lib/regradeProgress.js";
import { RADIUS } from "../../../shared/ui/radius.js";
import { FONT_SIZE, SPACE } from "../../../shared/ui/designTokens.js";
import { MAP_CHROME_Z } from "../lib/mapChromeStack.js";

const OFF = { phase: "idle", frac: 0, indeterminate: false };

/* The machine, driven by the store (regrade.createBannerDriver owns the rules; this is only the React seam). */
export function useRegradeBanner() {
  const [view, setView] = useState(OFF);
  useEffect(() => {
    const d = regrade.createBannerDriver({ onView: setView });
    return () => d.stop();
  }, []);
  return view;
}

export default function RegradeBanner({ left = 0, bottom = 52 }) {
  const v = useRegradeBanner();
  if (v.phase !== "shown" && v.phase !== "leaving") return null;
  const leaving = v.phase === "leaving";
  return (
    <div data-export="skip" data-testid="regrade-banner" data-phase={v.phase} data-regrade-frac={v.frac.toFixed(3)} data-regrade-indeterminate={v.indeterminate ? "1" : "0"}
      role="status" aria-live="polite"
      style={{ position: "absolute", left, right: 0, bottom, display: "flex", justifyContent: "center", pointerEvents: "none", zIndex: MAP_CHROME_Z.furniture }}>
      <div style={{
        pointerEvents: "none", display: "flex", flexDirection: "column", alignItems: "stretch", gap: SPACE.sm, minWidth: 132,
        padding: `${SPACE.md}px ${SPACE.xl}px`, borderRadius: RADIUS.lg, boxSizing: "border-box",
        background: "rgba(17, 19, 25, 0.88)", color: "#fff", boxShadow: "0 4px 16px rgba(0, 0, 0, 0.28)",
        fontSize: FONT_SIZE.control, fontWeight: 600, lineHeight: 1.2, textAlign: "center", whiteSpace: "nowrap",
        opacity: leaving ? 0 : 1, transition: `opacity ${regrade.FADE_MS}ms ease`,
      }}>
        <span>Regrading…</span>
        <div style={{ position: "relative", height: 3, borderRadius: RADIUS.pill, background: "rgba(255, 255, 255, 0.22)", overflow: "hidden" }}>
          {v.indeterminate ? (
            <div className="regrade-indeterminate" data-testid="regrade-bar" style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: "40%", borderRadius: RADIUS.pill, background: "#fff", animation: "regrade-slide 1.1s ease-in-out infinite" }} />
          ) : (
            <div data-testid="regrade-bar" style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: "100%", borderRadius: RADIUS.pill, background: "#fff", transformOrigin: "left center", transform: `scaleX(${v.frac})`, transition: "transform 120ms linear" }} />
          )}
        </div>
      </div>
    </div>
  );
}
