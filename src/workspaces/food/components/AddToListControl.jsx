/* AddToListControl — the place card's "Lists" control (NEW-1 / B2088288): his lists with a check on each
 * one this place is already on, plus "New list…" inline. Tapping a row adds or removes only that membership.
 * Rendered by VisitPanel through its `listsControl` slot; FoodApp owns the data. */
import { useState } from "react";
import { Button, SIZE } from "../../../shared/ui/controls.jsx";
import { RADIUS } from "../../../shared/ui/radius.js";
import { FONT_SIZE } from "../../../shared/ui/designTokens.js";
import { noAutofill } from "../lib/noAutofill.js";
import { validateListName } from "../lib/foodLists.js";
import { Swatch, IOS_NO_ZOOM, PANEL_SHADOW } from "./ListChips.jsx";

export default function AddToListControl({ lists, onListIds, onToggle, onCreate, disabled }) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState(null);
  const names = lists.filter((l) => onListIds.has(l.id)).map((l) => l.name);

  const create = async () => {
    const v = validateListName(draft, lists);
    if (!v.ok) { setErr(v.message); return; }
    const r = await onCreate(v.name);
    if (r && r.ok === false) { setErr(r.message); return; }
    setCreating(false); setDraft(""); setErr(null);
  };

  return (
    <div data-testid="food-add-to-list" style={{ margin: "8px 16px 0", display: "flex", flexDirection: "column", gap: 6 }}>
      <Button variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open} disabled={disabled} data-testid="food-add-to-list-btn"
        style={{ minHeight: 44, justifyContent: "flex-start", textAlign: "left" }}>
        {names.length ? `On: ${names.join(", ")}` : "Add to a list"} {open ? "▴" : "▾"}
      </Button>
      {open && (
        <div role="group" aria-label="Lists" style={{ border: "1px solid var(--border-default)", borderRadius: RADIUS.md, padding: "2px 8px" }}>
          {lists.map((l) => {
            const on = onListIds.has(l.id);
            return (
              <button key={l.id} type="button" role="checkbox" aria-checked={on} onClick={() => onToggle(l.id)} data-testid="food-add-to-list-row" data-list-id={l.id}
                style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", minHeight: 44, border: "none", background: "transparent", color: "var(--text-primary)", font: "inherit", fontSize: FONT_SIZE.emphasis, cursor: "pointer", textAlign: "left", padding: 0 }}>
                <span aria-hidden="true" style={{ width: 18, flex: "none", fontWeight: 700 }}>{on ? "✓" : ""}</span>
                <Swatch color={l.color} />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</span>
              </button>
            );
          })}
          {creating ? (
            <div style={{ padding: "6px 0" }}>
              <input autoFocus value={draft} data-testid="food-add-to-list-new-input" aria-label="New list label" placeholder="e.g. Lunch spots"
                onChange={(e) => { setDraft(e.target.value); setErr(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") create(); else if (e.key === "Escape") { setCreating(false); setErr(null); } }}
                {...noAutofill("list-label")} enterKeyHint="done"
                style={{ width: "100%", boxSizing: "border-box", height: SIZE.md.height, padding: SIZE.md.padding, borderRadius: RADIUS.md, border: "1px solid var(--border-default)", background: "var(--surface-page)", color: "var(--text-primary)", font: "inherit", ...IOS_NO_ZOOM }} />
              {err && <div role="alert" style={{ fontSize: FONT_SIZE.control, color: "var(--danger-text)", marginTop: 4 }}>{err}</div>}
            </div>
          ) : (
            <button type="button" onClick={() => setCreating(true)} data-testid="food-add-to-list-new"
              style={{ display: "block", width: "100%", minHeight: 44, border: "none", background: "transparent", color: "var(--accent-food)", font: "inherit", fontSize: FONT_SIZE.emphasis, fontWeight: 700, cursor: "pointer", textAlign: "left", padding: 0 }}>New list…</button>
          )}
        </div>
      )}
    </div>
  );
}
