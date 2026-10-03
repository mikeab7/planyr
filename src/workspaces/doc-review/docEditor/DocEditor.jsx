/* Review's DOCUMENT editor (.docx / .doc / .txt) — shown in place of the drawing canvas.
 * Lazy chunk: drawing review never pays for it. See ./CLAUDE.md-style header in docEditor/docKind.js.
 *
 * Word files: type/format/tables/lists, Track Changes, comments — round-tripped to a real .docx
 * (shared/files/docx). .txt: plain-text editing, byte-faithful. No measure/calibrate/takeoff here, and
 * NOTHING in this file downloads: saving hands bytes to `onSave`, which writes to the Library. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { Fragment, Slice } from "@tiptap/pm/model";
import { Button, ToggleChip } from "../../../shared/ui/controls.jsx";
import { docExtensions } from "./docExtensions.js";
import { DOC_EDITOR_CSS } from "./docEditorCss.js";
import { BYPASS, fixupTracked, listChanges, acceptChange, rejectChange, acceptAll, rejectAll, commentRanges, removeCommentMarks } from "./trackChanges.js";
import { HIGHLIGHT } from "../../../shared/files/docx/ooxml.js";
import { loadModel, buildSave } from "./docModel.js";

const FONTS = ["Calibri", "Arial", "Times New Roman", "Cambria", "Georgia", "Verdana", "Courier New"];
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36];
const HEX6 = /^#[0-9a-fA-F]{6}$/; // design-exempt: colour-string validation pattern, not a colour
const when = (d) => { try { return d ? new Date(d).toLocaleString() : ""; } catch { return ""; } };
const initialsOf = (n) => String(n || "").split(/\s+/).map((w) => w[0] || "").join("").slice(0, 3).toUpperCase();
const newCommentId = () => `c-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export default function DocEditor({ file, author = "Reviewer", notice = "", onSave, onDirty, saveRef }) {
  const [model, setModel] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true; setModel(null); setErr("");
    loadModel(file).then((m) => { if (live) setModel(m); }).catch((e) => { if (live) setErr(e && e.message ? e.message : "This file couldn’t be opened."); });
    return () => { live = false; };
  }, [file]);
  if (err) return (<div className="dre-root"><style>{DOC_EDITOR_CSS}</style><div className="dre-note err" data-testid="doc-editor-error" role="alert">“{file.name}” couldn’t be opened here. {err}</div></div>);
  if (!model) return (<div className="dre-root"><style>{DOC_EDITOR_CSS}</style><div className="dre-note" data-testid="doc-editor-loading">Opening “{file.name}”…</div></div>);
  return <Surface key={file.key || file.name} file={file} model={model} author={author} notice={notice} onSave={onSave} onDirty={onDirty} saveRef={saveRef} />;
}

/* ---------- the editor surface ---------- */
function Surface({ file, model, author, notice, onSave, onDirty, saveRef }) {
  const plain = model.mode === "plain";
  const [comments, setComments] = useState(model.comments || []);
  const [trackOn, setTrackOn] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [paneOpen, setPaneOpen] = useState(!plain && ((model.comments || []).length > 0));
  const [status, setStatus] = useState(notice ? { kind: "saved", msg: notice } : { kind: "idle", msg: "" });
  const [dirty, setDirty] = useState(false);
  const [, force] = useState(0);
  const [pending, setPending] = useState(null); // {from,to,quote} — a comment being composed
  const trackRef = useRef(false); trackRef.current = trackOn;
  const authorRef = useRef(author); authorRef.current = author;
  const filesRef = useRef(model.files);

  const extensions = useMemo(() => docExtensions({ plain }), [plain]);
  const editor = useEditor({
    extensions,
    content: model.doc,
    immediatelyRender: false,
    editorProps: {
      attributes: { class: plain ? "dre-page plain" : "dre-page", "data-testid": "doc-editor-page", spellcheck: "true", "aria-label": `Editing ${file.name}` },
      ...(plain ? {
        handleKeyDown: (view, e) => { if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.metaKey) { view.dispatch(view.state.tr.insertText("\t")); return true; } return false; },
        clipboardTextParser: (text, $ctx, _plain, view) => {
          const { schema } = view.state;
          const lines = String(text).split(/\r\n|\n|\r/);
          return new Slice(Fragment.from(lines.map((l) => schema.nodes.paragraph.create(null, l ? schema.text(l) : null))), 1, 1);
        },
      } : {}),
    },
    onUpdate: () => { setDirty(true); },
    onTransaction: () => force((n) => n + 1),
  });

  // Track Changes: let a user edit through, then re-insert what it deleted (struck through) and mark what it added.
  useEffect(() => {
    if (!editor || plain) return undefined;
    const view = editor.view;
    const orig = view.props.dispatchTransaction;
    view.setProps({
      dispatchTransaction(tr) {
        if (trackRef.current && tr.docChanged && !tr.getMeta(BYPASS) && !tr.getMeta("history$")) fixupTracked(tr, view.state, { author: authorRef.current });
        orig.call(this, tr);
      },
    });
    return () => { try { view.setProps({ dispatchTransaction: orig }); } catch (_) { /* editor already destroyed */ } };
  }, [editor, plain]);

  useEffect(() => { onDirty && onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => {
    if (!dirty) return undefined;
    const h = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  // Resolves true only when the bytes reached the Library (the host's Close-with-unsaved-edits prompt waits on it).
  const doSave = useCallback(async (asNew) => {
    if (!editor || !onSave) return false;
    setStatus({ kind: "saving", msg: "Saving to the Library…" });
    try {
      const built = buildSave({ model, file, json: editor.getJSON(), comments, author, asNew, files: filesRef.current });
      const { name, mode, note } = built;
      const blob = new Blob([built.bytes], { type: built.mime });
      const res = await onSave({ blob, name, mode });
      if (!res || !res.ok) { setStatus({ kind: "error", msg: (res && res.error) || "Couldn’t save. Your edits are still here — try again." }); return false; }
      if (mode === "replace") setDirty(false);
      setStatus({ kind: "saved", msg: res.message || (res.local ? (note || "Saved on this device only — sign in to put it in the Library.") : [note, res.where || "Saved to the Library."].filter(Boolean).join(" ")) });
      return true;
    } catch (e) {
      setStatus({ kind: "error", msg: `Couldn’t save: ${e && e.message ? e.message : "unknown error"}. Your edits are still here.` });
      return false;
    }
  }, [editor, onSave, file, model, comments, author]);
  useEffect(() => {
    if (!saveRef) return undefined;
    saveRef.current = () => doSave(false);
    return () => { saveRef.current = null; };
  }, [saveRef, doSave]);

  if (!editor) return <div className="dre-root"><style>{DOC_EDITOR_CSS}</style></div>;
  const changes = plain ? [] : listChanges(editor.state.doc);
  const saveLabel = model.converted ? "Save as .docx" : "Save";

  return (
    <div className="dre-root" data-testid="doc-editor" data-kind={file.kind} data-dirty={dirty ? "1" : "0"}
      onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); doSave(false); } }}>
      <style>{DOC_EDITOR_CSS}</style>
      <Toolbar editor={editor} plain={plain} trackOn={trackOn} setTrackOn={setTrackOn} findOpen={findOpen} setFindOpen={setFindOpen}
        paneOpen={paneOpen} setPaneOpen={setPaneOpen} changeCount={changes.length} commentCount={comments.length}
        saveLabel={saveLabel} saving={status.kind === "saving"} onSave={() => doSave(false)} onSaveAsWord={plain ? () => doSave(true) : null}
        onStartComment={() => {
          const { from, to, empty } = editor.state.selection;
          if (empty) { setStatus({ kind: "error", msg: "Select some text first, then add the comment." }); return; }
          setPending({ from, to, quote: editor.state.doc.textBetween(from, to, " ").slice(0, 120) }); setPaneOpen(true);
        }} />
      {model.converted && <div className="dre-note" data-testid="doc-converted-note">Word 97–2003 file — its text opens here (old-format formatting and tables aren’t carried over). Saving creates a new .docx next to it; the original .doc is kept.</div>}
      {(model.meta && model.meta.warnings || []).map((w, i) => <div key={i} className="dre-note warn" data-testid="doc-import-warning">⚠ {w}</div>)}
      {plain && model.txt.encoding === "windows-1252" && <div className="dre-note">This text file uses an older Windows encoding; it will be saved as UTF-8.</div>}
      {status.kind !== "idle" && <div className={`dre-note${status.kind === "error" ? " err" : ""}`} role={status.kind === "error" ? "alert" : "status"} data-testid="doc-save-status">{status.msg}</div>}
      {findOpen && <FindBar editor={editor} onClose={() => setFindOpen(false)} />}
      <div className="dre-body">
        <div className="dre-scroll"><EditorContent editor={editor} /></div>
        {!plain && paneOpen && (
          <ReviewPane editor={editor} changes={changes} comments={comments} setComments={setComments} author={author}
            pending={pending} setPending={setPending} onTouch={() => setDirty(true)} />
        )}
      </div>
    </div>
  );
}

/* ---------- toolbar ---------- */
function Toolbar({ editor, plain, trackOn, setTrackOn, findOpen, setFindOpen, paneOpen, setPaneOpen, changeCount, commentCount, saveLabel, saving, onSave, onSaveAsWord, onStartComment }) {
  const run = (fn) => () => { fn(editor.chain().focus()).run(); };
  const ts = editor.getAttributes("textStyle") || {};
  const styleValue = plain ? "" : editor.isActive("heading", { level: 1 }) ? "h1" : editor.isActive("heading", { level: 2 }) ? "h2" : editor.isActive("heading", { level: 3 }) ? "h3" : editor.getAttributes("paragraph").pStyle === "Title" ? "title" : "body";
  const setStyle = (v) => {
    const c = editor.chain().focus();
    if (v === "body") c.setParagraph().updateAttributes("paragraph", { pStyle: null }).run();
    else if (v === "title") c.setParagraph().updateAttributes("paragraph", { pStyle: "Title" }).run();
    else c.setHeading({ level: Number(v.slice(1)) }).updateAttributes("heading", { pStyle: null }).run();
  };
  const sizePt = ts["fontSize"] ? String(parseFloat(ts["fontSize"])) : "";
  return (
    <div className="dre-bar" role="toolbar" aria-label="Document tools" data-testid="doc-toolbar">
      <div className="dre-group">
        <Btn title="Undo" onClick={run((c) => c.undo())} disabled={!editor.can().undo()}>↶</Btn>
        <Btn title="Redo" onClick={run((c) => c.redo())} disabled={!editor.can().redo()}>↷</Btn>
        <Btn title="Find and replace" active={findOpen} onClick={() => setFindOpen(!findOpen)}>Find</Btn>
      </div>
      {!plain && (<>
        <span className="dre-sep" />
        <div className="dre-group">
          <select className="dre-select" aria-label="Paragraph style" value={styleValue} onChange={(e) => setStyle(e.target.value)}>
            <option value="body">Body</option><option value="title">Title</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option>
          </select>
          <select className="dre-select" aria-label="Font" value={ts.fontFamily || ""} onChange={(e) => (e.target.value ? editor.chain().focus().setFontFamily(e.target.value).run() : editor.chain().focus().unsetFontFamily().run())}>
            <option value="">Font</option>{FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <select className="dre-select" aria-label="Font size" value={sizePt} onChange={(e) => (e.target.value ? editor.chain().focus().setFontSize(`${e.target.value}pt`).run() : editor.chain().focus().unsetFontSize().run())}>
            <option value="">Size</option>{SIZES.map((s) => <option key={s} value={String(s)}>{s}</option>)}
          </select>
        </div>
        <span className="dre-sep" />
        <div className="dre-group">
          <Btn title="Bold" active={editor.isActive("bold")} onClick={run((c) => c.toggleBold())}><b>B</b></Btn>
          <Btn title="Italic" active={editor.isActive("italic")} onClick={run((c) => c.toggleItalic())}><i>I</i></Btn>
          <Btn title="Underline" active={editor.isActive("underline")} onClick={run((c) => c.toggleUnderline())}><u>U</u></Btn>
          <Btn title="Strikethrough" active={editor.isActive("strike")} onClick={run((c) => c.toggleStrike())}><s>S</s></Btn>
          <input className="dre-color" type="color" aria-label="Text color" title="Text color" value={HEX6.test(ts.color || "") ? ts.color : HIGHLIGHT.black} onChange={(e) => editor.chain().focus().setColor(e.target.value).run()} />
          <input className="dre-color" type="color" aria-label="Highlight color" title="Highlight" defaultValue={HIGHLIGHT.yellow} onChange={(e) => editor.chain().focus().setHighlight({ color: e.target.value }).run()} />
          <Btn title="Remove highlight" onClick={run((c) => c.unsetHighlight())}>⌫</Btn>
        </div>
        <span className="dre-sep" />
        <div className="dre-group">
          {["left", "center", "right", "justify"].map((a) => <Btn key={a} title={`Align ${a}`} active={editor.isActive({ textAlign: a })} onClick={run((c) => c.setTextAlign(a))}>{{ left: "⬅", center: "↔", right: "➡", justify: "☰" }[a]}</Btn>)}
          <Btn title="Bulleted list" active={editor.isActive("bulletList")} onClick={run((c) => c.toggleBulletList())}>•</Btn>
          <Btn title="Numbered list" active={editor.isActive("orderedList")} onClick={run((c) => c.toggleOrderedList())}>1.</Btn>
          <Btn title="Indent" onClick={run((c) => c.sinkListItem("listItem"))} disabled={!editor.can().sinkListItem("listItem")}>⇥</Btn>
          <Btn title="Outdent" onClick={run((c) => c.liftListItem("listItem"))} disabled={!editor.can().liftListItem("listItem")}>⇤</Btn>
        </div>
        <span className="dre-sep" />
        <div className="dre-group">
          <Btn title="Insert table" onClick={run((c) => c.insertTable({ rows: 2, cols: 2, withHeaderRow: false }))}>Table</Btn>
          {editor.isActive("table") && (<>
            <Btn title="Add row below" onClick={run((c) => c.addRowAfter())}>+Row</Btn>
            <Btn title="Add column right" onClick={run((c) => c.addColumnAfter())}>+Col</Btn>
            <Btn title="Delete row" onClick={run((c) => c.deleteRow())}>−Row</Btn>
            <Btn title="Delete column" onClick={run((c) => c.deleteColumn())}>−Col</Btn>
            <Btn title="Delete table" onClick={run((c) => c.deleteTable())}>✕Tbl</Btn>
          </>)}
        </div>
        <span className="dre-sep" />
        <div className="dre-group">
          <ToggleChip active={trackOn} onClick={() => setTrackOn(!trackOn)} aria-pressed={trackOn} data-testid="track-toggle" title="Record edits as tracked changes">Track changes {trackOn ? "on" : "off"}</ToggleChip>
          <Btn title="Add a comment on the selected text" onClick={onStartComment} testid="add-comment">Comment</Btn>
          <Btn title="Show changes and comments" active={paneOpen} onClick={() => setPaneOpen(!paneOpen)} testid="toggle-pane">Review{changeCount + commentCount ? ` (${changeCount + commentCount})` : ""}</Btn>
        </div>
      </>)}
      <span style={{ flex: 1 }} />
      <div className="dre-group">
        {onSaveAsWord && <Btn title="Save a copy as a Word document (formatting, comments)" onClick={onSaveAsWord} testid="save-as-word">Save as Word document</Btn>}
        <Button size="sm" variant="primary" disabled={saving} onClick={onSave} data-testid="doc-save">{saving ? "Saving…" : saveLabel}</Button>
      </div>
    </div>
  );
}
function Btn({ title, active, onClick, disabled, children, testid }) {
  return <Button size="sm" variant="ghost" active={!!active} disabled={disabled} title={title} aria-label={title} aria-pressed={active == null ? undefined : !!active} onClick={onClick} data-testid={testid} style={{ minWidth: 28 }}>{children}</Button>;
}

/* ---------- find / replace ---------- */
export function findMatches(doc, q, caseSensitive) {
  if (!q) return [];
  const needle = caseSensitive ? q : q.toLowerCase();
  const out = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = ""; const map = []; // text index → doc position
    node.forEach((child, off) => {
      const base = pos + 1 + off;
      if (child.isText) for (let i = 0; i < child.text.length; i++) { map.push(base + i); text += child.text[i]; }
      else { map.push(base); text += "\n"; }
    });
    const hay = caseSensitive ? text : text.toLowerCase();
    let i = 0;
    while ((i = hay.indexOf(needle, i)) >= 0) { out.push({ from: map[i], to: map[i + needle.length - 1] + 1 }); i += Math.max(1, needle.length); }
    return false;
  });
  return out;
}
function FindBar({ editor, onClose }) {
  const [q, setQ] = useState(""); const [rep, setRep] = useState(""); const [cs, setCs] = useState(false); const [idx, setIdx] = useState(0);
  const matches = findMatches(editor.state.doc, q, cs);
  const go = (i) => {
    if (!matches.length) return;
    const k = (i + matches.length) % matches.length; setIdx(k);
    const m = matches[k]; editor.chain().focus().setTextSelection({ from: m.from, to: m.to }).scrollIntoView().run();
  };
  const replaceOne = () => {
    if (!matches.length) return;
    const m = matches[Math.min(idx, matches.length - 1)];
    const tr = editor.state.tr.insertText(rep, m.from, m.to); editor.view.dispatch(tr);
  };
  const replaceAll = () => {
    if (!matches.length) return;
    const tr = editor.state.tr;
    for (const m of matches.slice().reverse()) tr.insertText(rep, m.from, m.to);
    editor.view.dispatch(tr);
  };
  return (
    <div className="dre-find" role="search" data-testid="doc-find">
      <input aria-label="Find" placeholder="Find" value={q} onChange={(e) => { setQ(e.target.value); setIdx(0); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); go(e.shiftKey ? idx - 1 : idx + (q ? 0 : 0)); } if (e.key === "Escape") onClose(); }} data-testid="find-input" />
      <input aria-label="Replace with" placeholder="Replace with" value={rep} onChange={(e) => setRep(e.target.value)} data-testid="replace-input" />
      <span className="dre-meta" aria-live="polite">{q ? `${matches.length ? Math.min(idx, matches.length - 1) + 1 : 0} of ${matches.length}` : ""}</span>
      <Btn title="Previous match" onClick={() => go(idx - 1)} disabled={!matches.length}>↑</Btn>
      <Btn title="Next match" onClick={() => go(idx + 1)} disabled={!matches.length} testid="find-next">↓</Btn>
      <ToggleChip active={cs} onClick={() => setCs(!cs)} title="Match case">Aa</ToggleChip>
      <Btn title="Replace this match" onClick={replaceOne} disabled={!matches.length} testid="replace-one">Replace</Btn>
      <Btn title="Replace every match" onClick={replaceAll} disabled={!matches.length} testid="replace-all">Replace all</Btn>
      <Btn title="Close find" onClick={onClose}>✕</Btn>
    </div>
  );
}

/* ---------- review pane: changes + comments ---------- */
function ReviewPane({ editor, changes, comments, setComments, author, pending, setPending, onTouch }) {
  const [draft, setDraft] = useState("");
  const [replyFor, setReplyFor] = useState(null); const [replyText, setReplyText] = useState("");
  const apply = (tr) => { editor.view.dispatch(tr); onTouch(); };
  const roots = comments.filter((c) => !c.parentId);
  const quoteOf = (id) => { const r = commentRanges(editor.state.doc, id)[0]; return r ? editor.state.doc.textBetween(r.from, r.to, " ").slice(0, 100) : ""; };
  const focusComment = (id) => { const r = commentRanges(editor.state.doc, id)[0]; if (r) editor.chain().focus().setTextSelection({ from: r.from, to: r.to }).scrollIntoView().run(); };
  const addComment = () => {
    const text = draft.trim(); if (!text || !pending) return;
    const id = newCommentId();
    editor.chain().setMeta(BYPASS, true).setTextSelection({ from: pending.from, to: pending.to }).setMark("comment", { id }).run();
    setComments([...comments, { id, author, initials: initialsOf(author), date: new Date().toISOString().replace(/\.\d+Z$/, "Z"), text, parentId: null, resolved: false }]);
    setDraft(""); setPending(null); onTouch();
  };
  const reply = (parentId) => {
    const text = replyText.trim(); if (!text) return;
    setComments([...comments, { id: newCommentId(), author, initials: initialsOf(author), date: new Date().toISOString().replace(/\.\d+Z$/, "Z"), text, parentId, resolved: false }]);
    setReplyFor(null); setReplyText(""); onTouch();
  };
  const remove = (id) => {
    const gone = new Set([id, ...comments.filter((c) => c.parentId === id).map((c) => c.id)]);
    apply(removeCommentMarks(editor.state, [...gone]));
    setComments(comments.filter((c) => !gone.has(c.id)));
  };
  const resolve = (id) => { setComments(comments.map((c) => (c.id === id ? { ...c, resolved: !c.resolved } : c))); onTouch(); };
  return (
    <aside className="dre-pane" data-testid="doc-review-pane" aria-label="Changes and comments">
      <div className="dre-card">
        <h4>Changes {changes.length ? `(${changes.length})` : ""}</h4>
        {!changes.length && <div className="dre-meta">No tracked changes. Turn on “Track changes” to record your edits.</div>}
        {changes.map((c) => (
          <div key={c.key} className="dre-card" data-testid="change-card" data-kind={c.kind} style={{ marginTop: 6 }}>
            <div><b className={c.kind === "ins" ? "dre-ins" : "dre-del"}>{c.kind === "ins" ? "Inserted" : "Deleted"}</b> “{c.text.slice(0, 80)}”</div>
            <div className="dre-meta">{c.author || "Unknown"}{c.date ? ` · ${when(c.date)}` : ""}</div>
            <div className="dre-row">
              <Button size="sm" variant="ghost" onClick={() => apply(acceptChange(editor.state, c.key))} data-testid="accept-change">Accept</Button>
              <Button size="sm" variant="ghost" onClick={() => apply(rejectChange(editor.state, c.key))} data-testid="reject-change">Reject</Button>
            </div>
          </div>
        ))}
        {changes.length > 1 && (
          <div className="dre-row">
            <Button size="sm" variant="ghost" onClick={() => apply(acceptAll(editor.state))} data-testid="accept-all">Accept all</Button>
            <Button size="sm" variant="ghost" onClick={() => apply(rejectAll(editor.state))} data-testid="reject-all">Reject all</Button>
          </div>
        )}
      </div>
      <div className="dre-card">
        <h4>Comments {roots.length ? `(${roots.length})` : ""}</h4>
        {pending && (
          <div className="dre-card" data-testid="comment-composer">
            <div className="dre-meta">On “{pending.quote}”</div>
            <textarea rows={3} aria-label="Comment" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} data-testid="comment-input" />
            <div className="dre-row">
              <Button size="sm" variant="primary" onClick={addComment} disabled={!draft.trim()} data-testid="comment-add">Add comment</Button>
              <Button size="sm" variant="ghost" onClick={() => { setPending(null); setDraft(""); }}>Cancel</Button>
            </div>
          </div>
        )}
        {!roots.length && !pending && <div className="dre-meta">Select text, then press Comment.</div>}
        {roots.map((c) => (
          <div key={c.id} className={`dre-card${c.resolved ? " resolved" : ""}`} data-testid="comment-card" style={{ marginTop: 6 }}>
            <div className="dre-meta" role="button" tabIndex={0} style={{ cursor: "pointer" }} onClick={() => focusComment(c.id)} onKeyDown={(e) => { if (e.key === "Enter") focusComment(c.id); }}>{quoteOf(c.id) ? `“${quoteOf(c.id)}”` : "(text removed)"}</div>
            <div><b>{c.author || "Unknown"}</b> <span className="dre-meta">{when(c.date)}{c.resolved ? " · resolved" : ""}</span></div>
            <div style={{ whiteSpace: "pre-wrap" }}>{c.text}</div>
            {comments.filter((r) => r.parentId === c.id).map((r) => (
              <div key={r.id} style={{ marginTop: 6, paddingLeft: 8, borderLeft: "2px solid var(--border-strong)" }} data-testid="comment-reply">
                <div><b>{r.author || "Unknown"}</b> <span className="dre-meta">{when(r.date)}</span></div>
                <div style={{ whiteSpace: "pre-wrap" }}>{r.text}</div>
              </div>
            ))}
            {replyFor === c.id ? (
              <div style={{ marginTop: 6 }}>
                <textarea rows={2} aria-label="Reply" autoFocus value={replyText} onChange={(e) => setReplyText(e.target.value)} data-testid="reply-input" />
                <div className="dre-row"><Button size="sm" variant="primary" onClick={() => reply(c.id)} disabled={!replyText.trim()} data-testid="reply-add">Reply</Button><Button size="sm" variant="ghost" onClick={() => { setReplyFor(null); setReplyText(""); }}>Cancel</Button></div>
              </div>
            ) : (
              <div className="dre-row">
                <Button size="sm" variant="ghost" onClick={() => setReplyFor(c.id)} data-testid="reply-open">Reply</Button>
                <Button size="sm" variant="ghost" onClick={() => resolve(c.id)} data-testid="resolve-comment">{c.resolved ? "Reopen" : "Resolve"}</Button>
                <Button size="sm" variant="danger" onClick={() => remove(c.id)} data-testid="delete-comment">Delete</Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}
