/* CompsPanel — Leasing Comps: EMBEDDED content for the map's left rail (never a dialog —
 * window.prompt/confirm are banned app-wide), self-contained data owner for the comps list
 * (mirrors pinStore.js's "fetch on mount + refetch on tab focus" shape rather than cloudSync's
 * heavier CAS machinery — comps don't have Site Planner's multi-tab autosave race).
 *
 * B831777 (NEW-2) — this used to be its own floating right-side panel with an "open/close" pair;
 * it is now the Comps TAB's content inside MapFinder's left rail, one tab beside Your sites
 * (never stacked — see BACKLOG.md). Two props carry that: `open` gates DATA (fetch as soon as the
 * map route is visible, regardless of which tab is showing, so a comp anchored earlier still
 * renders as a map pin the moment you land here — B831778/NEW-3's decoupling requirement) and
 * `active` gates DISPLAY (only the currently-selected tab's content is shown). There is no
 * `onClose` any more — switching to the Sites tab IS the close.
 *
 * Two views: 'list' (every comp the viewer can see, with a sale-comp averages strip — NEW-1
 * dropped the lease average from here, see `SummaryStrip` below) and 'form' (create —
 * pre-filled from a just-picked map anchor — or edit an owned comp).
 *
 * MODULE-SCOPE-COMPONENTS: every component here is defined at module scope.
 */
import { useEffect, useRef, useState } from "react";
import { Button, Field } from "../../ui/controls.jsx";
import {
  COMP_TYPES, LEASE_PERIODS, LEASE_EXPENSE_BASES, isCompType, partyLabels,
  landPricePerSf, buildingPricePerSf, leaseTotalAnnualRent, compFieldRows, compHeadline,
  compsSummaryBits, validateComp, emptyDraft, draftToComp, compToDraft, anchorCountyFlag,
  resolveCapTriangle, sortCompsByRecency, compDateLabel, anchorTeamConflict,
} from "../lib/comps.js";
import { compMarkerColor } from "../lib/compMarkerIcon.js";
import { collectPartyNames } from "../lib/partySuggest.js";
import PartyNameField from "./PartyNameField.jsx";
import {
  fetchAllComps, insertComp, insertComps, updateComp, deleteComp,
  fetchDeletedComps, restoreComp, permanentlyDeleteComp,
} from "../lib/compsStore.js";
import { listMyTeams, currentIdentity } from "../../../workspaces/site-planner/lib/teams.js";
import CompEntryGrid, { draftFromParsedRow } from "./CompEntryGrid.jsx";
import CompDraftsPanel from "./CompDraftsPanel.jsx";
import { fetchMyDrafts, insertDrafts, promoteDraft, deleteDraft } from "../lib/compDraftsStore.js";
import { kmlToDraftRows } from "../lib/kmlImport.js";
import { parcelLocationText, siteplanLocationText, pinFallbackText } from "../lib/compLocationText.js";
import { reverseGeocodeLatLon } from "../../../workspaces/site-planner/lib/geocode.js";
import { COUNTIES } from "../../../workspaces/site-planner/lib/counties.js";

// B986096-HARDENING-14 (owner cycle-4 report, minor: "comp list titles a row by rate when Title
// is empty — should fall back to the reverse-geocoded address instead" + "comp detail view
// doesn't show Location at all despite having a real street address") — a comp's real identity,
// once anchored, is WHERE it is, not its rate; falling back to the rate when Title is blank reads
// as though the deal's price IS its name. This mirrors CompEntryGrid.jsx's own Location cell
// (compLocationText.js's three-anchor-kind split) rather than duplicating a second reverse-geocode
// caller — deliberately a SEPARATE, self-contained cache from CompEntryGrid's per-draft-row one
// (CompEntryGrid is a HARDENING-12/13 gate closed this session; this never touches that file).
function countyEntry(key) {
  const rec = key ? COUNTIES[key] : null;
  if (!rec) return null;
  return { name: rec.label ? rec.label.split(" ·")[0].trim() : null, state: rec.state || null };
}
const _pinAddrCache = new Map(); // "lat,lon" -> resolved address string | null, shared across every mounted row/detail view this session
const _pinAddrInflight = new Map();
function pinCacheKey(anchor) {
  return anchor && typeof anchor.lat === "number" && typeof anchor.lon === "number"
    ? `${anchor.lat.toFixed(6)},${anchor.lon.toFixed(6)}`
    : null;
}
/** A saved comp's Location text — parcel APN / site-plan title synchronously, a pin's reverse-
 * geocoded street address once resolved (the synchronous county/coordinate fallback until then). */
function useCompLocationText(anchor, overlaysById) {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!anchor || anchor.kind !== "pin") return;
    const key = pinCacheKey(anchor);
    if (!key || _pinAddrCache.has(key) || _pinAddrInflight.has(key)) return;
    const p = reverseGeocodeLatLon(anchor.lat, anchor.lon)
      .then((ans) => { _pinAddrCache.set(key, ans?.label || null); })
      .catch(() => { _pinAddrCache.set(key, null); })
      .finally(() => { _pinAddrInflight.delete(key); bump((n) => n + 1); });
    _pinAddrInflight.set(key, p);
  }, [anchor]);
  if (!anchor) return null;
  if (anchor.kind === "parcel") return parcelLocationText(anchor, (k) => countyEntry(k)?.name);
  if (anchor.kind === "site_plan") return siteplanLocationText(anchor, overlaysById) || pinFallbackText(anchor, countyEntry);
  const key = pinCacheKey(anchor);
  const resolved = key ? _pinAddrCache.get(key) : null;
  return resolved || pinFallbackText(anchor, countyEntry);
}

const TYPE_LABEL = { land: "Land", building_sale: "Building sale", lease: "Lease" };

const inputStyle = {
  width: "100%", padding: "6px 8px", fontSize: 12.5, borderRadius: 6, fontFamily: "inherit",
  border: "1px solid var(--border-default)", background: "var(--surface-base)", color: "var(--text-primary)",
};

function TypeChip({ type }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 700,
      textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-secondary)",
    }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, background: compMarkerColor(type), transform: "rotate(45deg)" }} />
      {TYPE_LABEL[type] || type}
    </span>
  );
}

// NEW-1: the rail lists comps, it is not a summary surface — LEASE deliberately contributes no
// line here (see `compsSummaryBits` in lib/comps.js for why; the lease aggregation itself is
// untouched and still fully unit-tested there).
function SummaryStrip({ comps }) {
  const bits = compsSummaryBits(comps);
  if (!bits.length) return null;
  return (
    <div style={{ fontSize: 11, color: "var(--text-secondary)", padding: "0 14px 8px", lineHeight: 1.5 }}>
      {bits.join(" · ")}
    </div>
  );
}

export function CompRow({ comp, onOpen, overlaysById }) {
  // HARDENING-14 — a comp's own title wins; absent that, its LOCATION (a real identity — an
  // address, an APN, a plan name) is a better row title than its rate, which is what used to show.
  const locationText = useCompLocationText(comp.anchor, overlaysById);
  const primary = comp.title || locationText;
  return (
    <button onClick={() => onOpen(comp)} style={{
      display: "block", width: "100%", textAlign: "left", padding: "9px 14px", border: "none",
      borderBottom: "1px solid var(--border-default)", background: "transparent", cursor: "pointer", fontFamily: "inherit",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 650, color: "var(--text-primary)" }}>{primary || compHeadline(comp)}</span>
        {/* NEW-5 — a comp saved with no Executed date reads "Date unknown" rather than a blank
            gap; the tooltip states what it's sorted by instead (its own "Date entered" field is
            the full explanation, one click away in the detail view). */}
        <span style={{ fontSize: 11, color: "var(--text-secondary)", flex: "none" }}
          title={comp.compDate ? undefined : "No Executed date on file — sorted by the date this comp was entered"}>
          {compDateLabel(comp.compDate)}
        </span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 3 }}>
        <TypeChip type={comp.compType} />
        {primary && <span style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{compHeadline(comp)}</span>}
      </div>
    </button>
  );
}

// B1066368 — one row in the "Recently deleted" trash list, mirroring SitePlansSection.jsx's own
// trash row shape (identity + Restore + Delete forever). Reuses the same identity resolution as
// CompRow (title, else a real Location, else the rate headline) rather than a bare id or type.
function TrashRow({ comp, overlaysById, onRestore, onPurge }) {
  const locationText = useCompLocationText(comp.anchor, overlaysById);
  const primary = comp.title || locationText || compHeadline(comp);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 0", borderTop: "1px solid var(--border-default)" }}>
      <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={primary || undefined}>
        {primary} <span style={{ fontSize: 10.5, color: "var(--text-secondary)" }}>· {compDateLabel(comp.compDate)}</span>
      </div>
      <Button size="sm" variant="ghost" onClick={() => onRestore(comp)}>Restore</Button>
      <Button size="sm" variant="ghost" style={{ color: "var(--danger-text)" }} onClick={() => onPurge(comp)}>Delete forever</Button>
    </div>
  );
}

// A comp pinned on a site plan links back to its source brochure — provenance, not just a
// number (NEW-1/B848848: "a lease comp whose brochure is one click away is worth
// considerably more than one with a number and no provenance"). `overlay` may be null (the
// overlay list hasn't loaded yet, or the overlay was since removed) — the link only renders
// once the overlay it points to is actually known.
// B972512-HARDENING item 21 — DECIDED, deliberately: hiding a site-plan overlay (its own
// Visible toggle in SitePlansSection) never hides the comps pinned to it. A comp's lat/lon is
// real, independent, kept-in-sync data (item 1) — it stays exactly as meaningful as a plain pin
// or a parcel anchor regardless of whether its underlying plan IMAGE happens to be showing, and
// hiding it too would destroy information a person might specifically want (see the plan's messy
// old flyer image, but keep seeing where the comps are). What "with no context" would actually
// mean is fixed here instead: `overlaysById` is keyed from the FULL overlay list (not the
// zoom/visibility-filtered one MapFinder draws), so this link — and the note below when the
// plan itself is hidden — is always available, at any zoom, whether or not the plan is showing.
function SourceBrochureLink({ comp, overlaysById, onOpenBrochure }) {
  if (comp.anchor?.kind !== "site_plan" || !comp.anchor.sitePlanOverlayId) return null;
  const overlay = overlaysById && overlaysById[comp.anchor.sitePlanOverlayId];
  if (!overlay || !onOpenBrochure) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <button
        onClick={() => onOpenBrochure(overlay)}
        style={{ border: "none", background: "none", color: "var(--accent)", fontSize: 12, cursor: "pointer", padding: 0, textAlign: "left" }}
      >
        Open source brochure{overlay.docTitle ? ` — ${overlay.docTitle}` : ""} (p.{overlay.page}) ↗
      </button>
      {!overlay.visible && (
        <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 3 }}>
          This plan is currently hidden on the map.
        </div>
      )}
    </div>
  );
}

export function CompDetail({ comp, canEdit, onEdit, onDelete, onBack, overlaysById, onOpenBrochure }) {
  const rows = compFieldRows(comp);
  // HARDENING-14 — the detail view showed every structured field EXCEPT where the comp actually
  // is, despite that being real, already-resolved information (an address, an APN, a plan name).
  const locationText = useCompLocationText(comp.anchor, overlaysById);
  // B1066369 (owner live-drive report — "delete has no confirmation step") — a comp used to be
  // destroyed on the click that registers, with no way to back out. An inline "Delete? Confirm /
  // Cancel" on the button itself, per the no-dialog-box-edits rule, rather than a modal. Resets
  // whenever a different comp is opened, so leaving this comp's detail view (or landing on
  // another one) never carries an armed confirm forward.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  useEffect(() => { setConfirmingDelete(false); }, [comp.id]);
  return (
    <div style={{ padding: "10px 14px 14px" }}>
      {/* Two distinct things, spaced as such (NEW-4) — a real flex gap, with wrap so a long
          badge like "BUILDING SALE" never collides with the back link at the panel's narrow
          width instead of overlapping it. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <button onClick={onBack} style={{ border: "none", background: "none", color: "var(--text-secondary)", fontSize: 12, cursor: "pointer", padding: 0 }}>&larr; All comps</button>
        <TypeChip type={comp.compType} />
      </div>
      {comp.title && <div style={{ fontSize: 15, fontWeight: 700, marginTop: 6 }}>{comp.title}</div>}
      <div style={{ marginTop: 10 }}>
        {locationText && <Field label="Location"><span style={{ fontSize: 12.5 }}>{locationText}</span></Field>}
        {rows.map((r) => (
          <Field key={r.key} label={r.label}><span style={{ fontSize: 12.5 }}>{r.value}</span></Field>
        ))}
      </div>
      <SourceBrochureLink comp={comp} overlaysById={overlaysById} onOpenBrochure={onOpenBrochure} />
      {canEdit && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          {confirmingDelete ? (
            <>
              <span style={{ fontSize: 12, color: "var(--danger-text)" }}>Delete this comp?</span>
              <Button size="sm" variant="danger" onClick={() => onDelete(comp)}>Confirm</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(false)}>Cancel</Button>
            </>
          ) : (
            <>
              <Button size="sm" onClick={() => onEdit(comp)}>Edit</Button>
              <Button size="sm" variant="danger" onClick={() => setConfirmingDelete(true)}>Delete</Button>
            </>
          )}
        </div>
      )}
      {!canEdit && <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 10 }}>Entered by a teammate — only they can edit or remove this comp.</div>}
    </div>
  );
}

function CompForm({ draft, setDraft, teams, projects, partyNames, errors, onSave, onCancel, saving }) {
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const { provider: providerLabel, acquirer: acquirerLabel } = partyLabels(draft.compType);
  // NEW-9 — a parcel-anchored comp's Size arrives prefilled from the map selection; say so, and
  // say it stops being true the moment he edits it (STANDING RULE-driven honesty, not decoration).
  const sizeFromParcel = draft.anchor?.acreageAc != null;
  const sizeEdited = sizeFromParcel && draft.landSizeValue !== String(Math.round(draft.anchor.acreageAc * 100) / 100);
  return (
    <div style={{ padding: "10px 14px 14px" }}>
      {/* A real section header, not just a back-link — so this form reads as its OWN block,
          never as though it belongs to the site-plan controls sitting above it in the rail. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-secondary)" }}>
          {draft.id ? "Edit comp" : "New comp"}
        </span>
        <button onClick={onCancel} style={{ border: "none", background: "none", color: "var(--text-secondary)", fontSize: 12, cursor: "pointer", padding: 0 }}>&larr; Cancel</button>
      </div>

      <Field label="Type" stacked>
        <select value={draft.compType} onChange={set("compType")} style={inputStyle} disabled={!!draft.id}>
          {COMP_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </select>
      </Field>
      {/* NEW-5 (owner decision, 2026-09-02) — no longer required to save; the native date input's
          own picker already offers a "Today" shortcut in every browser that supports type=date. */}
      <Field label="Executed date" stacked>
        <input type="date" value={draft.compDate} onChange={set("compDate")} style={inputStyle} />
      </Field>
      {draft.compType === "lease" && (
        <Field label="Commencement" stacked>
          <input type="date" value={draft.leaseCommencementDate} onChange={set("leaseCommencementDate")} style={inputStyle} />
        </Field>
      )}
      <Field label="Title" stacked><input value={draft.title} onChange={set("title")} placeholder="Property / deal name" style={inputStyle} /></Field>

      {/* Facts about the deal's PARTIES, not its economics — kept with Title, ahead of the
          money block, so the rate/price figures stay together and readable (NEW-7 amended).
          Labels follow the comp's own type; the two stored columns are one shared axis. */}
      <Field label={providerLabel} stacked>
        <PartyNameField
          label={providerLabel}
          value={draft.partyProvider}
          onChange={(v) => setDraft((d) => ({ ...d, partyProvider: v }))}
          candidates={partyNames}
          listboxId="comp-party-provider-suggest"
        />
      </Field>
      <Field label={acquirerLabel} stacked>
        <PartyNameField
          label={acquirerLabel}
          value={draft.partyAcquirer}
          onChange={(v) => setDraft((d) => ({ ...d, partyAcquirer: v }))}
          candidates={partyNames}
          listboxId="comp-party-acquirer-suggest"
        />
      </Field>

      {draft.compType === "land" && (
        <>
          <Field label="Price" stacked><input type="number" value={draft.landPrice} onChange={set("landPrice")} placeholder="optional" style={inputStyle} /></Field>
          <Field label="Size" stacked>
            <span style={{ display: "flex", gap: 6 }}>
              <input type="number" value={draft.landSizeValue} onChange={set("landSizeValue")} placeholder="optional" style={{ ...inputStyle, flex: 1 }} />
              <select value={draft.landSizeUnit} onChange={set("landSizeUnit")} style={{ ...inputStyle, width: 68, flex: "none" }}>
                <option value="ac">AC</option><option value="sf">SF</option>
              </select>
            </span>
            {sizeFromParcel && (
              <div style={{ fontSize: 10.5, color: "var(--text-tertiary)", marginTop: 3 }}>
                {sizeEdited ? "Overrides the measured parcel selection." : "From the parcels you selected on the map — edit to override."}
              </div>
            )}
          </Field>
          {draft.landPrice && draft.landSizeValue && (
            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: -4, marginBottom: 8 }}>
              {(() => { const psf = landPricePerSf(draftToComp(draft)); return psf != null ? `$${psf.toFixed(2)}/SF` : null; })()}
            </div>
          )}
        </>
      )}

      {draft.compType === "building_sale" && (
        <>
          <Field label="Price" stacked><input type="number" value={draft.bldgPrice} onChange={set("bldgPrice")} placeholder="optional — derives from NOI + Cap" style={inputStyle} /></Field>
          <Field label="Building SF" stacked><input type="number" value={draft.bldgSizeSf} onChange={set("bldgSizeSf")} placeholder="optional" style={inputStyle} /></Field>
          {draft.bldgPrice && draft.bldgSizeSf && (
            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: -4, marginBottom: 8 }}>
              {(() => { const psf = buildingPricePerSf(draftToComp(draft)); return psf != null ? `$${psf.toFixed(2)}/SF` : null; })()}
            </div>
          )}
          {/* B986096-HARDENING-7 — enter any two of Price/NOI/Cap, the third derives (never
              overwriting a typed value). Cap is typed and shown as a percentage (5.75) but held
              internally as a decimal fraction (0.0575) — see resolveCapTriangle's header. */}
          <Field label="NOI ($)" stacked><input type="number" value={draft.bldgNoi} onChange={set("bldgNoi")} placeholder="optional — derives from Price + Cap" style={inputStyle} /></Field>
          <Field label="Cap rate (%)" stacked>
            <input
              type="number"
              value={draft.bldgCapRate === "" || draft.bldgCapRate == null ? "" : String(Number(draft.bldgCapRate) * 100)}
              onChange={(e) => setDraft((d) => ({ ...d, bldgCapRate: e.target.value === "" ? "" : String(Number(e.target.value) / 100) }))}
              placeholder="optional — derives from Price + NOI"
              style={inputStyle}
            />
          </Field>
          {(() => {
            const tri = resolveCapTriangle(draft);
            if (tri.disagreement) {
              const stated = (tri.disagreement.statedCapRate * 100).toFixed(2);
              const implied = (tri.disagreement.impliedCapRate * 100).toFixed(2);
              return (
                <div style={{ fontSize: 11, color: "var(--warn-text)", marginTop: -4, marginBottom: 8 }}>
                  Price, NOI and Cap don't reconcile: stated cap {stated}%, but NOI ÷ Price implies {implied}%. Nothing changed automatically.
                </div>
              );
            }
            const derivedEntry = ["price", "noi", "capRate"].map((k) => [k, tri[k]]).find(([, v]) => v.derived && v.value != null);
            if (!derivedEntry) return null;
            const [key, cell] = derivedEntry;
            const shown = key === "capRate" ? `${(cell.value * 100).toFixed(2)}%` : `$${cell.value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
            const label = key === "capRate" ? "Cap" : key === "noi" ? "NOI" : "Price";
            return (
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: -4, marginBottom: 8 }}>
                {label} derives to {shown}
              </div>
            );
          })()}
        </>
      )}

      {draft.compType === "lease" && (
        <>
          {/* Rate + its period read as ONE quantity ("$.65 MO") — a compact MO/YR control right
              after the rate input, not a separate full-width row (NEW-1). Still a real labelled
              <select> (aria-label), just visually compact; stored values are untouched. */}
          <Field label="Rate ($/SF)" stacked>
            <span style={{ display: "flex", gap: 6 }}>
              <input type="number" value={draft.leaseRate} onChange={set("leaseRate")} placeholder="optional" style={{ ...inputStyle, flex: 1 }} />
              <select value={draft.leaseRatePeriod} onChange={set("leaseRatePeriod")} aria-label="Rate period" style={{ ...inputStyle, width: 60, flex: "none" }}>
                {LEASE_PERIODS.map((p) => <option key={p} value={p}>{p === "annual" ? "YR" : "MO"}</option>)}
              </select>
            </span>
          </Field>
          <Field label="Basis" stacked>
            <select value={draft.leaseRateExpense} onChange={set("leaseRateExpense")} style={inputStyle}>
              {LEASE_EXPENSE_BASES.map((b) => <option key={b} value={b}>{b.toUpperCase()}</option>)}
            </select>
          </Field>
          <Field label="Leased SF" stacked><input type="number" value={draft.leaseSizeSf} onChange={set("leaseSizeSf")} placeholder="optional" style={inputStyle} /></Field>
          {draft.leaseRate && draft.leaseSizeSf && (
            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: -4, marginBottom: 8 }}>
              {(() => { const rent = leaseTotalAnnualRent(draftToComp(draft)); return rent != null ? `${rent.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 })}/yr total (face)` : null; })()}
            </div>
          )}
          <Field label="TI $/SF" stacked><input type="number" value={draft.leaseTi} onChange={set("leaseTi")} placeholder="optional" style={inputStyle} /></Field>
          <Field label="Term" stacked><input value={draft.leaseTerm} onChange={set("leaseTerm")} placeholder="e.g. 5 yrs" style={inputStyle} /></Field>
          <Field label="Free rent (mo)" stacked><input type="number" value={draft.leaseFreeRentMonths} onChange={set("leaseFreeRentMonths")} placeholder="optional" style={inputStyle} /></Field>
          <Field label="Escalation %/yr" stacked><input type="number" value={draft.leaseEscalationPct} onChange={set("leaseEscalationPct")} placeholder="optional" style={inputStyle} /></Field>
        </>
      )}

      <Field label="Notes" stacked><textarea value={draft.notes} onChange={set("notes")} rows={3} style={{ ...inputStyle, resize: "vertical" }} /></Field>

      {teams?.length > 0 && (
        <Field label="Share with team" stacked>
          <select value={draft.teamId || ""} onChange={(e) => setDraft((d) => ({ ...d, teamId: e.target.value || null }))} style={inputStyle}>
            <option value="">Just me</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
      )}
      {projects?.length > 0 && (
        <Field label="Project (optional)" stacked>
          <select value={draft.projectId || ""} onChange={(e) => setDraft((d) => ({ ...d, projectId: e.target.value || null }))} style={inputStyle}>
            <option value="">No project</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.site || p.name}</option>)}
          </select>
        </Field>
      )}

      {errors.length > 0 && (
        <div style={{ fontSize: 11.5, color: "var(--danger-text)", marginTop: 6 }}>{errors.join(" ")}</div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <Button size="sm" onClick={onSave} disabled={saving}>{saving ? "Saving…" : "Save comp"}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
      </div>
    </div>
  );
}

/** props:
 *  - open — fetch/keep-fresh gate. Pass the map route's own `visible`, NOT whether the Comps tab
 *    is selected: a comp anchored while browsing Sites must still be a map pin (NEW-3).
 *  - active — DISPLAY gate: is the Comps tab the one currently showing in the rail. Content stays
 *    mounted (not torn down) while inactive so its scroll position / in-progress form survive a
 *    tab flip; only `display` toggles.
 *  - pendingAnchor {kind,lat,lon,county,parcelApn,parcelGeom} | null, onAnchorConsumed()
 *  - focusCompId, onFocusHandled()
 *  - projects [{id,site|name}] — the host's already-loaded site list, for the optional
 *    project-association dropdown (cheap to pass down; no separate fetch needed)
 *  - onCompsChange(comps) — fired whenever the loaded list changes, so a map layer can render it
 *  - overlaysById {id -> overlay} — the host's already-loaded site-plan-overlay list, keyed by
 *    id, so a site_plan-anchored comp's detail view can show + open its source brochure
 *  - onOpenBrochure(overlay) — open that overlay's source document in Review, at its page (B848848)
 *  - onFocusAnchor(anchor) — pan/zoom the map to a {lat,lon} the paste-grid isn't done with yet
 *    (B849232/NEW-1: clicking an entry-grid row highlights its location before it's even saved)
 *
 * currentUserId and the team list are fetched INTERNALLY (mirrors this module's own
 * self-contained-data-owner shape) rather than threaded through the host, since neither is
 * otherwise held by SitePlannerApp today.
 */
export default function CompsPanel({
  open, active = true, pendingAnchor, onAnchorConsumed, focusCompId, onFocusHandled,
  projects, onCompsChange, overlaysById, onOpenBrochure, reloadToken, onFocusAnchor,
  onArmMapPin, onDisarmMapPin,
}) {
  const [comps, setComps] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [view, setView] = useState("list"); // list | detail | form | grid | drafts
  const [activeComp, setActiveComp] = useState(null);
  const [draft, setDraft] = useState(null);
  const [errors, setErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [teams, setTeams] = useState([]);
  // B849232/NEW-1 — the paste-grid create surface. `gridRows` is a client-side staging array,
  // never persisted until Save; `armedRowId` tracks which row is waiting for the NEXT map-picked
  // anchor (set by that row's "＋ Location" button) so a plain "Drop a pin"/"Comp from parcel"
  // click routes its result to that row instead of opening a fresh one.
  const [gridRows, setGridRows] = useState([]);
  const [armedRowId, setArmedRowId] = useState(null);
  const [gridSaving, setGridSaving] = useState(false);
  const [gridSaveError, setGridSaveError] = useState(null);
  // ⛔ HARDENING-13 (B986096, owner P0 live-test, "clicking [Location] arms pin placement") —
  // arming a row used to only set `armedRowId`; the map's OWN "am I placing a pin right now" state
  // (`placingCompPin`, owned entirely inside MapFinder) was a SEPARATE switch the user still had to
  // flip by hand via the toolbar's "Drop a pin" button — so "click Location, then click the map"
  // silently did nothing, because the map was never told to start listening for that click. This
  // wrapper arms BOTH in one call; disarming (id === null, the Escape/Cancel path) only clears the
  // row side — the map's own Cancel/Escape already owns turning `placingCompPin` back off.
  const armRow = (id) => { setArmedRowId(id); if (id) onArmMapPin?.(); else onDisarmMapPin?.(); };
  // B849233/NEW-2 — the KML-import draft staging area. `armedRowId` above is a SINGLE slot
  // shared with the grid: it names either a grid row's `_id` or a draft's real uuid, and the
  // pendingAnchor effect below checks which. `draftAnchors` is the map-picked override per draft
  // (lifted here because only this component receives `pendingAnchor` from the map); an
  // unpicked draft falls back to its KML geometry (a point, or a polygon's centroid) inside
  // CompDraftsPanel itself.
  const [drafts, setDrafts] = useState([]);
  const [draftAnchors, setDraftAnchors] = useState({});
  const [draftBusyId, setDraftBusyId] = useState(null);
  const [kmlImporting, setKmlImporting] = useState(false);
  const [kmlImportError, setKmlImportError] = useState(null);
  // B1066368 (owner live-drive report — "deleting a comp destroys it with no confirmation and no way
  // back") — "Recently deleted", mirroring SitePlansSection.jsx's own trash disclosure over
  // site_plan_overlays: fetched lazily, only once the disclosure is opened.
  const [trash, setTrash] = useState([]);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashError, setTrashError] = useState(null);
  const notifiedRef = useRef(onCompsChange);
  notifiedRef.current = onCompsChange;

  useEffect(() => {
    if (!open) return;
    currentIdentity().then(({ uid }) => setCurrentUserId(uid));
    listMyTeams().then(setTeams).catch(() => setTeams([]));
  }, [open]);

  const reload = async () => {
    setLoading(true);
    const { data, error } = await fetchAllComps();
    setLoading(false);
    if (error) { setLoadError(error.message || "Failed to load comps"); return; }
    setLoadError(null);
    // NEW-5 — the definitive recency order: newest Executed date first, an undated comp falling
    // back to its own Date entered rather than the DB's raw `comp_date desc` order (which,
    // post-migration, would otherwise put every undated comp first under Postgres's own NULLS
    // FIRST default for a DESC sort — exactly backwards for a genuinely unset field).
    const sorted = sortCompsByRecency(data);
    setComps(sorted);
    notifiedRef.current?.(sorted);
  };

  useEffect(() => { if (open) reload(); }, [open]);

  // B849233/NEW-2 — pending import drafts, fetched the same way (RLS already scopes to owner).
  const reloadDrafts = async () => {
    const { data } = await fetchMyDrafts();
    setDrafts((data || []).filter((d) => d.status === "pending"));
  };
  useEffect(() => { if (open) reloadDrafts(); }, [open]);

  // A site-plan overlay placement move recomputed some comps' positions server-side
  // (B972512-HARDENING item 1) — refetch right away rather than waiting for the tab-focus
  // refetch below to notice. Guarded on a truthy token so the initial render (token 0) doesn't
  // double-fetch alongside the [open] effect above.
  useEffect(() => { if (open && reloadToken) reload(); }, [reloadToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refetch on tab focus, mirroring pinStore.js's cross-device convenience (latency-insensitive
  // reference data — no realtime channel needed for a first shipment of this feature).
  useEffect(() => {
    if (!open) return undefined;
    const onVisible = () => { if (document.visibilityState === "visible") reload(); };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.removeEventListener("focus", onVisible); document.removeEventListener("visibilitychange", onVisible); };
  }, [open]);

  // A just-picked map anchor: routes to the ARMED row if one is waiting — either a grid row (a
  // "＋ Location" pick from the paste-grid) or a draft under review (a "＋ Pick a location" /
  // "match a parcel instead" pick from CompDraftsPanel), `armedRowId` being a single shared slot
  // across both. With nothing armed, it opens the grid pre-seeded with one new row carrying it —
  // the grid IS the create surface now (B849232/NEW-1 replaces the old single-comp create form;
  // editing an already-saved comp still uses the field form below).
  // ⛔ HARDENING-12 (B986096, owner P0 live-test) — "the toolbar pin ignores the row and makes a
  // new one." The map toolbar's "Drop a pin"/"Comp from parcel" buttons arm the MAP directly, a
  // SEPARATE mechanism from the grid's own per-row arming above (`armedRowId`) — a user reaching
  // for the toolbar while a pasted row is still waiting for a location never touched a row's
  // Location cell, so `armedRowId` was null and every pick appended a fresh orphan row instead of
  // answering the one already waiting. Now: with nothing explicitly armed, the grid open, and at
  // least one row genuinely missing a location, the pick fills the TOPMOST such row — only a
  // fully-answered sheet (or the grid being closed) still appends a new row.
  useEffect(() => {
    if (!pendingAnchor) return;
    // B986096-HARDENING-7 — "log it and say so": a location that resolved with no county gets a
    // soft, non-blocking flag on the row's Location cell (comps.js's `anchorCountyFlag`) instead
    // of a silent null — cleared automatically the moment a later pick DOES carry one.
    const locFlag = anchorCountyFlag(pendingAnchor);
    if (armedRowId) {
      if (gridRows.some((r) => r._id === armedRowId)) {
        // NEW-2 — picking a location for an armed row is a real edit to that row; mark it
        // `touched` here too so the quiet pre-touch validation message (CompEntryGrid.jsx's
        // ProblemsList) upgrades to the real one once the row genuinely has been acted on.
        setGridRows((rows) => rows.map((r) => {
          if (r._id !== armedRowId) return r;
          const cellFlags = { ...r.cellFlags };
          if (locFlag) cellFlags.location = locFlag; else delete cellFlags.location;
          return { ...r, draft: { ...r.draft, anchor: pendingAnchor }, cellFlags, touched: true };
        }));
      } else {
        setDraftAnchors((m) => ({ ...m, [armedRowId]: pendingAnchor }));
      }
      setArmedRowId(null);
    } else {
      const openTarget = view === "grid" ? gridRows.find((r) => !r.draft.anchor) : null;
      if (openTarget) {
        setGridRows((rows) => rows.map((r) => {
          if (r._id !== openTarget._id) return r;
          const cellFlags = { ...r.cellFlags };
          if (locFlag) cellFlags.location = locFlag; else delete cellFlags.location;
          return { ...r, draft: { ...r.draft, anchor: pendingAnchor }, cellFlags, touched: true };
        }));
      } else {
        setGridRows((rows) => [...rows, draftFromParsedRow({ draft: emptyDraft(pendingAnchor), cellFlags: locFlag ? { location: locFlag } : {} })]);
        setView("grid");
      }
    }
    onAnchorConsumed?.();
  }, [pendingAnchor]); // eslint-disable-line react-hooks/exhaustive-deps

  // ⛔ HARDENING-12 (B986096, owner P0 live-test, "Disarm on Escape and say so in the hint") —
  // a row armed for a map pick (the amber "Now click Drop a pin…" banner) had no keyboard way out
  // short of clicking its own "Cancel" link. Escape now disarms it from anywhere on the page.
  // HARDENING-13 — goes through `armRow(null)`, not the raw setter, so it also turns the map's
  // OWN pin-drop mode back off (armed together by HARDENING-13's `onArmMapPin`; disarmed together
  // here rather than leaving the map listening for a click nobody asked for any more).
  useEffect(() => {
    if (!armedRowId) return undefined;
    const onKeyDown = (e) => { if (e.key === "Escape") armRow(null); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [armedRowId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clicking a comp's map marker opens its detail view.
  useEffect(() => {
    if (!focusCompId) return;
    const c = comps.find((x) => x.id === focusCompId);
    if (c) { setActiveComp(c); setView("detail"); }
    onFocusHandled?.();
  }, [focusCompId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const openDetail = (c) => { setActiveComp(c); setView("detail"); };
  const openEdit = (c) => { setDraft(compToDraft(c)); setErrors([]); setView("form"); };
  const cancelForm = () => { setView(activeComp ? "detail" : "list"); setDraft(null); };

  const save = async () => {
    const comp = draftToComp(draft);
    const errs = validateComp(comp);
    // NEW-5 — refuse to share a comp anchored to a site plan that isn't shared with the same
    // team, rather than silently sharing the plan out from under its owner (see anchorTeamConflict).
    const teamConflict = anchorTeamConflict(comp, overlaysById);
    if (teamConflict) errs.push(teamConflict);
    if (errs.length) { setErrors(errs); return; }
    setSaving(true);
    const result = draft.id ? await updateComp(draft.id, comp) : await insertComp(comp);
    setSaving(false);
    if (result.error) { setErrors([result.error.message || "Save failed"]); return; }
    await reload();
    setActiveComp(result.data);
    setView("detail");
    setDraft(null);
  };

  const remove = async (c) => {
    const { error } = await deleteComp(c.id);
    if (error) { setErrors([error.message || "Delete failed"]); return; }
    await reload();
    setView("list");
    setActiveComp(null);
    if (trashOpen) await loadTrash();
  };

  // B1066368 — the "Recently deleted" trash list's three actions, mirroring
  // SitePlansSection.jsx's loadTrash/toggleTrash/restore/purgeForever exactly.
  const loadTrash = async () => {
    setTrashLoading(true);
    const { data, error } = await fetchDeletedComps();
    setTrashLoading(false);
    if (error) { setTrashError(error.message || "Failed to load Recently deleted"); return; }
    setTrashError(null);
    setTrash(data || []);
  };
  const toggleTrash = () => {
    setTrashOpen((was) => { if (!was) loadTrash(); return !was; });
  };
  const restoreOne = async (c) => {
    const { error } = await restoreComp(c.id);
    if (error) { setTrashError(error.message || "Restore failed"); }
    await reload();
    await loadTrash();
  };
  const purgeForever = async (c) => {
    const { error } = await permanentlyDeleteComp(c.id);
    if (error) { setTrashError(error.message || "Delete failed"); }
    await loadTrash();
  };

  // B849232/NEW-1 — the paste-grid create surface.
  const openGrid = () => { setGridRows([]); setArmedRowId(null); setGridSaveError(null); setView("grid"); };
  const closeGrid = () => { setView("list"); setArmedRowId(null); };
  const saveGridRows = async (readyRows) => {
    if (!readyRows.length) return;
    // NEW-5 — same refusal as the single-comp form's save(), applied per row: a row pinned to a
    // site plan that isn't shared with the row's own chosen team is held back rather than shared
    // out from under the plan's owner. Rows without a conflict still save normally.
    const conflictRows = readyRows.filter((r) => anchorTeamConflict(draftToComp(r.draft), overlaysById));
    const toSave = readyRows.filter((r) => !conflictRows.includes(r));
    if (!toSave.length) {
      setGridSaveError(conflictRows.length === 1
        ? "That row is pinned to a site plan that isn't shared with the chosen team — share the site plan first, or leave it unshared."
        : `${conflictRows.length} rows are pinned to a site plan that isn't shared with the chosen team — share the site plan first, or leave them unshared.`);
      return;
    }
    setGridSaving(true);
    setGridSaveError(null);
    const result = await insertComps(toSave.map((r) => draftToComp(r.draft)));
    setGridSaving(false);
    if (result.error) { setGridSaveError(result.error.message || "Save failed"); return; }
    const savedIds = new Set(toSave.map((r) => r._id));
    const remaining = gridRows.filter((r) => !savedIds.has(r._id));
    setGridRows(remaining);
    await reload();
    if (conflictRows.length) {
      setGridSaveError(conflictRows.length === 1
        ? "1 row wasn't saved — it's pinned to a site plan that isn't shared with the chosen team."
        : `${conflictRows.length} rows weren't saved — pinned to a site plan that isn't shared with the chosen team.`);
    } else if (remaining.length === 0) {
      closeGrid();
    }
  };

  // B849233/NEW-2 — the KML-import path. Hand entry (openGrid above) never reaches this;
  // `handleKmlFile` is the ONLY producer of a comp_import_drafts row.
  const handleKmlFile = async (file) => {
    setKmlImporting(true);
    setKmlImportError(null);
    try {
      const text = await file.text();
      const rows = kmlToDraftRows(text, { sourceFile: file.name });
      if (!rows.length) { setKmlImportError("No placemarks found in that file."); return; }
      const result = await insertDrafts(rows);
      if (result.error) { setKmlImportError(result.error.message || "Import failed"); return; }
      await reloadDrafts();
      setView("drafts");
    } catch (e) {
      setKmlImportError(e?.message || "Couldn't read that file");
    } finally {
      setKmlImporting(false);
    }
  };

  const promoteOneDraft = async (draftId, comp) => {
    setDraftBusyId(draftId);
    const result = await promoteDraft(draftId, comp);
    setDraftBusyId(null);
    if (result.error) { await reloadDrafts(); return; } // promote_error is now on the row itself
    setDraftAnchors((m) => { const next = { ...m }; delete next[draftId]; return next; });
    await reloadDrafts();
    await reload(); // a new comp exists now — the list/map must see it
  };

  const dismissOneDraft = async (draftId) => {
    setDraftBusyId(draftId);
    await deleteDraft(draftId);
    setDraftBusyId(null);
    if (armedRowId === draftId) setArmedRowId(null);
    setDraftAnchors((m) => { const next = { ...m }; delete next[draftId]; return next; });
    await reloadDrafts();
  };

  return (
    <div style={{ display: active ? "flex" : "none", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading && <div style={{ padding: 14, fontSize: 12, color: "var(--text-secondary)" }}>Loading…</div>}
        {loadError && <div style={{ padding: 14, fontSize: 12, color: "var(--danger-text)" }}>{loadError}</div>}

        {!loading && !loadError && view === "list" && (
          <>
            {/* A real section label, same treatment as "Site plans" above it — the two lists
                stacked in one rail must each say plainly which is which (NEW-3). */}
            <div style={{ padding: "10px 14px 0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-secondary)" }}>Comps</span>
              {/* B849232/NEW-1 — the paste-grid, not the map pin tool, is the everyday way in now:
                  Michael enters comps in batches from broker emails, most of which don't start
                  with a map click at all. The map's "Place comp" split button still works — it
                  opens the grid pre-seeded with one row (see the pendingAnchor effect above).
                  B848304 — renamed from "＋ New comps": that name read as the primary CREATE
                  action and competed with the map's own comp-placement entry point for the same
                  job. This button's real job is bulk paste from a broker email or a spreadsheet
                  block, which "Paste comps" says outright. */}
              <span style={{ display: "flex", gap: 6, flex: "none" }}>
                <button onClick={openGrid} title="Paste comps from a broker email or spreadsheet"
                  style={{ border: "1px solid var(--border-default)", background: "var(--surface-raised)", color: "var(--text-primary)", fontSize: 10.5, fontWeight: 700, borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontFamily: "inherit" }}>
                  ＋ Paste comps
                </button>
                {/* B849233/NEW-2 — the ONLY door into the draft staging table; picking a file
                    here is what creates a row, never hand entry above. */}
                <label title="Import a Google My Maps export"
                  style={{ border: "1px solid var(--border-default)", background: "var(--surface-raised)", color: "var(--text-primary)", fontSize: 10.5, fontWeight: 700, borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontFamily: "inherit" }}>
                  ⤒ Import (KML)
                  <input type="file" accept=".kml" style={{ display: "none" }} disabled={kmlImporting}
                    onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) handleKmlFile(f); }} />
                </label>
              </span>
            </div>
            {drafts.length > 0 && (
              <button onClick={() => setView("drafts")}
                style={{
                  display: "block", width: "calc(100% - 28px)", margin: "6px 14px 0", textAlign: "left", border: "1px solid var(--warn-border)",
                  background: "var(--warn-bg)", color: "var(--warn-text)", fontSize: 10.5, borderRadius: 6, padding: "6px 8px", cursor: "pointer", fontWeight: 700,
                }}>
                {drafts.length} imported comp{drafts.length === 1 ? "" : "s"} waiting on review ▸
              </button>
            )}
            {kmlImportError && <div style={{ padding: "6px 14px 0", fontSize: 10.5, color: "var(--danger-text)" }}>{kmlImportError}</div>}
            <SummaryStrip comps={comps} />
            {comps.length === 0 && <div style={{ padding: 14, fontSize: 12, color: "var(--text-secondary)" }}>No comps yet. Paste a few from a broker email with “＋ Paste comps” above, or use “Place comp” on the map.</div>}
            {comps.map((c) => <CompRow key={c.id} comp={c} onOpen={openDetail} overlaysById={overlaysById} />)}

            {/* B1066368 — "Recently deleted", mirroring SitePlansSection.jsx's own trash disclosure
                exactly (collapsed by default, fetched lazily on first open). */}
            <div style={{ margin: "6px 14px 10px" }}>
              <button onClick={toggleTrash} style={{
                border: "none", background: "none", padding: "4px 0", cursor: "pointer", fontFamily: "inherit",
                fontSize: 10.5, color: "var(--text-secondary)", display: "inline-flex", alignItems: "center", gap: 4,
              }}>
                <span style={{ display: "inline-block", transform: trashOpen ? "none" : "rotate(-90deg)" }}>▾</span>
                Recently deleted{trashOpen && trash.length ? ` (${trash.length})` : ""}
              </button>
              {trashError && <div style={{ fontSize: 10.5, color: "var(--danger-text)", padding: "4px 0" }}>{trashError}</div>}
              {trashOpen && (
                trashLoading ? (
                  <div style={{ fontSize: 10.5, color: "var(--text-secondary)", padding: "4px 0" }}>Loading…</div>
                ) : trash.length === 0 ? (
                  <div style={{ fontSize: 10.5, color: "var(--text-secondary)", padding: "4px 0" }}>Nothing here.</div>
                ) : (
                  trash.map((c) => (
                    <TrashRow key={c.id} comp={c} overlaysById={overlaysById} onRestore={restoreOne} onPurge={purgeForever} />
                  ))
                )
              )}
            </div>
          </>
        )}

        {view === "drafts" && (
          <CompDraftsPanel
            drafts={drafts} draftAnchors={draftAnchors}
            armedRowId={armedRowId} onArm={armRow}
            onFocusAnchor={(anchor) => onFocusAnchor?.(anchor)}
            onPromote={promoteOneDraft} onDismiss={dismissOneDraft} busyId={draftBusyId}
            onImportFile={handleKmlFile} importing={kmlImporting} importError={kmlImportError}
            onBack={() => { setView("list"); setArmedRowId(null); }}
          />
        )}

        {view === "grid" && (
          <CompEntryGrid
            rows={gridRows} onRowsChange={setGridRows}
            armedRowId={armedRowId} onArm={armRow}
            onFocusAnchor={(anchor) => onFocusAnchor?.(anchor)}
            onSave={saveGridRows} onCancel={closeGrid}
            saving={gridSaving} saveError={gridSaveError}
            overlaysById={overlaysById}
          />
        )}

        {!loading && view === "detail" && activeComp && (
          <CompDetail
            comp={activeComp} canEdit={activeComp.userId === currentUserId} onEdit={openEdit} onDelete={remove} onBack={() => setView("list")}
            overlaysById={overlaysById} onOpenBrochure={onOpenBrochure}
          />
        )}

        {!loading && view === "form" && draft && (
          <CompForm draft={draft} setDraft={setDraft} teams={teams} projects={projects} partyNames={collectPartyNames(comps)} errors={errors} onSave={save} onCancel={cancelForm} saving={saving} />
        )}
      </div>
    </div>
  );
}
