/* ListPanel — the selected list's own card (NEW-1 / B2088288): its members with remove, inline rename +
 * recolour, delete (asks once, inline — no dialog), and the "Add restaurants" picker.
 *
 * STATUS is derived and shown, never stored: "Been" is a READ-ONLY tag (a visit needs a date and a rating —
 * it goes through log-a-visit); "Want to try" is a toggle (a food_wishlist row, the existing add/remove).
 * The picker can only browse what he already has (Been + Want to try); a place nobody has marked arrives by the
 * toolbar's search box or a tap on a map pin while the picker is open — the hint says so. It never mints a
 * restaurant from a typed name. */
import { useState } from "react";
import { Button, ToggleChip, SIZE } from "../../../shared/ui/controls.jsx";
import { RADIUS } from "../../../shared/ui/radius.js";
import { FONT_SIZE } from "../../../shared/ui/designTokens.js";
import { noAutofill } from "../lib/noAutofill.js";
import { LIST_COLORS, validateListName } from "../lib/foodLists.js";
import { Swatch, IOS_NO_ZOOM, PANEL_SHADOW } from "./ListChips.jsx";

const STATUS_LABEL = { been: "Been", want: "Want to try", none: "Not marked" };

function StatusControl({ status, onToggleWant, disabled }) {
  if (status === "been") {
    return <span data-testid="food-list-status" data-status="been" style={{ flex: "none", fontSize: FONT_SIZE.label, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em", color: "var(--on-accent-food)", background: "var(--accent-food)", borderRadius: RADIUS.pill, padding: "2px 7px" }}>Been</span>;
  }
  const on = status === "want";
  return (
    <button
      type="button" onClick={onToggleWant} disabled={disabled} aria-pressed={on} data-testid="food-list-want" data-status={status}
      title={on ? "Marked want to try — tap to clear" : "Mark as want to try"}
      style={{
        flex: "none", minHeight: 30, padding: "2px 9px", borderRadius: RADIUS.pill, cursor: "pointer", font: "inherit", fontSize: FONT_SIZE.label, fontWeight: 700,
        border: `1px solid ${on ? "var(--accent-food)" : "var(--border-default)"}`, background: "transparent", color: on ? "var(--accent-food)" : "var(--text-secondary)",
      }}
    >{on ? "✓ Want to try" : "Want to try"}</button>
  );
}

function Row({ rec, action, actionLabel, actionTestId, onToggleWant, onOpen }) {
  return (
    <div data-testid="food-list-row" data-key={rec.key} data-status={rec.status} style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 44, borderTop: "1px solid var(--border-default)" }}>
      <button type="button" onClick={onOpen} title="Open on the map" style={{ flex: 1, minWidth: 0, textAlign: "left", border: "none", background: "transparent", color: "var(--text-primary)", font: "inherit", fontSize: FONT_SIZE.emphasis, cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: "4px 0" }}>
        {rec.name}
      </button>
      <StatusControl status={rec.status} onToggleWant={onToggleWant} />
      <button type="button" onClick={action} aria-label={`${actionLabel} ${rec.name}`} data-testid={actionTestId}
        style={{ flex: "none", minWidth: 44, minHeight: 44, border: "none", background: "transparent", cursor: "pointer", font: "inherit", fontSize: FONT_SIZE.emphasis, fontWeight: 700, color: "var(--text-secondary)" }}>
        {actionLabel === "Add" ? "+ Add" : "✕"}
      </button>
    </div>
  );
}

export default function ListPanel({
  list, lists, members, pickerRows, mode, onMode, filter, onFilter, collapsed, onCollapsed,
  onRename, onRecolor, onDelete, onRemoveMember, onAddRow, onToggleWant, onOpenMember, error, style,
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [nameErr, setNameErr] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (!list) return null;

  const startRename = () => { setDraft(list.name); setNameErr(null); setRenaming(true); };
  const commitRename = async () => {
    const v = validateListName(draft, lists, list.id);
    if (!v.ok) { setNameErr(v.message); return; }
    if (v.name !== list.name) { const r = await onRename(list.id, v.name); if (r && r.ok === false) { setNameErr(r.message); return; } }
    setRenaming(false); setNameErr(null);
  };

  const count = members.length;
  const adding = mode === "add";
  return (
    <div
      data-testid="food-list-panel" data-list-id={list.id}
      style={{ background: "var(--surface-raised)", border: "1px solid var(--border-default)", borderRadius: RADIUS.lg, boxShadow: PANEL_SHADOW, padding: "6px 10px", display: "flex", flexDirection: "column", minHeight: 0, color: "var(--text-primary)", ...style }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 36 }}>
        <Swatch color={list.color} size={12} />
        <strong style={{ fontSize: FONT_SIZE.emphasis, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{list.name}</strong>
        <span data-testid="food-list-count" style={{ fontSize: FONT_SIZE.control, color: "var(--text-secondary)", flex: "none" }}>{count} {count === 1 ? "place" : "places"}</span>
        <Button variant="ghost" onClick={() => onCollapsed(!collapsed)} aria-expanded={!collapsed} data-testid="food-list-toggle" style={{ flex: "none", height: SIZE.md.height, padding: SIZE.md.padding }}>{collapsed ? "Manage" : "Hide"}</Button>
      </div>
      {collapsed && count === 0 && <div data-testid="food-list-empty" style={{ fontSize: FONT_SIZE.control, color: "var(--text-secondary)", padding: "0 0 6px" }}>Nothing on this list yet.</div>}

      {!collapsed && (
        <div style={{ overflowY: "auto", minHeight: 0, display: "flex", flexDirection: "column", gap: 6, paddingBottom: 6 }}>
          {error && <div role="alert" data-testid="food-list-panel-error" style={{ fontSize: FONT_SIZE.control, color: "var(--danger-text)" }}>{error}</div>}

          {adding ? (
            <>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                {[["all", "All"], ["been", "Been"], ["want", "Want to try"], ["none", "Unmarked"]].map(([k, label]) => (
                  <ToggleChip key={k} active={filter === k} accent="var(--accent-food)" onAccent="var(--on-accent-food)" onClick={() => onFilter(k)} data-testid={`food-list-filter-${k}`} style={{ minHeight: 30 }}>{label}</ToggleChip>
                ))}
                <Button variant="ghost" onClick={() => onMode("members")} data-testid="food-list-done" style={{ marginLeft: "auto", height: SIZE.md.height, padding: SIZE.md.padding }}>Done</Button>
              </div>
              {filter === "none" ? (
                <div data-testid="food-list-unmarked-hint" style={{ fontSize: FONT_SIZE.control, color: "var(--text-secondary)" }}>Places you have not marked can't be browsed — search for one in the box above, or tap its pin on the map, and it lands on this list.</div>
              ) : pickerRows.length === 0 ? (
                <div data-testid="food-list-picker-empty" style={{ fontSize: FONT_SIZE.control, color: "var(--text-secondary)" }}>Nothing left to pick here. To add somewhere else, search for it above or tap its pin on the map.</div>
              ) : pickerRows.map((r) => (
                <Row key={r.key} rec={r} action={() => onAddRow(r)} actionLabel="Add" actionTestId="food-list-add" onToggleWant={() => onToggleWant(r)} onOpen={() => onOpenMember(r)} />
              ))}
              {filter !== "none" && pickerRows.length > 0 && <div style={{ fontSize: FONT_SIZE.control, color: "var(--text-secondary)" }}>Not here? Search above or tap a pin on the map.</div>}
            </>
          ) : (
            <>
              {count === 0
                ? <div data-testid="food-list-empty" style={{ fontSize: FONT_SIZE.control, color: "var(--text-secondary)" }}>Nothing on this list yet — add restaurants below.</div>
                : members.map((m) => <Row key={m.key} rec={m} action={() => onRemoveMember(m)} actionLabel="Remove" actionTestId="food-list-remove" onToggleWant={() => onToggleWant(m)} onOpen={() => onOpenMember(m)} />)}
              <Button onClick={() => { onFilter("all"); onMode("add"); }} data-testid="food-list-add-open" accent="var(--accent-food)" onAccent="var(--on-accent-food)" style={{ height: SIZE.md.height, padding: SIZE.md.padding }}>Add restaurants</Button>

              <div style={{ borderTop: "1px solid var(--border-default)", paddingTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
                {renaming ? (
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      autoFocus value={draft} aria-label="List label" data-testid="food-list-rename-input" {...noAutofill("list-label")}
                      onChange={(e) => { setDraft(e.target.value); setNameErr(null); }}
                      onKeyDown={(e) => { if (e.key === "Enter") commitRename(); else if (e.key === "Escape") { setRenaming(false); setNameErr(null); } }}
                      onBlur={commitRename}
                      style={{ flex: 1, minWidth: 0, boxSizing: "border-box", height: SIZE.md.height, padding: SIZE.md.padding, borderRadius: RADIUS.md, border: "1px solid var(--border-default)", background: "var(--surface-page)", color: "var(--text-primary)", font: "inherit", ...IOS_NO_ZOOM }}
                    />
                  </div>
                ) : (
                  <Button variant="ghost" onClick={startRename} data-testid="food-list-rename" style={{ alignSelf: "flex-start", height: SIZE.md.height, padding: SIZE.md.padding }}>Rename</Button>
                )}
                {nameErr && <div role="alert" data-testid="food-list-name-error" style={{ fontSize: FONT_SIZE.control, color: "var(--danger-text)" }}>{nameErr}</div>}
                <div role="group" aria-label="List colour" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {LIST_COLORS.map((c) => (
                    <button key={c.key} type="button" onClick={() => onRecolor(list.id, c.hex)} aria-label={c.label} aria-pressed={list.color.toLowerCase() === c.hex.toLowerCase()} data-testid="food-list-color" data-color={c.hex}
                      style={{ width: 30, height: 30, borderRadius: RADIUS.pill, background: c.hex, cursor: "pointer", border: list.color.toLowerCase() === c.hex.toLowerCase() ? "3px solid var(--text-primary)" : "2px solid var(--border-default)", padding: 0 }} />
                  ))}
                </div>
                {confirmDelete ? (
                  <div data-testid="food-list-delete-confirm" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", fontSize: FONT_SIZE.control }}>
                    <span style={{ flex: "1 1 160px" }}>Delete this list? Your places and visits stay.</span>
                    <Button variant="danger" onClick={() => { setConfirmDelete(false); onDelete(list.id); }} data-testid="food-list-delete-yes" style={{ height: SIZE.md.height, padding: SIZE.md.padding }}>Delete list</Button>
                    <Button variant="ghost" onClick={() => setConfirmDelete(false)} style={{ height: SIZE.md.height, padding: SIZE.md.padding }}>Keep</Button>
                  </div>
                ) : (
                  <Button variant="danger" onClick={() => setConfirmDelete(true)} data-testid="food-list-delete" style={{ alignSelf: "flex-start", height: SIZE.md.height, padding: SIZE.md.padding }}>Delete list…</Button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
export { STATUS_LABEL };
