/* PasteIcons — THE PASTE-OPTIONS DRAWINGS (NEW-1, owner approved the "Office-style" mockup 2026-10-29).
 *
 * Word's and Excel's Paste Options show a clipboard with one small mark on it that says which option it is.
 * These are OUR drawings of that idea — no Microsoft asset is copied (the rule B36051 set). The owner approved the
 * final art from a mockup, with one correction that is now the shape of every icon here: THE CLIPBOARD RUNS FULL
 * HEIGHT under each mark (the first draft cut it off where the paintbrush sat). Every icon is the same 24-unit
 * box: the clipboard (BASE), then its mark, drawn white-first — a wide stroke in the "halo" colour that separates
 * the mark from the clipboard behind it, then the mark itself.
 *
 * ⛔ THE HALO IS THE SURFACE, NOT WHITE. In the light theme the halo is white (the flyout is white, so nothing
 * shows). In the dark theme a white outline round every mark would glow, so the halo is read from `--paste-halo`,
 * which the flyout/tab sets to its own background and each button re-sets to ITS background (hover, pressed). The few
 * marks that are dark ink on a light page (the "A", the blue "123", the brush's brown) have a dark-theme twin via
 * `--paste-ink` / `--paste-blue` / `--paste-brown` / `--paste-gray` so they stay legible on a dark surface. All of that lives in
 * `PASTE_ICON_CSS`, which the editor's stylesheet includes.
 *
 * These are ILLUSTRATIONS, not chrome, so the literal colours are the point — the file sits on the design audit's
 * drawing-surface list (ui-audit/design-drift-audit.mjs) beside the print sheet. Module scope (MODULE-SCOPE-
 * COMPONENTS), static markup, no state.
 */
import React from "react";

const HALO = "var(--paste-halo, #FFFFFF)";
const INK = "var(--paste-ink, #1B1E26)";
const BLUE = "var(--paste-blue, #2B6CB0)";
const BROWN = "var(--paste-brown, #8A5A2B)";
const GRAY = "var(--paste-gray, #4B5263)";

/** The dark-theme twins and the halo defaults. Included in the editor's stylesheet. */
export const PASTE_ICON_CSS = `
[data-theme="dark"] .planyr-paste-glyph { --paste-ink: var(--text-primary); --paste-blue: #6FB4F0; --paste-brown: #D9A66B; --paste-gray: #C5CBD6; }
[data-theme="dark"] .planyr-paste-ctx { --paste-halo: var(--surface-raised); }
`;

const haloLine = (extra) => ({ stroke: HALO, ...extra });

/* The clipboard, full height: board, paper, clip. */
const BASE = (
  <>
    <rect x="2.5" y="3.5" width="13" height="17" rx="1.6" fill="#C9A46A" stroke="#6E5328" />
    <rect x="4.5" y="6" width="9" height="12.5" fill="#FFFFFF" />
    <rect x="6" y="2" width="6" height="3.6" rx="1" fill="#9AA1AC" stroke="#4B5263" strokeWidth="0.8" />
  </>
);

const BRUSH_BULB = "M16.4 16.6c-2-1.6-4.6 0-4.3 2.6-0.1 1.4-0.8 2.2-1.6 2.6 3 0.5 6.4-0.9 5.9-5.2z";

const MARKS = {
  /* Keep Source Formatting — a paintbrush. */
  source: (
    <>
      <path d="M22.4 10.6l-5 5" strokeWidth="4.6" strokeLinecap="round" style={haloLine()} />
      <path d={BRUSH_BULB} strokeWidth="2.4" strokeLinejoin="round" style={{ fill: HALO, stroke: HALO }} />
      <path d="M22.4 10.6l-5 5" strokeWidth="2.4" strokeLinecap="round" style={{ stroke: BROWN }} />
      <path d="M16.6 15.2l1.8 1.8" stroke="#6B7280" strokeWidth="2.4" />
      <path d={BRUSH_BULB} style={{ fill: BLUE }} />
    </>
  ),
  /* Merge Formatting — a styled page with an arrow flowing into the clipboard. */
  merge: (
    <>
      <rect x="13.5" y="10.5" width="9" height="12" rx="1" fill="none" strokeWidth="3" style={haloLine()} />
      <rect x="13.5" y="10.5" width="9" height="12" rx="1" fill="#FFFFFF" stroke="#4B5263" />
      <path d="M15.5 14h5M15.5 16.5h5M15.5 19h3" strokeWidth="1.2" style={{ stroke: BLUE }} />
      <path d="M8.5 16.5h5.6M12.4 14.8l1.8 1.7-1.8 1.7" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" style={haloLine()} />
      <path d="M8.5 16.5h5.6M12.4 14.8l1.8 1.7-1.8 1.7" stroke="#D9822B" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>
  ),
  /* Keep Text Only — a plain letter A. */
  text: (
    <text x="17" y="22.5" textAnchor="middle" fontFamily="Georgia, 'Times New Roman', serif" fontSize="13" fontWeight="700"
      strokeWidth="2.6" strokeLinejoin="round" paintOrder="stroke" style={{ stroke: HALO, fill: INK }}>A</text>
  ),
  /* Keep Source Column Widths — a small grid with a two-headed arrow over its columns. */
  widths: (
    <>
      <rect x="11.5" y="13" width="11" height="9" fill="none" strokeWidth="3" style={haloLine()} />
      <rect x="11.5" y="13" width="11" height="9" fill="#FFFFFF" stroke="#4B5263" />
      <path d="M15.2 13v9M18.8 13v9M11.5 17.5h11" stroke="#4B5263" strokeWidth="0.8" />
      <path d="M11.5 10.8h11M13 9.6l-1.5 1.2 1.5 1.2M21 9.6l1.5 1.2-1.5 1.2" strokeWidth="3.4" fill="none" strokeLinecap="round" strokeLinejoin="round" style={haloLine()} />
      <path d="M11.5 10.8h11M13 9.6l-1.5 1.2 1.5 1.2M21 9.6l1.5 1.2-1.5 1.2" stroke="#D9822B" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  /* Transpose — a row turning into a column. */
  transpose: (
    <>
      <rect x="11" y="10.5" width="9" height="3.5" fill="none" strokeWidth="3" style={haloLine()} />
      <rect x="11" y="10.5" width="9" height="3.5" fill="#DCE8F6" stroke="#2B6CB0" />
      <rect x="19.5" y="13" width="3.5" height="9.5" fill="none" strokeWidth="3" style={haloLine()} />
      <rect x="19.5" y="13" width="3.5" height="9.5" fill="#FCE7D6" stroke="#D9822B" />
      <path d="M13 15.5c0 3.2 2 5 4.6 5M16.4 19.2l1.4 1.3-1.4 1.3" strokeWidth="3.4" fill="none" strokeLinecap="round" strokeLinejoin="round" style={haloLine()} />
      <path d="M13 15.5c0 3.2 2 5 4.6 5M16.4 19.2l1.4 1.3-1.4 1.3" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: GRAY }} />
    </>
  ),
  /* Values — "123". */
  values: (
    <text x="16.8" y="21" textAnchor="middle" fontFamily="Inter, Arial, sans-serif" fontSize="8" fontWeight="800"
      strokeWidth="2.6" strokeLinejoin="round" paintOrder="stroke" style={{ stroke: HALO, fill: BLUE }}>123</text>
  ),
  /* Values and Source Formatting — "123" with a brush. */
  valuesFormat: (
    <>
      <text x="14.6" y="21.5" textAnchor="middle" fontFamily="Inter, Arial, sans-serif" fontSize="6.5" fontWeight="800"
        strokeWidth="2.6" strokeLinejoin="round" paintOrder="stroke" style={{ stroke: HALO, fill: BLUE }}>123</text>
      <path d="M23 9.8l-3.4 3.4" strokeWidth="4" strokeLinecap="round" style={haloLine()} />
      <path d="M19.6 13c-1.3-1-3 0-2.8 1.6 0 0.8-0.4 1.3-0.9 1.6 2 0.3 4.1-0.6 3.7-3.2z" strokeWidth="2" style={{ fill: HALO, stroke: HALO }} />
      <path d="M23 9.8l-3.4 3.4" strokeWidth="2" strokeLinecap="round" style={{ stroke: BROWN }} />
      <path d="M19.6 13c-1.3-1-3 0-2.8 1.6 0 0.8-0.4 1.3-0.9 1.6 2 0.3 4.1-0.6 3.7-3.2z" style={{ fill: BLUE }} />
    </>
  ),
  /* Formatting only — a "%" (a number format) with the brush. */
  formatting: (
    <>
      <text x="13.6" y="15" textAnchor="middle" fontFamily="Inter, Arial, sans-serif" fontSize="6.5" fontWeight="800"
        strokeWidth="2.6" strokeLinejoin="round" paintOrder="stroke" style={{ stroke: HALO, fill: GRAY }}>%</text>
      <path d="M22.4 10.6l-5 5" strokeWidth="4.6" strokeLinecap="round" style={haloLine()} />
      <path d={BRUSH_BULB} strokeWidth="2.4" strokeLinejoin="round" style={{ fill: HALO, stroke: HALO }} />
      <path d="M22.4 10.6l-5 5" strokeWidth="2.4" strokeLinecap="round" style={{ stroke: BROWN }} />
      <path d={BRUSH_BULB} style={{ fill: BLUE }} />
    </>
  ),
  /* Picture — a small framed landscape. */
  picture: (
    <>
      <rect x="11.5" y="12" width="11" height="10" fill="none" strokeWidth="3" style={haloLine()} />
      <rect x="11.5" y="12" width="11" height="10" fill="#DCE8F6" stroke="#2B6CB0" />
      <path d="M11.5 22l3.6-4.2 2.4 2.6 1.8-1.8 3.2 3.4z" fill="#3E8E5A" />
      <circle cx="19.6" cy="14.6" r="1.3" fill="#D9822B" />
    </>
  ),
};

/** One option's drawing. `size` is the rendered edge in CSS px (28 in the flyout, 22 in the collapsed tab, 18 in a menu). */
export function PasteGlyph({ mode, size = 28 }) {
  return (
    <svg className="planyr-paste-glyph" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false"
      style={{ display: "block", overflow: "visible" }}>
      {BASE}
      {MARKS[mode] ?? null}
    </svg>
  );
}

/** The bare clipboard — the collapsed tab's icon. */
export function ClipboardGlyph({ size = 22 }) {
  return (
    <svg className="planyr-paste-glyph" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" style={{ display: "block" }}>
      {BASE}
    </svg>
  );
}

/** The modes this file draws, so a test can assert every option the sets name has a drawing. */
export const PASTE_GLYPH_MODES = Object.keys(MARKS);
