/* NoteRedline — renders `lib/notesRedline.js`'s output as ONE document with the changes marked
 *  in place (NEW-2 of the conflict-comparison follow-up). See that file's header for the whole
 *  argument; this file only draws what it computed.
 *
 *  ⛔ SHAPE, NOT JUST COLOUR (the brief's named anti-pattern: "colour as the only signal").
 *  An insertion is underlined (`<ins>`); a deletion is struck through (`<del>`) — the same
 *  distinction Word and Google Docs use, so it survives for a colour-blind reader or a printed
 *  screenshot. A whole inserted/deleted BLOCK additionally carries a left border bar, which is
 *  a second, position-based signal rather than a second colour-only one.
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

/** A whole leaf block — a paragraph, heading, or code line — with its own tag and, for a
 *  wholly inserted/deleted block, a left border bar as a SECOND, non-colour signal. */
function Leaf({ block }) {
  if (block.opaque) {
    const tint = block.status === "inserted" ? "var(--success-bg)" : block.status === "deleted" ? "var(--danger-bg)" : "var(--surface-page)";
    const edge = block.status === "inserted" ? "var(--success-text)" : block.status === "deleted" ? "var(--danger-text)" : "var(--border-default)";
    return (
      <div style={{
        margin: "4px 0", padding: "4px 8px", fontSize: 12, fontStyle: "italic", color: "var(--text-secondary)",
        background: tint, borderLeft: `3px solid ${edge}`, borderRadius: RADIUS.control,
      }}
      >{block.label}{block.status === "inserted" ? " — added" : block.status === "deleted" ? " — removed" : ""}</div>
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

  if (block.tag === "h") {
    const level = block.attrs?.level || 1;
    const Tag = `h${Math.min(4, Math.max(1, level))}`;
    return <Tag style={{ ...wrapStyle, margin: `6px 0 3px`, fontSize: HEADING_SIZE[level] || 13, fontWeight: 700, color: "var(--text-primary)" }}>{spans}</Tag>;
  }
  if (block.tag === "code") {
    return <pre style={{ ...wrapStyle, fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 12, whiteSpace: "pre-wrap", overflowWrap: "anywhere", background: tint === "transparent" ? "var(--surface-page)" : tint }}>{spans}</pre>;
  }
  return <p style={{ ...wrapStyle, fontSize: 12, lineHeight: 1.5, color: "var(--text-primary)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{spans}</p>;
}

/** A wrapper node (list, blockquote, callout, toggle) around its already-nested children. */
function Wrapper({ wrapper, childList }) {
  const kids = childList.map((c, i) => <Node key={i} node={c} />);
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

/** MODULE-SCOPE, not a closure per render — recurses over `buildRedline`'s nested tree. */
function Node({ node }) {
  if (node.leaf) return <Leaf block={node.leaf} />;
  return <Wrapper wrapper={node.wrapper} childList={node.children} />;
}

export default function NoteRedline({ blocks }) {
  if (!blocks || !blocks.length) {
    return <em style={{ fontSize: 12, color: "var(--text-secondary)" }}>Both copies are empty.</em>;
  }
  return <div>{blocks.map((n, i) => <Node key={i} node={n} />)}</div>;
}
