/* ConflictSideBySide — the two-card, side-by-side comparison (B842624's original shape),
 *  now the SECONDARY view inside `ConflictReview.jsx` — the redline (`NoteRedline.jsx`) is what
 *  the review opens on by default, per the owner's own ask: *"wouldn't a redline be better, so
 *  I can see the differences over each other."* Side by side stays reachable (a toggle in the
 *  review's header) because two full, independently-scrollable copies are still occasionally
 *  the easier read for a genuinely large rewrite — but it is no longer the resting view.
 *
 *  ⛔ B849104 — CARDS AND BUTTONS ARE ORDERED AND LABELLED BY RECENCY, MATCHING
 *  `ConflictReview.jsx`'s footer (`lib/notesVersionOrder.js`), NOT by "This window"/"the other
 *  window" and never two identical "Keep this version" buttons — see that file's header for the
 *  full argument (both the original asymmetric verbs AND the first fix's identical ones read as
 *  unclear to the owner). Each button's `aria-label` still separately names the window, for a
 *  screen-reader user who loses the positional cue a sighted reader gets for free.
 *
 *  ⛔ B1077681/NEW-2 — EACH CARD NOW RENDERS ITS PANE'S REAL FORMATTED CONTENT, NOT A PLAIN-TEXT
 *  WORD-HIGHLIGHT DIFF. The old body diffed `docToText(doc)` — a flatten that cannot tell "a
 *  table" from "the same words typed as running text" — so a table on one side and the
 *  equivalent plain paragraphs on the other rendered as two IDENTICAL-looking panes with no
 *  table anywhere (the owner's own screenshot: "here's the side by side but where is the
 *  table"). `panes.newer`/`panes.older` (`lib/notesRedline.js`'s `buildComparison`, computed
 *  once by the parent and passed down here) are two fully-formatted block trees — the newer
 *  document's own shape with insertions, and the older document's own shape with deletions —
 *  built from the SAME alignment the unified redline uses, and rendered here through the SAME
 *  `NoteRedline` component. A table, a picture, a list all render as themselves in both panes,
 *  so the two can only look alike when the documents genuinely do. See
 *  `test/notesRedline.test.js` for the regression fixture (a table on one side, the same
 *  content as plain paragraphs on the other) asserting the two panes now differ.
 */
import NoteRedline from "./NoteRedline.jsx";
import { notesConflictKeptLine } from "../lib/notesStore.js";
import { stampLabel, absoluteStamp } from "../lib/notesTime.js";

const RADIUS = { control: 8, pill: 999 }; // mirrored from shared/ui/controls.jsx — see NoteToolbar
// ⛔ B842947/NEW-4 (owner redlines, 2026-09-03) — the choose button below is a filled button
// matching `shared/ui/controls.jsx`'s `Button variant="primary"` shape-for-shape (Notes' own
// accent) instead of the old hand-rolled outline pill. MIRRORED rather than imported — the
// same reasoning `ConflictReview.jsx`'s own `PrimaryButton` documents (importing controls.jsx
// from Notes risks the Site-route chunk allowlist, `ui-audit/perf-bundle-audit.mjs`). The
// "nothing is lost" line is now `notesConflictKeptLine()` — the discarded copy goes to version
// history, not a sibling page.
const NOTES_ACCENT = { accent: "var(--accent-notes)", onAccent: "var(--on-accent-notes)" };
const REST_SHADOW = "0 1px 2px rgba(0,0,0,0.05)"; // design-exempt: neutral rest-shadow mirrored verbatim from shared/ui/controls.jsx's own REST_SHADOW — token-independent by design, see that file's Button comment

function PrimaryButton({ accent = "var(--accent)", onAccent = "var(--on-accent)", style, children, ...rest }) {
  return (
    <button
      style={{
        padding: "5px 10px", fontSize: 10.5, borderRadius: RADIUS.control, cursor: "pointer",
        fontFamily: "inherit", fontWeight: 600, boxShadow: REST_SHADOW,
        border: `1px solid ${accent}`, background: accent, color: onAccent, ...style,
      }}
      {...rest}
    >{children}</button>
  );
}

/** One version, read-only and in full — the pane's real formatted content (`NoteRedline`) in
 *  place of the old plain-text diff highlight. */
function VersionCard({ label, when, whenExact, blocks, images, buttonLabel, buttonAriaLabel, onChoose, testId }) {
  return (
    <div
      data-testid={testId}
      style={{
        minWidth: 0, display: "flex", flexDirection: "column", gap: 6,
        background: "var(--surface-raised)", border: "1px solid var(--warn-border)", borderRadius: RADIUS.control,
        padding: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 12, color: "var(--text-primary)" }}>{label}</span>
        <span
          title={whenExact || undefined}
          style={{ fontSize: 10.5, fontWeight: 600, color: "var(--text-secondary)", flex: "0 0 auto" }}
        >{when ? `edited ${when}` : "edit time unknown"}</span>
      </div>
      <div
        data-testid={`${testId}-text`}
        style={{
          maxHeight: 320, overflowY: "auto", minWidth: 0,
          border: "1px solid var(--border-default)", borderRadius: RADIUS.control,
          padding: 8,
          /* The standard background-attachment scroll-shadow — two solid layers riding the
           * SCROLLING content ("local") and two soft shadow layers fixed to the box ("scroll"),
           * so the shadow only shows once there is more to scroll toward. No JS. */
          background:
            "linear-gradient(var(--surface-page) 30%, transparent),"
            + "linear-gradient(transparent, var(--surface-page) 70%) 0 100%,"
            + "linear-gradient(rgba(0,0,0,.16), transparent) 0 0," // design-exempt: scroll-shadow hint — no shadow-color token exists repo-wide yet (same gap SheetView.jsx/CompEntryGrid.jsx already cite)
            + "linear-gradient(transparent, rgba(0,0,0,.16)) 0 100%", // design-exempt: scroll-shadow hint — no shadow-color token exists repo-wide yet (same gap SheetView.jsx/CompEntryGrid.jsx already cite)
          backgroundRepeat: "no-repeat",
          backgroundColor: "var(--surface-page)",
          backgroundSize: "100% 24px, 100% 24px, 100% 8px, 100% 8px",
          backgroundAttachment: "local, local, scroll, scroll",
        }}
      >
        {blocks.length
          ? <NoteRedline blocks={blocks} images={images} />
          : <em style={{ color: "var(--text-secondary)" }}>This copy is empty.</em>}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <PrimaryButton
          type="button"
          {...NOTES_ACCENT}
          data-testid={`${testId}-choose`}
          aria-label={buttonAriaLabel}
          onClick={onChoose}
        >{buttonLabel}</PrimaryButton>
      </div>
    </div>
  );
}

/** The visible name for one slot — same recency-first framing as `ConflictReview.jsx`'s
 *  `roleLabel` (kept as a sibling copy rather than a shared import: the two files' JSX shapes
 *  differ enough that a shared component would need its own prop surface for no real reuse). */
function roleLabel(comparable, isNewer, which) {
  if (comparable) return isNewer ? "Newer version" : "Older version";
  return which === "mine" ? "This window’s version" : "The other window’s version";
}

/** THE TWO CARDS SIT SIDE BY SIDE ON A WIDE SCREEN, STACKED ON A NARROW ONE — see the
 *  original B842624 header for why this is a CSS grid question, never a JS breakpoint.
 *
 *  `order` is `lib/notesVersionOrder.js`'s `orderConflictVersions` result (computed once by
 *  `ConflictReview.jsx`, not re-derived here); `panes` is `lib/notesRedline.js`'s
 *  `buildComparison(...).panes` — `panes.newer` pairs with `order.newer`, `panes.older` with
 *  `order.older`, by construction (both come from the same caller, in the same order). */
export default function ConflictSideBySide({ order, panes, images, onKeepMine, onKeepTheirs }) {
  const chooseFor = (which) => (which === "mine" ? onKeepMine : onKeepTheirs);

  const cardFor = (slot, blocks) => ({
    when: stampLabel(slot.updatedAt),
    whenExact: absoluteStamp(slot.updatedAt),
    blocks,
    onChoose: chooseFor(slot.which),
    testId: slot.which === "mine" ? "notes-conflict-mine" : "notes-conflict-theirs",
  });
  const newerCard = cardFor(order.newer, panes.newer);
  const olderCard = cardFor(order.older, panes.older);
  const newerLabel = roleLabel(order.comparable, true, order.newer.which);
  const olderLabel = roleLabel(order.comparable, false, order.older.which);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* NEW-1 — stated once, above both cards, not repeated per card. */}
      <p style={{ fontSize: 10.5, color: "var(--text-secondary)", margin: 0 }}>{notesConflictKeptLine()}</p>
      <div data-testid="notes-conflict-sidebyside" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 8, alignItems: "start" }}>
        <VersionCard
          label={newerLabel} when={newerCard.when} whenExact={newerCard.whenExact} blocks={newerCard.blocks} images={images}
          buttonLabel={order.comparable ? "Keep the newer version" : `Keep ${order.newer.which === "mine" ? "this window’s" : "the other window’s"} version`}
          buttonAriaLabel={`Keep the version edited ${newerCard.when || "at an unknown time"}, from ${order.newer.which === "mine" ? "this window" : "the other window"}`}
          onChoose={newerCard.onChoose} testId={newerCard.testId}
        />
        <VersionCard
          label={olderLabel} when={olderCard.when} whenExact={olderCard.whenExact} blocks={olderCard.blocks} images={images}
          buttonLabel={order.comparable ? "Keep the older version" : `Keep ${order.older.which === "mine" ? "this window’s" : "the other window’s"} version`}
          buttonAriaLabel={`Keep the version edited ${olderCard.when || "at an unknown time"}, from ${order.older.which === "mine" ? "this window" : "the other window"}`}
          onChoose={olderCard.onChoose} testId={olderCard.testId}
        />
      </div>
    </div>
  );
}
