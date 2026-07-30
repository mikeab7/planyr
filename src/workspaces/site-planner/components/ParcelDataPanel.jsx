/* Parcel data panels — the county appraisal record and the taxing units for the SELECTED lot.
 *
 * Lifted out of `SitePlanner.jsx` and lazily loaded (the B1064 tranche, behind `LazyPanel`):
 * this content only ever renders when a parcel that came from a county identify is selected,
 * which is a small fraction of sessions, and it was riding the planner's boot chunk for all of
 * them. Extracting it is the optimization that pays for the NEW-1…NEW-6 setback/parcel work in
 * the same change — the planner chunk had ~1 KB of budget headroom left when this landed.
 *
 * NEW-5 — the panel's two shipped defects, both fixed here (owner, 2026-07-30, Weld County CO):
 *   (a) the OWNER was printed twice — once as the headline, once as the first curated row. The
 *       headline is now the only place it appears, and it reads through the SHARED field map
 *       (`ownerName`) instead of a local copy of its regex, so the two can't disagree about
 *       which county column the owner comes from.
 *   (b) the list dumped every curated field, including the unbounded metes-and-bounds Legal
 *       description. The default view is now three short rows; everything else — the values,
 *       the land use, the zoning and the Legal blob — folds behind one closed disclosure, and
 *       the Legal value is height-capped so it scrolls in place instead of growing the panel.
 *
 * The row split itself is `appraisal.splitCuratedRows`, SHARED with the map-search parcel card
 * (B1166) so the two surfaces can't drift on which rows are shown, in what order, or how a
 * value is formatted. Only the rendering differs — a floating card over the map vs this docked
 * panel — which is why they share the helper and not the component.
 *
 * Props: `attrs` the county record · `taxInfo` the resolved taxing units (null while loading)
 *        · `PAL` the planner palette (passed like every other extracted panel).
 */
import { apprAll, ownerName, parcelPanelRows } from "../lib/appraisal.js";

/* The Legal description is the one unbounded value in a county record; cap it and let it scroll
 * in place, so opening the disclosure can never turn the panel into a wall of text again. */
const LEGAL_MAX_H = 76;

export function ParcelAppraisal({ attrs, PAL }) {
  const who = ownerName(attrs);
  const { primary, more } = parcelPanelRows(attrs);
  const row = (r) => (
    <div key={r.label} data-testid="parcel-row" style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", padding: "5px 0", borderBottom: "1px solid #f3efe5" }}>
      <span style={{ fontSize: 11.5, color: PAL.muted, flex: "none" }}>{r.label}</span>
      <span style={{ fontSize: 12, color: PAL.ink, fontWeight: 600, textAlign: "right", wordBreak: "break-word", maxHeight: r.label === "Legal" ? LEGAL_MAX_H : undefined, overflowY: r.label === "Legal" ? "auto" : undefined }}>{r.value}</span>
    </div>
  );
  return (
    <>
      {who && (
        <div style={{ marginBottom: 9, paddingBottom: 8, borderBottom: "1px solid var(--planner-border)" }}>
          <div style={{ fontSize: 9.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700 }}>Owner</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: PAL.ink, lineHeight: 1.3, marginTop: 2 }} data-testid="parcel-owner">{who}</div>
        </div>
      )}
      {!primary.length && !more.length
        ? <div style={{ fontSize: 12, color: PAL.muted }}>No recognizable fields in the county record.</div>
        : (
          <>
            {primary.map(row)}
            {more.length > 0 && (
              <details data-testid="parcel-more">
                <summary style={{ fontSize: 11, color: PAL.muted, cursor: "pointer", padding: "5px 0" }}>More details ({more.length})</summary>
                {more.map(row)}
              </details>
            )}
          </>
        )}
      <details style={{ marginTop: 8 }}>
        <summary style={{ fontSize: 11, color: PAL.muted, cursor: "pointer" }}>All county fields</summary>
        <div style={{ marginTop: 6 }}>
          {apprAll(attrs).map((r) => (
            <div key={r.label} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", padding: "3px 0" }}>
              <span style={{ fontSize: 10.5, color: PAL.muted, flex: "none" }}>{r.label}</span>
              <span style={{ fontSize: 10.5, color: PAL.ink, fontFamily: "ui-monospace, monospace", textAlign: "right", wordBreak: "break-word" }}>{String(r.value)}</span>
            </div>
          ))}
        </div>
      </details>
    </>
  );
}

/* Taxing jurisdictions + the combined rate — graceful-degrade until a rate source is wired for
 * the county. LOUD-FAILURE: "not wired" says so in amber, it never renders as a clean zero. */
export function ParcelTaxes({ taxInfo, PAL }) {
  if (!taxInfo) return <div style={{ fontSize: 11.5, color: PAL.muted }}>Looking up taxing units…</div>;
  return (
    <>
      {taxInfo.units.length > 0 ? taxInfo.units.map((u, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", padding: "4px 0", borderBottom: "1px solid #f3efe5" }}>
          <span style={{ fontSize: 11.5, color: PAL.ink }}>{u.name}</span>
          <span style={{ fontSize: 11.5, color: PAL.muted, fontFamily: "ui-monospace, monospace" }}>{u.value}</span>
        </div>
      )) : <div style={{ fontSize: 11.5, color: PAL.muted }}>No taxing-unit fields in the county record.</div>}
      {taxInfo.connected && taxInfo.total != null ? (
        <div style={{ marginTop: 8, fontSize: 13, fontWeight: 700, color: PAL.ink }}>Total tax rate: {taxInfo.total} per $100</div>
      ) : (
        <div style={{ marginTop: 8, fontSize: 11, color: PAL.warn, lineHeight: 1.5 }}>▲ {taxInfo.note} A total tax rate isn&apos;t shown until a rate source is wired for this county.</div>
      )}
    </>
  );
}

export default ParcelAppraisal;
