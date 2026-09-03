/* ConflictReview — the full-screen conflict review NEW-3 asks for: room to actually read, one
 *  click away from the compact notice (`ConflictNotice.jsx`) rather than a banner that seizes
 *  the top third of the window. The owner, verbatim: *"it shouldn't just pop up with this
 *  massive banner, i should be able to click something that takes me to this but on full
 *  screen for review."*
 *
 *  Opens on the REDLINE (`NoteRedline.jsx`) by default — the owner's ask, "wouldn't a redline be
 *  better, so I can see the differences over each other" — with the original two-card
 *  side-by-side (`ConflictSideBySide.jsx`) one click away for the rare case a full rewrite
 *  reads easier as two independent columns.
 *
 *  ⛔ NOT A FLOATING NOTIFICATION. `docs/DESIGN.md`'s "Floating notifications" rule governs
 *  ambient, app-level toasts that overlay content uninvited; this is a full-screen surface the
 *  user explicitly opened by pressing a button, the same category as `QuickOpen.jsx`'s overlay
 *  — so it takes the whole viewport rather than sitting bottom-centered over other content.
 *
 *  Resolving (either "Keep the older/newer version" button) is reachable from here and ONLY
 *  from here — the compact notice carries no choices of its own, by design (see that file's
 *  header) — so this is where NEW-3's "resolution must still be reachable" promise is kept.
 *  Closing (Esc or the "Decide later" button) does NOT resolve anything; it just returns to the
 *  compact notice, unresolved, and the SAME comparison reopens next time — see B849106.
 *
 *  ⛔ B849104/B849105/B849107 — A SECOND FOLLOW-UP BRIEF, AFTER THE FIRST ONE'S OWN FIX MADE
 *  THINGS WORSE. B842624's original bar had two DIFFERENT verbs ("Keep this one" / "Use the
 *  other") for the identical action; the first fix (still visible in this file's git history)
 *  made both buttons read the IDENTICAL string "Keep this version" — and the owner came right
 *  back: *"the two buttons... doing opposite things... say the same thing."* Identical was
 *  exactly as unhelpful as asymmetric, just unhelpful in the other direction. The fix this time
 *  orients on a fact a reader can actually use — WHICH COPY IS NEWER (`lib/notesVersionOrder.js`)
 *  — matching the reference the owner named, Google Docs' version history: each version is
 *  identified by WHEN, and the action names what it does. See `docs/notes-conflict-critique.md`
 *  for the critique-loop screenshots this design passed before shipping.
 *
 *  ⛔ B1077680/NEW-1 — AN OPAQUE BLOCK (A TABLE, A BOX, A SKETCH, A PICTURE) NOW SHOWS ITS OWN
 *  CONTENT, NOT JUST ITS TYPE NAME — see `NoteRedline.jsx`'s header for the full argument. A
 *  picture's bytes live in IndexedDB, not in the document, so this file loads them
 *  ASYNCHRONOUSLY once the review is actually open (never on the compact notice's mount — a
 *  real conflict is rare and most notes have no pictures in them at all) and hands the
 *  resulting `imageId → data URL` map down to both the redline and the side-by-side view, which
 *  is why both accept the same `images` prop rather than each fetching their own copy.
 *
 *  ⛔ B1077681/NEW-2 — SIDE BY SIDE NO LONGER FLATTENS TO PLAIN TEXT. It used to diff
 *  `docToText(doc)` word-by-word, which cannot tell "a table" from "the same words typed as
 *  running text" — the owner's exact case (a contact-info table on one side, the same four
 *  lines as plain paragraphs on the other) rendered as two IDENTICAL-looking panes with no
 *  table anywhere. Both views now come from ONE shared computation, `buildComparison`
 *  (`lib/notesRedline.js`) — the unified redline's `blocks`, and `panes.newer`/`panes.older`,
 *  two fully-formatted trees (kept text + insertions / kept text + deletions) built from the
 *  SAME block alignment. `ConflictSideBySide.jsx` renders each pane through the same
 *  `NoteRedline` component the unified view uses, so real structure — a table, a picture, a
 *  list — survives in both views and the two panes can only look alike when the documents
 *  genuinely do.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { buildComparison } from "../lib/notesRedline.js";
import { orderConflictVersions } from "../lib/notesVersionOrder.js";
import { imageIdsInDoc } from "../lib/notesMarkdown.js";
import { readNoteImages } from "../lib/notesStore.js";
import NoteRedline, { ChangeTag } from "./NoteRedline.jsx";
import ConflictSideBySide from "./ConflictSideBySide.jsx";
import { stampLabel, absoluteStamp } from "../lib/notesTime.js";

const RADIUS = { control: 8, pill: 999 }; // mirrored from shared/ui/controls.jsx — see NoteToolbar

/** The visible HEADING name for one slot ("newer"/"older") — recency-based whenever it's known,
 *  and a plain, honest window fallback when it isn't (see `notesVersionOrder.js`'s header for
 *  why an unranked pair must never be LABELLED as ranked). Shared by the footer's two columns
 *  and the redline's own key so the two "speak the same language" (NEW-4). */
function roleLabel(comparable, isNewer, which) {
  if (comparable) return isNewer ? "Newer version" : "Older version";
  return which === "mine" ? "This window’s version" : "The other window’s version";
}

/** The MID-SENTENCE form of the same slot, for the legend's own prose ("is only in ⟨phrase⟩" /
 *  "keeping ⟨phrase⟩ loses it"). Deliberately NOT just `roleLabel(...).toLowerCase()` wrapped in
 *  an external "the": "this window's version" takes no article and "the other window's
 *  version" already carries its own, so a template that prepends "the" to both produces "the
 *  this window's version" / "the the other window's version" — caught in the critique loop's
 *  second pass, on the very fallback path this whole rule exists to keep honest. Each phrase
 *  here is total and self-contained; a caller never adds its own article. */
function rolePhrase(comparable, isNewer, which) {
  if (comparable) return isNewer ? "the newer version" : "the older version";
  return which === "mine" ? "this window’s version" : "the other window’s version";
}

/** One resolve choice, in the footer — the condensed sibling of `ConflictSideBySide`'s
 *  `VersionCard`: no text pane (the redline above already shows the content), just enough to
 *  identify and act on ONE specific copy. MODULE-SCOPE, not a closure per render. */
function ChoiceColumn({ roleText, when, whenExact, buttonLabel, buttonAriaLabel, onChoose, testId }) {
  return (
    <div style={{ minWidth: 0, flex: "1 1 220px", display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 700, fontSize: 12, color: "var(--text-primary)" }}>{roleText}</span>
        <span title={whenExact || undefined} style={{ fontSize: 10.5, fontWeight: 600, color: "var(--text-secondary)" }}>
          {when ? `edited ${when}` : "edit time unknown"}
        </span>
      </div>
      <button
        type="button"
        data-testid={testId}
        aria-label={buttonAriaLabel}
        onClick={onChoose}
        style={{
          alignSelf: "flex-start", border: "1px solid var(--warn-text)", borderRadius: RADIUS.pill,
          background: "transparent", color: "var(--warn-text)", font: "inherit",
          fontSize: 10.5, fontWeight: 700, padding: "4px 14px", cursor: "pointer",
        }}
      >{buttonLabel}</button>
    </div>
  );
}

export default function ConflictReview({
  title, localDoc, serverDoc, localUpdatedAt, serverUpdatedAt,
  onKeepMine, onKeepTheirs, onClose,
}) {
  const [view, setView] = useState("redline");
  const panelRef = useRef(null);
  const name = String(title || "").trim() || "Untitled";

  const order = useMemo(
    () => orderConflictVersions({ localDoc, serverDoc, localUpdatedAt, serverUpdatedAt }),
    [localDoc, serverDoc, localUpdatedAt, serverUpdatedAt],
  );
  // ⛔ THE REDLINE IS BUILT NEWER-FIRST, NEVER LOCAL-FIRST (B849105) — `buildComparison`'s first
  // argument is always its REVISED side, so passing `order.newer` there is what makes "added"
  // mean "added going from old to new" instead of "added in whichever tab you're reading from".
  // `comparison.panes.newer`/`.older` (B1077681) feed the side-by-side view below with the SAME
  // alignment, so the two views can never disagree about what changed.
  const comparison = useMemo(() => buildComparison(order.newer.doc, order.older.doc), [order]);

  // ⛔ B1077680 — a picture's bytes are not in the document (IndexedDB, behind `readNoteImages`);
  // loaded once per open comparison, never on the compact notice's mount. `images` stays `null`
  // (NoteRedline's "not loaded yet" state) until this resolves, then holds whatever came back —
  // a missing id is simply absent from the map, same contract `readNoteImages` already promises.
  const [images, setImages] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const ids = [...new Set([...imageIdsInDoc(order.newer.doc), ...imageIdsInDoc(order.older.doc)])];
    if (!ids.length) { setImages({}); return undefined; }
    setImages(null);
    readNoteImages(ids).then((map) => { if (!cancelled) setImages(map); });
    return () => { cancelled = true; };
  }, [order]);

  useEffect(() => {
    const opener = document.activeElement;
    panelRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && document.contains(opener)) {
        try { opener.focus(); } catch (_) { /* an element that went away needs no focus */ }
      }
    };
  }, []);

  const keys = (e) => { if (e.key === "Escape") { e.preventDefault(); onClose?.(); } };

  const newerWhen = stampLabel(order.newer.updatedAt);
  const olderWhen = stampLabel(order.older.updatedAt);
  const newerLabel = roleLabel(order.comparable, true, order.newer.which);
  const olderLabel = roleLabel(order.comparable, false, order.older.which);
  const newerPhrase = rolePhrase(order.comparable, true, order.newer.which);
  const olderPhrase = rolePhrase(order.comparable, false, order.older.which);
  const chooseFor = (w) => (w === "mine" ? onKeepMine : onKeepTheirs);
  /** A screen-reader loses the sighted reader's positional/labelling cues entirely, so its own
   *  label restates BOTH facts a sighted person gets for free — which window, and when. */
  const ariaFor = (slot, roleText, when) =>
    `${roleText} — edited ${when || "an unknown time"}, from ${slot.which === "mine" ? "this window" : "the other window"}`;

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={`Compare versions of “${name}”`}
      data-testid="notes-conflict-review"
      onKeyDown={keys}
      style={{
        position: "fixed", inset: 0, zIndex: 90, display: "flex", flexDirection: "column",
        background: "var(--surface-page)",
      }}
    >
      <div style={{
        flex: "0 0 auto", display: "flex", flexDirection: "column", gap: 2,
        padding: "10px 14px", borderBottom: "1px solid var(--border-default)",
      }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>Compare versions — {name}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ display: "flex", border: "1px solid var(--border-default)", borderRadius: RADIUS.pill, overflow: "hidden" }}>
              {[["redline", "Redline"], ["sidebyside", "Side by side"]].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  data-testid={`notes-conflict-view-${id}`}
                  onClick={() => setView(id)}
                  aria-pressed={view === id}
                  style={{
                    border: "none", cursor: "pointer", font: "inherit", fontSize: 10.5, fontWeight: 700,
                    padding: "5px 12px", color: view === id ? "var(--on-accent-notes)" : "var(--text-secondary)",
                    background: view === id ? "var(--accent-notes)" : "transparent",
                  }}
                >{label}</button>
              ))}
            </div>
            {/* NEW-3 — NOT A BARE "✕". A close icon alone reads as "cancel/discard" to a person
             * deciding whether it's safe to walk away without picking a version; this button
             * says in words that it is. It does exactly what Esc/the old ✕ did — nothing is
             * resolved, the compact notice's "Review changes →" button reopens this exact
             * comparison later — the change is only that it now SAYS so. */}
            <button
              type="button"
              data-testid="notes-conflict-review-close"
              aria-label="Decide later — closes this comparison without choosing; both versions stay safe and you can reopen it anytime from the notice"
              onClick={onClose}
              style={{
                border: "1px solid var(--border-default)", borderRadius: RADIUS.pill, background: "transparent",
                color: "var(--text-secondary)", font: "inherit", fontSize: 10.5, fontWeight: 700,
                padding: "5px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
              }}
            ><span aria-hidden="true">✕</span> Decide later</button>
          </div>
        </div>
        <span style={{ fontSize: 10.5, color: "var(--text-secondary)" }}>
          Both copies are safe either way — pick a version below, or close this and decide later.
        </span>
      </div>

      <div style={{ flex: "1 1 auto", overflowY: "auto", padding: "14px 16px" }}>
        {view === "redline" ? (
          <div style={{ maxWidth: 820, margin: "0 auto" }}>
            {/* NEW-4 — STICKY, so the key is still on screen once he's scrolled into a long
             * note (the exact spot he was looking at when he couldn't find one), and it now
             * covers BOTH encodings the renderer actually uses: inline underline/strikethrough
             * for a word-level edit, and the block-level "+ Added"/"− Removed" tag for a whole
             * item (table, picture, paragraph) that only exists on one side. Framed by WHICH
             * VERSION IS NEWER, matching the footer below, and stated as a CONSEQUENCE — which
             * button loses which text — rather than bare set membership. */}
            <div style={{
              position: "sticky", top: 0, zIndex: 1, background: "var(--surface-page)",
              paddingBottom: 8, marginBottom: 2,
            }}
            >
              <p style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-primary)", margin: "0 0 4px" }}>
                {order.comparable
                  ? <>{olderLabel} (edited {olderWhen}) → {newerLabel} (edited {newerWhen})</>
                  : <>{newerLabel} ↔ {olderLabel} — edit time unknown, so we can’t say which is newer</>}
              </p>
              <p style={{ fontSize: 10.5, color: "var(--text-secondary)", margin: 0 }}>
                <span style={{ color: "var(--success-text)", textDecoration: "underline" }}>Underlined</span> text
                {" "}or a <ChangeTag status="inserted" /> tag is only in <strong>{newerPhrase}</strong> —
                {" "}keeping {olderPhrase} loses it.{" "}
                <span style={{ color: "var(--danger-text)", textDecoration: "line-through" }}>Struck-through</span> text
                {" "}or a <ChangeTag status="deleted" /> tag is only in <strong>{olderPhrase}</strong> —
                {" "}keeping {newerPhrase} loses it.
              </p>
            </div>
            {/* A bordered "page" rather than text floating on the bare background — the
             * empty margin either side is a document-reading width, not unfinished chrome
             * (round 1 of the critique loop read this as sparse without the card). */}
            <div
              data-testid="notes-redline-body"
              style={{
                background: "var(--surface-raised)", border: "1px solid var(--border-default)",
                borderRadius: RADIUS.control, padding: "18px 24px",
              }}
            >
              <NoteRedline blocks={comparison.blocks} images={images} />
              {!comparison.changed ? (
                <p style={{ fontSize: 12, color: "var(--text-secondary)", fontStyle: "italic" }}>The two copies read the same — nothing found to mark.</p>
              ) : null}
            </div>
          </div>
        ) : (
          <ConflictSideBySide
            title={title} order={order} panes={comparison.panes} images={images}
            onKeepMine={onKeepMine} onKeepTheirs={onKeepTheirs}
          />
        )}
      </div>

      {/* ⛔ ONLY THE REDLINE NEEDS A FOOTER. The side-by-side view already carries both
       * resolve buttons — one per card, right next to that card's own text — so a second,
       * identical pair down here would be redundant (found in round 1 of the critique loop:
       * both surfaces on screen at once). Redline has no per-card buttons to reuse, so it
       * alone needs this. */}
      {view === "redline" ? (
        <div style={{
          flex: "0 0 auto", display: "flex", flexDirection: "column", gap: 8,
          padding: "10px 14px", borderTop: "1px solid var(--border-default)", background: "var(--warn-bg)",
        }}
        >
          {/* NEW-1 — THE REASSURANCE IS STATED ONCE, HERE, NOT REPEATED PER BUTTON. It used to
           * be a near-mirror sentence under EACH button, competing with the choice instead of
           * supporting it. */}
          <p style={{ fontSize: 10.5, color: "var(--text-secondary)", margin: 0 }}>
            Nothing is lost either way — the version you don’t keep is saved as a copy next to “{name}”.
          </p>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <ChoiceColumn
              roleText={newerLabel} when={newerWhen} whenExact={absoluteStamp(order.newer.updatedAt)}
              buttonLabel={order.comparable ? "Keep the newer version" : `Keep ${order.newer.which === "mine" ? "this window’s" : "the other window’s"} version`}
              buttonAriaLabel={ariaFor(order.newer, newerLabel, newerWhen)}
              onChoose={chooseFor(order.newer.which)} testId="notes-conflict-review-keep-newer"
            />
            <ChoiceColumn
              roleText={olderLabel} when={olderWhen} whenExact={absoluteStamp(order.older.updatedAt)}
              buttonLabel={order.comparable ? "Keep the older version" : `Keep ${order.older.which === "mine" ? "this window’s" : "the other window’s"} version`}
              buttonAriaLabel={ariaFor(order.older, olderLabel, olderWhen)}
              onChoose={chooseFor(order.older.which)} testId="notes-conflict-review-keep-older"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
