/* View3dButton — the map's "3D" button (NEW-2, B2671227, 2026-11-11; amends B2671220). It replaces the "View in 3D" row that used to sit at the bottom of the
 * Grading panel, where it was hard to find: it lives in the top-right row of the Site view, beside the "View" and "Imagery & Layers" cards, in the same card
 * style (icon + one short word).
 *
 * WHO SEES IT — one gate, `SitePlanner.jsx`'s `grOn` (the owner gate AND this plan's own "Grade this plan" switch): SitePlanner renders this component only
 * `{grOn && …}`, so a non-owner, and a plan that never opted into grading, have no button in the DOM at all. Whether the Grading panel is open is irrelevant.
 * Disabled — with its reason on hover — until the proposed surface exists.
 *
 * ⛔ THIS FILE IS PLANNER-SIDE AND THREE-FREE: it imports no viewer, no scene and no three.js (repo-root `test/` **grading3dGate** scans for it). Opening the
 * viewer is the parent's callback; the viewer's lazy chunk is fetched only when it mounts. */
import React from "react";
import { RADIUS } from "../../../shared/ui/radius.js";
import { FONT_SIZE } from "../../../shared/ui/designTokens.js";
import { CubeIcon } from "./icons.jsx";

const CARD_SHADOW = "0 2px 10px rgba(28,25,20,0.16)"; // design-exempt: the same card shadow the View and Layers cards beside it use (ViewMenu.jsx)

export default function View3dButton({ ready, onOpen, pal }) {
  return (
    // the same card as the View / Imagery & Layers cards beside it (ViewMenu.jsx): overlay surface, panel hairline, md radius, the same lift
    <div data-testid="grading-3d-card" style={{ background: "var(--surface-overlay)", border: `1px solid ${pal.panelLine}`, borderRadius: RADIUS.md, boxShadow: CARD_SHADOW, overflow: "hidden", flex: "none" }}>
      <button type="button" data-testid="grading-3d-open" disabled={!ready} onClick={() => { if (ready && onOpen) onOpen(); }}
        aria-label="3D — open the full-screen 3D cut-and-fill view of the grading"
        title={ready ? "Open the full-screen 3D view of the grading" : "Available once the grading has finished calculating"}
        style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 11px", border: "none", background: "transparent", color: ready ? pal.ink : pal.muted, cursor: ready ? "pointer" : "default", fontFamily: "inherit", fontSize: FONT_SIZE.control, fontWeight: 700 }}>
        <span aria-hidden style={{ color: ready ? pal.accent : pal.muted, display: "flex" }}><CubeIcon size={16} /></span> 3D
      </button>
    </div>
  );
}
