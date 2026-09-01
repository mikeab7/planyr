/* CompEntryGrid — the paste-box-over-a-row-grid comp entry surface (B849232/NEW-1), replacing
 * the old one-comp-at-a-time form as the CREATE path. Michael enters comps in batches, copied
 * out of broker emails; this is the review surface itself — parsed values land straight in
 * typed, editable cells, there is no separate confirm step.
 *
 * ⛔ B986096-HARDENING — a signed-in owner pass against the live deploy found this container was
 * PHYSICALLY BROKEN, not just unpolished: a full-viewport backdrop `<div>` sat over the map, so
 * the banner's own instruction ("click Drop a pin on the map") was unfollowable — the backdrop
 * intercepted `elementFromPoint` at both the button's coordinates and 80% across the map. A
 * modal can never ask you to interact with the thing it's covering. Fixed by ceasing to be a
 * modal at all: no backdrop, no `inset:0`. This is a small, DRAGGABLE floating card
 * (`position:fixed`, sized to its own content only) — the map is reachable everywhere outside
 * the card's own small rectangle, at all times, including while a location is being picked.
 *
 * WIDTH — measured, not guessed. The Comps rail is 232px wide on desktop (MapFinder.jsx's
 * left-rail card), narrower than the ~380px this feature was scoped against, and the real grid
 * (Type/Date/Rate+period+basis/Annual/Size/Location, every row type sharing ONE column
 * structure) needs more like 820px. A self-contained floating card avoids touching the docked
 * rail's own width (shared with the Sites tab and the map-chrome stack, and a sibling session
 * is hardening the site-plan-overlay code in that same file this week).
 *
 * Two kinds of uncertainty (compParse.js's contract) render with DIFFERENT chrome, never the
 * same amber: a SOFT cell (`--warn-*` tokens, a "~" glyph) the user MAY fix, and a BLOCKING
 * cell reuses the app's existing genuinely-rejected-value convention (`aria-invalid="true"`,
 * `--danger`, a "!" glyph — index.css) because that state already means "must fix before this
 * can save" everywhere else in the app. Both glyphs render as a small badge in the corner of
 * their cell, OUTSIDE the input/select's own box — never inline next to a native <select>,
 * which used to sit directly on top of its chevron.
 *
 * MODULE-SCOPE-COMPONENTS: every component here is defined at module scope.
 */
import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../ui/controls.jsx";
import { parsePaste, rowHasBlockingFlags, parseProseLine, splitPasteLines } from "../lib/compParse.js";
import { emptyDraft, draftToComp, validateComp, annualLeaseRate, partyLabels } from "../lib/comps.js";

const TYPE_LABEL = { land: "Land", building_sale: "Bldg sale", lease: "Lease" };

// Type(64) Date(96) Rate/Price(190) Annual(76) Size(96) Location(96) More(22) Delete(22)
const COLS = "64px 96px 190px 76px 96px 96px 22px 22px";

let _rowSeq = 0;
function newRowId() { return `row${Date.now()}_${_rowSeq++}`; }

export function draftFromParsedRow(parsed) {
  return { _id: newRowId(), draft: { ...emptyDraft(null), ...parsed.draft }, cellFlags: parsed.cellFlags || {} };
}

function cellStyle(flag) {
  const base = {
    width: "100%", boxSizing: "border-box", padding: "5px 6px", fontSize: 12, borderRadius: 6,
    fontFamily: "inherit", color: "var(--text-primary)", background: "var(--surface-base)",
    border: "1px solid var(--border-default)",
  };
  if (!flag) return base;
  if (flag.level === "blocking") {
    return { ...base, borderColor: "var(--danger)", borderWidth: 2, background: "var(--danger-bg)" };
  }
  return { ...base, borderColor: "var(--warn-border)", background: "var(--warn-bg)" };
}

// A corner badge, positioned OUTSIDE the flagged control's own box — never inline beside it,
// which is what used to land the "!" glyph directly on top of a <select>'s own chevron.
function FlagGlyph({ flag }) {
  if (!flag) return null;
  return (
    <span title={flag.reason} aria-label={flag.reason}
      style={{
        position: "absolute", top: -6, right: -6, zIndex: 1,
        display: "inline-flex", alignItems: "center", justifyContent: "center", width: 14, height: 14,
        borderRadius: 999, fontSize: 10, fontWeight: 900, cursor: "help", lineHeight: 1,
        color: flag.level === "blocking" ? "var(--danger-text)" : "var(--warn-text)",
        background: flag.level === "blocking" ? "var(--danger-bg)" : "var(--warn-bg)",
        border: `1px solid ${flag.level === "blocking" ? "var(--danger-border)" : "var(--warn-border)"}`,
      }}>
      {flag.level === "blocking" ? "!" : "~"}
    </span>
  );
}

function Cell({ flag, children }) {
  return (
    <div style={{ position: "relative", minWidth: 0 }}>
      {children}
      <FlagGlyph flag={flag} />
    </div>
  );
}

// The one place a lease row's normalized annual figure is computed — off the shared pure
// `annualLeaseRate` (comps.js) so this can never disagree with the detail view or the rail's
// own averages. Rendered in its OWN grid column (never a floating label outside the grid).
function AnnualCell({ draft }) {
  if (draft.compType !== "lease") return <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>—</span>;
  const comp = draftToComp(draft);
  const annual = annualLeaseRate(comp);
  if (annual == null) return <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>—/yr</span>;
  const basis = draft.leaseRateExpense ? draft.leaseRateExpense.toUpperCase() : "basis?";
  return <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>${annual.toFixed(2)}/yr {basis}</span>;
}

// The long-tail fields that live ONLY behind the chevron — everything else (type, date,
// price/rate, size, location, and now title) is reachable without expanding. Used to badge the
// toggle so "there's more inside" is visible without opening it (B986096-HARDENING-3 item 4).
function hiddenFieldCount(draft) {
  let n = 0;
  if (draft.partyProvider) n++;
  if (draft.partyAcquirer) n++;
  if (draft.notes) n++;
  if (draft.compType === "lease") {
    if (draft.leaseTi) n++;
    if (draft.leaseTerm) n++;
    if (draft.leaseFreeRentMonths) n++;
    if (draft.leaseEscalationPct) n++;
  }
  return n;
}

function GridRow({ row, onChange, onRemove, onFocusAnchor, onArm, armed }) {
  const { draft, cellFlags } = row;
  const set = (key) => (e) => onChange({ ...row, draft: { ...draft, [key]: e.target.value }, cellFlags: withFlagCleared(cellFlags, key) });
  const setField = (key, value) => onChange({ ...row, draft: { ...draft, [key]: value }, cellFlags: withFlagCleared(cellFlags, key) });
  const [expanded, setExpanded] = useState(false);
  const { provider: providerLabel, acquirer: acquirerLabel } = partyLabels(draft.compType);
  const canFocus = !!draft.anchor;
  const hidden = hiddenFieldCount(draft);

  return (
    <div style={{ borderBottom: "1px solid var(--border-default)", padding: "8px 0" }}>
      <div
        onClick={() => canFocus && onFocusAnchor(draft.anchor)}
        style={{ display: "grid", gridTemplateColumns: COLS, gap: 6, alignItems: "center", cursor: canFocus ? "pointer" : "default" }}>
        <select aria-label="Comp type" value={draft.compType} onChange={(e) => setField("compType", e.target.value)}
          onClick={(e) => e.stopPropagation()} style={cellStyle(cellFlags.compType)}>
          {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>

        <Cell flag={cellFlags.compDate}>
          <input aria-label="Date" type="date" value={draft.compDate} onChange={set("compDate")} onClick={(e) => e.stopPropagation()} style={cellStyle(cellFlags.compDate)} />
        </Cell>

        {draft.compType === "lease" ? (
          <div style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", gap: 4 }}>
              <input aria-label="Lease rate $/SF" type="number" value={draft.leaseRate} onChange={set("leaseRate")} placeholder="$/SF"
                aria-invalid={cellFlags.leaseRatePeriod?.level === "blocking" ? "true" : undefined}
                style={{ ...cellStyle(cellFlags.leaseRate), width: 62, flex: "none" }} />
              <select aria-label="Rate period" value={draft.leaseRatePeriod} onChange={(e) => setField("leaseRatePeriod", e.target.value)}
                aria-invalid={cellFlags.leaseRatePeriod?.level === "blocking" ? "true" : undefined}
                style={{ ...cellStyle(cellFlags.leaseRatePeriod), width: 58, flex: "none" }}>
                <option value="">? /</option>
                <option value="monthly">/MO</option>
                <option value="annual">/YR</option>
              </select>
              <select aria-label="Rate basis" value={draft.leaseRateExpense} onChange={(e) => setField("leaseRateExpense", e.target.value)}
                style={{ ...cellStyle(cellFlags.leaseRateExpense), width: 62, flex: "none" }}>
                <option value="">basis?</option>
                <option value="nnn">NNN</option>
                <option value="gross">GROSS</option>
              </select>
            </div>
            <FlagGlyph flag={cellFlags.leaseRate || cellFlags.leaseRatePeriod} />
          </div>
        ) : (
          <Cell flag={cellFlags[draft.compType === "land" ? "landPrice" : "bldgPrice"]}>
            <input aria-label="Price" type="number" placeholder="Price"
              value={draft.compType === "land" ? draft.landPrice : draft.bldgPrice}
              onChange={draft.compType === "land" ? set("landPrice") : set("bldgPrice")}
              onClick={(e) => e.stopPropagation()}
              style={cellStyle(cellFlags[draft.compType === "land" ? "landPrice" : "bldgPrice"])} />
          </Cell>
        )}

        <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", justifyContent: "center" }}>
          <AnnualCell draft={draft} />
        </div>

        {draft.compType === "land" ? (
          <div style={{ display: "flex", gap: 3 }} onClick={(e) => e.stopPropagation()}>
            <Cell flag={cellFlags.landSizeValue}>
              <input aria-label="Land size" type="number" value={draft.landSizeValue} onChange={set("landSizeValue")} placeholder="Size" style={{ ...cellStyle(cellFlags.landSizeValue), width: 56 }} />
            </Cell>
            <select aria-label="Size unit" value={draft.landSizeUnit} onChange={set("landSizeUnit")} style={{ ...cellStyle(null), width: 36, flex: "none", padding: "5px 2px" }}>
              <option value="ac">AC</option><option value="sf">SF</option>
            </select>
          </div>
        ) : (
          <Cell flag={cellFlags[draft.compType === "building_sale" ? "bldgSizeSf" : "leaseSizeSf"]}>
            <input aria-label="Building or leased SF" type="number" placeholder="SF"
              value={draft.compType === "building_sale" ? draft.bldgSizeSf : draft.leaseSizeSf}
              onChange={draft.compType === "building_sale" ? set("bldgSizeSf") : set("leaseSizeSf")}
              onClick={(e) => e.stopPropagation()}
              style={cellStyle(cellFlags[draft.compType === "building_sale" ? "bldgSizeSf" : "leaseSizeSf"])} />
          </Cell>
        )}

        <div onClick={(e) => e.stopPropagation()}>
          {draft.anchor ? (
            <button onClick={() => onFocusAnchor(draft.anchor)} title="Show on map"
              style={{ border: "1px solid var(--border-default)", background: "var(--surface-raised)", color: "var(--text-secondary)", fontSize: 10.5, borderRadius: 6, padding: "5px 4px", cursor: "pointer", width: "100%" }}>
              📍 Set
            </button>
          ) : (
            <button onClick={() => onArm(row._id)} title="Pick a location for this row on the map"
              style={{
                border: `1px solid ${armed ? "var(--accent)" : "var(--warn-border)"}`, background: armed ? "var(--accent)" : "var(--warn-bg)",
                color: armed ? "var(--on-accent)" : "var(--warn-text)", fontSize: 10.5, borderRadius: 6, padding: "5px 4px", cursor: "pointer", width: "100%", fontWeight: 700,
              }}>
              {armed ? "Picking…" : "＋ Loc"}
            </button>
          )}
        </div>

        <div style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => setExpanded((v) => !v)}
            title={expanded ? "Hide the extra fields" : hidden > 0 ? `${hidden} more field${hidden === 1 ? "" : "s"} filled in below — click to show` : "Seller/buyer, notes, and lease terms live here"}
            aria-label="More fields"
            style={{
              border: "none", background: "transparent", cursor: "pointer", fontSize: 12, padding: "4px 0",
              color: hidden > 0 && !expanded ? "var(--accent)" : "var(--text-secondary)",
              fontWeight: hidden > 0 && !expanded ? 700 : 400,
            }}>
            {expanded ? "▾" : "▸"}
          </button>
          {!expanded && hidden > 0 && (
            <span aria-hidden="true" style={{
              position: "absolute", top: -4, right: -6, minWidth: 14, height: 14, borderRadius: 999,
              background: "var(--accent)", color: "var(--on-accent)", fontSize: 9, fontWeight: 800,
              display: "flex", alignItems: "center", justifyContent: "center", padding: "0 2px", lineHeight: 1,
            }}>
              {hidden}
            </span>
          )}
        </div>
        <button onClick={(e) => { e.stopPropagation(); onRemove(row._id); }} title="Remove row" aria-label="Remove row"
          style={{ border: "none", background: "transparent", color: "var(--danger-text)", cursor: "pointer", fontSize: 12, padding: "4px 0" }}>
          ✕
        </button>
      </div>

      <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 5 }}>
        <input aria-label="Title / address" value={draft.title} onChange={set("title")} placeholder="Title / address"
          style={{ ...cellStyle(cellFlags.title), width: "100%" }} />
      </div>

      {expanded && (
        <div onClick={(e) => e.stopPropagation()} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 6, paddingLeft: 2 }}>
          <input aria-label={providerLabel} value={draft.partyProvider} onChange={set("partyProvider")} placeholder={providerLabel} style={cellStyle(null)} />
          <input aria-label={acquirerLabel} value={draft.partyAcquirer} onChange={set("partyAcquirer")} placeholder={acquirerLabel} style={cellStyle(null)} />
          {draft.compType === "lease" && (<>
            <input aria-label="TI $/SF" type="number" value={draft.leaseTi} onChange={set("leaseTi")} placeholder="TI $/SF" style={cellStyle(null)} />
            <input aria-label="Term" value={draft.leaseTerm} onChange={set("leaseTerm")} placeholder="Term (e.g. 5 yrs)" style={cellStyle(null)} />
            <input aria-label="Free rent (months)" type="number" value={draft.leaseFreeRentMonths} onChange={set("leaseFreeRentMonths")} placeholder="Free rent (mo)" style={cellStyle(null)} />
            <input aria-label="Annual escalation %" type="number" value={draft.leaseEscalationPct} onChange={set("leaseEscalationPct")} placeholder="Escalation %/yr" style={cellStyle(null)} />
          </>)}
          <textarea aria-label="Notes" value={draft.notes} onChange={set("notes")} placeholder="Notes" rows={2}
            style={{ ...cellStyle(null), gridColumn: "1 / -1", resize: "vertical" }} />
        </div>
      )}
    </div>
  );
}

function withFlagCleared(cellFlags, key) {
  if (!cellFlags?.[key]) return cellFlags;
  const next = { ...cellFlags };
  delete next[key];
  return next;
}

function rowIsReady(row) {
  return !rowHasBlockingFlags(row.cellFlags) && validateComp(draftToComp(row.draft)).length === 0;
}

export default function CompEntryGrid({ rows, onRowsChange, armedRowId, onArm, onFocusAnchor, onSave, onCancel, saving, saveError }) {
  const [pasteText, setPasteText] = useState("");
  // Kept visible until the rows it produced are saved or the user explicitly dismisses it — a
  // failed or partial parse used to clear the box instantly, taking the only reference for
  // fixing it with it (B986096-HARDENING item 4).
  const [lastPasteText, setLastPasteText] = useState(null);
  // Tracks the most recent commit IF it was interpreted as ONE record, so the "split into one
  // row per line instead" control (B986096-HARDENING item 1's shape-detection corollary) can
  // undo exactly those rows and re-parse the same raw text the other way.
  const [lastSingleParse, setLastSingleParse] = useState(null);

  // No boundsRef — this card isn't clamped to the map container (this component has no access
  // to it), just to the window, which is enough: dragging is the escape hatch for whatever the
  // default position happens to cover, not a hard requirement to avoid it by construction.
  const [pos, setPos] = useState(() => ({
    x: Math.max(16, (typeof window !== "undefined" ? window.innerWidth : 1200) - 860),
    y: 110,
  }));
  const posRef = useRef(pos);
  posRef.current = pos;

  const startDrag = (e) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    const ox = posRef.current.x, oy = posRef.current.y;
    const move = (ev) => {
      const w = typeof window !== "undefined" ? window.innerWidth : 1200;
      const h = typeof window !== "undefined" ? window.innerHeight : 800;
      setPos({ x: Math.max(4, Math.min(w - 60, ox + ev.clientX - sx)), y: Math.max(4, Math.min(h - 40, oy + ev.clientY - sy)) });
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const appendParsed = (parsedRows, rawText, mode) => {
    setLastPasteText(rawText);
    if (!parsedRows.length) { setLastSingleParse(null); return; }
    const newRows = parsedRows.map(draftFromParsedRow);
    onRowsChange([...rows, ...newRows]);
    setLastSingleParse(mode === "single" ? { raw: rawText, rowIds: newRows.map((r) => r._id) } : null);
  };

  // A real clipboard paste — the block/Excel shapes' path. Default insertion is prevented so
  // the raw pasted text never lands directly in the (controlled) textarea; parsing decides what
  // the box shows instead (kept as a reference, see `lastPasteText`).
  const handlePaste = (e) => {
    const text = e.clipboardData?.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    const { rows: parsedRows, mode } = parsePaste(text);
    appendParsed(parsedRows, text, mode);
  };

  // ⛔ B986096-HARDENING item 2 — parses on INPUT, not only on paste. The old code read a ref's
  // `.value` inside a separate onKeyDown handler for "press Enter to commit a typed line," which
  // depends on the DOM node's own tracked value rather than React's controlled state — fragile,
  // and the one owner-measured case where it looked totally dead. Unified into the ONE onChange
  // handler instead: pressing Enter inserts a real newline (nothing intercepts it anymore), and
  // any value containing "\n" — from Enter, or any other input method that inserts one — is
  // exactly the general shape awtch: parse everything up to it as a committed line/block, and go
  // through the SAME shape-aware `parsePaste` a real clipboard paste uses (a hand-typed multi-
  // line block is treated identically to a pasted one).
  const handleChange = (e) => {
    const val = e.target.value;
    if (val.includes("\n")) {
      const committed = val.replace(/\n+$/, "");
      if (committed.trim()) {
        const { rows: parsedRows, mode } = parsePaste(committed);
        appendParsed(parsedRows, committed, mode);
      }
      setPasteText("");
      return;
    }
    setPasteText(val);
  };

  const switchToOnePerLine = () => {
    if (!lastSingleParse) return;
    const { raw, rowIds } = lastSingleParse;
    const idSet = new Set(rowIds);
    const remaining = rows.filter((r) => !idSet.has(r._id));
    const multiRows = splitPasteLines(raw).map(parseProseLine).filter(Boolean).map(draftFromParsedRow);
    onRowsChange([...remaining, ...multiRows]);
    setLastSingleParse(null);
  };

  const updateRow = (updated) => onRowsChange(rows.map((r) => (r._id === updated._id ? updated : r)));
  const removeRow = (id) => onRowsChange(rows.filter((r) => r._id !== id));

  const readyRows = rows.filter(rowIsReady);
  const blockingCount = rows.filter((r) => rowHasBlockingFlags(r.cellFlags)).length;
  // Not blocked by a red cell, but still can't save — missing the date or the location
  // validateComp requires. A DIFFERENT reason from a blocking cell and now worded/colored
  // differently too (B986096-HARDENING item 5's footer honesty fix — the copy used to say
  // "(red)" for both).
  const missingCount = rows.filter((r) => !rowHasBlockingFlags(r.cellFlags) && validateComp(draftToComp(r.draft)).length > 0).length;

  let footerMsg = "";
  if (rows.length > 0) {
    if (blockingCount === 0 && missingCount === 0) {
      footerMsg = `${readyRows.length} row${readyRows.length === 1 ? "" : "s"} ready.`;
    } else {
      const parts = [];
      if (blockingCount > 0) parts.push(`${blockingCount} blocking (red)`);
      if (missingCount > 0) parts.push(`${missingCount} need${missingCount === 1 ? "s" : ""} a date or a location`);
      footerMsg = `${readyRows.length} of ${rows.length} ready — ${parts.join(", ")}.`;
    }
  }

  return createPortal(
    <div
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "fixed", left: pos.x, top: pos.y, width: "min(820px, calc(100vw - 32px))",
        maxHeight: "min(80vh, 720px)", zIndex: 2600, display: "flex", flexDirection: "column",
        background: "var(--surface-overlay)", border: "1px solid var(--border-default)", borderRadius: 12,
        boxShadow: "0 16px 44px rgba(28,25,20,0.22), 0 3px 10px rgba(28,25,20,0.1)", // design-exempt: mirrors shared/ui/FloatingPanel.jsx's card shadow verbatim — no shadow token exists yet
      }}>
      <div onPointerDown={startDrag}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid var(--border-default)", cursor: "move", userSelect: "none" }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>New comps</span>
        <button onPointerDown={(e) => e.stopPropagation()} onClick={onCancel} aria-label="Close"
          style={{ border: "none", background: "transparent", color: "var(--text-secondary)", fontSize: 14, cursor: "pointer", padding: 2 }}>✕</button>
      </div>

      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-default)" }}>
        <textarea
          value={pasteText}
          onChange={handleChange}
          onPaste={handlePaste}
          placeholder="Paste comps here — a broker email (any shape), or an Excel block. Press Enter to commit a single typed line."
          rows={2}
          style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", fontSize: 12, borderRadius: 8, fontFamily: "inherit", border: "1px solid var(--border-default)", background: "var(--surface-base)", color: "var(--text-primary)", resize: "vertical" }}
        />
        {lastPasteText && (
          <div style={{ marginTop: 6, position: "relative", fontSize: 10.5, color: "var(--text-secondary)", background: "var(--surface-raised)", border: "1px solid var(--border-default)", borderRadius: 6, padding: "6px 8px" }}>
            <button onClick={() => { setLastPasteText(null); setLastSingleParse(null); }} title="Dismiss" aria-label="Dismiss"
              style={{ position: "absolute", top: 4, right: 4, border: "none", background: "none", color: "var(--text-tertiary)", cursor: "pointer", fontSize: 10.5, padding: 2 }}>✕</button>
            <div style={{ fontWeight: 700, marginBottom: 3, paddingRight: 16 }}>Last pasted text (kept so you can fix a bad parse):</div>
            <div style={{ whiteSpace: "pre-wrap", maxHeight: 90, overflowY: "auto" }}>{lastPasteText}</div>
            {lastSingleParse && (
              <div style={{ marginTop: 5 }}>
                Treated as ONE record.{" "}
                <button onClick={switchToOnePerLine} style={{ border: "none", background: "none", color: "var(--accent)", cursor: "pointer", padding: 0, textDecoration: "underline", fontSize: 10.5 }}>
                  Split into one row per line instead
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "8px 14px" }}>
        {armedRowId && (
          <div style={{ fontSize: 12, color: "var(--warn-text)", background: "var(--warn-bg)", border: "1px solid var(--warn-border)", borderRadius: 6, padding: "6px 8px", marginBottom: 8 }}>
            Now click <strong>Drop a pin</strong> or <strong>Comp from parcel</strong> on the map, then click the map — the location lands on the row you picked. The map stays fully usable while you do this.{" "}
            <button onClick={() => onArm(null)} style={{ border: "none", background: "none", color: "inherit", textDecoration: "underline", cursor: "pointer", padding: 0, marginLeft: 4 }}>Cancel</button>
          </div>
        )}
        {rows.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text-secondary)", padding: "18px 4px", textAlign: "center" }}>
            Paste a few comps above to get started.
          </div>
        ) : (
          <div style={{ minWidth: 640, overflowX: "auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: COLS, gap: 6, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-secondary)", paddingBottom: 4, borderBottom: "1px solid var(--border-default)" }}>
              <span>Type</span><span>Date</span><span>Price / Rate</span><span>Annual</span><span>Size</span><span>Location</span><span /><span />
            </div>
            {rows.map((row) => (
              <GridRow key={row._id} row={row} onChange={updateRow} onRemove={removeRow}
                onFocusAnchor={onFocusAnchor} onArm={onArm} armed={armedRowId === row._id} />
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 14px", borderTop: "1px solid var(--border-default)" }}>
        <span style={{ fontSize: 10.5, color: "var(--text-secondary)" }}>{footerMsg}</span>
        <span style={{ display: "flex", gap: 8 }}>
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>Close</Button>
          <Button size="sm" onClick={() => onSave(readyRows)} disabled={saving || readyRows.length === 0}>
            {saving ? "Saving…" : `Save ${readyRows.length || ""} comp${readyRows.length === 1 ? "" : "s"}`.trim()}
          </Button>
        </span>
      </div>
      {saveError && <div style={{ fontSize: 12, color: "var(--danger-text)", padding: "0 14px 10px" }}>{saveError}</div>}
    </div>,
    document.body,
  );
}
