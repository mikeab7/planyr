/* CompEntryGrid — the paste-box-over-a-row-grid comp entry surface (B849232/NEW-1), replacing
 * the old one-comp-at-a-time form as the CREATE path. Michael enters comps in batches, copied
 * out of broker emails; this is the review surface itself — parsed values land straight in
 * typed, editable cells, there is no separate confirm step (`docs/comp-entry` decision,
 * 2026-09-01).
 *
 * WIDTH — measured, not guessed. The Comps rail is 232px wide on desktop (MapFinder.jsx's
 * left-rail card, `width: 232`), narrower than the ~380px this feature was scoped against. A
 * multi-column grid is unusable at 232px under any column count. Rejected: (a) widening the
 * docked rail itself — that constant is shared with the Sites tab and the map-chrome stack
 * (`MAP_OVERLAY_*`), and a sibling session is hardening the site-plan-overlay code in this same
 * file this week, so touching its layout constants is exactly the shared-file risk the task
 * asked to avoid; (b) a bare horizontal scrollbar inside the 232px card — technically enough,
 * but every column past the first would be scrolled out of sight AT ALL TIMES, which fails
 * "the grid is the review surface" (a review surface you can't see is not one). Landed on: a
 * self-contained, portaled OVERLAY CARD (below) — effectively "widen the panel", but scoped to
 * this one flow instead of the persistent rail, so it touches nothing MapFinder.jsx already
 * owns. It still scrolls horizontally as a second line of defense on a narrow phone.
 *
 * Two kinds of uncertainty (compParse.js's contract) render with DIFFERENT chrome, never the
 * same amber: a SOFT cell (`--warn-*` tokens, a pencil glyph) the user MAY fix, and a BLOCKING
 * cell reuses the app's existing genuinely-rejected-value convention (`aria-invalid="true"`,
 * `--danger`, a ⚠ glyph — index.css) because that state already means "must fix before this can
 * save" everywhere else in the app; inventing a second red would be a second vocabulary for the
 * same fact.
 *
 * MODULE-SCOPE-COMPONENTS: every component here is defined at module scope.
 */
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../ui/controls.jsx";
import { parsePaste, rowHasBlockingFlags, parseProseLine } from "../lib/compParse.js";
import { emptyDraft, draftToComp, validateComp, annualLeaseRate, partyLabels } from "../lib/comps.js";

const TYPE_LABEL = { land: "Land", building_sale: "Bldg sale", lease: "Lease" };

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

function FlagGlyph({ flag }) {
  if (!flag) return null;
  return (
    <span title={flag.reason} aria-label={flag.reason}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", width: 14, height: 14,
        borderRadius: 999, fontSize: 10, fontWeight: 900, flex: "none", cursor: "help", lineHeight: 1,
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
    <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      <FlagGlyph flag={flag} />
    </div>
  );
}

// Reused by both the Price/Rate column and the annual-equivalent readout beneath it — the ONE
// place a lease row's normalized figure is computed, off the shared pure `annualLeaseRate`
// (comps.js) so this can never disagree with the detail view or the rail's own averages.
function LeaseAnnualLine({ draft }) {
  const comp = draftToComp(draft);
  const annual = annualLeaseRate(comp);
  if (annual == null) return <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>—/yr</span>;
  const basis = draft.leaseRateExpense ? draft.leaseRateExpense.toUpperCase() : "basis?";
  return <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>${annual.toFixed(2)}/yr {basis}</span>;
}

function GridRow({ row, onChange, onRemove, onFocusAnchor, onArm, armed }) {
  const { draft, cellFlags } = row;
  const set = (key) => (e) => onChange({ ...row, draft: { ...draft, [key]: e.target.value }, cellFlags: withFlagCleared(cellFlags, key) });
  const [expanded, setExpanded] = useState(false);
  const { provider: providerLabel, acquirer: acquirerLabel } = partyLabels(draft.compType);
  const canFocus = !!draft.anchor;

  return (
    <div style={{ borderBottom: "1px solid var(--border-default)", padding: "7px 0" }}>
      <div
        onClick={() => canFocus && onFocusAnchor(draft.anchor)}
        style={{ display: "grid", gridTemplateColumns: "72px 108px 1fr 96px 1fr 96px 46px", gap: 6, alignItems: "center", cursor: canFocus ? "pointer" : "default" }}>
        <select aria-label="Comp type" value={draft.compType} onChange={(e) => onChange({ ...row, draft: { ...draft, compType: e.target.value }, cellFlags: withFlagCleared(cellFlags, "compType") })}
          onClick={(e) => e.stopPropagation()} style={cellStyle(cellFlags.compType)}>
          {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>

        <Cell flag={cellFlags.compDate}>
          <input aria-label="Date" type="date" value={draft.compDate} onChange={set("compDate")} onClick={(e) => e.stopPropagation()} style={cellStyle(cellFlags.compDate)} />
        </Cell>

        {draft.compType === "lease" ? (
          <Cell flag={cellFlags.leaseRate || cellFlags.leaseRatePeriod}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", gap: 4 }}>
                <input aria-label="Lease rate $/SF" type="number" value={draft.leaseRate} onChange={set("leaseRate")} placeholder="$/SF"
                  aria-invalid={cellFlags.leaseRatePeriod?.level === "blocking" ? "true" : undefined}
                  style={{ ...cellStyle(cellFlags.leaseRate), flex: 1 }} />
                <select aria-label="Rate period" value={draft.leaseRatePeriod}
                  onChange={(e) => onChange({ ...row, draft: { ...draft, leaseRatePeriod: e.target.value }, cellFlags: withFlagCleared(cellFlags, "leaseRatePeriod") })}
                  aria-invalid={cellFlags.leaseRatePeriod?.level === "blocking" ? "true" : undefined}
                  style={{ ...cellStyle(cellFlags.leaseRatePeriod), width: 56, flex: "none" }}>
                  <option value="">? / </option>
                  <option value="monthly">/MO</option>
                  <option value="annual">/YR</option>
                </select>
                <select aria-label="Rate basis" value={draft.leaseRateExpense}
                  onChange={(e) => onChange({ ...row, draft: { ...draft, leaseRateExpense: e.target.value }, cellFlags: withFlagCleared(cellFlags, "leaseRateExpense") })}
                  style={{ ...cellStyle(cellFlags.leaseRateExpense), width: 62, flex: "none" }}>
                  <option value="">basis?</option>
                  <option value="nnn">NNN</option>
                  <option value="gross">GROSS</option>
                </select>
              </div>
              <LeaseAnnualLine draft={draft} />
            </div>
          </Cell>
        ) : (
          <Cell flag={cellFlags[draft.compType === "land" ? "landPrice" : "bldgPrice"]}>
            <input aria-label="Price" type="number" placeholder="Price"
              value={draft.compType === "land" ? draft.landPrice : draft.bldgPrice}
              onChange={draft.compType === "land" ? set("landPrice") : set("bldgPrice")}
              onClick={(e) => e.stopPropagation()}
              style={cellStyle(cellFlags[draft.compType === "land" ? "landPrice" : "bldgPrice"])} />
          </Cell>
        )}

        {draft.compType === "land" ? (
          <div style={{ display: "flex", gap: 3 }} onClick={(e) => e.stopPropagation()}>
            <Cell flag={cellFlags.landSizeValue}>
              <input aria-label="Land size" type="number" value={draft.landSizeValue} onChange={set("landSizeValue")} placeholder="Size" style={cellStyle(cellFlags.landSizeValue)} />
            </Cell>
            <select aria-label="Size unit" value={draft.landSizeUnit} onChange={set("landSizeUnit")} style={{ ...cellStyle(null), width: 44, flex: "none" }}>
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
              style={{ border: "1px solid var(--border-default)", background: "var(--surface-raised)", color: "var(--text-secondary)", fontSize: 10.5, borderRadius: 6, padding: "5px 6px", cursor: "pointer", width: "100%" }}>
              📍 Set
            </button>
          ) : (
            <button onClick={() => onArm(row._id)} title="Pick a location for this row on the map"
              style={{
                border: `1px solid ${armed ? "var(--accent)" : "var(--warn-border)"}`, background: armed ? "var(--accent)" : "var(--warn-bg)",
                color: armed ? "var(--on-accent)" : "var(--warn-text)", fontSize: 10.5, borderRadius: 6, padding: "5px 6px", cursor: "pointer", width: "100%", fontWeight: 700,
              }}>
              {armed ? "Picking…" : "＋ Location"}
            </button>
          )}
        </div>

        <div style={{ display: "flex", gap: 2 }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => setExpanded((v) => !v)} title="More fields" aria-label="More fields"
            style={{ border: "none", background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontSize: 12, padding: "4px 2px" }}>
            {expanded ? "▾" : "▸"}
          </button>
          <button onClick={() => onRemove(row._id)} title="Remove row" aria-label="Remove row"
            style={{ border: "none", background: "transparent", color: "var(--danger-text)", cursor: "pointer", fontSize: 12, padding: "4px 2px" }}>
            ✕
          </button>
        </div>
      </div>

      {expanded && (
        <div onClick={(e) => e.stopPropagation()} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 6, paddingLeft: 2 }}>
          <input aria-label={providerLabel} value={draft.partyProvider} onChange={set("partyProvider")} placeholder={providerLabel} style={cellStyle(null)} />
          <input aria-label={acquirerLabel} value={draft.partyAcquirer} onChange={set("partyAcquirer")} placeholder={acquirerLabel} style={cellStyle(null)} />
          {draft.compType === "lease" && (<>
            <input aria-label="TI $/SF" type="number" value={draft.leaseTi} onChange={set("leaseTi")} placeholder="TI $/SF" style={cellStyle(null)} />
            <input aria-label="Term" value={draft.leaseTerm} onChange={set("leaseTerm")} placeholder="Term (e.g. 5 yrs)" style={cellStyle(null)} />
            <input aria-label="Free rent (months)" type="number" value={draft.leaseFreeRentMonths} onChange={set("leaseFreeRentMonths")} placeholder="Free rent (mo)" style={cellStyle(null)} />
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
  const boxRef = useRef(null);

  const appendParsed = (parsedRows) => {
    if (!parsedRows.length) return;
    onRowsChange([...rows, ...parsedRows.map(draftFromParsedRow)]);
  };

  const handlePaste = (e) => {
    const text = e.clipboardData?.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    const { rows: parsedRows } = parsePaste(text);
    appendParsed(parsedRows);
    setPasteText("");
  };

  const handleKeyDown = (e) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    const text = boxRef.current?.value || "";
    if (!text.trim()) return;
    e.preventDefault();
    appendParsed([parseProseLine(text)]);
    setPasteText("");
  };

  const updateRow = (updated) => onRowsChange(rows.map((r) => (r._id === updated._id ? updated : r)));
  const removeRow = (id) => onRowsChange(rows.filter((r) => r._id !== id));

  const readyRows = rows.filter(rowIsReady);
  const blockedCount = rows.length - readyRows.length;

  return createPortal(
    <div
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "fixed", inset: 0, zIndex: 2600, display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(20,18,14,0.35)", // design-exempt: no scrim token exists yet in index.css
      }}>
      <div style={{
        width: "min(760px, calc(100vw - 48px))", maxHeight: "min(84vh, 720px)", display: "flex", flexDirection: "column",
        background: "var(--surface-overlay)", border: "1px solid var(--border-default)", borderRadius: 12,
        boxShadow: "0 16px 44px rgba(28,25,20,0.22), 0 3px 10px rgba(28,25,20,0.1)", // design-exempt: mirrors shared/ui/FloatingPanel.jsx's card shadow verbatim — no shadow token exists yet
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid var(--border-default)" }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>New comps</span>
          <button onClick={onCancel} aria-label="Close" style={{ border: "none", background: "transparent", color: "var(--text-secondary)", fontSize: 14, cursor: "pointer", padding: 2 }}>✕</button>
        </div>

        <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border-default)" }}>
          <textarea
            ref={boxRef}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
            placeholder="Paste comps here — one line per comp from a broker email, or an Excel block (rows and columns). Press Enter to add a single typed line."
            rows={2}
            style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", fontSize: 12, borderRadius: 8, fontFamily: "inherit", border: "1px solid var(--border-default)", background: "var(--surface-base)", color: "var(--text-primary)", resize: "vertical" }}
          />
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "8px 16px" }}>
          {armedRowId && (
            <div style={{ fontSize: 12, color: "var(--warn-text)", background: "var(--warn-bg)", border: "1px solid var(--warn-border)", borderRadius: 6, padding: "6px 8px", marginBottom: 8 }}>
              Now click <strong>Drop a pin</strong> or <strong>Comp from parcel</strong> on the map, then click the map — the location lands on the row you picked. <button onClick={() => onArm(null)} style={{ border: "none", background: "none", color: "inherit", textDecoration: "underline", cursor: "pointer", padding: 0, marginLeft: 4 }}>Cancel</button>
            </div>
          )}
          {rows.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-secondary)", padding: "18px 4px", textAlign: "center" }}>
              Paste a few comps above to get started.
            </div>
          ) : (
            <div style={{ minWidth: 560 }}>
              <div style={{ display: "grid", gridTemplateColumns: "72px 108px 1fr 96px 1fr 96px 46px", gap: 6, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-secondary)", paddingBottom: 4, borderBottom: "1px solid var(--border-default)" }}>
                <span>Type</span><span>Date</span><span>Price / Rate</span><span>Size</span><span>Location</span><span /><span />
              </div>
              {rows.map((row) => (
                <GridRow key={row._id} row={row} onChange={updateRow} onRemove={removeRow}
                  onFocusAnchor={onFocusAnchor} onArm={onArm} armed={armedRowId === row._id} />
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 16px", borderTop: "1px solid var(--border-default)" }}>
          <span style={{ fontSize: 10.5, color: "var(--text-secondary)" }}>
            {rows.length === 0 ? "" : blockedCount > 0
              ? `${readyRows.length} of ${rows.length} ready — ${blockedCount} need a fix (red) or a location.`
              : `${readyRows.length} row${readyRows.length === 1 ? "" : "s"} ready.`}
          </span>
          <span style={{ display: "flex", gap: 8 }}>
            <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>Close</Button>
            <Button size="sm" onClick={() => onSave(readyRows)} disabled={saving || readyRows.length === 0}>
              {saving ? "Saving…" : `Save ${readyRows.length || ""} comp${readyRows.length === 1 ? "" : "s"}`.trim()}
            </Button>
          </span>
        </div>
        {saveError && <div style={{ fontSize: 12, color: "var(--danger-text)", padding: "0 16px 10px" }}>{saveError}</div>}
      </div>
    </div>,
    document.body,
  );
}
