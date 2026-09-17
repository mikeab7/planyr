/* dashboardDocFetch — the last-touched Review document, for the Jump-back-in card (B1213313,
 * NEW-2). A trimmed version of doc-review/lib/reviewStore.js's own `fetchReviews()` shape —
 * avoided here on purpose so this card doesn't statically pull that module's heavier
 * `cloudSync.js`/`siteModel.js` imports for three columns.
 *
 * ⛔ B1340368 (owner report 2026-09-08, "the Last document row dead-ends") — the single most
 * recent NON-DELETED document is not always openable: its own `deleted_at` can be null while
 * the PROJECT it's filed under (`project_id`, mirrors `sites.group_id`) has since been fully
 * deleted or purged. Reproduced live: doc `rvmtov1wtr0459a` ("2026.09.05 planyr-dupe-check")
 * is alive and correctly excluded by neither of the two obvious candidates — it isn't itself
 * soft-deleted, and this query already excludes `deleted_at` rows — but its `project_id`
 * (`smtov116eka7`) resolves to NOTHING in `sites` (a throwaway test project, since torn down).
 * Opening it navigates the route to that dead project id, and Shell.jsx's project-deletion gate
 * (built for the Site Planner, but module-agnostic — it blocks whichever workspace is active)
 * swaps in "This project doesn't exist" instead of ever mounting Doc Review. Neither the
 * document nor the query was ever the bug; the STALE reference is `project_id` itself, and
 * nothing cleared it when its project went away (see storage.js's `purgeProjectFoldersFor`,
 * which now does exactly that at the point a project is confirmed permanently gone).
 *
 * Fixed here by pulling a bounded batch of the most recent non-deleted documents (never just
 * one) and walking them in order for the first one whose filed project is either unset or
 * still live — falling back through the list exactly as the brief asked, and returning null
 * (dropping the line) only when nothing in the batch qualifies.
 *
 * ⛔ B1616656 (×3 recurrence of the underlying symptom, owner report 2026-09-17, "why is this
 * what's showing up") — the SAME `rvmtov1wtr0459a` row was still the offered "Last document"
 * after both B1340368 (the dead-project reroute) and B1456896 (the auto-download) shipped, and
 * clicking it still landed on an empty Review canvas with nothing to do but download a stray
 * .txt test file. Neither prior fix was wrong — the dead project id no longer strands the click
 * and the download is no longer silent — but the row itself was never a legitimate candidate:
 * this repo's own product line is "the imported drawing is an immutable backdrop" (see
 * doc-review/CLAUDE.md) — the markup canvas can only ever show a PDF, so a document with BOTH no
 * filed project (nothing to route to that isn't the empty canvas) AND a non-PDF source (nothing
 * the canvas can render either) opens to a page with nothing on it. A document missing only one
 * of those two things is fine: filed to a live project, it opens into that project's real
 * context; a project-less PDF opens and renders on the canvas exactly as any PDF does. So the
 * candidate walk below now also skips a project-less document whose OWN recorded source name
 * (`data.sources[0].name`) isn't a PDF — never withholding a document that has a live project or
 * that renders, per the same "don't hide legitimate recent work" reasoning B1340368's recurrence
 * fix already used for a plain project-less document.
 *
 * AUDIT-FIRST finding, scoped out of this fix on purpose: `data->>sourceFile` — the flat mirror
 * column `reviewStore.js`'s own `fetchReviews()`/`FileBrowser.jsx`'s `isPdfFile` already read for
 * this same question — is populated on only 4 of the account's 26 live `doc_reviews` rows
 * (checked directly against `planyr_production`), because it's only ever written by the
 * `fileNewReview()` upload path (B685/B686) and was never backfilled onto older or
 * differently-created rows — this exact reported row included, which has no `sourceFile` key at
 * all despite its `data.sources[0].name` correctly reading `"planyr-dupe-check.txt"`. Reusing
 * that mirror here would have shipped a fix that silently failed to catch the very row it was
 * written for (every unrecognized name reads as "assume PDF" by that code's own convention), so
 * this file reads `data.sources[0].name` instead — present on 26 of 26 live rows, because both
 * a plain upload (`fileNewReview`) and a stitched set write it unconditionally at creation, and
 * it's the one field `sourceFile`/`single.fileName` are themselves mirrored FROM. Whether
 * `FileBrowser.jsx`'s own classification should move off the same unreliable mirror is a
 * separate question, untouched here — it defaults an unrecognized file to "assume PDF", the safe
 * direction, and every review created going forward (this fix's window included) already
 * populates `sourceFile` correctly, so nothing observed today shows it misfiring on a live path.
 */
import { supabase } from "../../site-planner/lib/supabase.js";
import { liveProjectIds, docProjectIsDead } from "../../../shared/projects/docProjectLiveness.js";
import { isPdfName } from "../../../shared/files/uploadQueue.js";

// A project-less candidate's own recorded source name is the one thing that decides whether the
// Review canvas can show it at all. An unrecognized/absent name reads as "assume PDF" — the same
// permissive default `FileBrowser.jsx`'s `isPdfFile` already uses — so this can only ever narrow
// the fallback batch on a name we can actually read as non-PDF, never on a maybe.
function candidateIsPdf(sources) {
  const name = Array.isArray(sources) && sources[0] && sources[0].name;
  return !name || isPdfName(name);
}

// Bounded fallback depth — a card is not the place for an unbounded account-wide scan; an
// account with 20 consecutive documents all filed under dead projects is not a case this
// falls back past, and the card just drops the line rather than showing a stale one.
const DOC_CANDIDATE_LIMIT = 20;

/** { id, title, project, projectId, updatedAt } for the most recently touched document across
 * every project whose filed project (if any) is still live, or null if there is none / the
 * read failed. */
export async function fetchLastTouchedDoc() {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("doc_reviews")
      .select("id, title, project, project_id, updated_at, sources:data->sources")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(DOC_CANDIDATE_LIMIT);
    if (error || !Array.isArray(data) || !data.length) return null;
    const projectIds = [...new Set(data.map((d) => d.project_id).filter(Boolean))];
    let live = null;
    if (projectIds.length) {
      // Inconclusive (offline/RLS/thrown) → fail OPEN, same as every other deletion-status
      // check in this codebase: never withhold the whole card on a maybe. docProjectIsDead's
      // own `!liveIds` branch already returns false for every candidate in that case, so
      // `pick` below naturally falls back to the plain most-recent document.
      try { live = await liveProjectIds(projectIds); } catch (_) { live = null; }
    }
    // Eligible when: its filed project is confirmed alive OR unfiled-but-a-PDF OR filed-and-live
    // regardless of file type — a live project gives the click somewhere real to land even when
    // the canvas itself can't render the file. Only a project-less non-PDF is skipped: nothing to
    // route to and nothing the canvas can show, so today's open would be a bare, useless canvas.
    const pick = data.find((d) => {
      if (docProjectIsDead(d, live)) return false;
      if (d.project_id) return true;
      return candidateIsPdf(d.sources);
    });
    if (!pick) return null;
    return { id: pick.id, title: pick.title || "Untitled document", project: pick.project || null, projectId: pick.project_id || null, updatedAt: pick.updated_at || null };
  } catch (_) {
    return null;
  }
}
