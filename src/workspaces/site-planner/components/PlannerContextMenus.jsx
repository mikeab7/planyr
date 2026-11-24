/* @planner-extract — the planner right-click menus (audit batch G6b, behaviour-identical move).
 * Were inline functions in the main return; now module-scope memoized components
 * (MODULE-SCOPE-COMPONENTS). Everything they read from the planner arrives as a prop; no import back from SitePlanner.jsx. */
import { memo } from "react";
import ContextMenu from "../../../shared/ui/ContextMenu.jsx";
import { LockGlyph } from "../../../shared/ui/LockToggle.jsx";
import { hasCanvasClip, hasOverlayClip } from "../lib/planClipboardStore.js";
import { CROSS_BAND_BEHIND, CROSS_BAND_FRONT } from "../lib/paintOrder.js";
import { calloutAtAbsoluteFront } from "../lib/arrange.js";
import { pullOf, showAreaOn } from "../lib/easementLabelPull.js";
import { overlayOrderFlags, overlayBand } from "../lib/overlayOrder.js";
import ParcelContextMenu from "./ParcelContextMenu.jsx";
import { isRenameable } from "../lib/parcelMenu.js";
import { MOD_LABEL } from "../lib/plannerConstants.js";

export const ParcelMenuHost = memo(function ParcelMenuHost({
  combineSel,
  deleteParcels,
  mergeParcels,
  openParcelPage,
  parcelActsRef,
  parcelMenu,
  parcelRows,
  parcels,
  resetParcelChipOffset,
  restoreCombinedOriginals,
  setCombineSel,
  setParcelChipHidden,
  setParcelMenu,
  zoomToElements,
}) {
        /* NEW-1 (2026-10-22) — the SAME menu as the panel row's ⋯ and a right-click on a row (lib/parcelMenu.js, one component). */
        const pc = parcels.find((p) => p.id === parcelMenu.id);
        if (!pc) return null;
        const row = parcelRows.find((r) => r.id === pc.id);
        const id = pc.id;
        const pick = (what) => {
          setParcelMenu(null);
          if (what === "properties" || what === "rename") openParcelPage(id);
          else if (what === "zoom") zoomToElements([{ kind: "parcel", id }]);
          else if (what === "lock") parcelActsRef.current.onToggleLock(id);
          else if (what === "chip") setParcelChipHidden(id, !pc.chipHidden);
          else if (what === "chipReset") resetParcelChipOffset(id);
          else if (what === "merge") mergeParcels();
          else if (what === "clearSel") setCombineSel([]);
          else if (what === "uncombine") restoreCombinedOriginals(id);
          else if (what === "delete") deleteParcels([id], "menu:parcel");
        };
        return <ParcelContextMenu x={parcelMenu.x} y={parcelMenu.y} pc={pc} renameable={isRenameable(row)} mergeCount={combineSel.length} onPick={pick} onClose={() => setParcelMenu(null)} testId="parcel-menu" />;
});

export const MapContextMenu = memo(function MapContextMenu({
  PAL,
  alignDeedToParcel,
  arrangePeers,
  arrangeSel,
  callouts,
  copyRef,
  deedAlreadyPromoted,
  deedGroupMembers,
  deedMainOf,
  deleteMarkupById,
  deleteSel,
  disabledRow,
  duplicateRef,
  fit,
  flashWarn,
  insertVtx,
  mapMenu,
  markups,
  measures,
  menuItem,
  menuPanel,
  openInspector,
  parcels,
  pasteClip,
  pasteOverlay,
  promoteDeedToParcel,
  removeLeaderFromCallout,
  setAddLeaderFor,
  setAlignFor,
  setCalloutBand,
  setEaseShowArea,
  setMapMenu,
  setMarkupBand,
  setMeasureBand,
  setSel,
  snapBackEaseLabel,
  toggleCalloutLock,
  toggleMarkupLock,
  toggleMeasureLock,
}) {
        const MW = 214;
        const close = () => setMapMenu(null);
        const row = ({ text, on, danger, dis, hint, title }) => (
          <button title={title} disabled={!!dis}
            style={{ ...menuItem(false), ...(dis ? { color: PAL.disabled, ...disabledRow } : danger ? { color: PAL.danger } : {}), cursor: dis ? "default" : "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}
            onClick={dis ? undefined : on}>
            <span>{text}</span>{hint && <span style={{ fontSize: 11, color: dis ? PAL.disabled : PAL.muted, fontWeight: 400 }}>{hint}</span>}
          </button>
        );
        /* NEW-1/NEW-2 — ONE Arrange group, rendered identically for every family that has one.
         * Before this each menu hand-rolled its own: the markup menu offered all four modes, the
         * measurement menu offered TWO of them, and the callout menu offered none at all — the
         * "same right menu options" drift the owner reported, in its purest form. Building the
         * group once is what stops the fourth menu drifting away again.
         *
         * ⛔ AND IT NEVER RENDERS AS AN EMPTY SPACE. The old markup/measurement menus hid the whole
         * group behind `count > 1`, so right-clicking the only object on its layer showed no
         * ordering rows and no reason — which is what "the layers / order feature doesn't work at
         * all" looked like from the outside. A lone object now gets the four rows GREYED with a
         * plain-English hover reason, so the answer is visible instead of absent. */
        const arrangeGroup = (ref, { hdr }) => {
          const info = arrangePeers(ref);
          if (!info) return null;
          const af = info.flags;
          const alone = info.alone;
          // B1788912 (NEW-1) — an element's peer set is the whole plan now (no more type-band
          // wording), same shape as the annotation families below.
          const why = alone ? (ref.kind === "el" ? "This is the only element on the plan, so there is nothing to reorder it against."
            : `This is the only one on the ${info.band} layer, so there is nothing to reorder it against.`) : "";
          /* NEW-1 — a disabled row now says what END it is at, in the terms the user is thinking in:
             the WHOLE drawing ("behind everything on the plan"), because with cross-band Arrange
             (annotations) and the retired type layer (elements, B1788912) there is nothing invisible
             left to do, and a row that greys while something is still underneath is exactly the
             claim of completion this item exists to kill. */
          const endWord = (mode) => {
            const back = mode === "back" || mode === "backward";
            if (ref.kind === "el") return `Already at the ${back ? "back" : "front"} of the plan.`;
            return `Already ${back ? "behind" : "in front of"} everything on the plan.`;
          };
          const r = (text, mode, dis, hint) => row({
            text, hint, dis: dis || alone, title: dis && !alone ? endWord(mode) : why,
            on: () => { arrangeSel(mode, ref); close(); },
          });
          // B806080 round 2 — "Bring to Front" on a CALLOUT is answered by the absolute-front
          // escape hatch, never by `af.atTop` (the top of the callout family alone): `af.atTop`
          // was true of the owner's WETLANDS callout the entire time it still painted under an
          // area measurement, which is exactly the toast that was wrong. `calloutAtAbsoluteFront`
          // is the one fact this row and `arrangeSel`'s own toast are both built from, so they
          // cannot independently drift about what "already at the front" means.
          const bringToFrontDis = ref.kind === "callout" ? calloutAtAbsoluteFront(callouts, ref.id) : af.atTop;
          return <>
            {hdr}
            {r("Bring to Front", "front", bringToFrontDis, `${MOD_LABEL}⇧]`)}
            {r("Bring Forward", "forward", af.atTop, `${MOD_LABEL}]`)}
            {r("Send Backward", "backward", af.atBottom, `${MOD_LABEL}[`)}
            {r("Send to Back", "back", af.atBottom, `${MOD_LABEL}⇧[`)}
          </>;
        };
        const sep = <div style={{ borderTop: `1px solid ${PAL.panelLine}`, marginTop: 4, paddingTop: 4 }} />;
        // NEW-1 (2026-10-22) — a right-click along an easement / markup line / measurement leads with "Add control point" at the spot.
        const addPointRows = mapMenu.edge ? (<>
          <button data-testid="map-menu-add-control-point" title="Drop a control point on the line at the spot you clicked"
            style={{ ...menuItem(false), cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
            onClick={() => { const ed = mapMenu.edge; close(); insertVtx(ed.layer, ed.id, ed.index, ed.pt); }}>
            <span aria-hidden="true">＋</span><span>Add control point</span>
          </button>
          {sep}
        </>) : null;
        let header = "", body = null;
        if (mapMenu.kind === "markup") {
          const m = markups.find((x) => x.id === mapMenu.id);
          if (!m) return null;
          const isDeed = m.kind === "encumbrance";
          const dm = isDeed ? deedMainOf(deedGroupMembers(m), m) : m;
          const hasParcel = parcels.some((p) => p.active !== false && (p.points?.length || 0) >= 3);
          const groupN = m.deedGroup ? markups.filter((x) => x.deedGroup === m.deedGroup).length : 1;
          header = isDeed ? "Deed (metes & bounds)" : m.kind === "easement" ? "Easement" : "Markup";
          const delText = isDeed ? `Delete deed${groupN > 1 ? " + exceptions" : ""}` : `Delete ${m.kind === "easement" ? "easement" : "markup"}`;
          // B820/NEW-1 — Arrange (z-order) among the markups IN THIS BAND (see arrangePeers), plus
          // the one cross-band command (a markup normally floats over the elements; this drops it —
          // the whole deed group, if it's a deed — beneath them).
          // NEW-2 — one named setter, shared with the covering element's "Bring it back in front"
          // row (see setMarkupBand). It also gained the re-stack its two siblings always had: the
          // old inline version flipped the flag and left `z` alone, so a markup brought back in
          // front could land underneath a markup it used to be above.
          const setBehind = () => { setMarkupBand(m.id, !m.behindEls); close(); };
          body = <>
            {addPointRows}
            {isDeed && row({ text: hasParcel ? "Align to county parcel" : "Rotate to grid north", dis: !!m.locked, title: m.locked ? "Unlock this deed first" : "", on: () => { alignDeedToParcel(dm.id); close(); } })}
            {/* NEW-1 — a markup reaches its inspector from its own menu, like a measurement always could. */}
            {row({ text: "Properties\u2026", on: () => { setSel({ kind: "markup", id: m.id }); openInspector(); close(); } })}
            {/* NEW-2 — the way out when the county service is down: the legal description IS the
                boundary, so turn the plotted deed into a real parcel. Sits beside Align because the
                two are the same decision from opposite sides (fit MY deed to THEIR map · make my
                deed the map). Already-promoted deeds say so instead of silently making a second. */}
            {isDeed && row({
              text: deedAlreadyPromoted(dm) ? "Already the parcel boundary" : "Use as parcel boundary",
              dis: deedAlreadyPromoted(dm),
              title: deedAlreadyPromoted(dm) ? "This deed is already a parcel on the plan" : "Turn this deed into a real parcel — acreage, setbacks and the area math all start working on it",
              on: () => { promoteDeedToParcel(dm.id); close(); },
            })}
            {row({ text: m.locked ? "Unlock" : "Lock", hint: <LockGlyph locked={!!m.locked} size={13} />, on: () => { toggleMarkupLock(m.id); close(); } })}
            {/* NEW-6 — every drawn kind is copyable, and says so in its own menu. */}
            {row({ text: "Copy", hint: `${MOD_LABEL}C`, on: () => { copyRef({ kind: "markup", id: m.id }); close(); } })}
            {/* NEW-1 — and every drawn kind is DUPLICABLE. Only elements and references had this. */}
            {row({ text: "Duplicate", hint: `${MOD_LABEL}D`, on: () => { duplicateRef({ kind: "markup", id: m.id }); close(); } })}
            {arrangeGroup({ kind: "markup", id: m.id }, { hdr: sep })}
            {row({ text: m.behindEls ? CROSS_BAND_FRONT : CROSS_BAND_BEHIND, on: setBehind })}
            {sep}
            {row({ text: delText, hint: "Del", danger: true, on: () => { deleteMarkupById(m.id); } })}
          </>;
        } else if (mapMenu.kind === "easeLabel") {
          // NEW-1/NEW-2 — the easement LABEL's own menu: snap it back to the strip, show/hide its area line.
          const m = markups.find((x) => x.id === mapMenu.id);
          if (!m) return null;
          const pulled = !!pullOf(m), areaOn = showAreaOn(m);
          header = "Easement label";
          body = <>
            {row({ text: areaOn ? "Hide area" : "Show area", dis: !!m.locked, title: m.locked ? "Unlock this easement first" : "", on: () => { setEaseShowArea(m.id, !areaOn); close(); } })}
            {row({ text: "Snap back to strip", dis: !pulled || !!m.locked, title: !pulled ? "The label is already on the strip" : m.locked ? "Unlock this easement first" : "Return the label to the strip and remove its leader", on: () => { snapBackEaseLabel(m.id); close(); } })}
            {sep}
            {row({ text: "Easement properties\u2026", on: () => { setSel({ kind: "markup", id: m.id }); openInspector(); close(); } })}
          </>;
        } else if (mapMenu.kind === "measure") {
          // NEW — measurements get a right-click menu just like every other element.
          const m = measures[mapMenu.i];
          if (!m) return null;
          header = "Measurement";
          /* NEW-1 — Arrange, from the ONE shared group. This menu used to render TWO of the four
             modes (front/back, and in different wording: "Bring to front" against the markup
             menu's "Bring to Front"), which is the drift in miniature — same concept, same
             keyboard chords already wired, half the rows and a different capitalisation. */
          body = <>
            {addPointRows}
            {row({ text: "Properties…", on: () => { setSel({ kind: "measure", i: mapMenu.i }); openInspector(); close(); } })}
            {m.id && arrangeGroup({ kind: "measure", id: m.id }, { hdr: sep })}
            {m.id && row({ text: m.behindEls ? CROSS_BAND_FRONT : CROSS_BAND_BEHIND,
              title: m.behindEls ? "Draw this measurement over the buildings again" : "Draw this measurement under the buildings, so the plan sits on top of it",
              on: () => { setMeasureBand(m.id, !m.behindEls); close(); } })}
            <div style={{ borderTop: `1px solid ${PAL.panelLine}`, marginTop: 4, paddingTop: 4 }} />
            {row({ text: m.locked ? "Unlock" : "Lock", hint: <LockGlyph locked={!!m.locked} size={13} />, on: () => { toggleMeasureLock(m.id); close(); } })}
            {row({ text: "Copy", hint: `${MOD_LABEL}C`, on: () => { copyRef({ kind: "measure", id: m.id, i: mapMenu.i }); close(); } })}
            {row({ text: "Duplicate", hint: `${MOD_LABEL}D`, on: () => { duplicateRef({ kind: "measure", id: m.id, i: mapMenu.i }); close(); } })}
            <div style={{ borderTop: `1px solid ${PAL.panelLine}`, marginTop: 4, paddingTop: 4 }} />
            {row({ text: "Delete measurement", hint: "Del", danger: true, on: () => { deleteSel({ kind: "measure", i: mapMenu.i }, { entry: "menu:measure" }); close(); } })}
          </>;
        } else if (mapMenu.kind === "callout") {
          // Multi-leader — Add / Delete Leader for the SEPARATE `callouts` collection.
          const c = callouts.find((x) => x.id === mapMenu.id);
          if (!c) return null;
          header = c.noLeader ? "Text box" : "Callout";
          /* NEW-1/NEW-2 — THE MENU THE AUDIT FOUND EMPTIEST. An annotation had Add Leader, Copy and
             Delete and nothing else: no Properties row, no Lock (while the code has honoured
             `c.locked` all along, with no way to set or clear it), no Duplicate, and — the
             structural one — no ordering of any kind, because callouts were rendered from the raw
             state array. All four are the same drift, closed together. */
          body = <>
            {row({ text: "Properties…", on: () => { setSel({ kind: "callout", id: c.id }); openInspector(); close(); } })}
            {row({ text: "Add Leader", dis: !!c.locked, title: c.locked ? "Unlock this note first" : "", on: () => { setAddLeaderFor(c.id); flashWarn("Add Leader: click where the new leader should point — Esc to cancel.", 0); close(); } })}
            {mapMenu.leaderIndex >= 0 && row({ text: "Delete Leader", danger: true, dis: !!c.locked, on: () => { removeLeaderFromCallout(c.id, mapMenu.leaderIndex); close(); } })}
            {row({ text: c.locked ? "Unlock" : "Lock", hint: c.locked ? "\ud83d\udd12" : "\ud83d\udd13", on: () => { toggleCalloutLock(c.id); close(); } })}
            {/* NEW-2 (B1765729) \u2014 the SAME align-rotation mechanism a building's own right-click
                menu offers (AlignRotationIcon/alignFor/alignToElement/alignToParcelEdge), extended
                so a text box or callout can be the align SOURCE too: click a building, another
                callout/text box, or a parcel edge next to match this one's angle to it. */}
            {row({ text: "Align rotation\u2026", on: () => { setAlignFor({ kind: "callout", id: c.id }); close(); } })}
            {row({ text: "Copy", hint: `${MOD_LABEL}C`, on: () => { copyRef({ kind: "callout", id: c.id }); close(); } })}
            {row({ text: "Duplicate", hint: `${MOD_LABEL}D`, on: () => { duplicateRef({ kind: "callout", id: c.id }); close(); } })}
            {arrangeGroup({ kind: "callout", id: c.id }, { hdr: sep })}
            {row({ text: c.behindEls ? CROSS_BAND_FRONT : CROSS_BAND_BEHIND,
              title: c.behindEls ? "Draw this note over the buildings again" : "Draw this note under the buildings, so the plan sits on top of it",
              on: () => { setCalloutBand(c.id, !c.behindEls); close(); } })}
            <div style={{ borderTop: `1px solid ${PAL.panelLine}`, marginTop: 4, paddingTop: 4 }} />
            {row({ text: c.noLeader ? "Delete text box" : "Delete callout", hint: "Del", danger: true, on: () => { deleteSel({ kind: "callout", id: c.id }, { entry: "menu:callout" }); close(); } })}
          </>;
        } else {
          const hasClip = hasCanvasClip() || hasOverlayClip();
          header = "Map";
          body = <>
            {row({ text: "Zoom to fit", on: () => { fit(); close(); } })}
            {row({ text: "Paste", hint: `${MOD_LABEL}V`, dis: !hasClip, title: hasClip ? "" : "Copy a shape or drawing first", on: () => { if (hasCanvasClip()) pasteClip(); else if (hasOverlayClip()) pasteOverlay(); close(); } })}
            {/* Google Earth (KMZ) export is NOT here — owner decision 2026-10-22 (NEW-1): File ▾ is its ONE home in the planner. */}
          </>;
        }
        return (
          <ContextMenu x={mapMenu.x} y={mapMenu.y} onClose={close} width={MW} zIndex={1998} className="menu" panelStyle={menuPanel}>
            <div style={{ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.06em", padding: "8px 8px 6px" }}>{header}</div>
            {body}
          </ContextMenu>
        );
});

export const OverlayContextMenu = memo(function OverlayContextMenu({
  PAL,
  copyOverlay,
  disabledRow,
  duplicateOverlay,
  flashWarn,
  menuItem,
  menuPanel,
  ovMenu,
  parcels,
  pasteOverlay,
  patchOverlay,
  removeOverlay,
  reorderOverlay,
  setOvAlignBase,
  setOvMenu,
  setSelOverlay,
  setShowAerial,
  sheetOverlays,
  toggleOverlayBand,
}) {
        const MW = 220;
        const o = sheetOverlays.find((x) => x.id === ovMenu.id);
        if (!o) return null;
        // NEW-2 — front/back are WITHIN this reference's band (below vs above the plan), so the
        // greying matches what the ops actually do; crossing the plan is the separate toggle below.
        const { atFront, atBack } = overlayOrderFlags(sheetOverlays, ovMenu.id);
        const isAbove = overlayBand(o) === "above";
        const isAerialRow = !!o.fromMap; // B848736 — the pinned map reference: no promote, no align (see the panel row for the full rationale)
        const locked = !!o.locked, hasParcel = parcels.length > 0;
        const hdr = (top) => ({ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.06em", padding: top ? "8px 8px 6px" : "4px 8px 6px", ...(top ? { borderTop: `1px solid ${PAL.panelLine}`, marginTop: 4 } : {}) });
        const item = ({ text, hint, on, dis, danger, title }) => (
          <button title={title} disabled={!!dis}
            style={{ ...menuItem(false), ...(dis ? { color: PAL.disabled, ...disabledRow } : danger ? { color: PAL.danger } : {}), cursor: dis ? "default" : "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}
            onClick={dis ? undefined : on}>
            <span>{text}</span>{hint && <span style={{ fontSize: 11, color: dis ? PAL.disabled : PAL.muted, fontWeight: 400 }}>{hint}</span>}
          </button>
        );
        return (
          <ContextMenu x={ovMenu.x} y={ovMenu.y} onClose={() => setOvMenu(null)} width={MW} zIndex={1998} className="menu" panelStyle={menuPanel}>
            <div style={hdr(false)}>Edit</div>
            {item({ text: "Copy", hint: `${MOD_LABEL}C`, on: () => { copyOverlay(ovMenu.id); setOvMenu(null); } })}
            {item({ text: "Duplicate", hint: `${MOD_LABEL}D`, on: () => { duplicateOverlay(ovMenu.id); setOvMenu(null); } })}
            {item({ text: "Paste", hint: `${MOD_LABEL}V`, dis: !hasOverlayClip(), title: hasOverlayClip() ? "" : "Copy a drawing first", on: () => { pasteOverlay(); setOvMenu(null); } })}
            <div style={hdr(true)}>Arrange</div>
            {item({ text: "Bring to front", dis: atFront, on: () => { reorderOverlay(ovMenu.id, "front"); setOvMenu(null); } })}
            {item({ text: "Send to back", dis: atBack, on: () => { reorderOverlay(ovMenu.id, "back"); setOvMenu(null); } })}
            {!isAerialRow && item({ text: isAbove ? CROSS_BAND_BEHIND : CROSS_BAND_FRONT, title: isAbove ? "Put this overlay back under the parcel and the site elements" : "Lift this overlay over the parcel boundary, the setback ring and the site elements", on: () => { toggleOverlayBand(ovMenu.id, !isAbove); setOvMenu(null); } })}
            <div style={hdr(true)}>Place</div>
            {item({ text: locked ? "Unlock" : "Lock", hint: <LockGlyph locked={!!locked} size={13} />, on: () => { patchOverlay(ovMenu.id, { locked: !locked }); setOvMenu(null); } })}
            {item({ text: "Align to base edge…", dis: locked || !hasParcel || isAerialRow, title: isAerialRow ? "This aerial came from the map — it's already to scale, so manual alignment is disabled" : locked ? "Unlock to align" : (!hasParcel ? "Draw or load a parcel first" : "Click a parcel edge to snap this drawing parallel to it"), on: () => { setSelOverlay(ovMenu.id); setOvAlignBase(ovMenu.id); setOvMenu(null); flashWarn("Click a parcel boundary to align this drawing parallel to it.", 6000); } })}
            <div style={{ borderTop: `1px solid ${PAL.panelLine}`, marginTop: 4, paddingTop: 4 }} />
            {item({ text: "Delete", hint: "Del", danger: true, on: () => { removeOverlay(ovMenu.id); if (isAerialRow) setShowAerial(true); setOvMenu(null); } })}
          </ContextMenu>
        );
});
