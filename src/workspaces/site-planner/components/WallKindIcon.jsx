import { WALL_KIND_INK } from "../lib/planStyle.js";

/* WallKindIcon — Building panel v3 (NEW-4). The ONE set of six 16×16 icons for the "Docks & walls" strip: a
 * truck cab (court), a box trailer on landing gear (trailer), a sedan (car parking), two trees on a ground line
 * (buffer), a walker (walk) and a road in perspective. The strip's pieces, the legend's swatches and the edit
 * box's swatch all draw THIS set, filled in the kind's ink colour (WALL_KIND_INK, declared in planStyle.js).
 * Module scope (MODULE-SCOPE-COMPONENTS); decorative, so aria-hidden. */
const SHAPES = {
  court: (<>
    <path fillRule="evenodd" d="M1.2 11.6V7.3l1.9-3.2h3.9v7.5zM2.5 7.4l1.1-1.9h2.1v1.9z" />
    <rect x="6.2" y="2.4" width=".9" height="2" /><rect x="7" y="9.6" width="8" height="2" /><rect x="10" y="8.6" width="3.2" height="1" />
    <circle cx="3.9" cy="12.6" r="1.6" /><circle cx="10.6" cy="12.6" r="1.6" /><circle cx="13.5" cy="12.6" r="1.6" />
  </>),
  trailer: (<>
    <rect x="1" y="3.2" width="13.5" height="7" rx=".6" /><rect x="3.2" y="10.2" width=".9" height="3" /><rect x="2.4" y="12.8" width="2.5" height=".8" />
    <circle cx="10.4" cy="12.4" r="1.5" /><circle cx="13" cy="12.4" r="1.5" />
  </>),
  parking: (<>
    <path fillRule="evenodd" d="M1 11.4V9.3c0-.6.4-1.1 1-1.2l2.3-.5 2-2.6c.3-.4.8-.6 1.3-.6h3.1c.5 0 1 .2 1.3.6l1.7 2.5c.8.2 1.3.8 1.3 1.6v2.3zM6.1 7.5l1.3-1.7h1.8v1.7zM10.2 7.5V5.8h1.2l1.1 1.7z" />
    <circle cx="4.3" cy="11.6" r="1.6" /><circle cx="11.8" cy="11.6" r="1.6" />
  </>),
  buffer: (<>
    <circle cx="5" cy="6.5" r="3.6" /><rect x="4.4" y="9" width="1.2" height="5.5" /><circle cx="11.6" cy="8" r="2.9" /><rect x="11" y="10" width="1.2" height="4.5" /><rect x="1" y="14.2" width="14" height="1" />
  </>),
  sidewalk: (<>
    <circle cx="8.6" cy="2.4" r="1.6" />
    <path d="M7.3 4.6h2l1.6 3.4 2 .8-.5 1.1-2.4-.9-.6-1.2-.6 2.6 2.1 2.3.4 3.3H10l-.4-2.7-1.9-1.9-.9 2.1-2.4 2.5-.9-.8 2.1-2.4 1.4-5.5-1.3.6-.9 2.2-1.1-.4 1.2-2.9z" />
  </>),
  road: (<>
    <path d="M6.2 1h1.2L5 15H1.6zM8.6 1h1.2L14.4 15H11z" /><rect x="7.5" y="3" width="1" height="2.2" /><rect x="7.4" y="7" width="1.2" height="2.6" /><rect x="7.3" y="11.5" width="1.4" height="3" />
  </>),
};

/** The kinds that have an icon — the same six the strip, legend and edit box draw. */
export const WALL_KIND_ICONS = Object.keys(SHAPES);

export default function WallKindIcon({ kind, size = 11, style }) {
  const shape = SHAPES[kind];
  if (!shape) return null;
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16" fill={WALL_KIND_INK[kind]} style={{ flex: "none", display: "block", ...style }}>
      {shape}
    </svg>
  );
}
