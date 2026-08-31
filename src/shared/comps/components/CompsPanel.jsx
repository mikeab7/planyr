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
  compsSummaryBits, validateComp,
} from "../lib/comps.js";
import { compMarkerColor } from "../lib/compMarkerIcon.js";
import { collectPartyNames } from "../lib/partySuggest.js";
import PartyNameField from "./PartyNameField.jsx";
import { fetchAllComps, insertComp, updateComp, deleteComp } from "../lib/compsStore.js";
import { listMyTeams, currentIdentity } from "../../../workspaces/site-planner/lib/teams.js";

const TYPE_LABEL = { land: "Land", building_sale: "Building sale", lease: "Lease" };

function emptyDraft(anchor) {
  return {
    compType: "land", compDate: "", title: "", notes: "", teamId: null, projectId: null,
    anchor: anchor || null,
    partyProvider: "", partyAcquirer: "",
    landPrice: "", landSizeValue: "", landSizeUnit: "ac",
    bldgPrice: "", bldgSizeSf: "",
    leaseRate: "", leaseRatePeriod: "annual", leaseRateExpense: "nnn", leaseTi: "", leaseTerm: "", leaseSizeSf: "",
    leaseFreeRentMonths: "",
  };
}

// Draft (form strings) -> the numeric/typed shape lib/comps.js + compsStore.js expect.
function draftToComp(d) {
  const num = (v) => (v === "" || v == null ? null : Number(v));
  return {
    ...d,
    landPrice: num(d.landPrice), landSizeValue: num(d.landSizeValue),
    bldgPrice: num(d.bldgPrice), bldgSizeSf: num(d.bldgSizeSf),
    leaseRate: num(d.leaseRate), leaseTi: num(d.leaseTi), leaseSizeSf: num(d.leaseSizeSf),
    leaseFreeRentMonths: num(d.leaseFreeRentMonths),
  };
}

function compToDraft(c) {
  const str = (v) => (v == null ? "" : String(v));
  return {
    id: c.id, compType: c.compType, compDate: c.compDate || "", title: c.title || "", notes: c.notes || "",
    teamId: c.teamId, projectId: c.projectId, anchor: c.anchor,
    partyProvider: c.partyProvider || "", partyAcquirer: c.partyAcquirer || "",
    landPrice: str(c.landPrice), landSizeValue: str(c.landSizeValue), landSizeUnit: c.landSizeUnit || "ac",
    bldgPrice: str(c.bldgPrice), bldgSizeSf: str(c.bldgSizeSf),
    leaseRate: str(c.leaseRate), leaseRatePeriod: c.leaseRatePeriod || "annual",
    leaseRateExpense: c.leaseRateExpense || "nnn", leaseTi: str(c.leaseTi), leaseTerm: c.leaseTerm || "",
    leaseSizeSf: str(c.leaseSizeSf), leaseFreeRentMonths: str(c.leaseFreeRentMonths),
  };
}

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
  return (
    <div style={{ padding: "10px 14px 14px" }}>
      <button onClick={onCancel} style={{ border: "none", background: "none", color: "var(--text-secondary)", fontSize: 12, cursor: "pointer", padding: 0, marginBottom: 10 }}>&larr; Cancel</button>

      <Field label="Type">
        <select value={draft.compType} onChange={set("compType")} style={{ ...inputStyle, width: 160 }} disabled={!!draft.id}>
          {COMP_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </select>
      </Field>
      <Field label="Date *">
        <input type="date" value={draft.compDate} onChange={set("compDate")} style={{ ...inputStyle, width: 160 }} />
      </Field>
      <Field label="Title"><input value={draft.title} onChange={set("title")} placeholder="Property / deal name" style={{ ...inputStyle, width: 220 }} /></Field>

      {/* Facts about the deal's PARTIES, not its economics — kept with Title, ahead of the
          money block, so the rate/price figures stay together and readable (NEW-7 amended).
          Labels follow the comp's own type; the two stored columns are one shared axis. */}
      <Field label={providerLabel}>
        <PartyNameField
          label={providerLabel}
          value={draft.partyProvider}
          onChange={(v) => setDraft((d) => ({ ...d, partyProvider: v }))}
          candidates={partyNames}
          listboxId="comp-party-provider-suggest"
        />
      </Field>
      <Field label={acquirerLabel}>
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
          <Field label="Price"><input type="number" value={draft.landPrice} onChange={set("landPrice")} placeholder="optional" style={{ ...inputStyle, width: 140 }} /></Field>
          <Field label="Size">
            <span style={{ display: "flex", gap: 6 }}>
              <input type="number" value={draft.landSizeValue} onChange={set("landSizeValue")} placeholder="optional" style={{ ...inputStyle, width: 90 }} />
              <select value={draft.landSizeUnit} onChange={set("landSizeUnit")} style={{ ...inputStyle, width: 70 }}>
                <option value="ac">AC</option><option value="sf">SF</option>
              </select>
            </span>
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
          <Field label="Price"><input type="number" value={draft.bldgPrice} onChange={set("bldgPrice")} placeholder="optional" style={{ ...inputStyle, width: 140 }} /></Field>
          <Field label="Building SF"><input type="number" value={draft.bldgSizeSf} onChange={set("bldgSizeSf")} placeholder="optional" style={{ ...inputStyle, width: 140 }} /></Field>
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
          <Field label="Rate ($/SF)">
            <span style={{ display: "flex", gap: 6 }}>
              <input type="number" value={draft.leaseRate} onChange={set("leaseRate")} placeholder="optional" style={{ ...inputStyle, width: 90 }} />
              <select value={draft.leaseRatePeriod} onChange={set("leaseRatePeriod")} aria-label="Rate period" style={{ ...inputStyle, width: 58 }}>
                {LEASE_PERIODS.map((p) => <option key={p} value={p}>{p === "annual" ? "YR" : "MO"}</option>)}
              </select>
            </span>
          </Field>
          <Field label="Basis">
            <select value={draft.leaseRateExpense} onChange={set("leaseRateExpense")} style={{ ...inputStyle, width: 120 }}>
              {LEASE_EXPENSE_BASES.map((b) => <option key={b} value={b}>{b.toUpperCase()}</option>)}
            </select>
          </Field>
          <Field label="Leased SF"><input type="number" value={draft.leaseSizeSf} onChange={set("leaseSizeSf")} placeholder="optional" style={{ ...inputStyle, width: 140 }} /></Field>
          {draft.leaseRate && draft.leaseSizeSf && (
            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: -4, marginBottom: 8 }}>
              {(() => { const rent = leaseTotalAnnualRent(draftToComp(draft)); return rent != null ? `${rent.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 })}/yr total (face)` : null; })()}
            </div>
          )}
          <Field label="TI $/SF"><input type="number" value={draft.leaseTi} onChange={set("leaseTi")} placeholder="optional" style={{ ...inputStyle, width: 120 }} /></Field>
          <Field label="Term"><input value={draft.leaseTerm} onChange={set("leaseTerm")} placeholder="e.g. 5 yrs" style={{ ...inputStyle, width: 140 }} /></Field>
          <Field label="Free rent (mo)"><input type="number" value={draft.leaseFreeRentMonths} onChange={set("leaseFreeRentMonths")} placeholder="optional" style={{ ...inputStyle, width: 100 }} /></Field>
        </>
      )}

      <Field label="Notes"><textarea value={draft.notes} onChange={set("notes")} rows={3} style={{ ...inputStyle, width: 220, resize: "vertical" }} /></Field>

      {teams?.length > 0 && (
        <Field label="Share with team">
          <select value={draft.teamId || ""} onChange={(e) => setDraft((d) => ({ ...d, teamId: e.target.value || null }))} style={{ ...inputStyle, width: 180 }}>
            <option value="">Just me</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
      )}
      {projects?.length > 0 && (
        <Field label="Project (optional)">
          <select value={draft.projectId || ""} onChange={(e) => setDraft((d) => ({ ...d, projectId: e.target.value || null }))} style={{ ...inputStyle, width: 180 }}>
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
 *
 * currentUserId and the team list are fetched INTERNALLY (mirrors this module's own
 * self-contained-data-owner shape) rather than threaded through the host, since neither is
 * otherwise held by SitePlannerApp today.
 */
export default function CompsPanel({
  open, active = true, pendingAnchor, onAnchorConsumed, focusCompId, onFocusHandled,
  projects, onCompsChange, overlaysById, onOpenBrochure,
}) {
  const [comps, setComps] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [view, setView] = useState("list"); // list | detail | form
  const [activeComp, setActiveComp] = useState(null);
  const [draft, setDraft] = useState(null);
  const [errors, setErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [teams, setTeams] = useState([]);
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

  // Refetch on tab focus, mirroring pinStore.js's cross-device convenience (latency-insensitive
  // reference data — no realtime channel needed for a first shipment of this feature).
  useEffect(() => {
    if (!open) return undefined;
    const onVisible = () => { if (document.visibilityState === "visible") reload(); };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.removeEventListener("focus", onVisible); document.removeEventListener("visibilitychange", onVisible); };
  }, [open]);

  // A just-picked map anchor opens the create form pre-filled.
  useEffect(() => {
    if (!pendingAnchor) return;
    setDraft(emptyDraft(pendingAnchor));
    setErrors([]);
    setView("form");
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

  return (
    <div style={{ display: active ? "flex" : "none", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading && <div style={{ padding: 14, fontSize: 12, color: "var(--text-secondary)" }}>Loading…</div>}
        {loadError && <div style={{ padding: 14, fontSize: 12, color: "var(--danger-text)" }}>{loadError}</div>}

        {!loading && !loadError && view === "list" && (
          <>
            <SummaryStrip comps={comps} />
            {comps.length === 0 && <div style={{ padding: 14, fontSize: 12, color: "var(--text-secondary)" }}>No comps yet. Use “Drop a pin” or “Comp from parcel” on the map to add one.</div>}
            {comps.map((c) => <CompRow key={c.id} comp={c} onOpen={openDetail} />)}
          </>
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
