/* IntegrityBanner — the two findings nothing could previously mention (B315715, B342992).
 *
 * ⛔ IT IS ITS OWN LAZY CHUNK, and that is a measured bundle decision rather than tidiness.
 * The bar renders only when there is a real finding, which is almost never — so on the
 * overwhelming majority of loads its bytes would be downloaded before the notebook rail can
 * paint, for a component nobody sees. Same reasoning as the editor and Quick Open. It is
 * pulled in from Notes.jsx behind a Suspense with a null fallback: a bar that arrives a
 * moment late is exactly as useful, and a rail that paints a moment sooner is the thing this
 * route's byte budget exists to protect.
 */
import { duplicateNotice, joinMentions, keepCopyLabel, numberWord, pageMention, sentenceCase } from "../lib/notesDuplicates.js";
import { absoluteStamp } from "../lib/notesTime.js";

const RADIUS = { control: 8, pill: 999 };

/** ⛔ THE SAME NOTE IN TWO PROJECTS, AND A NOTE THAT WAS FILED NOWHERE — SAID OUT LOUD.
 *
 *  Two findings, one bar, and each one exists because the product had no way to mention
 *  something it already knew:
 *
 *  • A NOTE IN TWO PROJECTS (NEW-4, prior round). Copied into an unrelated pursuit, found by
 *    hand a week later under a tombstone heading.
 *  • A NOTE WITH NO NODE (NEW-1). The first version of this bar said "One note is filed in no
 *    project and reachable from nowhere" — a correct finding, rendered useless: it named no
 *    note, opened nothing and offered no action, so the only thing a person could do with it
 *    was worry. It now NAMES each one (its first line, when it was written, how much is
 *    there), it has ALREADY put them somewhere visible by the time you read it, and every way
 *    out is one click away in the bar itself.
 *
 *  ⛔ THE RECOVERY IS NOT A BUTTON, IT IS DONE. Auto-adoption runs on load, so the note is
 *  reachable before anyone reads this. A "Put it back" the user had to find was one more
 *  chance for a real note to sit lost while a banner talked about it. */
export default function IntegrityBanner({ duplicates, writeRefused = 0, purgeFailed = 0, recovered, projectNames, projects, onOpen, onFile, onBin, onKeepOne, onKeepBoth, onDismiss }) {
  const dupLine = duplicateNotice(duplicates);
  const lost = (recovered || []).length;
  /* ⛔ THE BAR NEVER ASSERTS A WRITE OUTCOME IT DID NOT OBSERVE (NEW-1, 2026-10-16). `writeRefused`
   * is set only when `writeTree` actually returned false for that adoption attempt; `purgeFailed`
   * only when a body was still in storage after the purge ran. Neither is derived from how many
   * notes were *found*. */
  const stillLost = writeRefused;
  if (!dupLine && !lost && !stillLost && !purgeFailed) return null;
  const nameOf = (id) => projectNames.get(id) || "a project that no longer exists";
  const first = duplicates?.[0] || null;
  const pill = (extra = {}) => ({
    flex: "0 0 auto", border: "1px solid var(--warn-text)", borderRadius: RADIUS.pill,
    background: "transparent", color: "var(--warn-text)", font: "inherit",
    fontSize: 11.5, fontWeight: 700, padding: "2px 10px", cursor: "pointer", ...extra,
  });
  return (
    <div
      role="alert"
      data-testid="notes-integrity-banner"
      data-duplicates={duplicates?.length || 0}
      data-unreachable={stillLost}
      data-purge-failed={purgeFailed}
      data-recovered={lost}
      style={{
        flex: "none", display: "flex", flexDirection: "column", gap: 6, padding: "8px 16px",
        background: "var(--warn-bg)", borderBottom: "1px solid var(--border-default)",
        color: "var(--warn-text)", fontSize: 12.5, fontWeight: 600,
      }}
    >
      {dupLine ? (
        <span>
          {dupLine} {first ? joinMentions(first.pages.map((p) => pageMention(p, nameOf))) + "." : ""}
        </span>
      ) : null}

      {lost ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {/* ⛔ ONE SENTENCE, WHAT HAPPENED AND WHAT TO DO (NEW-1, the banner-wording fix). The
              old three-clause version explained the mechanism ("its name lived on the entry
              that went missing") — implementation detail nobody asked for — and routed the
              no-project case through the same "under Not in a project" template as the
              duplicate banner's headline defect. Neither is stated here at all. */}
          <span data-testid="notes-recovered-summary">
            {lost === 1
              ? "One note lost its filing and is back below — open it and file it if it belongs somewhere."
              : `${sentenceCase(numberWord(lost))} notes lost their filing and are back below — open them and file the ones that belong somewhere.`}
          </span>
          {(recovered || []).map((r) => (
            <div key={r.pageId} data-testid={`notes-recovered-${r.pageId}`} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                data-testid={`notes-recovered-open-${r.pageId}`}
                onClick={() => onOpen({ pages: [{ pageId: r.pageId, projectId: null, where: "live", title: r.title }] })}
                title="Open this note"
                style={{ flex: "1 1 220px", minWidth: 0, textAlign: "left", border: "none", background: "transparent", color: "var(--warn-text)", font: "inherit", fontWeight: 700, cursor: "pointer", textDecoration: "underline", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >{r.firstLine || r.title}</button>
              <span style={{ flex: "0 0 auto", fontWeight: 600, opacity: 0.85 }}>
                {r.chars} characters{r.createdAt ? ` · written ${absoluteStamp(r.createdAt).split(",")[0]}` : ""}
              </span>
              {/* File under a project… — a real <select>, because "which project" is a list
                  and an inline editor beats a dialog (house rule). */}
              <select
                data-testid={`notes-recovered-file-${r.pageId}`}
                value=""
                onChange={(e) => { if (e.target.value !== "") onFile(r.pageId, e.target.value === "__none__" ? null : e.target.value); }}
                style={{ flex: "0 0 auto", font: "inherit", fontSize: 11.5, fontWeight: 700, borderRadius: RADIUS.control, border: "1px solid var(--warn-text)", background: "transparent", color: "var(--warn-text)", padding: "2px 6px", cursor: "pointer" }}
              >
                <option value="">File under…</option>
                <option value="__none__">Keep as loose</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button type="button" data-testid={`notes-recovered-bin-${r.pageId}`} onClick={() => onBin(r.pageId)} style={pill()}>Move to bin</button>
            </div>
          ))}
        </div>
      ) : null}

      {stillLost ? (
        <span data-testid="notes-integrity-stuck">
          Planyr couldn&apos;t save the fix for {stillLost === 1 ? "one note" : `${numberWord(stillLost)} notes`} — reload to try again; nothing was changed.
        </span>
      ) : null}
      {purgeFailed ? (
        <span data-testid="notes-purge-stuck">
          {purgeFailed === 1 ? "One deleted note's" : `${sentenceCase(numberWord(purgeFailed))} deleted notes'`} leftover data couldn&apos;t be cleared from this browser — reload to try again.
        </span>
      ) : null}

      {/* ⛔ THE RESOLUTION IS HERE, NOT SOMEWHERE ELSE (NEW-4). A finding whose only exit is
          Dismiss is a finding that teaches you to dismiss findings. Every copy can be kept on
          its own — the others go to the BIN, so the choice is undoable — or both can be kept
          and the pair remembered so it stops asking.
          ⛔ AND THE ONE-CLICK "Keep…" BUTTONS ARE PROOF-GATED (NEW-1, the
          notes-reconciler-stale-index fix). They bin whichever copy is NOT kept — real, if
          undoable, damage — so they only appear when the two entries are provably the same
          text (`identical`), never on a near-duplicate a similarity score merely suspects.
          ⛔ AND EVERY CONTROL LIVES IN ONE ROW, ALIGNED TO ONE EDGE (NEW-1, the banner-wording
          fix — owner report, verbatim: "the wording and formatting of the warning need
          improvement". "Show me" used to float top-right of the summary line while "Dismiss"
          sat alone on its own row below the buttons — two corners of the same bar. One finding,
          one control group, wrapping together as a unit rather than splitting across rows at a
          narrow width. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
        {first && first.identical ? (
          <span data-testid="notes-dupe-actions" style={{ display: "contents" }}>
            {first.pages.map((p) => (
              <button
                key={p.pageId}
                type="button"
                data-testid={`notes-dupe-keep-${p.pageId}`}
                onClick={() => onKeepOne(first, p.pageId)}
                style={pill()}
              >{keepCopyLabel(p, nameOf)}</button>
            ))}
            <button type="button" data-testid="notes-dupe-keep-both" onClick={() => onKeepBoth(first)} style={pill()}>Keep both</button>
          </span>
        ) : first ? (
          // A near-duplicate never gets a button that could bin the wrong side of a guess —
          // only a way to say it is not a match, kept non-destructive like every other control
          // here (`onKeepBoth` records the pair and stops asking; nothing is deleted).
          <span data-testid="notes-dupe-actions-unconfirmed" style={{ display: "contents" }}>
            <button type="button" data-testid="notes-dupe-keep-both" onClick={() => onKeepBoth(first)} style={pill()}>Not the same</button>
          </span>
        ) : null}
        {first ? <button type="button" data-testid="notes-integrity-open" onClick={() => onOpen(first)} style={pill()}>Show me</button> : null}
        <button type="button" onClick={onDismiss} style={pill({ border: "1px solid var(--border-default)" })}>Dismiss</button>
      </div>
    </div>
  );
}

