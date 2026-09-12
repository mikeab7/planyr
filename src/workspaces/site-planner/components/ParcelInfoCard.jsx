import { useState } from "react";
import { parcelCardRows } from "../lib/appraisal.js";
import { PinIcon, EmptyCircleIcon, WarnTriangleIcon } from "./icons.jsx";
import { RADIUS } from "../../../shared/ui/radius.js";

/* ParcelInfoCard (B233, reshaped by NEW-1) — the card that drops in under the map
 * finder's search pill after a "Go". FOUR distinct states: found (the parcel's key
 * facts + Plan this site), none (the map centred, but no parcel covers that point),
 * unavailable (the county parcel service couldn't be reached) and no-source (this county
 * has no parcel source wired at all) — each reads differently on purpose.
 *
 * B1597232 — `no-source` is the newest and exists because the other three could not express it.
 * A point in a county Planyr has never wired has nothing to query, so the search used to land
 * on `unavailable`: "the county parcel service couldn't be reached for this area right
 * now… give it a moment." Both halves were false — nothing was unreachable, and waiting
 * changes nothing — and it is the wording the owner met when searching two Wayne County, MI
 * addresses. This state names the county and says the gap is a gap, from `noParcelSourceNote`'s
 * own sentence (passed in as `info.note`) so the words cannot drift from the verdict that
 * produced them. It deliberately does NOT offer "start the plan here anyway": per NEW-4's rule,
 * that fallback belongs to an OUTAGE (where the source that would have answered is down), and
 * the way forward here is the aerial trace the copy names.
 *
 * NEW-1: the found state shows exactly THREE rows by default — Owner, Account / ID,
 * Acreage (the split lives in lib/appraisal.js `parcelCardRows`, so it's unit-guarded).
 * Everything else the county returned — land / improvement / total value, land use,
 * zoning, year built and the Legal description — sits behind the collapsed "More
 * details" disclosure. The Legal blob is the reason: it's unbounded metes-and-bounds
 * call text that used to wrap to ten-plus lines and push the card past the map controls
 * beside it. Nothing is deleted, only folded — and both the disclosure's own body and
 * the Legal value are height-capped + scrollable, so an expanded card still can't grow
 * without bound.
 *
 * Module scope (MODULE-SCOPE-COMPONENTS), theme tokens only (B341/B508) — no raw hex,
 * and no DOM/Leaflet dependency, which is what lets the whole card render in a unit
 * test (test/parcelCard.test.js). */

const PAL = {
  panelBg: "var(--surface-raised)", panelLine: "var(--border-default)",
  ink: "var(--text-primary)", muted: "var(--text-secondary)", accent: "var(--accent)",
};

/* The two warning banners, the row rule and the Plan button's ink are carried over
 * from MapFinder.jsx BYTE-FOR-BYTE, raw hex included. This item reshapes what the card
 * SHOWS; restyling what it already showed is a different change, and the brief is
 * explicit that these banners stay exactly as they are. (Repointing them at the
 * --warn-* / --on-accent tokens is the right follow-up — it just isn't this one, and
 * doing it here would silently change how a cached-copy notice looks in dark mode.) */
const ROW_RULE = "1px solid #f3efe5";

// How tall the card's own content may get. The COLLAPSED card is bounded by its three
// rows; these caps bound the EXPANDED one — the details body scrolls past its cap, and
// the Legal value scrolls inside its own row — so no county's blob can stretch the card.
export const DETAILS_MAX_HEIGHT = 190;
export const LEGAL_MAX_HEIGHT = 92;

const noticeStyle = {
  marginBottom: 8, padding: "6px 8px", background: "#fdf6e7",
  border: "1px solid #e6c478", borderRadius: 6, fontSize: 11,
  color: "#8a5a00", lineHeight: 1.4,
};

// A value that IS a link (B1455632 — Nevada's per-parcel "County record" deep link, the one
// field of its kind among every wired source) renders as a link rather than plain text.
const isLinkValue = (v) => typeof v === "string" && /^https?:\/\//i.test(v.trim());

// One label/value row. `cap` height-caps + scrolls the value (the Legal description).
function InfoRow({ label, value, cap = false }) {
  const link = isLinkValue(value);
  return (
    <div data-parcel-row={label} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", padding: "4px 0", borderBottom: ROW_RULE }}>
      <span style={{ fontSize: 11, color: PAL.muted, flex: "none" }}>{label}</span>
      <span style={{ fontSize: 11.5, color: link ? PAL.accent : PAL.ink, fontWeight: 600, textAlign: "right", wordBreak: "break-word", ...(cap ? { maxHeight: LEGAL_MAX_HEIGHT, overflowY: "auto", minWidth: 0 } : null) }}>
        {link ? <a href={value.trim()} target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>View record ↗</a> : value}
      </span>
    </div>
  );
}

export default function ParcelInfoCard({
  info, narrow = false, cachedAsOfLabel = "", onDismiss, onPlan, detailsOpen = false,
  // NEW-4 — the fallback when the county service is unreachable: start the plan at this point
  // anyway and draw the boundary. Passed only by the map finder; absent → the card just explains.
  onStartBlank = null,
  // B1149600ish/NEW-6 — the card used to offer "Plan this site" (a SITE-module action)
  // unconditionally, even while the map's own Site/Comp toggle read Comp — reproduced by the
  // owner on a real address search. `mode` decides which primary action belongs here; `onComp`
  // is the comp-creation handler for the currently-selected parcel(s) (absent → the found state
  // shows only the parcel facts, per the brief: "the comp action, or nothing beyond the facts").
  // `compAccent` lets the caller match its own comp-mode hue without a second hardcoded color here.
  mode = "site", onComp = null, compAccent = null,
}) {
  // `detailsOpen` seeds the disclosure only — it re-seeds per parcel via the `key` the
  // caller sets, so a new search always opens closed (the whole point of the fold).
  const [open, setOpen] = useState(detailsOpen);
  if (!info) return null;

  const found = info.status === "found";
  const noSource = info.status === "no-source"; // B1597232 — this county has no parcel source wired at all
  const { primary, more } = found ? parcelCardRows(info.attrs, { acct: info.acct, acres: info.acres }) : { primary: [], more: [] };

  return (
    <div style={{
      position: "absolute", zIndex: narrow ? 1090 : 1001, background: PAL.panelBg,
      border: `1px solid ${PAL.panelLine}`, borderRadius: 10,
      boxShadow: "0 6px 22px rgba(28,25,20,0.22)", overflow: "hidden",
      ...(narrow
        ? { top: 58, left: 8, right: 8, transform: "none", width: "auto", maxWidth: "none" }
        : { top: 64, left: "50%", transform: "translateX(-50%)", width: 348, maxWidth: "calc(100% - 540px)" }),
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 11px", borderBottom: found ? `1px solid ${PAL.panelLine}` : "none" }}>
        {/* NEW-3 — one slot, one icon family. It used to render a COLOUR emoji pin against two text
            glyphs, so the three states of the same badge didn't match each other. */}
        <span style={{ flex: "none", display: "grid", placeItems: "center",
          color: info.status === "unavailable" ? "var(--warn-text)" : found ? PAL.accent : PAL.muted }}>
          {/* B1597232 — a coverage gap is a neutral FACT, not a warning: it shares the `none` state's
              quiet empty circle rather than the outage triangle, because nothing has gone wrong. */}
          {found ? <PinIcon size={13} /> : info.status === "none" || noSource ? <EmptyCircleIcon size={13} /> : <WarnTriangleIcon size={13} />}
        </span>
        <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: info.status === "unavailable" ? PAL.accent : PAL.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {found ? (info.addr || info.label || "Parcel")
            : info.status === "none" ? "No parcel at this point"
            : noSource ? "No parcel data here yet"
            : "Parcel info unavailable"}
        </span>
        <button onClick={onDismiss} title="Dismiss" aria-label="Dismiss parcel info"
          style={{ flex: "none", width: 22, height: 22, borderRadius: 5, border: "none", background: "transparent", color: PAL.muted, cursor: "pointer", fontSize: 13, lineHeight: 1 }}>✕</button>
      </div>

      {found ? (
        <div style={{ padding: "8px 11px 10px" }}>
          {info.backup && (
            <div style={noticeStyle}>
              Statewide backup — {info.backup} county’s server is unavailable; shown from TxGIO and may lag county updates.
            </div>
          )}
          {info.cached && (
            <div style={noticeStyle}>
              Cached copy{cachedAsOfLabel} — the county server is unavailable, so this lot came from Planyr’s saved snapshot. Accurate for selection; may lag recent county updates.
            </div>
          )}

          {primary.map((r) => <InfoRow key={r.label} label={r.label} value={r.value} />)}

          {more.length > 0 && (
            <>
              <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
                style={{ display: "flex", alignItems: "center", gap: 5, width: "100%", marginTop: 6, padding: "5px 0", background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: PAL.muted, textAlign: "left" }}>
                <span aria-hidden="true" style={{ flex: "none", width: 8, fontSize: 8, lineHeight: 1, display: "inline-block", transform: open ? "rotate(90deg)" : "none" }}>▶</span>
                More details
              </button>
              {open && (
                <div style={{ maxHeight: DETAILS_MAX_HEIGHT, overflowY: "auto" }}>
                  {more.map((r) => <InfoRow key={r.label} label={r.label} value={r.value} cap={/^legal$/i.test(r.label)} />)}
                </div>
              )}
            </>
          )}

          {/* ⛔ NEW-1 (2026-09-08) — THIS CARD NO LONGER CARRIES A PRIMARY ACTION, and the removal
              is the point, not a trim. It used to end in one button chosen by the map toolbar's
              Site/Comp mode ("Plan this site →" / "Add as comp →"). That mode is gone: an address
              search now simply FINDS, and the parcel it finds lands in the map toolbar's decide
              bar directly above this card, where all three verbs are offered at once. A single
              action down here would be the old guess wearing new clothes — it would name ONE of
              those three as the answer, on the very surface whose job is to describe the ground
              rather than decide about it. B831776/NEW-6's rule (never offer the Site action while
              the user is logging comps) is satisfied absolutely rather than conditionally: there
              is no action here to be wrong.
              `onPlan` / `onComp` / `mode` / `compAccent` stay in the signature deliberately —
              `onStartBlank` below is a different case (an OUTAGE, where no parcel was found, so no
              decide bar is showing and this card is the only way forward) and the props keep this
              component's contract stable for it. */}
        </div>
      ) : info.status === "none" ? (
        <div style={{ padding: "9px 11px", fontSize: 11.5, color: PAL.muted, lineHeight: 1.5 }}>
          The map centered on the address, but no parcel covers that exact point — it may sit on a road or right-of-way. Click the lot directly, or zoom in and use <b>Select parcels</b>.
        </div>
      ) : noSource ? (
        /* B1597232 — the county is named by `info.note` (`noParcelSourceNote`'s own sentence, so this
           card can never name a different county from the one the resolver decided on), and the
           way forward is the aerial trace — never the outage fallback, and never "try again". */
        <div data-testid="parcel-card-no-source" style={{ padding: "9px 11px", fontSize: 11.5, color: PAL.muted, lineHeight: 1.5 }}>
          {info.note} You can still trace the lot from the <b>Aerial</b> underlay.
        </div>
      ) : (
        /* NEW-4 — an outage used to end here, with the owner left on a map that would not give
           him a lot and no way forward. The way forward goes in the same breath as the bad news:
           start the plan anyway, located at this address, and draw the boundary by hand. */
        <div style={{ padding: "9px 11px", fontSize: 11.5, color: PAL.accent, lineHeight: 1.5 }}>
          The map centered on the address, but the county parcel service couldn’t be reached for this area right now. Give it a moment, then click the lot or use <b>Select parcels</b>.
          {onStartBlank && (
            <button onClick={onStartBlank} data-testid="parcel-card-start-blank"
              style={{ display: "block", width: "100%", marginTop: 8, height: 30, borderRadius: RADIUS.sm, border: "none", background: PAL.accent, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
              Start the plan here &amp; draw the boundary →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
