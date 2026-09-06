/* Model workspace — the command palette (NEW-1, owner chat block: "Command palette for the
 * Spreadsheet, and get the audit tools out of the overflow").
 *
 * Ctrl/Cmd+K, fuzzy search over EVERY action lib/commandRegistry.js lists — the toolbar's
 * REDUCED Home ribbon plus everything the owner's brief asked to also reach here (Borders,
 * Names, Formula Auditing, Sort & Filter, Find/Replace, Sheet management, Import/Export, Zoom).
 * Arrow keys + Enter, Escape closes, no mouse required — modeled on this repo's own precedent for
 * exactly this shape, Notes' `QuickOpen.jsx` (Ctrl+K there too; kept as a SEPARATE, workspace-
 * local component rather than a shared import — each lazy-loaded workspace's code stays its own,
 * per this repo's architecture rule, and the two have nothing in common beyond the gesture).
 *
 * Every row calls `run(ctx)` — literally the same `ctx.onXxx` handler the ribbon button (or the
 * permanent audit toolbar, or the cell right-click menu) for that action calls, since ModelApp.jsx
 * builds `ctx` once and hands the SAME object everywhere. This component decides nothing about
 * what an action DOES — only how to find it and invoke it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { RADIUS } from "../../../shared/ui/radius.js";
import { COMMANDS, COMMAND_GROUPS, searchCommands } from "../lib/commandRegistry.js";

const RESULT_LIMIT = 60;

export default function CommandPalette({ open, ctx, onClose }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const boxRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // A fresh open always starts from an empty query at row 0 — never the last search somebody
  // typed three actions ago.
  useEffect(() => { if (open) { setQuery(""); setIndex(0); } }, [open]);
  useEffect(() => { setIndex(0); }, [query]);

  // Focus/restore split from the outside-press listener below — bundling them (Notes'
  // `QuickOpen.jsx` documents the exact bug this avoids) re-runs the focus effect on every
  // keystroke because `onClose` is a fresh function every render.
  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    inputRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && document.contains(opener)) {
        try { opener.focus(); } catch (_) { /* an element that went away needs no focus */ }
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const down = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) onClose?.(); };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [open, onClose]);

  useEffect(() => {
    const box = listRef.current;
    const row = box?.children?.[index];
    if (!box || !row) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < box.scrollTop) box.scrollTop = top;
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight;
  }, [index]);

  const results = useMemo(() => searchCommands(COMMANDS, query, ctx).slice(0, RESULT_LIMIT), [query, ctx]);

  if (!open) return null;

  const runAt = (i) => {
    const r = results[i];
    if (!r || r.disabled) return;
    onClose?.();
    r.run(ctx);
  };

  const keys = (e) => {
    if (e.key === "Escape") { e.preventDefault(); onClose?.(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(results.length - 1, i + 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); return; }
    if (e.key === "Enter") { e.preventDefault(); runAt(index); }
  };

  return (
    <div
      data-testid="model-command-palette-backdrop"
      style={{
        position: "fixed", inset: 0, zIndex: 80,
        display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: "12vh",
        background: "transparent", pointerEvents: "none",
      }}
    >
      <div
        ref={boxRef}
        data-testid="model-command-palette"
        role="dialog"
        aria-label="Command palette"
        onKeyDown={keys}
        style={{
          pointerEvents: "auto", width: "min(520px, calc(100vw - 32px))",
          maxHeight: "60vh", display: "flex", flexDirection: "column",
          borderRadius: RADIUS.lg, border: "1px solid var(--border-strong)",
          background: "var(--surface-raised)", boxShadow: "0 24px 60px rgba(0,0,0,0.32)", // design-exempt: no shadow-color token yet repo-wide (Notes' own QuickOpen carries the identical gap)
          overflow: "hidden",
        }}
      >
        <input
          ref={inputRef}
          data-testid="model-command-palette-input"
          value={query}
          placeholder="Type a command…"
          aria-label="Search commands"
          onChange={(e) => setQuery(e.target.value)}
          style={{
            flex: "none", border: "none", borderBottom: "1px solid var(--border-default)",
            background: "transparent", color: "var(--text-primary)", font: "inherit",
            fontSize: 14, fontWeight: 600, padding: "11px 14px", outline: "none", // FONT_SIZE.display
          }}
        />
        <div ref={listRef} data-testid="model-command-palette-list" style={{ overflowY: "auto", padding: "4px 0" }}>
          {results.map((r, i) => {
            const activeRow = i === index && !r.disabled;
            return (
              <button
                key={r.id}
                type="button"
                data-testid={`model-command-${r.id}`}
                data-active={activeRow ? "1" : undefined}
                disabled={r.disabled}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => { if (!r.disabled) setIndex(i); }}
                onClick={() => runAt(i)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                  width: "100%", padding: "7px 14px", border: "none", textAlign: "left",
                  cursor: r.disabled ? "default" : "pointer",
                  background: activeRow ? "var(--accent-model)" : "transparent",
                  color: activeRow ? "var(--on-accent-model)" : r.disabled ? "var(--text-tertiary)" : "var(--text-primary)",
                  opacity: r.disabled ? 0.55 : 1,
                  font: "inherit",
                }}
              >
                <span style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0, overflow: "hidden" }}>
                  <span style={{
                    flex: "0 0 auto", fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", // FONT_SIZE.micro
                    color: activeRow ? "var(--on-accent-model)" : "var(--text-tertiary)", opacity: activeRow ? 0.85 : 1,
                  }}>{COMMAND_GROUPS[r.group] || r.group}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13 }}>{r.label}</span>
                </span>
                {r.shortcut && (
                  <span aria-hidden="true" style={{ flex: "0 0 auto", fontSize: 10.5, fontWeight: 600, opacity: 0.7 }}>{r.shortcut}</span>
                )}
              </button>
            );
          })}
          {!results.length && (
            <p data-testid="model-command-palette-empty" style={{ margin: 0, padding: "12px 14px", fontSize: 12, color: "var(--text-secondary)" }}>
              No commands match “{query.trim()}”.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
