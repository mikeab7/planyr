/* Sequence Planyr workspace — launches the scheduler app at /sequence/ */
import { useEffect } from "react";

const PAL = { bg: "#efeadf", chrome: "#14110e", ink: "#2c2a26", muted: "#8a8473", ember: "#e8590c", line: "#e7e2d6" };

export default function Scheduler({ shellModule, onShellSwitch, authControl } = {}) {
  useEffect(() => {
    window.location.href = "/sequence/";
  }, []);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, background: PAL.bg, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, background: `linear-gradient(150deg, ${PAL.ember}, #c2410c)`, display: "grid", placeItems: "center" }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="3" y="6" width="18" height="15" rx="2" stroke="#fff" strokeWidth="1.7" />
          <path d="M3 10h18" stroke="#fff" strokeWidth="1.5" />
          <rect x="8" y="3" width="2" height="4" rx="1" fill="#fff" />
          <rect x="14" y="3" width="2" height="4" rx="1" fill="#fff" />
          <rect x="7" y="13" width="3" height="2" rx="0.6" fill="#fff" opacity="0.7" />
          <rect x="11" y="13" width="3" height="2" rx="0.6" fill="#fff" opacity="0.7" />
          <rect x="7" y="16.5" width="3" height="2" rx="0.6" fill="#fff" opacity="0.5" />
        </svg>
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontWeight: 800, fontSize: 17, color: PAL.ink, letterSpacing: "-0.01em" }}>Sequence Planyr</div>
        <div style={{ fontSize: 13, color: PAL.muted, marginTop: 5 }}>Launching…</div>
      </div>
    </div>
  );
}
