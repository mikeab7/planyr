/* Middle-ellipsis label (NEW-4) — the head ellipsizes, the distinguishing TAIL is always drawn.
 *
 * Why not a JS measurement: this is pure CSS, so it stays correct at ANY container width, through
 * a rail resize, a font swap or a zoom, with no measure/re-render loop. The head is a flexible
 * `overflow: hidden; text-overflow: ellipsis` box; the tail is `flex: none`, so the browser gives
 * the tail its space FIRST and spends whatever is left on the head.
 *
 * Always carries the full text as a `title` (the hover tooltip the owner asked for), so nothing is
 * ever unrecoverable — the split is a display concern only. MODULE-SCOPE-COMPONENTS: defined here,
 * at module scope, never inside a render body.
 */
import { splitLabel } from "../files/middleTruncate.js";

export default function MiddleTruncate({ text, maxTail, minHead, title, style, tailStyle, "data-testid": testId }) {
  const full = text == null ? "" : String(text);
  const { head, tail } = splitLabel(full, { ...(maxTail != null ? { maxTail } : {}), ...(minHead != null ? { minHead } : {}) });
  return (
    <span data-testid={testId} data-full={full} title={title === undefined ? full : title || undefined}
      style={{ display: "inline-flex", minWidth: 0, maxWidth: "100%", alignItems: "baseline", whiteSpace: "nowrap", ...style }}>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{head}</span>
      {tail ? <span style={{ flex: "none", ...tailStyle }}>{tail}</span> : null}
    </span>
  );
}
