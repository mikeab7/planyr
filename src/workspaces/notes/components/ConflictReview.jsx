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
 *
 *  ⛔ B842944–B842948 (owner redlines, five in one screenshot, 2026-09-03) — A FOLLOW-UP LAYER, AFTER
 *  THE MECHANISM ABOVE ALREADY SHIPPED. Michael marked up his own live panel with five separate
 *  notes; none touched the redline direction, the key's existence, or decide-later — all of
 *  that stayed. What changed:
 *
 *  NEW-1 — "why are both copies safe? ... i dont care to keep an old copy that much" /
 *  "isnt that wasted space". Resolving a conflict no longer creates a sibling page at all — see
 *  `Notes.jsx`'s `handleConflict`, which now parks the discarded copy in THIS PAGE's own
 *  version history (`snapshotPage`) instead of `copyPageWithin`. The reassurance sentence below
 *  is rewritten to match (`notesConflictKeptLine`, `lib/notesStore.js`) and demoted from a
 *  warn-tinted banner to a quiet caption — it is no longer the loudest thing on the panel.
 *
 *  NEW-2 — "this header somehow splits the documents": the version bar + legend used to be
 *  `position: sticky` INSIDE the scrolling pane, which reserves its layout space only ONCE at
 *  its original flow position — once that gap scrolls past, the pinned copy paints ON TOP of
 *  whatever content has since scrolled up underneath it (exactly what happened to his
 *  "jerry@broadacrellc.com" / "M: (832) 309-0891" lines). Fixed structurally, not by tuning the
 *  sticky offset: the bar is now DOCKED — its own `flex: 0 0 auto` sibling ABOVE the scrolling
 *  pane, never inside it — so it reserves real flexbox space on every frame and content can
 *  never scroll underneath it. It is still visible throughout the scroll (better than sticky:
 *  no scroll-timing edge case to get wrong), it just isn't part of the scrolling flow.
 *
 *  NEW-3 — "the explanation is way too wordy to say somehting very simple". The prior legend
 *  stated the CONSEQUENCE of each encoding in a full sentence each ("keeping the older version
 *  loses it") — a previous brief explicitly asked for exactly that phrasing, and it produced
 *  two run-on sentences instead of the "absorb it at a glance" bar the owner wants. Rewritten
 *  as two short fragments naming what each mark MEANS, matching the header line's own
 *  older→newer order, with the direction-of-loss already implied by which slot the mark
 *  belongs to (visible in the version-bar line directly above it).
 *
 *  NEW-4 — "these buttons blend in too much" (both the mode toggle / Decide later cluster AND
 *  the two Keep buttons). Every hand-rolled `<button>` here now matches `shared/ui/controls.jsx`'s
 *  `Button`(primary/ghost)/`ToggleChip` primitives shape-for-shape (`PrimaryButton`/`GhostButton`/
 *  `ModeChip` below — MIRRORED rather than imported, see that block's own comment for why) per
 *  docs/DESIGN.md's hard rule ("a new control is never invented at the call site") — `ModeChip`
 *  for the Redline/Side by side mode switch, `GhostButton` for Decide later, and `PrimaryButton`
 *  (a real filled button, Notes' own `--accent-notes`) for the two Keep actions, which are the
 *  entire point of the panel and were previously the least visible things on it.
 *
 *  NEW-5 — "spacing is weird here". The footer used to spread the two choices to opposite ends
 *  of the full-width bar (`justify-content: space-between`) with each label floating above its
 *  own button as a separate element. `KeepButton` below merges the label and its timestamp INTO
 *  the one button (so there is never a question which time belongs to which action), and the
 *  two buttons sit centered, side by side, close together — the two things being compared read
 *  as a pair, the way Google Docs' own restore bar keeps a version's identity and its action in
 *  one control rather than two.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { buildComparison } from "../lib/notesRedline.js";
import { orderConflictVersions } from "../lib/notesVersionOrder.js";
import { imageIdsInDoc } from "../lib/notesMarkdown.js";
import { notesConflictKeptLine, readNoteImages } from "../lib/notesStore.js";
import NoteRedline, { ChangeTag } from "./NoteRedline.jsx";
import ConflictSideBySide from "./ConflictSideBySide.jsx";
import { stampLabel, absoluteStamp } from "../lib/notesTime.js";

const RADIUS = { control: 8, pill: 999 }; // mirrored from shared/ui/controls.jsx — see NoteToolbar
const PAD = { sm: "5px 10px", lg: "9px 14px" }; // mirrored from shared/ui/controls.jsx — see below
const FONT = { sm: 10.5 }; // mirrored from shared/ui/controls.jsx — see below
const REST_SHADOW = "0 1px 2px rgba(0,0,0,0.05)"; // design-exempt: neutral rest-shadow mirrored verbatim from shared/ui/controls.jsx's own REST_SHADOW — token-independent by design, see that file's Button comment
// The module's own accent, per docs/DESIGN.md's "active-control accent" rule — every filled
// primitive in this panel uses Notes' hue, not the app-wide default.
const NOTES_ACCENT = { accent: "var(--accent-notes)", onAccent: "var(--on-accent-notes)" };

/* ⛔ B842947/NEW-4 — `PrimaryButton`/`GhostButton`/`ModeChip` MIRROR `shared/ui/controls.jsx`'s
 * `Button`(variant primary/ghost)/`ToggleChip` rather than importing them — deliberately, the
 * same reasoning `NoteToolbar.jsx` already documents for `RADIUS`: importing `controls.jsx`
 * from Notes hoists a shared chunk onto other routes and risks the site-planner route's chunk
 * allowlist (`ui-audit/perf-bundle-audit.mjs`). A few duplicated style rules beat a cross-route bundle
 * regression. Keep these in step with `controls.jsx`'s own `Button`/`ToggleChip` if either
 * changes shape. */
function PrimaryButton({ size = "lg", accent = "var(--accent)", onAccent = "var(--on-accent)", style, children, ...rest }) {
  return (
    <button
      style={{
        padding: PAD[size] || PAD.lg, fontSize: 12, borderRadius: RADIUS.control, cursor: "pointer",
        fontFamily: "inherit", fontWeight: 600, boxShadow: REST_SHADOW,
        border: `1px solid ${accent}`, background: accent, color: onAccent, ...style,
      }}
      {...rest}
    >{children}</button>
  );
}

function GhostButton({ size = "sm", style, children, ...rest }) {
  return (
    <button
      style={{
        padding: PAD[size] || PAD.sm, fontSize: FONT.sm, borderRadius: RADIUS.control, cursor: "pointer",
        fontFamily: "inherit", fontWeight: 600, boxShadow: REST_SHADOW,
        border: "1px solid var(--border-default)", background: "var(--surface-raised)", color: "var(--text-primary)", ...style,
      }}
      {...rest}
    >{children}</button>
  );
}

function ModeChip({ active, accent = "var(--accent)", onAccent = "var(--on-accent)", style, children, ...rest }) {
  return (
    <button
      style={{
        padding: "6px 11px", fontSize: FONT.sm, borderRadius: RADIUS.pill, cursor: "pointer",
        fontFamily: "inherit", fontWeight: active ? 650 : 500,
        border: `1px solid ${active ? accent : "var(--border-default)"}`,
        background: active ? accent : "var(--surface-raised)",
        color: active ? onAccent : "var(--text-primary)",
        boxShadow: REST_SHADOW, ...style,
      }}
      {...rest}
    >{children}</button>
  );
}

/** The visible HEADING name for one slot ("newer"/"older") — recency-based whenever it's known,
 *  and a plain, honest window fallback when it isn't (see `notesVersionOrder.js`'s header for
 *  why an unranked pair must never be LABELLED as ranked). Shared by the version bar and the
 *  redline's own key so the two "speak the same language" (NEW-4). */
function roleLabel(comparable, isNewer, which) {
  if (comparable) return isNewer ? "Newer version" : "Older version";
  return which === "mine" ? "This window’s version" : "The other window’s version";
}

/** The MID-SENTENCE form of the same slot, for the legend's own fragments ("= ⟨phrase⟩ only").
 *  Deliberately NOT just `roleLabel(...).toLowerCase()` wrapped in an external "the": "this
 *  window's version" takes no article and "the other window's version" already carries its
 *  own, so a template that prepends "the" to both produces a double article — caught in the
 *  critique loop's second pass, on the very fallback path this whole rule exists to keep
 *  honest. Each phrase here is total and self-contained; a caller never adds its own article. */
function rolePhrase(comparable, isNewer, which) {
  if (comparable) return isNewer ? "the newer version" : "the older version";
  return which === "mine" ? "this window’s version" : "the other window’s version";
}

/** ONE primary resolve action — the label AND its timestamp are the SAME control (NEW-4/NEW-5),
 *  so there is never a question which time belongs to which button; the old layout floated a
 *  label above an outlined pill with the timestamp off to the side of that. MODULE-SCOPE, not a
 *  closure per render (MODULE-SCOPE-COMPONENTS). */
function KeepButton({ buttonLabel, when, whenExact, buttonAriaLabel, onChoose, testId }) {
  return (
    <PrimaryButton
      type="button"
      size="lg"
      {...NOTES_ACCENT}
      data-testid={testId}
      aria-label={buttonAriaLabel}
      onClick={onChoose}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, minWidth: 172 }}
    >
      <span style={{ fontSize: 12, fontWeight: 700 }}>{buttonLabel}</span>
      <span title={whenExact || undefined} style={{ fontSize: 10.5, fontWeight: 500, opacity: 0.85 }}>
        {when ? `edited ${when}` : "edit time unknown"}
      </span>
    </PrimaryButton>
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
  const newerButtonLabel = order.comparable ? "Keep the newer version" : `Keep ${order.newer.which === "mine" ? "this window’s" : "the other window’s"} version`;
  const olderButtonLabel = order.comparable ? "Keep the older version" : `Keep ${order.older.which === "mine" ? "this window’s" : "the other window’s"} version`;

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
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* NEW-4 — a ModeChip pair reads as a real control (filled active state), not
             * flat text with a hairline border. */}
            <div style={{ display: "flex", gap: 4 }}>
              {[["redline", "Redline"], ["sidebyside", "Side by side"]].map(([id, label]) => (
                <ModeChip
                  key={id}
                  type="button"
                  data-testid={`notes-conflict-view-${id}`}
                  onClick={() => setView(id)}
                  aria-pressed={view === id}
                  active={view === id}
                  {...NOTES_ACCENT}
                >{label}</ModeChip>
              ))}
            </div>
            {/* NEW-3 (of the original B849107 brief) — NOT A BARE "✕". A close icon alone reads
             * as "cancel/discard" to a person deciding whether it's safe to walk away without
             * choosing; this button says in words that it is. It does exactly what Esc/the old
             * ✕ did — nothing is resolved, the compact notice's "Review changes →" button
             * reopens this exact comparison later — the change is only that it now SAYS so. */}
            <GhostButton
              type="button"
              size="sm"
              data-testid="notes-conflict-review-close"
              aria-label="Decide later — closes this comparison without choosing; both versions stay safe and you can reopen it anytime from the notice"
              onClick={onClose}
              style={{ display: "flex", alignItems: "center", gap: 5 }}
            ><span aria-hidden="true">✕</span> Decide later</GhostButton>
          </div>
        </div>
      </div>

      {/* NEW-2 — DOCKED, not sticky-inside-the-scroll-pane: its own flex sibling above the
       * scrolling body, so it reserves real layout space on every frame and content can never
       * scroll underneath it. Only the redline view needs it — side by side shows both full
       * copies with nothing to key. */}
      {view === "redline" ? (
        <div style={{
          flex: "0 0 auto", padding: "8px 16px", borderBottom: "1px solid var(--border-default)",
          background: "var(--surface-page)",
        }}
        >
          <div style={{ maxWidth: 820, margin: "0 auto", display: "flex", flexDirection: "column", gap: 4 }}>
            <p style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
              {order.comparable
                ? <>{olderLabel} (edited {olderWhen}) → {newerLabel} (edited {newerWhen})</>
                : <>{newerLabel} ↔ {olderLabel} — edit time unknown, so we can’t say which is newer</>}
            </p>
            {/* NEW-3 — TWO SHORT FRAGMENTS naming what each mark MEANS, matching the older→newer
             * order of the line above. The prior version spelled out the CONSEQUENCE of each in
             * a full sentence ("keeping the older version loses it") per an earlier brief's own
             * instruction — right in spirit, wrong in execution: it read as two run-on
             * sentences instead of something absorbed at a glance. */}
            <p style={{ fontSize: 10.5, color: "var(--text-secondary)", margin: 0 }}>
              <span style={{ color: "var(--danger-text)", textDecoration: "line-through" }}>Struck-through</span>
              {" "}or <ChangeTag status="deleted" /> = <strong>{olderPhrase}</strong> only.{" "}
              <span style={{ color: "var(--success-text)", textDecoration: "underline" }}>Underlined</span>
              {" "}or <ChangeTag status="inserted" /> = <strong>{newerPhrase}</strong> only.
            </p>
          </div>
        </div>
      ) : null}

      <div style={{ flex: "1 1 auto", overflowY: "auto", padding: "14px 16px" }}>
        {view === "redline" ? (
          <div style={{ maxWidth: 820, margin: "0 auto" }}>
            {/* A bordered "page" rather than text floating on the bare background — the
             * empty margin either side is a document-reading width, not unfinished chrome
             * (round 1 of the original critique loop read this as sparse without the card). */}
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
       * identical pair down here would be redundant (found in round 1 of the original critique
       * loop: both surfaces on screen at once). Redline has no per-card buttons to reuse, so it
       * alone needs this. */}
      {view === "redline" ? (
        <div style={{
          flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
          padding: "12px 14px 14px", borderTop: "1px solid var(--border-default)", background: "var(--surface-raised)",
        }}
        >
          {/* NEW-1 — stated once, quietly, above the buttons that are the actual point of the
           * panel, not the loudest thing on it (the old amber banner used to be). */}
          <p style={{ fontSize: 10.5, color: "var(--text-secondary)", margin: 0 }}>{notesConflictKeptLine()}</p>
          {/* NEW-5 — the two choices sit close together, centered, as a pair — not shoved to
           * opposite ends of the full-width bar. */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
            <KeepButton
              buttonLabel={olderButtonLabel} when={olderWhen} whenExact={absoluteStamp(order.older.updatedAt)}
              buttonAriaLabel={ariaFor(order.older, olderLabel, olderWhen)}
              onChoose={chooseFor(order.older.which)} testId="notes-conflict-review-keep-older"
            />
            <KeepButton
              buttonLabel={newerButtonLabel} when={newerWhen} whenExact={absoluteStamp(order.newer.updatedAt)}
              buttonAriaLabel={ariaFor(order.newer, newerLabel, newerWhen)}
              onChoose={chooseFor(order.newer.which)} testId="notes-conflict-review-keep-newer"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
