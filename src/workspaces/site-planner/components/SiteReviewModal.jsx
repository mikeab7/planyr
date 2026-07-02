import { useState, useRef, useEffect } from "react";
import { pendingLegacySites, importOneSiteToCloud, discardLegacySite, isEmptySite } from "../lib/storage.js";

const F = "system-ui, -apple-system, sans-serif";

function formatDate(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// Returns { primary, secondary } labels for a site, prioritising the most specific info.
function siteLabel(s) {
  const addr = s.parcels && s.parcels[0] && s.parcels[0].addr;
  if (addr) return { primary: addr, secondary: s.site && s.site !== "Untitled site" ? s.site : null };
  if (s.site && s.site !== "Untitled site") return { primary: s.site, secondary: null };
  if (s.county) return { primary: `${s.county} County`, secondary: s.origin ? `${s.origin.lat.toFixed(4)}° N, ${Math.abs(s.origin.lon).toFixed(4)}° W` : null };
  if (s.origin) return { primary: `${s.origin.lat.toFixed(4)}° N, ${Math.abs(s.origin.lon).toFixed(4)}° W`, secondary: null };
  return null; // truly unidentifiable
}

function siteMeta(s) {
  const parcels = (s.parcels || []).length;
  const buildings = (s.els || []).filter(e => e && e.type === "building" && !e.dogEar && !e.attachedTo).length;
  const parts = [];
  if (parcels) parts.push(`${parcels} parcel${parcels !== 1 ? "s" : ""}`);
  if (buildings) parts.push(`${buildings} building${buildings !== 1 ? "s" : ""}`);
  return parts.join(" · ");
}

function nextUndecidedIdx(sites, fromIdx, decisions) {
  for (let i = fromIdx + 1; i < sites.length; i++) {
    const d = decisions[sites[i].id];
    if (!d || d === "failed") return i;
  }
  for (let i = 0; i < fromIdx; i++) {
    const d = decisions[sites[i].id];
    if (!d || d === "failed") return i;
  }
  return -1;
}

export function SiteReviewModal({ uid, onOpen, onClose }) {
  const [sites] = useState(() => pendingLegacySites(uid));
  const [decisions, setDecisions] = useState({});
  const [activeIdx, setActiveIdx] = useState(0);
  const decisionsRef = useRef(decisions);
  decisionsRef.current = decisions;

  const savedCount = Object.values(decisions).filter((v) => v === "saved").length;
  const decidedCount = Object.values(decisions).filter((v) => v === "saved" || v === "skipped" || v === "discarded").length;

  // B532: dismiss with Escape (the scrim-click already closes; the keyboard path was missing).
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(savedCount); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, savedCount]);

  const handleSave = async (id) => {
    setDecisions((d) => ({ ...d, [id]: "saving" }));
    const r = await importOneSiteToCloud(uid, id);
    const outcome = r?.ok ? "saved" : "failed";
    setDecisions((d) => {
      const updated = { ...d, [id]: outcome };
      decisionsRef.current = updated;
      return updated;
    });
    if (outcome === "saved") {
      const idx = sites.findIndex((s) => s.id === id);
      const next = nextUndecidedIdx(sites, idx, { ...decisionsRef.current, [id]: "saved" });
      if (next !== -1) setActiveIdx(next);
    }
  };

  const handleSkip = (id) => {
    const idx = sites.findIndex((s) => s.id === id);
    const updated = { ...decisionsRef.current, [id]: "skipped" };
    decisionsRef.current = updated;
    setDecisions(updated);
    const next = nextUndecidedIdx(sites, idx, updated);
    if (next !== -1) setActiveIdx(next);
  };

  const handleDiscard = (id) => {
    discardLegacySite(uid, id);
    const idx = sites.findIndex((s) => s.id === id);
    const updated = { ...decisionsRef.current, [id]: "discarded" };
    decisionsRef.current = updated;
    setDecisions(updated);
    const next = nextUndecidedIdx(sites, idx, updated);
    if (next !== -1) setActiveIdx(next);
  };

  const handleOpen = (id) => {
    onClose(savedCount); // close modal first
    onOpen(id);          // then navigate
  };

  if (!sites.length) return null;

  const progress = sites.length > 0 ? (decidedCount / sites.length) * 100 : 0;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 5000,
        background: "rgba(8,10,20,0.75)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16, fontFamily: F,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(savedCount); }}
    >
      <div role="dialog" aria-modal="true" aria-label="Review unsaved on-device sites" style={{
        background: "#181f35", color: "#e4ecff",
        border: "1px solid #273560", borderRadius: 14,
        width: "100%", maxWidth: 520,
        boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
        display: "flex", flexDirection: "column", maxHeight: "88vh",
      }}>

        {/* Header */}
        <div style={{
          padding: "15px 18px 13px",
          borderBottom: "1px solid #273560",
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, letterSpacing: "-0.01em" }}>
              Review on-device sites
            </div>
            <div style={{ fontSize: 11.5, color: "#8DA2C8", marginTop: 2 }}>
              {decidedCount} of {sites.length} decided
            </div>
          </div>
          <div style={{ width: 72, height: 3, background: "#273560", borderRadius: 2, overflow: "hidden" }}>
            <div style={{
              height: "100%", width: `${progress}%`,
              background: "#4f7df0", borderRadius: 2,
              transition: "width 0.25s ease",
            }} />
          </div>
          <button
            onClick={() => onClose(savedCount)}
            title="Close"
            style={{
              cursor: "pointer", background: "rgba(255,255,255,0.09)",
              color: "#b0c4e8", border: "none", borderRadius: 6,
              padding: "3px 10px", fontFamily: F, fontSize: 13, fontWeight: 700,
            }}
          >✕</button>
        </div>

        {/* Site list */}
        <div style={{ overflowY: "auto", flex: 1, padding: "10px 12px" }}>
          {sites.map((s, i) => {
            const isActive = i === activeIdx;
            const d = decisions[s.id];
            const isSaving = d === "saving";
            const isSaved  = d === "saved";
            const isSkipped = d === "skipped";
            const isDiscarded = d === "discarded";
            const isFailed = d === "failed";
            const isDone   = isSaved || isSkipped || isDiscarded;
            const needsRetry = isFailed && isActive;
            const empty = isEmptySite(s);

            const label = siteLabel(s);
            const meta = siteMeta(s);
            const planName = s.name && s.name !== s.site ? s.name : null;

            return (
              <div
                key={s.id}
                onClick={() => { if (!isSaving) setActiveIdx(i); }}
                style={{
                  marginBottom: 8, borderRadius: 10,
                  border: `1px solid ${isActive ? "#4f7df0" : "#273560"}`,
                  background: isActive ? "#1c2a4a" : isDone ? "#141a2b" : "#18203a",
                  cursor: isSaving ? "default" : "pointer",
                  opacity: isDone ? 0.72 : 1,
                  transition: "border-color 0.12s, background 0.12s",
                }}
              >
                {/* Row */}
                <div style={{ padding: "11px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                  {/* Step circle */}
                  <div style={{
                    width: 24, height: 24, borderRadius: "50%", flex: "none",
                    background: isSaved ? "#166534" : (isSkipped || isDiscarded) ? "#374151" : isFailed ? "#7c2d12" : isActive ? "#4f7df0" : "#273560",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, fontWeight: 800, color: "#fff",
                  }}>
                    {isSaved ? "✓" : (isSkipped || isDiscarded) ? "–" : isFailed ? "!" : i + 1}
                  </div>

                  {/* Name + meta */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {label ? (
                      <>
                        <div style={{
                          fontSize: 13, fontWeight: 700,
                          color: isDone ? "#5a7099" : "#e4ecff",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {label.primary}
                        </div>
                        <div style={{ fontSize: 11, color: "#8DA2C8", marginTop: 1, display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {label.secondary && <span>{label.secondary}</span>}
                          {meta && <span>{meta}</span>}
                          {planName && <span>{planName}</span>}
                          {s.updatedAt ? <span>Updated {formatDate(s.updatedAt)}</span> : <span>Never saved</span>}
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={{
                          fontSize: 13, fontWeight: 700,
                          color: isDone ? "#5a7099" : "#8a9ab8",
                          fontStyle: "italic",
                        }}>
                          {empty ? "Empty site (nothing was saved)" : "Untitled site"}
                        </div>
                        <div style={{ fontSize: 11, color: "#8DA2C8", marginTop: 1 }}>
                          {s.updatedAt ? `Created ${formatDate(s.updatedAt)}` : ""}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Status badge */}
                  {isSaved && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#4ade80", background: "rgba(74,222,128,0.12)", borderRadius: 5, padding: "2px 8px" }}>Saved</span>
                  )}
                  {isSkipped && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#9aa3b2", background: "rgba(107,114,128,0.13)", borderRadius: 5, padding: "2px 8px" }}>On device</span>
                  )}
                  {isDiscarded && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#9aa3b2", background: "rgba(107,114,128,0.13)", borderRadius: 5, padding: "2px 8px" }}>Discarded</span>
                  )}
                  {isFailed && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#f87171", background: "rgba(248,113,113,0.12)", borderRadius: 5, padding: "2px 8px" }}>Failed</span>
                  )}
                </div>

                {/* Action buttons — only on the active, undecided (or failed-retry) card */}
                {isActive && (!isDone || needsRetry) && (
                  <div style={{ padding: "0 14px 12px", display: "flex", gap: 8 }}>
                    {empty ? (
                      /* Empty/corrupt site: nothing worth keeping */
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDiscard(s.id); }}
                        style={{
                          flex: 1, cursor: "pointer",
                          background: "#374151", color: "#b8bdc7",
                          border: "1px solid #4b5563", borderRadius: 7,
                          padding: "7px 0", fontFamily: F, fontSize: 12.5, fontWeight: 700,
                        }}
                      >
                        Discard (nothing here)
                      </button>
                    ) : (
                      <>
                        {/* Primary: open the site so the user can see it before deciding */}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleOpen(s.id); }}
                          disabled={isSaving}
                          style={{
                            flex: 1, cursor: isSaving ? "default" : "pointer",
                            background: isFailed ? "#b45309" : "#4f7df0",
                            color: "#fff", border: "none", borderRadius: 7,
                            padding: "7px 0", fontFamily: F, fontSize: 12.5, fontWeight: 700,
                          }}
                        >
                          {isFailed ? "Retry save" : "Open →"}
                        </button>
                        {/* Quick-save for sites the user already recognises */}
                        {!isFailed && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleSave(s.id); }}
                            disabled={isSaving}
                            style={{
                              flex: "none", cursor: isSaving ? "default" : "pointer",
                              background: "rgba(79,125,240,0.15)", color: "#7ab3f0",
                              border: "1px solid #3b5bbf", borderRadius: 7,
                              padding: "7px 12px", fontFamily: F, fontSize: 12, fontWeight: 600,
                            }}
                          >
                            {isSaving ? "Saving…" : "Save"}
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleSkip(s.id); }}
                          disabled={isSaving}
                          style={{
                            flex: "none", cursor: isSaving ? "default" : "pointer",
                            background: "rgba(255,255,255,0.07)", color: "#7a98c8",
                            border: "1px solid #273560", borderRadius: 7,
                            padding: "7px 12px", fontFamily: F, fontSize: 12, fontWeight: 600,
                          }}
                        >
                          Keep on device
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 18px", borderTop: "1px solid #273560",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          {decidedCount < sites.length ? (
            <span style={{ flex: 1, fontSize: 12, color: "#8DA2C8" }}>
              {sites.length - decidedCount} remaining · click a site or use Open to see it first
            </span>
          ) : (
            <span style={{ flex: 1, fontSize: 12, color: "#4ade80" }}>
              {savedCount > 0
                ? `${savedCount} site${savedCount === 1 ? "" : "s"} saved to your account`
                : "No sites saved — decisions applied"}
            </span>
          )}
          <button
            onClick={() => onClose(savedCount)}
            style={{
              cursor: "pointer",
              background: decidedCount === sites.length ? "#4f7df0" : "rgba(255,255,255,0.07)",
              color: decidedCount === sites.length ? "#fff" : "#7a98c8",
              border: decidedCount === sites.length ? "none" : "1px solid #273560",
              borderRadius: 8, padding: "8px 22px",
              fontFamily: F, fontSize: 13, fontWeight: 700,
              transition: "background 0.15s",
            }}
          >
            {decidedCount === sites.length ? "Done" : "Close"}
          </button>
        </div>

      </div>
    </div>
  );
}
