import { useRef, useLayoutEffect } from "react";

/* The metes-and-bounds paste box, with an optional low-OCR-confidence highlight — CLAUDE.md item
 * (e): "Highlight low-confidence tokens in the editable text so the user's eye goes straight to the
 * characters most likely wrong, rather than proofreading a whole page." A plain `<textarea>` can't
 * style individual characters, so this uses the standard technique: a read-only backdrop `<div>`
 * painted with the SAME text (marks visible, glyphs transparent) sits directly behind a `<textarea>`
 * whose own background is transparent — the backdrop supplies the highlight color, the textarea
 * supplies the real, editable, selectable text on top. Scroll position is kept in lock-step so the
 * marks track the text as the user scrolls.
 *
 * MODULE-SCOPE-COMPONENTS: defined here, not inline in SitePlanner.jsx's render body.
 *
 * When `lowConfidenceSpans` is empty (every non-OCR path, and an OCR read Tesseract was confident
 * about end to end) this renders a PLAIN `<textarea>` — byte-for-byte the same element the box has
 * always been, so nothing about the non-OCR paths changes.
 */

const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const MARK_STYLE = "background:var(--warn-bg);border-bottom:2px solid var(--warn-border);border-radius:2px;";

function highlightedHtml(value, spans) {
  const text = String(value || "");
  const sorted = [...spans]
    .filter((s) => typeof s.start === "number" && typeof s.end === "number" && s.end > s.start)
    .sort((a, b) => a.start - b.start);
  let html = "";
  let cursor = 0;
  for (const s of sorted) {
    const start = Math.max(cursor, Math.min(text.length, s.start));
    const end = Math.max(start, Math.min(text.length, s.end));
    if (start > cursor) html += escapeHtml(text.slice(cursor, start));
    if (end > start) html += `<mark style="${MARK_STYLE}" title="Low OCR confidence — check this">${escapeHtml(text.slice(start, end))}</mark>`;
    cursor = Math.max(cursor, end);
  }
  html += escapeHtml(text.slice(cursor));
  return `${html}\n`; // trailing newline keeps the backdrop's last line from being clipped short of the textarea's own
}

export default function OcrDeedTextarea({ value, onChange, lowConfidenceSpans, rows, placeholder, style, ...rest }) {
  const taRef = useRef(null);
  const backdropRef = useRef(null);
  const hasSpans = !!(lowConfidenceSpans && lowConfidenceSpans.length);

  const syncScroll = () => {
    if (backdropRef.current && taRef.current) {
      backdropRef.current.scrollTop = taRef.current.scrollTop;
      backdropRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  };
  useLayoutEffect(() => { syncScroll(); });

  if (!hasSpans) {
    return <textarea ref={taRef} value={value} onChange={onChange} rows={rows} placeholder={placeholder} style={style} {...rest} />;
  }

  return (
    <div style={{ position: "relative" }}>
      <div
        ref={backdropRef} aria-hidden="true"
        style={{
          ...style, position: "absolute", inset: 0, margin: 0, color: "transparent",
          whiteSpace: "pre-wrap", wordWrap: "break-word", overflow: "auto", pointerEvents: "none", background: "transparent",
        }}
        dangerouslySetInnerHTML={{ __html: highlightedHtml(value, lowConfidenceSpans) }}
      />
      <textarea
        ref={taRef} value={value} onChange={onChange} onScroll={syncScroll} rows={rows} placeholder={placeholder}
        style={{ ...style, position: "relative", background: "transparent" }} {...rest}
      />
    </div>
  );
}
