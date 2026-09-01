/* CompDraftsPanel — the KML-import review/promote surface (B849233/NEW-2). Reachable only from
 * the KML import action (CompsPanel's "Import (KML)" button) — hand entry (the paste grid) never
 * creates a row here. Every row is shown for confirmation before it becomes a real comp; nothing
 * is committed silently (the leasing spec's own words for the description-extraction step).
 *
 * A plain in-rail list (unlike CompEntryGrid's portaled overlay) — each card is a single-column
 * stacked form, the same width CompForm already works at, so no width problem to solve here.
 *
 * MODULE-SCOPE-COMPONENTS: every component here is defined at module scope.
 */
import { useState } from "react";
import { Button, Field } from "../../ui/controls.jsx";
import {
  COMP_TYPES, LEASE_PERIODS, LEASE_EXPENSE_BASES, partyLabels, emptyDraft, draftToComp, validateComp,
} from "../lib/comps.js";

const TYPE_LABEL = { land: "Land", building_sale: "Building sale", lease: "Lease" };

const inputStyle = {
  width: "100%", boxSizing: "border-box", padding: "6px 8px", fontSize: 12, borderRadius: 6, fontFamily: "inherit",
  border: "1px solid var(--border-default)", background: "var(--surface-base)", color: "var(--text-primary)",
};

/** A draft's geometry (a raw point, or a polygon's already-computed centroid) resolved to a pin
 * anchor — used only as long as nothing better has been picked. A user pick (via the map, routed
 * through `anchor` prop) always wins over this fallback. */
export function anchorFromGeometry(rawGeometry) {
  if (!rawGeometry) return null;
  if (rawGeometry.kind === "point" && typeof rawGeometry.lat === "number" && typeof rawGeometry.lon === "number") {
    return { kind: "pin", lat: rawGeometry.lat, lon: rawGeometry.lon };
  }
  if (rawGeometry.kind === "polygon" && typeof rawGeometry.centroidLat === "number" && typeof rawGeometry.centroidLon === "number") {
    return { kind: "pin", lat: rawGeometry.centroidLat, lon: rawGeometry.centroidLon };
  }
  return null;
}

function DraftCard({ draft, anchorOverride, armed, onArm, onFocusAnchor, onPromote, onDismiss, busy }) {
  const [fields, setFields] = useState(() => ({ ...emptyDraft(null), ...draft.proposed }));
  const set = (k) => (e) => setFields((f) => ({ ...f, [k]: e.target.value }));
  const geometryAnchor = anchorFromGeometry(draft.rawGeometry);
  const anchor = anchorOverride || geometryAnchor;
  const comp = draftToComp({ ...fields, anchor });
  const errs = validateComp(comp);
  const canPromote = errs.length === 0;
  const { provider: providerLabel, acquirer: acquirerLabel } = partyLabels(fields.compType);
  const isPolygon = draft.rawGeometry?.kind === "polygon";

  return (
    <div style={{ border: "1px solid var(--border-default)", borderRadius: 8, padding: "10px 12px", marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{draft.rawName || "Untitled placemark"}</span>
        {draft.sourceFile && <span style={{ fontSize: 10, color: "var(--text-tertiary)", flex: "none" }}>{draft.sourceFile}</span>}
      </div>

      {draft.rawDescription && (
        <div style={{ fontSize: 10.5, color: "var(--text-secondary)", background: "var(--surface-raised)", borderRadius: 6, padding: "6px 8px", margin: "6px 0", whiteSpace: "pre-wrap" }}>
          {draft.rawDescription}
        </div>
      )}

      <Field label="Type" stacked>
        <select value={fields.compType} onChange={set("compType")} style={inputStyle}>
          {COMP_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </select>
      </Field>
      <Field label="Date" stacked required>
        <input type="date" value={fields.compDate} onChange={set("compDate")} style={inputStyle} />
      </Field>

      {fields.compType === "land" && (<>
        <Field label="Price" stacked><input type="number" value={fields.landPrice} onChange={set("landPrice")} placeholder="optional" style={inputStyle} /></Field>
        <Field label="Size" stacked>
          <span style={{ display: "flex", gap: 6 }}>
            <input type="number" value={fields.landSizeValue} onChange={set("landSizeValue")} placeholder="optional" style={{ ...inputStyle, flex: 1 }} />
            <select value={fields.landSizeUnit} onChange={set("landSizeUnit")} style={{ ...inputStyle, width: 68, flex: "none" }}>
              <option value="ac">AC</option><option value="sf">SF</option>
            </select>
          </span>
        </Field>
      </>)}

      {fields.compType === "building_sale" && (<>
        <Field label="Price" stacked><input type="number" value={fields.bldgPrice} onChange={set("bldgPrice")} placeholder="optional" style={inputStyle} /></Field>
        <Field label="Building SF" stacked><input type="number" value={fields.bldgSizeSf} onChange={set("bldgSizeSf")} placeholder="optional" style={inputStyle} /></Field>
      </>)}

      {fields.compType === "lease" && (<>
        <Field label="Rate ($/SF)" stacked>
          <span style={{ display: "flex", gap: 6 }}>
            <input type="number" value={fields.leaseRate} onChange={set("leaseRate")} placeholder="optional" style={{ ...inputStyle, flex: 1 }} />
            <select value={fields.leaseRatePeriod} onChange={set("leaseRatePeriod")} aria-label="Rate period" style={{ ...inputStyle, width: 60, flex: "none" }}>
              <option value="">?</option>
              {LEASE_PERIODS.map((p) => <option key={p} value={p}>{p === "annual" ? "YR" : "MO"}</option>)}
            </select>
          </span>
        </Field>
        <Field label="Basis" stacked>
          <select value={fields.leaseRateExpense} onChange={set("leaseRateExpense")} style={inputStyle}>
            <option value="">?</option>
            {LEASE_EXPENSE_BASES.map((b) => <option key={b} value={b}>{b.toUpperCase()}</option>)}
          </select>
        </Field>
        <Field label="Leased SF" stacked><input type="number" value={fields.leaseSizeSf} onChange={set("leaseSizeSf")} placeholder="optional" style={inputStyle} /></Field>
      </>)}

      <Field label={providerLabel} stacked><input value={fields.partyProvider} onChange={set("partyProvider")} style={inputStyle} /></Field>
      <Field label={acquirerLabel} stacked><input value={fields.partyAcquirer} onChange={set("partyAcquirer")} style={inputStyle} /></Field>
      <Field label="Notes" stacked><textarea value={fields.notes} onChange={set("notes")} rows={2} style={{ ...inputStyle, resize: "vertical" }} /></Field>

      <Field label="Location" stacked>
        {anchor ? (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button onClick={() => onFocusAnchor(anchor)} style={{ border: "1px solid var(--border-default)", background: "var(--surface-raised)", color: "var(--text-secondary)", fontSize: 10.5, borderRadius: 6, padding: "5px 8px", cursor: "pointer" }}>
              📍 Show on map
            </button>
            <span style={{ fontSize: 10.5, color: "var(--text-tertiary)" }}>
              {isPolygon && !anchorOverride ? "centroid of the imported shape" : anchorOverride ? "picked on the map" : "from the KML point"}
            </span>
            {isPolygon && (
              <button onClick={() => onArm(draft.id)} style={{ border: "none", background: "none", color: "var(--accent)", fontSize: 10.5, cursor: "pointer", padding: 0 }}>
                {armed ? "picking…" : "match a parcel instead"}
              </button>
            )}
          </div>
        ) : (
          <button onClick={() => onArm(draft.id)}
            style={{
              border: `1px solid ${armed ? "var(--accent)" : "var(--warn-border)"}`, background: armed ? "var(--accent)" : "var(--warn-bg)",
              color: armed ? "var(--on-accent)" : "var(--warn-text)", fontSize: 10.5, borderRadius: 6, padding: "5px 8px", cursor: "pointer", fontWeight: 700,
            }}>
            {armed ? "Picking… click the map" : "＋ Pick a location"}
          </button>
        )}
      </Field>

      {draft.promoteError && (
        <div style={{ fontSize: 10.5, color: "var(--danger-text)", background: "var(--danger-bg)", border: "1px solid var(--danger-border)", borderRadius: 6, padding: "5px 8px", marginTop: 4 }}>
          Couldn't promote: {draft.promoteError}
        </div>
      )}
      {!canPromote && !draft.promoteError && (
        <div style={{ fontSize: 10.5, color: "var(--text-tertiary)", marginTop: 4 }}>{errs.join(" ")}</div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <Button size="sm" onClick={() => onPromote(comp)} disabled={busy || !canPromote}>{busy ? "Saving…" : "Promote to comp"}</Button>
        <Button size="sm" variant="ghost" onClick={onDismiss} disabled={busy}>Dismiss</Button>
      </div>
    </div>
  );
}

/** props:
 *  - drafts — pending import drafts (already filtered by the host to status:'pending')
 *  - draftAnchors {id -> anchor} — map-picked overrides, lifted to the host (CompsPanel) because
 *    only it receives `pendingAnchor` from the map
 *  - armedRowId, onArm(id|null) — which draft is waiting for the next map pick
 *  - onFocusAnchor(anchor), onPromote(draftId, comp), onDismiss(draftId)
 *  - busyId — the draft currently mid-promotion/dismiss
 *  - onImportFile(file) — hand a picked .kml File up to the host
 *  - importing, importError
 *  - onBack() — return to the comps list
 */
export default function CompDraftsPanel({
  drafts, draftAnchors, armedRowId, onArm, onFocusAnchor, onPromote, onDismiss, busyId,
  onImportFile, importing, importError, onBack,
}) {
  return (
    <div style={{ padding: "10px 14px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <button onClick={onBack} style={{ border: "none", background: "none", color: "var(--text-secondary)", fontSize: 12, cursor: "pointer", padding: 0 }}>&larr; All comps</button>
        <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-secondary)" }}>Import review</span>
      </div>

      <label style={{
        display: "block", textAlign: "center", border: "1px dashed var(--border-default)", borderRadius: 8, padding: "10px 8px",
        fontSize: 12, color: "var(--text-secondary)", cursor: "pointer", marginBottom: 12,
      }}>
        {importing ? "Reading file…" : "Import another Google My Maps export (.kml)"}
        <input type="file" accept=".kml" style={{ display: "none" }} disabled={importing}
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onImportFile(f); }} />
      </label>
      {importError && <div style={{ fontSize: 12, color: "var(--danger-text)", marginBottom: 10 }}>{importError}</div>}

      {drafts.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--text-secondary)", padding: "18px 4px", textAlign: "center" }}>
          Nothing waiting on review.
        </div>
      ) : (
        drafts.map((d) => (
          <DraftCard key={d.id} draft={d} anchorOverride={draftAnchors[d.id]}
            armed={armedRowId === d.id} onArm={onArm} onFocusAnchor={onFocusAnchor}
            onPromote={(comp) => onPromote(d.id, comp)} onDismiss={() => onDismiss(d.id)}
            busy={busyId === d.id} />
        ))
      )}
    </div>
  );
}
