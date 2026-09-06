/* Parcel RECORD — the Parcel-panel body from the "GIS is down" tranche.
 *
 * Lifted out of `SitePlanner.jsx` and lazily loaded, for the reason `ParcelDataPanel.jsx` states in
 * its own header (the B1064 tranche): it renders ONLY inside the Parcel panel, only for a selected
 * lot — a small fraction of sessions — and the Site route's largest chunk has no headroom to spend
 * on code most sessions never reach. Extracting it is what pays for the tranche shipping at all.
 *
 * PARCEL RECORD (NEW-3) — a lot pulled from a county identify arrives with an appraisal record; a
 * lot DRAWN by hand (what you do when the county service is down) arrived with geometry and nothing
 * else, and there was no way to type any of it in. Both are one path here, and a county-pulled lot's
 * fields are editable too, because a county record with a wrong address should be correctable. The
 * provenance chip is the load-bearing part: a plan that is later reviewed must never present a
 * hand-drawn boundary as though it came from the county.
 *
 * NEW-2 (B1239329) — this module used to also export `PlacementControls` (the "TURN"/"SLIDE the
 * plan" body). Removed along with the rest of the Placement section (owner decision).
 *
 * Props are passed rather than imported (`PAL`, `chip`, the border/surface tokens) exactly like every
 * other extracted panel — a module that reached back into the planner's palette would be hoisted
 * straight back onto the boot chunk.
 */
import { PARCEL_FIELDS, parcelProvenance, provenanceLabel } from "../lib/parcelRecord.js";

const label = { display: "block", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, marginBottom: 2 };

export function ParcelRecord({ parcel, PAL, border, surface, onField, chip, onSelectDeed }) {
  const prov = provenanceLabel(parcel);
  const src = parcelProvenance(parcel);
  const tone = src === "county" ? PAL.info : src === "deed" ? PAL.purple : PAL.warn;
  const input = { width: "100%", boxSizing: "border-box", padding: "6px 8px", fontSize: 12, fontFamily: "inherit", border, borderRadius: 6, outline: "none", color: PAL.ink, background: surface };
  const chipBox = (color, line) => ({ display: "inline-block", padding: "2px 8px", borderRadius: 99, fontSize: 10.5, fontWeight: 700, color, border: `1px solid ${line}` });
  /* Uncontrolled + re-keyed on the stored value: the field commits on blur / Enter, so a typed word
   * is ONE undo frame rather than fifteen, and the key makes an undo (or a cloud change) re-seed the
   * box instead of leaving stale text under the user's cursor. */
  const field = (f) => (
    <label key={f.key} style={{ display: "block", marginBottom: 7 }}>
      <span style={{ ...label, color: PAL.muted }}>{f.label}</span>
      <input
        defaultValue={parcel[f.key] || ""} placeholder={f.placeholder}
        key={`${parcel.id}:${f.key}:${parcel[f.key] || ""}`}
        data-testid={`parcel-field-${f.key}`}
        onKeyDown={(e) => {
          /* B548821 — stop only the two keys this field actually consumes. A blanket
             stopPropagation kept every OTHER key (Ctrl+Z above all) from ever reaching the
             planner's window listener while this field had focus, which is a SECOND, undocumented
             keyboard router living outside shared/keyboard/keyScope.js — the one place this app
             decides who owns the keyboard. keyScope's FIELD scope already refuses every
             plan-mutating shortcut while this input is genuinely focused, so nothing here needs
             its own copy of that rule; it only needs to keep Enter/Escape from also being read as
             a canvas shortcut. */
          if (e.key === "Enter") { e.stopPropagation(); e.currentTarget.blur(); }
          else if (e.key === "Escape") { e.stopPropagation(); e.currentTarget.value = parcel[f.key] || ""; e.currentTarget.blur(); }
        }}
        onBlur={(e) => onField(parcel.id, f.key, e.target.value)}
        style={input} />
    </label>
  );
  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <div data-testid="parcel-provenance" title={prov.long} style={chipBox(tone, tone)}>{prov.short}</div>
        {/* NEW-2 — HOW WELL THE DEED CLOSES, on the parcel itself and not only in the flash that
            promoted it. A deed closing to 0.4′ and one closing to 40′ must never look the same on
            screen: the second is a boundary you cannot rely on, and the number is the difference. */}
        {parcel.deedMisclosureFt != null && (
          <div data-testid="parcel-misclosure"
            title={`The deed's calls end about ${parcel.deedMisclosureFt}′ from where they began (its misclosure). Under about a foot is normal for a modern survey; tens of feet means the description does not describe a closed tract, and the boundary should be verified before you rely on it.`}
            style={chipBox(parcel.deedMisclosureFt > 1 ? PAL.warn : PAL.muted, parcel.deedMisclosureFt > 1 ? PAL.warn : PAL.panelLine)}>
            {parcel.deedMisclosureFt > 1 ? "⚠ " : ""}closes to {parcel.deedMisclosureFt}′
          </div>
        )}
      </div>
      {PARCEL_FIELDS.map(field)}
      <label style={{ display: "block" }}>
        <span style={{ ...label, color: PAL.muted }}>Stated acreage</span>
        <input
          defaultValue={parcel.statedAcres != null ? String(parcel.statedAcres) : ""}
          key={`${parcel.id}:statedAcres:${parcel.statedAcres ?? ""}`}
          placeholder="e.g. 12.50 — what the deed or county calls it"
          data-testid="parcel-field-statedAcres"
          onKeyDown={(e) => {
            // B548821 — scoped stop, see the field() helper above for why.
            if (e.key === "Enter") { e.stopPropagation(); e.currentTarget.blur(); }
            else if (e.key === "Escape") { e.stopPropagation(); e.currentTarget.value = parcel.statedAcres != null ? String(parcel.statedAcres) : ""; e.currentTarget.blur(); }
          }}
          onBlur={(e) => onField(parcel.id, "statedAcres", e.target.value)}
          style={input} />
      </label>
      <div style={{ fontSize: 10.5, color: PAL.muted, lineHeight: 1.45, marginTop: 4 }}>
        Kept apart from the measured acreage, so the difference stays visible. Measurements always use what's drawn.
      </div>
      {/* ⛔ THE WAY BACK TO THE DEED, and it is not a convenience — it is what makes "the deed stays
          on the plan so you can still compare or align it" TRUE. Measured on the real page: once the
          parcel is promoted it is laid over the deed that produced it and the Parcel panel takes the
          dock, so a right-click where the deed visibly is answers with the PARCEL's menu, every time.
          The deed was still there and still un-addressable. Reaching it from the parcel it produced
          sidesteps the hit-test contest entirely instead of trying to win it. */}
      {parcel.fromDeedGroup && onSelectDeed && (
        <button data-testid="parcel-select-deed" style={{ ...chip, width: "100%", marginTop: 8 }}
          title="Select the deed this boundary came from — to compare it, rotate it, or align it once the county map is back"
          onClick={() => onSelectDeed(parcel.fromDeedGroup)}>
          ↩ Go to the deed this came from
        </button>
      )}
    </>
  );
}
