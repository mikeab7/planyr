/* Curved undo / redo arrows for the Univer grid (NEW-2, B2574353). Univer's own glyphs are the sharp-cornered default set; the
 * owner asked for the round-hook arrows Excel uses. Same hand-drawn inline-SVG convention as Ribbon.jsx's icon set (24×24 viewBox,
 * `currentColor` stroke, round caps) — so size, colour and the disabled tint all come from the toolbar button around it, exactly
 * like the neighbouring icons. NOTE the old Ribbon's IconUndo/IconRedo are right-angle elbows, not curves, so they were NOT reused.
 * Imports only React: nothing here touches @univerjs/* (UniverSheet.jsx registers these through the facade). */
import { createElement } from "react";

const svgProps = {
  xmlns: "http://www.w3.org/2000/svg", fill: "none", viewBox: "0 0 24 24", width: "1em", height: "1em",
  stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true",
};

/** arrowhead on the left, then a half-turn arc (a real curve, never an elbow) */
const UNDO_HEAD = "9 14 4 9 9 4";
const UNDO_ARC = "M4 9h9a6 6 0 0 1 0 12h-4";
const REDO_HEAD = "15 14 20 9 15 4";
const REDO_ARC = "M20 9h-9a6 6 0 0 0 0 12h4";

/** Univer hands its icons extra props (preserveStrokeWidth, extend, …) that are not DOM attributes: forward only class + style. */
const curved = (name, head, arc) => function CurvedIcon({ className, style }) {
  return createElement("svg", { ...svgProps, style, "data-planyr-icon": `${name}-curved`, className: `univerjs-icon univerjs-icon-${name}-icon${className ? " " + className : ""}` },
    createElement("polyline", { points: head }), createElement("path", { d: arc }));
};
export const CurvedUndoIcon = curved("undo", UNDO_HEAD, UNDO_ARC);
export const CurvedRedoIcon = curved("redo", REDO_HEAD, REDO_ARC);

/** Univer's registry names for the two toolbar glyphs (ui/menu undo-redo factories). */
export const CURVED_ICONS = { UndoIcon: CurvedUndoIcon, RedoIcon: CurvedRedoIcon };
