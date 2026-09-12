/* ShortcutsPage — "Keyboard Shortcuts" (NEW-1, owner ask 2026-09-12: "there should be a page for
 * keyboard shortcuts so that this knowledge isn't hidden").
 *
 * Reachable two ways, matching the app's own existing "?" convention (Site Planner already bound
 * "?" to its own local shortcuts overlay — this supersedes that with one page reachable from
 * every workspace, not just Site Planner): the global "?" listener in `Shell.jsx`, and the
 * "Keyboard shortcuts" row in the global Help menu (`HelpReportControl.jsx`).
 *
 * Content comes entirely from `shared/keyboard/shortcutsData.js` — this component renders it and
 * owns no shortcut knowledge of its own, per that file's own "keep it true" rule.
 *
 * Lazy-loaded from the Shell (same shape as AdminGate/DesignGallery/Dashboard) — it costs nothing
 * on the entry chunk until someone actually opens it.
 *
 * Short-viewport requirement (owner's own window is ~1191×465 — SHORT): the dialog is a flex
 * column with a fixed header/search band and a `flex:1; minHeight:0; overflowY:auto` body, so it
 * scrolls correctly rather than assuming everything fits on screen at once.
 */
import { useMemo, useRef, useState, useEffect } from "react";
import { SHORTCUT_SECTIONS } from "../shared/keyboard/shortcutsData.js";
import { formatCombo, comboAriaLabel } from "../shared/keyboard/platform.js";
import { RADIUS } from "../shared/ui/radius.js";
import { FONT_SIZE, SPACE } from "../shared/ui/designTokens.js";

const BACKDROP = "var(--modal-scrim)"; // the app's one modal scrim token (AuthPanel.jsx / SitePlanner.jsx's own dialogs use the same look)

function Kbd({ combo, keysText }) {
  const text = combo ? formatCombo(combo) : keysText;
  const aria = combo ? comboAriaLabel(combo) : keysText;
  return (
    <kbd
      aria-label={aria}
      style={{
        display: "inline-block", font: "inherit", fontSize: FONT_SIZE.control, fontWeight: 700,
        color: "var(--text-primary)", background: "var(--surface-page)",
        border: "1px solid var(--border-default)", borderRadius: RADIUS.sm,
        padding: "2px 7px", lineHeight: 1.4, whiteSpace: "nowrap",
      }}
    >
      {text}
    </kbd>
  );
}

function Row({ it }) {
  return (
    <div
      data-testid="shortcuts-item"
      data-shortcut-id={it.id}
      style={{ display: "flex", alignItems: "baseline", gap: SPACE.lg, padding: "6px 0", borderBottom: "1px solid var(--border-default)" }}
    >
      <div style={{ flex: "0 0 auto", minWidth: 118 }}>
        <Kbd combo={it.combo} keysText={it.keysText} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: FONT_SIZE.control, color: "var(--text-primary)" }}>{it.label}</div>
        {it.note && <div style={{ fontSize: FONT_SIZE.label, color: "var(--text-tertiary)", marginTop: 2 }}>{it.note}</div>}
      </div>
    </div>
  );
}

/** Does this item match the query? Checked against the label, the note, and the platform-agnostic
 *  aria form of the combo (so typing "ctrl z" finds Undo on any platform, mac included). */
function matches(it, q) {
  if (!q) return true;
  const hay = `${it.label} ${it.note || ""} ${it.keysText || ""} ${it.combo ? comboAriaLabel(it.combo) : ""}`.toLowerCase();
  return hay.includes(q);
}

export default function ShortcutsPage({ onClose }) {
  const [query, setQuery] = useState("");
  const searchRef = useRef(null);
  const dialogRef = useRef(null);
  const bodyRef = useRef(null);

  useEffect(() => { searchRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => SHORTCUT_SECTIONS.map((section) => ({
    ...section,
    groups: section.groups
      .map((g) => ({ ...g, items: g.items.filter((it) => matches(it, q)) }))
      .filter((g) => g.items.length > 0),
  })).filter((section) => section.groups.length > 0), [q]);

  const jumpTo = (id) => {
    const el = bodyRef.current?.querySelector(`[data-section="${id}"]`);
    el?.scrollIntoView({ block: "start" });
  };

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 5000, background: BACKDROP, display: "grid", placeItems: "center", padding: 12 }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        data-testid="shortcuts-page"
        onClick={(e) => e.stopPropagation()}
        style={{
          display: "flex", flexDirection: "column",
          background: "var(--surface-raised)", borderRadius: RADIUS.lg, boxShadow: "var(--modal-shadow)",
          width: "min(760px, 94vw)", maxHeight: "90vh", minHeight: 0,
        }}
      >
        {/* Header + search — fixed height, never scrolls away */}
        <div style={{ flex: "0 0 auto", padding: "16px 20px 10px", borderBottom: "1px solid var(--border-default)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
            <h2 style={{ margin: 0, fontSize: FONT_SIZE.display, color: "var(--text-primary)" }}>Keyboard shortcuts</h2>
            <button
              type="button" data-testid="shortcuts-close" onClick={onClose}
              style={{
                border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-secondary)",
                borderRadius: RADIUS.sm, padding: "4px 10px", fontSize: FONT_SIZE.control, cursor: "pointer", font: "inherit",
              }}
            >
              Close ✕
            </button>
          </div>
          <input
            ref={searchRef}
            data-testid="shortcuts-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search shortcuts…"
            aria-label="Search shortcuts"
            style={{
              width: "100%", boxSizing: "border-box", font: "inherit", fontSize: FONT_SIZE.control,
              padding: "7px 10px", border: "1px solid var(--border-default)", borderRadius: RADIUS.sm,
              background: "var(--surface-page)", color: "var(--text-primary)",
            }}
          />
          {!q && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
              {SHORTCUT_SECTIONS.map((s) => (
                <button
                  key={s.id} type="button" onClick={() => jumpTo(s.id)}
                  style={{
                    border: "1px solid var(--border-default)", background: "var(--surface-page)", color: "var(--text-secondary)",
                    borderRadius: RADIUS.pill, padding: "3px 10px", fontSize: FONT_SIZE.label, cursor: "pointer", font: "inherit",
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Body — the ONLY thing that scrolls, so a short window (the owner's is ~465px tall)
            still shows the header and search box and simply scrolls the list beneath them. */}
        <div ref={bodyRef} style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "6px 20px 18px" }}>
          {filtered.length === 0 && (
            <div style={{ padding: "24px 0", textAlign: "center", fontSize: FONT_SIZE.control, color: "var(--text-tertiary)" }}>
              No shortcuts match "{query}".
            </div>
          )}
          {filtered.map((section) => (
            <div key={section.id} data-section={section.id} style={{ marginTop: 18 }}>
              <div
                style={{
                  fontSize: FONT_SIZE.label, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
                  color: "var(--text-tertiary)", marginBottom: 4,
                }}
              >
                {section.label}
              </div>
              {section.groups.map((g, gi) => (
                <div key={gi} style={{ marginTop: g.label ? 10 : 0 }}>
                  {g.label && (
                    <div style={{ fontSize: FONT_SIZE.label, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 2 }}>
                      {g.label}
                    </div>
                  )}
                  {g.items.map((it) => <Row key={it.id} it={it} />)}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
