/* NoteRedline — renders `lib/notesRedline.js`'s output as ONE document with the changes marked
 *  in place (NEW-2 of the conflict-comparison follow-up). See that file's header for the whole
 *  argument; this file only draws what it computed.
 *
 *  ⛔ SHAPE, NOT JUST COLOUR (the brief's named anti-pattern: "colour as the only signal").
 *  An insertion is underlined (`<ins>`); a deletion is struck through (`<del>`) — the same
 *  distinction Word and Google Docs use, so it survives for a colour-blind reader or a printed
 *  screenshot. A whole inserted/deleted BLOCK additionally carries a left border bar, which is
 *  a second, position-based signal rather than a second colour-only one.
 *
 *  ⛔ AN OPAQUE BLOCK SHOWS ITS OWN CONTENT, NEVER JUST ITS TYPE NAME (follow-up brief NEW-1).
 *  The owner, on a removed table rendered as a bare "Table" pill: *"if we're going to show that
 *  we removed a table, why are we not showing the table."* He named the reference himself —
 *  Word's Track Changes / Compare Documents, where a deleted table renders in place, contents
 *  visible, marked as deleted — and that is what `OpaqueContent` below does for every node type
 *  `lib/notesRedline.js` treats as opaque (diffed as a whole unit, never word-by-word):
 *  a table renders as a real `<table>`, a box (`noteAnchor`) renders its actual content
 *  (`PlainNode`, recursively — a box can hold text or a picture), a sketch lists its box
 *  labels, and a picture renders as an actual thumbnail once its bytes have loaded (`images`,
 *  threaded down from `ConflictReview.jsx`'s async load — see that file's header). A
 *  divider and an attachment are the two genuine exceptions: a divider has no content beyond
 *  being a divider, and an attachment's whole content the panel could ever show — its name —
 *  is already in `block.label`, so `OpaqueContent` returns nothing extra for either rather than
 *  padding the panel with the same fact twice.
 */
const RADIUS = { control: 8, pill: 999 }; // mirrored from shared/ui/controls.jsx — see NoteToolbar

const HEADING_SIZE = { 1: 14, 2: 13, 3: 12, 4: 12 };

const CALLOUT_BORDER = {
  info: "var(--accent-notes)", tip: "var(--save-badge)", important: "var(--accent-review)",
  warning: "var(--warn-text)", danger: "var(--danger-text)",
};
const CALLOUT_BG = { warning: "var(--warn-bg)", danger: "var(--danger-bg)" };

/** One run's own formatting — bold/italic/strike/underline/code/highlight/textStyle/link, the
 *  exact mark vocabulary `lib/notesMarkdown.js`'s `applyMarks` already renders for export, kept
 *  in step so a mark added there is never silently invisible here. */
function markStyle(marks) {
  const has = (n) => marks.find((m) => m.type === n);
  const style = { };
  const deco = [];
  if (has("bold")) style.fontWeight = 700;
  if (has("italic")) style.fontStyle = "italic";
  if (has("strike")) deco.push("line-through");
  if (has("underline")) deco.push("underline");
  const code = has("code");
  if (code) { style.fontFamily = "ui-monospace, Menlo, Consolas, monospace"; style.background = "var(--surface-page)"; }
  const hl = has("highlight");
  if (hl) style.background = hl.attrs?.color || "var(--warn-bg)";
  const ts = has("textStyle");
  if (ts?.attrs?.color) style.color = ts.attrs.color;
  if (ts?.attrs?.fontFamily) style.fontFamily = ts.attrs.fontFamily;
  const link = has("link");
  if (link) { style.color = "var(--accent-notes-text)"; deco.push("underline"); }
  if (deco.length) style.textDecorationLine = deco.join(" ");
  return style;
}

/** One redline span — same text, or an insertion/deletion overlaid on its own marks. `<ins>`/
 *  `<del>` are semantic, so a screen reader announces the change even if colour never loads. */
function Span({ kind, text, marks }) {
  const style = markStyle(marks);
  if (kind === "same") return <span style={style}>{text}</span>;
  const deco = kind === "ins" ? "underline" : "line-through";
  style.textDecorationLine = style.textDecorationLine ? `${style.textDecorationLine} ${deco}` : deco;
  style.color = kind === "ins" ? "var(--success-text)" : "var(--danger-text)";
  const Tag = kind === "ins" ? "ins" : "del";
  return <Tag style={{ ...style, textDecoration: "none" }}>{text}</Tag>;
}

/** The word/symbol NEW-4 asks for on every whole-block insert/delete — colour is never the only
 *  carrier of "what changed" (WCAG 1.4.1; the owner hit this directly: a table's own opaque
 *  placeholder said "— added" in words, but the four plain-text contact lines removed right
 *  below it were "red and nothing else"). One small component, used identically whether the
 *  block is opaque (a table/picture/…) or ordinary text, so the two encodings the renderer uses
 *  — inline underline/strikethrough for a word-level edit, this tag for a whole added/removed
 *  block — are never one labelled and the other silent. */
export function ChangeTag({ status }) {
  if (status !== "inserted" && status !== "deleted") return null;
  const added = status === "inserted";
  return (
    <span
      data-testid="notes-redline-change-tag"
      style={{
        display: "inline-block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3,
        color: added ? "var(--success-text)" : "var(--danger-text)", marginRight: 6, verticalAlign: "middle",
      }}
    >{added ? "+ Added" : "− Removed"}</span>
  );
}

/** Leaf text runs (text + hardBreak nodes) out of arbitrary inline content — the plain-display
 *  twin of `lib/notesRedline.js`'s `runsOfInline`, kept here rather than imported because it
 *  feeds `Span` directly (no diff kind to carry). */
function plainRuns(content) {
  const runs = [];
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (n.type === "text") { runs.push({ text: n.text || "", marks: Array.isArray(n.marks) ? n.marks : [] }); return; }
    if (n.type === "hardBreak") { runs.push({ text: "\n", marks: [] }); return; }
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  (content || []).forEach(walk);
  return runs;
}

/** Undiffed inline text, for content shown as itself (inside a table cell, a box, a sketch) —
 *  every run renders as plain "same" through the same `Span`/`markStyle` the diffed view uses,
 *  so bold/italic/colour/etc. still survive; there is simply no ins/del kind to apply. */
function PlainRuns({ content }) {
  return plainRuns(content).map((r, i) => <Span key={i} kind="same" text={r.text} marks={r.marks} />);
}

/** A picture's actual thumbnail, once its bytes have arrived via the `images` map
 *  (`ConflictReview.jsx` loads it asynchronously — see that file's header). Until then, or if
 *  the bytes are genuinely gone, this says so in words rather than leaving a blank gap. */
function ImageThumb({ node, images }) {
  const src = images?.[node?.attrs?.imageId];
  const alt = String(node?.attrs?.alt || "picture");
  if (!src) {
    return <span style={{ fontSize: 10.5, fontStyle: "italic", color: "var(--text-secondary)" }}>{alt} — picture not loaded yet</span>;
  }
  return <img src={src} alt={alt} style={{ display: "block", maxWidth: "100%", maxHeight: 180, borderRadius: RADIUS.control, margin: "2px 0" }} />;
}

/** A table's real rows and cells — B1077680/NEW-1's central case: the owner's whole complaint
 *  was a removed TABLE rendering as the word "Table" and nothing else. Cell text keeps its own
 *  marks (`PlainRuns`); merged cells keep their real colspan/rowspan so the shape reads
 *  correctly even though nothing here diffs INSIDE the table (that stays out of scope, per
 *  `lib/notesRedline.js`'s header — the table is one opaque unit; only its content was hidden,
 *  and only that is fixed here). `overflowX: auto` on its own wrapper — not the whole panel —
 *  so a wide table scrolls in place instead of forcing the redline body sideways (NEW-3). */
function TableContent({ node }) {
  const rows = (node?.content || []).filter((r) => r.type === "tableRow");
  if (!rows.length) return null;
  return (
    <div style={{ overflowX: "auto", margin: "2px 0" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {(row.content || []).map((cell, ci) => {
                const Tag = cell.type === "tableHeader" ? "th" : "td";
                const colspan = Number(cell.attrs?.colspan || 1);
                const rowspan = Number(cell.attrs?.rowspan || 1);
                const paras = (cell.content || []).filter((c) => c.type === "paragraph");
                return (
                  <Tag
                    key={ci}
                    colSpan={colspan > 1 ? colspan : undefined}
                    rowSpan={rowspan > 1 ? rowspan : undefined}
                    style={{
                      border: "1px solid var(--border-default)", padding: "3px 6px", textAlign: "left",
                      fontWeight: cell.type === "tableHeader" ? 700 : 400, verticalAlign: "top",
                      whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "var(--text-primary)",
                    }}
                  >
                    {paras.length
                      ? paras.map((p, pi) => (
                        <div key={pi}><PlainRuns content={p.content} /></div>
                      ))
                      : null}
                  </Tag>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A sketch's box labels (and, where present, their body text) as a short list — enough to see
 *  WHAT was on the sketch without trying to reproduce its canvas layout (out of scope, same as
 *  the rest of this file's opaque handling). Reads both the current `boxes` shape and the
 *  superseded `outline` one a stored sketch may still carry (`lib/notesMarkdown.js`'s
 *  `sketchLines` reads the same two shapes for the same reason). */
function SketchContent({ node }) {
  const a = node?.attrs || {};
  const boxes = Array.isArray(a.boxes) && a.boxes.length ? a.boxes : Array.isArray(a.outline) ? a.outline : [];
  if (!boxes.length) return null;
  return (
    <ul style={{ margin: "2px 0", paddingLeft: 18, fontSize: 12, color: "var(--text-primary)" }}>
      {boxes.map((b, i) => (
        <li key={b?.id ?? i}>
          <strong>{b?.label ? String(b.label) : "Untitled box"}</strong>
          {b?.body ? ` — ${String(b.body)}` : ""}
        </li>
      ))}
    </ul>
  );
}

/** A single node rendered PLAIN (no ins/del semantics) — the recursion a box's (`noteAnchor`)
 *  own content needs, since a box is itself opaque (the whole box compares as one unit) but its
 *  CONTENTS are ordinary blocks/marks that deserve to be shown, not summarised as "Box". Covers
 *  the node vocabulary `lib/notesExtensions.js` actually allows inside one (per that module's
 *  own comment: text, or a picture) plus the handful of block types worth recursing into if a
 *  future change nests more under it — never throws on one it doesn't recognise. */
function PlainNode({ node, images }) {
  if (!node || typeof node !== "object") return null;
  const kids = (n) => (Array.isArray(n.content) ? n.content : []).map((k, i) => <PlainNode key={i} node={k} images={images} />);
  switch (node.type) {
    case "paragraph":
      return <p style={{ margin: "2px 0", fontSize: 12, lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "var(--text-primary)" }}><PlainRuns content={node.content} /></p>;
    case "heading": {
      const level = node.attrs?.level || 1;
      const Tag = `h${Math.min(4, Math.max(1, level))}`;
      return <Tag style={{ margin: "3px 0", fontSize: HEADING_SIZE[level] || 13, fontWeight: 700, color: "var(--text-primary)" }}><PlainRuns content={node.content} /></Tag>;
    }
    case "codeBlock": {
      const text = (node.content || []).map((c) => c.text || "").join("");
      return <pre style={{ margin: "2px 0", fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 12, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{text}</pre>;
    }
    case "bulletList": return <ul style={{ margin: "2px 0", paddingLeft: 20 }}>{kids(node)}</ul>;
    case "orderedList": return <ol start={node.attrs?.start || 1} style={{ margin: "2px 0", paddingLeft: 20 }}>{kids(node)}</ol>;
    case "listItem": return <li style={{ fontSize: 12, lineHeight: 1.5 }}>{kids(node)}</li>;
    case "taskList": return <ul style={{ margin: "2px 0", paddingLeft: 20, listStyle: "none" }}>{kids(node)}</ul>;
    case "taskItem":
      return (
        <li style={{ fontSize: 12, lineHeight: 1.5 }}>
          <label style={{ display: "inline-flex", gap: 6, alignItems: "baseline" }}>
            <input type="checkbox" checked={!!node.attrs?.checked} readOnly disabled />
            <span>{kids(node)}</span>
          </label>
        </li>
      );
    case "blockquote":
      return <blockquote style={{ margin: "3px 0", paddingLeft: 10, borderLeft: "3px solid var(--border-default)", color: "var(--text-secondary)" }}>{kids(node)}</blockquote>;
    case "horizontalRule":
      return <hr style={{ border: "none", borderTop: "1px solid var(--border-default)", margin: "6px 0" }} />;
    case "noteImage": return <ImageThumb node={node} images={images} />;
    case "table": return <TableContent node={node} />;
    case "noteSketch": return <SketchContent node={node} />;
    case "noteAttachment":
      return <span style={{ fontSize: 12, fontStyle: "italic", color: "var(--text-secondary)" }}>📎 {node.attrs?.name || "Attachment"}</span>;
    default:
      return Array.isArray(node.content) ? kids(node) : null;
  }
}

/** What renders BELOW an opaque block's label — the real content NEW-1 asks for. `hr`
 *  (a divider has nothing beyond being a divider) and `attachment` (its one fact, the
 *  filename, is already in the label above) deliberately return nothing extra; every other
 *  opaque kind shows what it actually holds. */
function OpaqueContent({ tag, node, images }) {
  switch (tag) {
    case "table": return <TableContent node={node} />;
    case "image": return <ImageThumb node={node} images={images} />;
    case "box": return <div>{(node?.content || []).map((k, i) => <PlainNode key={i} node={k} images={images} />)}</div>;
    case "sketch": return <SketchContent node={node} />;
    default: return null;
  }
}

/** A whole leaf block — a paragraph, heading, or code line — with its own tag and, for a
 *  wholly inserted/deleted block, a left border bar as a THIRD, non-colour signal (alongside
 *  the underline/strikethrough on its own text and the `ChangeTag` word). */
function Leaf({ block, images }) {
  if (block.opaque) {
    const tint = block.status === "inserted" ? "var(--success-bg)" : block.status === "deleted" ? "var(--danger-bg)" : "var(--surface-page)";
    const edge = block.status === "inserted" ? "var(--success-text)" : block.status === "deleted" ? "var(--danger-text)" : "var(--border-default)";
    const content = block.node ? <OpaqueContent tag={block.tag} node={block.node} images={images} /> : null;
    return (
      <div style={{
        margin: "4px 0", padding: "4px 8px", fontSize: 12, color: "var(--text-secondary)",
        background: tint, borderLeft: `3px solid ${edge}`, borderRadius: RADIUS.control,
      }}
      >
        <div style={{ fontStyle: "italic" }}><ChangeTag status={block.status} />{block.label}</div>
        {content}
      </div>
    );
  }

  const spans = (block.spans || []).map((s, i) => <Span key={i} kind={s.kind} text={s.text} marks={s.marks} />);
  const tint = block.status === "inserted" ? "var(--success-bg)" : block.status === "deleted" ? "var(--danger-bg)" : "transparent";
  const edge = block.status === "inserted" ? "var(--success-text)" : block.status === "deleted" ? "var(--danger-text)" : "transparent";
  const wrapStyle = {
    margin: "3px 0", padding: block.status === "same" && block.tag !== "h" ? "0" : "2px 6px",
    background: tint, borderLeft: tint === "transparent" ? "none" : `3px solid ${edge}`,
    borderRadius: tint === "transparent" ? 0 : RADIUS.control,
  };
  const tag = <ChangeTag status={block.status} />;

  if (block.tag === "h") {
    const level = block.attrs?.level || 1;
    const Tag = `h${Math.min(4, Math.max(1, level))}`;
    return <Tag style={{ ...wrapStyle, margin: `6px 0 3px`, fontSize: HEADING_SIZE[level] || 13, fontWeight: 700, color: "var(--text-primary)" }}>{tag}{spans}</Tag>;
  }
  if (block.tag === "code") {
    return <pre style={{ ...wrapStyle, fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 12, whiteSpace: "pre-wrap", overflowWrap: "anywhere", background: tint === "transparent" ? "var(--surface-page)" : tint }}>{tag}{spans}</pre>;
  }
  return <p style={{ ...wrapStyle, fontSize: 12, lineHeight: 1.5, color: "var(--text-primary)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{tag}{spans}</p>;
}

/** A wrapper node (list, blockquote, callout, toggle) around its already-nested children. */
function Wrapper({ wrapper, childList, images }) {
  const kids = childList.map((c, i) => <Node key={i} node={c} images={images} />);
  switch (wrapper.type) {
    case "bulletList":
      return <ul style={{ margin: "3px 0", paddingLeft: 20 }}>{kids}</ul>;
    case "orderedList":
      return <ol start={wrapper.start || 1} style={{ margin: "3px 0", paddingLeft: 20 }}>{kids}</ol>;
    case "listItem":
    case "taskItem":
      return (
        <li style={{ fontSize: 12, lineHeight: 1.5 }}>
          {wrapper.type === "taskItem" ? (
            <label style={{ display: "inline-flex", gap: 6, alignItems: "baseline" }}>
              <input type="checkbox" checked={!!wrapper.checked} readOnly disabled />
              <span>{kids}</span>
            </label>
          ) : kids}
        </li>
      );
    case "taskList":
      return <ul style={{ margin: "3px 0", paddingLeft: 20, listStyle: "none" }}>{kids}</ul>;
    case "blockquote":
      return <blockquote style={{ margin: "4px 0", paddingLeft: 10, borderLeft: "3px solid var(--border-default)", color: "var(--text-secondary)" }}>{kids}</blockquote>;
    case "callout":
      return (
        <div style={{
          margin: "4px 0", padding: "6px 10px", borderLeft: `3px solid ${CALLOUT_BORDER[wrapper.tone] || "var(--accent-notes)"}`,
          background: CALLOUT_BG[wrapper.tone] || "var(--surface-raised)", borderRadius: RADIUS.control,
        }}
        >{kids}</div>
      );
    case "toggle":
      return (
        <details open style={{ margin: "4px 0" }}>
          <summary style={{ fontSize: 12, fontWeight: 700, cursor: "default", color: "var(--text-primary)" }}>{wrapper.title || "Section"}</summary>
          <div style={{ paddingLeft: 10 }}>{kids}</div>
        </details>
      );
    default:
      return <div>{kids}</div>;
  }
}

/** MODULE-SCOPE, not a closure per render — recurses over `buildRedline`'s nested tree.
 *  `images` (an `imageId → data URL` map, or `null` while it's still loading) rides down to
 *  every `Leaf` so an opaque picture block can render its actual thumbnail — see this file's
 *  header and `ConflictReview.jsx`'s loading effect. */
function Node({ node, images }) {
  if (node.leaf) return <Leaf block={node.leaf} images={images} />;
  return <Wrapper wrapper={node.wrapper} childList={node.children} images={images} />;
}

export default function NoteRedline({ blocks, images = null }) {
  if (!blocks || !blocks.length) {
    return <em style={{ fontSize: 12, color: "var(--text-secondary)" }}>Both copies are empty.</em>;
  }
  return <div>{blocks.map((n, i) => <Node key={i} node={n} images={images} />)}</div>;
}
