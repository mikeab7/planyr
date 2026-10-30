/* Model workspace — what the screen shows while an Alt key-tip sequence is open (Excel's "press Alt,
 * then letters"). Two things, both pointer-less so a click still reaches whatever is underneath (and
 * cancels the sequence — ModelApp listens for it):
 *   1. a small black badge on every ribbon control that carries `data-keytip="<path>"` and is still
 *      reachable from the keys typed so far, showing the letters that remain (Excel shows the next
 *      step; here the control's remaining path — "AL" for Align left after Alt H);
 *   2. a strip along the bottom listing the choices at this level ("I  Autofit column width …") —
 *      the part of Excel's Format menu this ribbon has no button for, so every path in lib/keyTips.js
 *      is discoverable, not only the ones that happen to have a control.
 * Badge positions are read from the live DOM (getBoundingClientRect) in a layout effect, so they sit
 * on the real control at any width, and a control folded into the More menu simply has no badge.
 */
import { useLayoutEffect, useState } from "react";
import { choicesAt } from "../lib/keyTips.js";
import { RADIUS } from "../../../shared/ui/radius.js";

export default function KeyTipOverlay({ state }) {
  const [badges, setBadges] = useState([]);
  const path = state.path;
  useLayoutEffect(() => {
    if (!state.active) { setBadges([]); return undefined; }
    const measure = () => {
      const out = [];
      document.querySelectorAll("[data-keytip]").forEach((el) => {
        const tip = (el.getAttribute("data-keytip") || "").toUpperCase();
        if (!tip.startsWith(path) || tip.length === path.length) return;
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) return;
        out.push({ key: tip + out.length, text: tip.slice(path.length), x: b.left + b.width / 2, y: b.bottom - 2 });
      });
      setBadges(out);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [state.active, path]);
  if (!state.active) return null;
  const choices = choicesAt(path);
  return (
    <>
      {badges.map((b) => (
        <span
          key={b.key} aria-hidden="true" data-testid="model-keytip-badge"
          style={{
            position: "fixed", left: b.x, top: b.y, transform: "translateX(-50%)", zIndex: 70, pointerEvents: "none",
            padding: "0 4px", borderRadius: RADIUS.sm, background: "var(--text-primary)", color: "var(--surface-page)",
            fontWeight: 700, fontSize: "0.8em", lineHeight: "16px", whiteSpace: "nowrap", // design-exempt: a badge is smaller than its control's own type — relative, not a type-scale step
          }}
        >{b.text}</span>
      ))}
      <div
        role="status" data-testid="model-keytip-panel" aria-live="polite"
        style={{
          position: "fixed", left: "50%", bottom: 48, transform: "translateX(-50%)", zIndex: 70, pointerEvents: "none",
          maxWidth: "calc(100vw - 32px)", padding: "6px 10px", display: "flex", flexWrap: "wrap", gap: "4px 14px",
          background: "var(--surface-raised)", color: "var(--text-primary)", border: "1px solid var(--border-strong)", borderRadius: RADIUS.md,
        }}
      >
        <strong>{["Alt", ...path.split("")].join(" › ")}</strong>
        {choices.length === 0 && <span>Press Esc to cancel</span>}
        {choices.map((c) => (
          <span key={c.key} style={{ whiteSpace: "nowrap" }}>
            <kbd style={{ fontWeight: 700, fontFamily: "inherit", padding: "0 4px", border: "1px solid var(--border-strong)", borderRadius: RADIUS.sm }}>{c.key}</kbd>{" "}
            {c.label}{c.leaf ? "" : " ›"}
          </span>
        ))}
      </div>
    </>
  );
}
