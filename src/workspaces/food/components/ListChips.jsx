/* ListChips — the list switcher (NEW-1 / B2088288): one chip per list plus "All" and "+ New".
 *
 * PHONE: it floats ON the map (FoodApp positions it), never in the header — so it cannot push the search
 * field or the Map | List switch off screen, and it adds no second header row. It is one nowrap row that
 * scrolls sideways inside its own box (never wider than the room the map gives it).
 * The new-list name is an INLINE field (no dialog box) using the module's noAutofill tokens. */
import { useEffect, useRef, useState } from "react";
import { noAutofill } from "../lib/noAutofill.js";
import { validateListName } from "../lib/foodLists.js";
import { ToggleChip, SIZE } from "../../../shared/ui/controls.jsx";
import { RADIUS } from "../../../shared/ui/radius.js";
import { FONT_SIZE } from "../../../shared/ui/designTokens.js";

// 16px on a text field keeps iOS Safari from zooming the page when it takes focus.
export const IOS_NO_ZOOM = { fontSize: 16 }; // design-exempt: 16 keeps iOS from zooming the page on focus
// The same floating-panel edge shadow the place card and bottom sheet use (no shadow token exists).
export const PANEL_SHADOW = "0 6px 20px rgba(0,0,0,0.18)"; // design-exempt: shared floating-panel shadow, no token exists

export function Swatch({ color, size = 10 }) {
  return <span aria-hidden="true" style={{ display: "inline-block", width: size, height: size, borderRadius: RADIUS.pill, background: color, flex: "none" }} />;
}

export default function ListChips({ lists, selectedId, onSelect, onCreate, style }) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState(null);
  const inputRef = useRef(null);
  useEffect(() => { if (creating) inputRef.current?.focus(); }, [creating]);

  const submit = async () => {
    const v = validateListName(draft, lists);
    if (!v.ok) { setErr(v.message); return; }
    const res = await onCreate(v.name);
    if (res && res.ok === false) { setErr(res.message); return; }
    setCreating(false); setDraft(""); setErr(null);
  };
  const cancel = () => { setCreating(false); setDraft(""); setErr(null); };
  const accent = "var(--accent-food)", onAccent = "var(--on-accent-food)";
  const chip = { flex: "none", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 6, minHeight: SIZE.md.height };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, ...style }}>
      <div
        data-testid="food-list-chips" role="group" aria-label="Restaurant lists"
        data-sweep-exempt="list chips scroll sideways on purpose inside their own strip"
        style={{ display: "flex", gap: 6, overflowX: "auto", flexWrap: "nowrap", scrollbarWidth: "none", paddingBottom: 2 }}
      >
        <ToggleChip active={!selectedId} accent={accent} onAccent={onAccent} onClick={() => onSelect("")} data-testid="food-list-chip-all" style={chip}>All</ToggleChip>
        {lists.map((l) => (
          <ToggleChip
            key={l.id} active={selectedId === l.id} accent={accent} onAccent={onAccent}
            onClick={() => onSelect(l.id)} data-testid="food-list-chip" data-list-id={l.id} aria-pressed={selectedId === l.id} style={chip}
          >
            <Swatch color={l.color} />{l.name}
          </ToggleChip>
        ))}
        {creating ? (
          <input
            ref={inputRef} value={draft} data-testid="food-list-new-input" aria-label="New list label" placeholder="e.g. Lunch spots"
            onChange={(e) => { setDraft(e.target.value); setErr(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); else if (e.key === "Escape") cancel(); }}
            onBlur={() => { if (!draft.trim()) cancel(); }}
            {...noAutofill("list-label")} enterKeyHint="done"
            style={{
              flex: "none", width: 140, boxSizing: "border-box", height: SIZE.md.height, padding: SIZE.md.padding, borderRadius: RADIUS.md,
              border: "1px solid var(--border-default)", background: "var(--surface-page)", color: "var(--text-primary)", font: "inherit", ...IOS_NO_ZOOM,
            }}
          />
        ) : (
          <ToggleChip accent={accent} onAccent={onAccent} onClick={() => setCreating(true)} data-testid="food-list-new" style={chip}>+ New</ToggleChip>
        )}
      </div>
      {err && <div role="alert" data-testid="food-list-error" style={{ fontSize: FONT_SIZE.control, color: "var(--danger-text)", background: "var(--surface-raised)", border: "1px solid var(--border-default)", borderRadius: RADIUS.sm, padding: "3px 8px", alignSelf: "flex-start" }}>{err}</div>}
    </div>
  );
}
