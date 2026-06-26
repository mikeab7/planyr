/* CloudSyncBadge — the compact, app-wide cloud-sync indicator (NEW-1).
 *
 * A small cloud glyph (NO "Saved" text label) that lives in AppHeader Row 1 and rides
 * with every workspace. It reports the REAL save/sync state — it is driven by the
 * normalized `saveState` the workspace already computes, never an optimistic "always
 * green". The whole point is the crash-severity guardrail: a failed cloud write must be
 * LOUD and visually distinct, and the indicator must NEVER silently vanish (returning
 * null on an exception is exactly how the old one disappeared) — so a render crash here
 * falls back to the loud error glyph, not to nothing.
 *
 * States (each visually distinct, not text-dependent):
 *   synced   → quiet green cloud + check    (the resting default — low emphasis)
 *   saving   → amber cloud + up-arrow, pulsing (in-flight, transient)
 *   offline  → amber cloud + pause          (saved on this device, will sync when back)
 *   readonly → amber cloud + lock           (another tab is the active editor — NOT syncing here; B465/NEW-2)
 *   error    → LOUD red cloud + slash + ring (a write FAILED / conflict) — click for detail + retry
 *   local    → muted "device" glyph         (signed out — saved on this device only)
 *   null/—   → nothing                       (no project/doc loaded; NOT an error)
 *
 * Colors are theme tokens (B341) so the glyph stays legible when the chrome flips
 * light/dark; hierarchy comes from color + weight + the pulse, never from fading.
 */
import { Component, useEffect, useRef, useState } from "react";

// state → presentation. Pure + exported so the truth-table is unit-locked: a future
// edit can't silently let a failed save read the same as "all good" (cloudSyncBadge.test.js).
//   loud       — draws the eye (red + ring): reserved for a real failure.
//   actionable — clicking opens a detail popover (what happened + Retry); the rest just hover-tip.
export function cloudBadgeView(state) {
  switch (state) {
    case "saving":
      return { variant: "cloud-up", color: "var(--warn-text)", pulse: true, loud: false, actionable: false,
        title: "Syncing…", tip: "Saving your changes to the cloud…" };
    case "offline":
      return { variant: "cloud-pause", color: "var(--warn-text)", pulse: false, loud: false, actionable: true,
        title: "Saved on this device", tip: "Saved on this device — the cloud is unreachable. Your work will sync the next time you make a change or close this tab." };
    case "readonly":
      // B465/NEW-2 — NOT green. Another tab of this browser is the active editor, so this tab is
      // read-only and is NOT saving to the cloud. Amber + a lock glyph + an actionable popover that
      // explains why and what to do. (The banner in the workspace carries the loud Take-over action.)
      return { variant: "cloud-lock", color: "var(--warn-text)", pulse: false, loud: false, actionable: true,
        title: "Read-only — not saving", tip: "This plan is open in another tab, which is the active editor. Your changes here are kept on this device but won't sync to the cloud until you take over editing here (use the banner) or close the other tab." };
    case "error":
      return { variant: "cloud-slash", color: "var(--danger)", pulse: false, loud: true, actionable: true,
        title: "Sync problem", tip: "Your last change couldn't be saved to the cloud. It's safe on this device and will retry." };
    case "local":
      return { variant: "device", color: "var(--chrome-muted)", pulse: false, loud: false, actionable: false,
        title: "Saved on this device", tip: "Saved on this device. Sign in to sync across your devices." };
    case "synced":
      return { variant: "cloud-check", color: "var(--save-badge)", pulse: false, loud: false, actionable: false,
        title: "Synced", tip: "Saved and synced to the cloud." };
    default:
      return null; // null / undefined / unknown → nothing to show (no project context). NOT a hidden error.
  }
}

// The cloud (and "device") glyphs — shared visual language with the doc-review save
// chip so a cloud means the same thing everywhere. 24×24 viewBox, stroke = currentColor.
const CLOUD = "M7 17.5h9.5a3.5 3.5 0 0 0 .4-7A5 5 0 0 0 7.6 8.6 4 4 0 0 0 7 17.5Z";
function CloudGlyph({ variant, size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none", display: "block" }}>
      {variant === "device" ? (
        <><rect x="3" y="4.5" width="18" height="12" rx="2" /><path d="M8.5 20h7M12 16.5V20" /></>
      ) : (
        <>
          <path d={CLOUD} />
          {variant === "cloud-check" && <path d="M9.4 12.6l1.9 1.9 3.4-3.6" strokeWidth="1.8" />}
          {variant === "cloud-up"    && <path d="M12 15.5v-4.2M10.1 12.7L12 10.7l1.9 2" strokeWidth="1.8" />}
          {variant === "cloud-pause" && <path d="M10.6 11.4v3.4M13.4 11.4v3.4" strokeWidth="1.8" />}
          {variant === "cloud-lock"  && <path d="M9.9 12.6h4.2v3.1H9.9zM10.8 12.6v-1.1a1.2 1.2 0 0 1 2.4 0v1.1" strokeWidth="1.5" />}
          {variant === "cloud-slash" && <path d="M5.2 5.2l13.6 13.6" strokeWidth="2" />}
        </>
      )}
    </svg>
  );
}

const popPanel = {
  position: "absolute", right: 0, top: "calc(100% + 7px)", zIndex: 70, width: 248,
  padding: "11px 13px", borderRadius: 10, background: "var(--surface-raised)", color: "var(--text-primary)",
  border: "1px solid var(--border-default)", boxShadow: "0 12px 30px rgba(0,0,0,0.28)",
  fontFamily: "system-ui, sans-serif", textAlign: "left",
};

function Badge({ state, onRetry, detail }) {
  const [open, setOpen] = useState(false);
  const v = cloudBadgeView(state);
  // Close the popover whenever the state stops being a problem (e.g. a retry succeeds).
  useEffect(() => { if (!v || !v.actionable) setOpen(false); }, [v && v.actionable]);
  if (!v) return null; // no project/doc context → show nothing (legitimately empty, not an error)

  const tip = detail || v.tip;
  const canPop = v.actionable; // error / offline → click reveals what happened + a retry
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
      <button
        type="button"
        onClick={canPop ? () => setOpen((o) => !o) : undefined}
        title={tip}
        aria-label={`Cloud sync: ${v.title}`}
        aria-haspopup={canPop ? "dialog" : undefined}
        aria-expanded={canPop ? open : undefined}
        style={{
          display: "grid", placeItems: "center", width: 26, height: 24, borderRadius: 7, flex: "none",
          background: "transparent", color: v.color, cursor: canPop ? "pointer" : "default",
          // The loud failure state gets a hairline ring in its own color so it pops out of the
          // quiet chrome at a glance — the rest carry no border.
          border: v.loud ? "1px solid var(--danger)" : "1px solid transparent",
          padding: 0, animation: v.pulse ? "pf-pulse 1.1s ease-in-out infinite" : "none",
        }}
      >
        <CloudGlyph variant={v.variant} />
      </button>
      {canPop && open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 69 }} />
          <div role="dialog" style={popPanel}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
              <span style={{ color: v.color, display: "grid", placeItems: "center" }}><CloudGlyph variant={v.variant} size={16} /></span>
              <span style={{ fontWeight: 800, fontSize: 13 }}>{v.title}</span>
            </div>
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: "var(--text-secondary)" }}>{tip}</p>
            {onRetry && v.loud && (
              <button
                type="button"
                onClick={() => { setOpen(false); onRetry(); }}
                style={{
                  marginTop: 10, width: "100%", padding: "6px 11px", borderRadius: 7, cursor: "pointer",
                  fontFamily: "inherit", fontSize: 12, fontWeight: 700, border: "none",
                  background: "var(--accent)", color: "var(--on-accent)",
                }}
              >
                Retry now
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// The guardrail in code: if the badge ever throws while rendering, show the LOUD error
// glyph rather than vanishing (returning null on an exception is how the old indicator
// silently disappeared). Error boundaries must be class components in React. Exported so
// the headless harness can prove the fallback renders the loud glyph (never blank).
export class CloudBadgeBoundary extends Component {
  constructor(props) { super(props); this.state = { crashed: false }; }
  static getDerivedStateFromError() { return { crashed: true }; }
  componentDidCatch() { /* swallow — the visible fallback below IS the report */ }
  render() {
    if (this.state.crashed) {
      return (
        <span role="img" aria-label="Cloud sync: status unavailable"
          title="Sync status couldn't be read — your latest work is saved on this device."
          style={{ display: "grid", placeItems: "center", width: 26, height: 24, borderRadius: 7,
            color: "var(--danger)", border: "1px solid var(--danger)" }}>
          <CloudGlyph variant="cloud-slash" />
        </span>
      );
    }
    return this.props.children;
  }
}

export default function CloudSyncBadge({ state, onRetry, detail }) {
  // Key the boundary on the state so a CHANGE remounts it — a transient render crash
  // clears once the inputs change instead of wedging the badge blank forever. This also
  // makes the badge survive module/project switches cleanly: it always reflects the live
  // state it's handed, never a stale cached one.
  return (
    <CloudBadgeBoundary key={String(state ?? "none")}>
      <Badge state={state} onRetry={onRetry} detail={detail} />
    </CloudBadgeBoundary>
  );
}
