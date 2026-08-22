/* On-canvas "View" menu (B653) — the eye-icon card holding what this drawing is showing.
 *
 * ⛔ NEW-1 REBUILT WHAT THIS CARD IS FOR, and the owner's complaint is worth keeping verbatim
 * because it is a complaint about LEVEL, not about any one control:
 *
 *   "for the view, it's kind of pointless, most of those items - like show dock doors or not show
 *    dock doors. If I have dock doors there, I always want them to show. … What it really should
 *    be is being able to hide a whole set of stuff. Like buildings and pond and roads … And when I
 *    say remove, I don't mean remove, I just mean hide temporarily. And then another one for
 *    markups - I should be able to hide all markups."
 *
 * The card used to hold four ORNAMENT toggles (dock doors, column grid, dimension callouts, area
 * lines). What he reaches for is "get this class of thing out of my way so I can see underneath".
 * So the card now leads with CONTENT groups and demotes ornament to its own short section.
 *
 * ─── THE FOUR OLD TOGGLES, each decided rather than preserved ────────────────────────────────
 *   Show dock doors  → REMOVED. He is explicit that he always wants them once drawn, and a
 *                      toggle nobody turns off is a row that costs attention on every open. The
 *                      one hazard of deleting a shipped control is STRANDING a plan saved with it
 *                      off, so `normalizeRetiredToggles` restores those on load (see the model).
 *   Show column grid → KEPT, under "Detail". A structural grid genuinely is a drafting aid you
 *                      flip on and off while laying out bays; it is the one of the four that is
 *                      about the WORK rather than about clutter.
 *   Show dimensions  → KEPT, under "Detail" — worth suppressing for a clean look before a print.
 *   Show areas       → KEPT, but moved under "Labels" beside the parcel acreage master, because
 *                      "the sf line on an element" and "the acreage chip on a lot" are one idea
 *                      and were two unrelated controls in two unrelated places.
 *
 * ─── WHY THE ACREAGE MASTER IS HERE ──────────────────────────────────────────────────────────
 * The owner asked, in the same breath, to "delete the chips that show the acreage for parcels" —
 * a feature that ALREADY SHIPPED as the per-lot `chipHidden` (B1404), reachable only from a
 * parcel's right-click menu. He did not know it existed. That is a discoverability failure, not a
 * missing feature, so nothing was reimplemented: the per-lot control is untouched and this adds a
 * plan-wide master beside the other label switch. They compose in `parcelAcreageHidden` and the
 * master never writes the per-lot flag — see the model's header.
 *
 * ─── THE SHAPE IS BORROWED, DELIBERATELY ─────────────────────────────────────────────────────
 * The master "Elements" checkbox is tri-state over per-type rows: the exact pattern of the Layers
 * panel's "Show all flood & drainage" row, fed by the same `{ all, any, onCount, ids }` object
 * shape (`groupState`). The owner asked for the plan-content version of a thing he already has,
 * and two mechanisms that looked different would read as two ideas.
 *
 * ⛔ SMOOTH ZOOM IS NOT HERE, AND THAT IS STILL THE POINT (B286000). View ▾ is a PER-DRAWING
 * display menu — what is shown on THIS plan and the drafting aids used on it. A preference that
 * follows the DEVICE across every plan is an INTERFACE setting and lives in Settings → Interface
 * (`shared/ui/InterfaceSettings.jsx`). There must be exactly ONE switch; the repo-root test suite
 * **smoothZoomHome** goes red in both directions if one comes back.
 *
 * Card anatomy mirrors the Layers card next to it; `pal` is the planner's theme-mapped palette
 * (theme tokens only — B341), and data-export="skip" rides on the shared top-right container so
 * exports never include canvas chrome.
 */

import { useEffect, useRef, useState } from "react";
import { RADIUS } from "../../../shared/ui/radius.js";
import {
  isHidden, groupState, setVisible, setManyVisible, showAll, groupsFor, hiddenSummary,
} from "../lib/contentVisibility.js";

// Same 13px eye as the planner's per-overlay visibility toggle (B277) — redeclared here
// because SitePlanner.jsx keeps its icons file-private and importing back from the
// planner would be circular.
const EyeIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
  </svg>
);

// The struck-through eye, for the "something is hidden" chip. Same 13px box so the two
// never shift the header by a pixel when the state flips.
const EyeOffIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

// Commit-on-Enter/blur numeric field — the same semantics as the planner's file-private
// NumInput (edit freely, parse + clamp only on commit) so the Grid field can't half-apply.
function GridNumInput({ value, min = 1, max = 1000, style, onCommit }) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const editing = useRef(false);
  useEffect(() => { if (!editing.current) setDraft(value == null ? "" : String(value)); }, [value]);
  const commit = () => {
    editing.current = false;
    const n = parseFloat(draft);
    if (!Number.isFinite(n)) { setDraft(value == null ? "" : String(value)); return; }
    const v = Math.min(max, Math.max(min, n));
    setDraft(String(v));
    if (v !== value) onCommit(v);
  };
  return (
    <input type="text" inputMode="decimal" value={draft} style={style}
      onFocus={() => { editing.current = true; }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); e.target.blur(); } if (e.key === "Escape") { editing.current = false; setDraft(value == null ? "" : String(value)); e.target.blur(); } }} />
  );
}

export default function ViewMenu({ open, onToggle, settings, setSnap, patchSettings, pal, counts, elementsReady = true }) {
  const row = { display: "flex", gap: 7, alignItems: "center", cursor: "pointer", fontSize: 12.5, color: pal.ink, padding: "3px 0" };
  const numInput = { width: 52, padding: "4px 6px", fontSize: 12, fontFamily: "inherit", color: pal.ink, background: "var(--surface-raised)", border: `1px solid ${pal.panelLine}`, borderRadius: RADIUS.sm };
  const sectionHead = { fontSize: 9.5, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: pal.muted, margin: "9px 0 3px" };
  const countStyle = { fontSize: 10, color: pal.muted, flex: "none", fontVariantNumeric: "tabular-nums" };

  const hidden = settings.hidden;
  const groups = groupsFor(counts || {});
  const summary = hiddenSummary(hidden);
  const elMaster = groupState(hidden, groups.elRows.map((r) => r.key));

  const setHidden = (next) => { if (next !== hidden) patchSettings({ hidden: next }); };
  // One row renderer for every content group, so a per-type row and a family row cannot drift.
  const groupRow = ({ key, label, count }, indent = 0) => (
    <label key={key} style={{ ...row, paddingLeft: indent }}
      title={isHidden(hidden, key) ? `${label} are hidden — they are still on the plan and still counted` : `Hide ${label.toLowerCase()} temporarily`}>
      <input type="checkbox" data-testid={`view-row-${key}`} checked={!isHidden(hidden, key)}
        onChange={(e) => setHidden(setVisible(hidden, key, e.target.checked))} />
      <span style={{ flex: 1 }}>{label}</span>
      <span style={countStyle}>{count}</span>
    </label>
  );

  return (
    <div data-wheelscroll="1" style={{ width: open ? 232 : "auto", background: "var(--surface-overlay)", border: `1px solid ${pal.panelLine}`, borderRadius: RADIUS.md, boxShadow: "0 2px 10px rgba(28,25,20,0.16)", overflow: "hidden" }}>
      <button data-testid="view-menu-btn" onClick={onToggle} aria-expanded={open}
        title="What's shown on this drawing — hide groups temporarily, plus grid & snap"
        style={{ display: "flex", alignItems: "center", gap: 7, width: "100%", padding: "8px 11px", border: "none", background: "transparent", color: pal.ink, cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700 }}>
        <span style={{ color: summary ? "var(--warn-text)" : pal.accent, display: "inline-flex" }}>{summary ? <EyeOffIcon /> : <EyeIcon />}</span> View
        {/* ⛔ THE FILTERED-VIEW CHIP. The owner's requirement: "if something is hidden, the owner
            must be able to tell at a glance that he is looking at a filtered view rather than an
            empty site." It rides the COLLAPSED header — the state you can see without opening
            anything — in warn amber, and it NAMES the groups so it says what to turn back on. */}
        {!open && summary && (
          <span data-testid="view-hidden-chip" title={`Hidden: ${summary.labels.join(", ")} — still on the plan and still counted. Open View to show them again.`}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 2, fontSize: 10.5, fontWeight: 600, color: "var(--warn-text)" }}>
            <span style={{ width: 7, height: 7, borderRadius: RADIUS.pill, background: "var(--warn-text)", display: "inline-block" }} />
            {summary.text} hidden
          </span>
        )}
        {!open && !summary && settings.snap && (
          <span data-testid="view-snap-chip" title={`Snap is on (${settings.gridSize}′ grid) — press S to toggle`}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 2, fontSize: 10.5, fontWeight: 600, color: "var(--success-text)" }}>
            <span style={{ width: 7, height: 7, borderRadius: RADIUS.pill, background: "var(--success-text)", display: "inline-block" }} />
            Snap {settings.gridSize}′
          </span>
        )}
        <span style={{ flex: 1 }} /> <span style={{ color: pal.muted, fontWeight: 500 }}>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div style={{ padding: "2px 11px 10px" }}>
          {/* The same fact again with the card open, where the collapsed chip is not visible —
              and here it carries the one-click way back, so "I hid something and I want it all
              back" never requires remembering which rows were ticked. */}
          {summary && (
            <div data-testid="view-hidden-banner"
              style={{ display: "flex", alignItems: "center", gap: 6, margin: "4px 0 2px", padding: "5px 7px", borderRadius: RADIUS.sm, background: "var(--warn-bg)", border: "1px solid var(--warn-text)" }}>
              <span style={{ fontSize: 11, color: "var(--warn-text)", fontWeight: 600, flex: 1, minWidth: 0 }}>
                {summary.text} hidden
              </span>
              <button data-testid="view-show-all" onClick={() => setHidden(showAll(hidden))}
                title="Show every hidden group again"
                style={{ border: "none", background: "transparent", color: "var(--warn-text)", cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 700, padding: 0, textDecoration: "underline" }}>
                Show all
              </button>
            </div>
          )}

          {/* ⛔ B558064 — WHILE THE PLAN'S ELEMENTS ARE STILL LOADING, SAY SO — NEVER READ A
              MID-LOAD `counts` AS "THIS PLAN HAS NOTHING TO HIDE". A signed-in plan's cloud
              header carries no elements at all (they live in `site_elements` rows — B672), so
              `counts.els`/`parcels`/… are genuinely empty for the second or two between opening
              a plan and its rows landing. Reading that as "empty plan" used to make this whole
              section vanish, leaving only the Detail/Labels ornament toggles below — which is
              structurally the OLD pre-B653 menu minus dock doors, and reads as a stuck build.
              Once `elementsReady` flips true this placeholder is replaced by the real rows (or
              by nothing at all, correctly, for a plan that truly has no content). */}
          {!elementsReady ? (
            <>
              <div style={sectionHead}>Content</div>
              <div style={{ fontSize: 11.5, color: pal.muted, padding: "3px 0" }}>Loading what's on this plan…</div>
            </>
          ) : (groups.elRows.length > 0 || groups.otherRows.length > 0) && (
            <>
              <div style={sectionHead}>Content</div>
              {groups.elRows.length > 0 && (
                <>
                  {/* The tri-state master, on the Layers panel's "Show all flood & drainage"
                      pattern — `indeterminate` cannot be expressed in JSX, so it is set on the
                      node, exactly as `floodMasterRow` does it. */}
                  <label style={{ ...row, fontWeight: 600 }} title="Hide every drawn element at once — they stay on the plan and stay in every number">
                    <input type="checkbox" data-testid="view-elements-master" checked={elMaster.all}
                      ref={(el) => { if (el) el.indeterminate = elMaster.any && !elMaster.all; }}
                      aria-label="Show all elements"
                      onChange={(e) => setHidden(setManyVisible(hidden, elMaster.ids, e.target.checked))} />
                    <span style={{ flex: 1 }}>Elements</span>
                    <span style={countStyle}>{groups.elTotal}</span>
                  </label>
                  {groups.elRows.map((r) => groupRow(r, 18))}
                </>
              )}
              {groups.otherRows.map((r) => groupRow(r))}
            </>
          )}

          <div style={sectionHead}>Labels</div>
          <label style={row} title="The square-footage / acreage line on element labels">
            <input type="checkbox" checked={settings.showAreas !== false} onChange={(e) => patchSettings({ showAreas: e.target.checked })} /> Element areas
          </label>
          <label style={row} title="The acreage chip on each lot. A lot you have hidden on its own (right-click → Hide acreage label) stays hidden either way.">
            <input type="checkbox" data-testid="view-parcel-acreage" checked={!isHidden(hidden, "labels:parcelAcreage")}
              onChange={(e) => setHidden(setVisible(hidden, "labels:parcelAcreage", e.target.checked))} /> Parcel acreage
          </label>

          <div style={sectionHead}>Detail</div>
          <label style={row} title="The structural column grid and bay lines on drawn buildings">
            <input type="checkbox" checked={settings.showGrid} onChange={(e) => patchSettings({ showGrid: e.target.checked })} /> Column grid
          </label>
          <label style={row} title="The red footprint dimension callouts (building depth, road width, strip width)">
            <input type="checkbox" checked={settings.showDims !== false} onChange={(e) => patchSettings({ showDims: e.target.checked })} /> Dimensions
          </label>

          <div style={{ borderTop: `1px solid ${pal.panelLine}`, margin: "9px 0 7px" }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: pal.muted }}>Grid (ft)</span>
            <GridNumInput style={numInput} value={settings.gridSize} min={1} onCommit={(n) => patchSettings({ gridSize: n })} />
          </div>
          <label style={{ ...row, color: pal.muted, fontSize: 12 }} title="Snap to grid & flush against neighbours — press S to toggle (this browser session only; off by default); hold Alt while dragging to place freely">
            <input type="checkbox" checked={settings.snap} onChange={(e) => setSnap(e.target.checked)} /> Snap to grid &amp; neighbours (S)
          </label>
        </div>
      )}
    </div>
  );
}
