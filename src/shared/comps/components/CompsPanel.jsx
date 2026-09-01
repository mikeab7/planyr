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
  compsSummaryBits, validateComp, emptyDraft, draftToComp, compToDraft,
} from "../lib/comps.js";
import { compMarkerColor } from "../lib/compMarkerIcon.js";
import { collectPartyNames } from "../lib/partySuggest.js";
import PartyNameField from "./PartyNameField.jsx";
import { fetchAllComps, insertComp, insertComps, updateComp, deleteComp } from "../lib/compsStore.js";
import { listMyTeams, currentIdentity } from "../../../workspaces/site-planner/lib/teams.js";
import CompEntryGrid, { draftFromParsedRow } from "./CompEntryGrid.jsx";
import CompDraftsPanel from "./CompDraftsPanel.jsx";
import { fetchMyDrafts, insertDrafts, promoteDraft, deleteDraft } from "../lib/compDraftsStore.js";
import { kmlToDraftRows } from "../lib/kmlImport.js";

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

function CompRow({ comp, onOpen }) {
  return (
    <button onClick={() => onOpen(comp)} style={{
      display: "block", width: "100%", textAlign: "left", padding: "9px 14px", border: "none",
      borderBottom: "1px solid var(--border-default)", background: "transparent", cursor: "pointer", fontFamily: "inherit",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 650, color: "var(--text-primary)" }}>{comp.title || compHeadline(comp)}</span>
        <span style={{ fontSize: 11, color: "var(--text-secondary)", flex: "none" }}>{comp.compDate}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 3 }}>
        <TypeChip type={comp.compType} />
        {comp.title && <span style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{compHeadline(comp)}</span>}
      </div>
    </button>
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

function CompDetail({ comp, canEdit, onEdit, onDelete, onBack, overlaysById, onOpenBrochure }) {
  const rows = compFieldRows(comp);
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
        {rows.map((r) => (
          <Field key={r.key} label={r.label}><span style={{ fontSize: 12.5 }}>{r.value}</span></Field>
        ))}
      </div>
      <SourceBrochureLink comp={comp} overlaysById={overlaysById} onOpenBrochure={onOpenBrochure} />
      {canEdit && (
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <Button size="sm" onClick={() => onEdit(comp)}>Edit</Button>
          <Button size="sm" variant="danger" onClick={() => onDelete(comp)}>Delete</Button>
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
      <Field label="Date" stacked required>
        <input type="date" value={draft.compDate} onChange={set("compDate")} style={inputStyle} />
      </Field>
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
          <Field label="Price" stacked><input type="number" value={draft.bldgPrice} onChange={set("bldgPrice")} placeholder="optional" style={inputStyle} /></Field>
          <Field label="Building SF" stacked><input type="number" value={draft.bldgSizeSf} onChange={set("bldgSizeSf")} placeholder="optional" style={inputStyle} /></Field>
          {draft.bldgPrice && draft.bldgSizeSf && (
            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: -4, marginBottom: 8 }}>
              {(() => { const psf = buildingPricePerSf(draftToComp(draft)); return psf != null ? `$${psf.toFixed(2)}/SF` : null; })()}
            </div>
          )}
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
    setComps(data);
    notifiedRef.current?.(data);
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
  useEffect(() => {
    if (!pendingAnchor) return;
    if (armedRowId) {
      if (gridRows.some((r) => r._id === armedRowId)) {
        setGridRows((rows) => rows.map((r) => (r._id === armedRowId ? { ...r, draft: { ...r.draft, anchor: pendingAnchor } } : r)));
      } else {
        setDraftAnchors((m) => ({ ...m, [armedRowId]: pendingAnchor }));
      }
      setArmedRowId(null);
    } else {
      setGridRows((rows) => [...rows, draftFromParsedRow({ draft: emptyDraft(pendingAnchor), cellFlags: {} })]);
      setView("grid");
    }
    onAnchorConsumed?.();
  }, [pendingAnchor]); // eslint-disable-line react-hooks/exhaustive-deps

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
  };

  // B849232/NEW-1 — the paste-grid create surface.
  const openGrid = () => { setGridRows([]); setArmedRowId(null); setGridSaveError(null); setView("grid"); };
  const closeGrid = () => { setView("list"); setArmedRowId(null); };
  const saveGridRows = async (readyRows) => {
    if (!readyRows.length) return;
    setGridSaving(true);
    setGridSaveError(null);
    const result = await insertComps(readyRows.map((r) => draftToComp(r.draft)));
    setGridSaving(false);
    if (result.error) { setGridSaveError(result.error.message || "Save failed"); return; }
    const savedIds = new Set(readyRows.map((r) => r._id));
    const remaining = gridRows.filter((r) => !savedIds.has(r._id));
    setGridRows(remaining);
    await reload();
    if (remaining.length === 0) closeGrid();
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
                  with a map click at all. "Drop a pin"/"Comp from parcel" still work — they open
                  the grid pre-seeded with one row (see the pendingAnchor effect above). */}
              <span style={{ display: "flex", gap: 6, flex: "none" }}>
                <button onClick={openGrid} title="Paste comps from a broker email or spreadsheet"
                  style={{ border: "1px solid var(--border-default)", background: "var(--surface-raised)", color: "var(--text-primary)", fontSize: 10.5, fontWeight: 700, borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontFamily: "inherit" }}>
                  ＋ New comps
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
            {comps.length === 0 && <div style={{ padding: 14, fontSize: 12, color: "var(--text-secondary)" }}>No comps yet. Paste a few from a broker email with “＋ New comps” above, or use “Drop a pin”/“Comp from parcel” on the map.</div>}
            {comps.map((c) => <CompRow key={c.id} comp={c} onOpen={openDetail} />)}
          </>
        )}

        {view === "drafts" && (
          <CompDraftsPanel
            drafts={drafts} draftAnchors={draftAnchors}
            armedRowId={armedRowId} onArm={setArmedRowId}
            onFocusAnchor={(anchor) => onFocusAnchor?.(anchor)}
            onPromote={promoteOneDraft} onDismiss={dismissOneDraft} busyId={draftBusyId}
            onImportFile={handleKmlFile} importing={kmlImporting} importError={kmlImportError}
            onBack={() => { setView("list"); setArmedRowId(null); }}
          />
        )}

        {view === "grid" && (
          <CompEntryGrid
            rows={gridRows} onRowsChange={setGridRows}
            armedRowId={armedRowId} onArm={setArmedRowId}
            onFocusAnchor={(anchor) => onFocusAnchor?.(anchor)}
            onSave={saveGridRows} onCancel={closeGrid}
            saving={gridSaving} saveError={gridSaveError}
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
