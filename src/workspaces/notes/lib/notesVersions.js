/* notesVersions — the PURE half of version history (NEW-3).
 *
 * WHAT THIS IS FOR, and why the 30-day bin does not already cover it. The bin protects a
 * note somebody DELETED. It does nothing at all for a note somebody MANGLED — a paste over
 * a selection, an undo history lost to a reload, or (a live risk on this account, not a
 * hypothetical) two windows open on the same account, which this module already knows how
 * to produce conflict copies from. Undo dies with the tab; this does not.
 *
 * ⛔ RESTORING CREATES A NEW VERSION. IT NEVER DESTROYS HISTORY. Restoring is an EDIT like
 * any other, so the state you are leaving is snapshotted first — which means restoring the
 * wrong version is itself undoable, by restoring the one taken a second earlier. A restore
 * that overwrote history would be a data-loss feature wearing a safety feature's name.
 * `planRestore` below is that rule, written once and unit-tested.
 *
 * ⛔ RETENTION IS DENSER RECENT, COARSER AS IT AGES, because that is the shape of what
 * anybody actually wants back: the last hour at full resolution (you noticed the mangle
 * within minutes), then one an hour for a day, then one a day for a month. Keeping every
 * snapshot forever would put a note's whole typing history on a device whose budget is
 * measured in megabytes; keeping only N would make the useful old one the first thing
 * dropped. `planRetention` is a PURE function of `(entries, now)` — no clock of its own, no
 * storage — so every tier boundary is a test rather than a hope.
 *
 * ⛔ AND THE **CURRENT** VERSION IS NEVER A CANDIDATE FOR DELETION. The newest entry is
 * pinned unconditionally, whatever the tiers say, because a history whose most recent row
 * can be swept is a history that can be empty at the exact moment you need it.
 *
 * WHERE THE BYTES LIVE, and why (TIER-BY-REBUILDABILITY). Snapshots go to **IndexedDB**,
 * never to localStorage. localStorage on the owner's own browser was measured at ~78% of a
 * hard ~5 MB cap with real saved plans in it; a note's version history is bulky, bursty and
 * would crowd irreplaceable work out of the small tier — the exact priority inversion that
 * rule exists to forbid. Snapshots are user work, so they are BUDGETED rather than evicted
 * on pressure: retention above is the budget.
 */

/** How long the editor must be idle-ish before a new snapshot is worth taking. Typing for
 *  an hour therefore costs a handful of rows, not one per keystroke. */
export const SNAPSHOT_MIN_GAP_MS = 90 * 1000;

/** Retention tiers, newest first. `within` is how far back the tier reaches; `every` is the
 *  minimum spacing kept inside it. The last tier's `within` is the point history ends. */
export const RETENTION_TIERS = [
  { within: 60 * 60 * 1000, every: 0 },                        // the last hour: keep everything
  { within: 24 * 60 * 60 * 1000, every: 60 * 60 * 1000 },      // the last day: hourly
  { within: 30 * 24 * 60 * 60 * 1000, every: 24 * 60 * 60 * 1000 }, // the last month: daily
];

/** A hard ceiling under the tiers, so a pathological day of editing cannot fill a device. */
export const MAX_VERSIONS_PER_PAGE = 60;

/** Is a fresh snapshot due? Pure: the caller supplies both clocks. */
export function shouldSnapshot(lastAt, now, gap = SNAPSHOT_MIN_GAP_MS) {
  if (!Number.isFinite(lastAt)) return true;
  return Number(now) - Number(lastAt) >= gap;
}

/** Decide which snapshots to keep. `entries` is `[{ id, at, ... }]` in any order; the answer
 *  is `{ keep, drop }`, both arrays of ids, newest-first within `keep`. */
export function planRetention(entries, { now = 0, tiers = RETENTION_TIERS, max = MAX_VERSIONS_PER_PAGE } = {}) {
  const rows = (entries || []).filter((e) => e && Number.isFinite(e.at)).slice().sort((a, b) => b.at - a.at);
  if (!rows.length) return { keep: [], drop: [] };

  const keep = [];
  const drop = [];
  let lastKeptAt = null;

  rows.forEach((row, i) => {
    // The newest is pinned, always — a history whose current row can be swept is not one.
    if (i === 0) { keep.push(row.id); lastKeptAt = row.at; return; }
    // A restore point is a deliberate marker, not incidental typing; it outranks spacing.
    if (row.pinned) { keep.push(row.id); lastKeptAt = row.at; return; }

    const age = now - row.at;
    const tier = tiers.find((t) => age <= t.within);
    if (!tier) { drop.push(row.id); return; }                  // older than history goes back
    if (tier.every > 0 && lastKeptAt != null && lastKeptAt - row.at < tier.every) { drop.push(row.id); return; }
    keep.push(row.id);
    lastKeptAt = row.at;
  });

  // The ceiling trims from the OLD end, after the tiers have had their say.
  while (keep.length > max) drop.push(keep.pop());
  return { keep, drop };
}

/** THE RESTORE PLAN, stated as data so the "never destroys history" rule is testable.
 *
 *  Given the document on screen now and the snapshot being restored, this returns the two
 *  writes that make a restore safe, in order:
 *    1. `snapshotCurrent` — the pre-restore state, marked `pinned` so retention keeps it;
 *    2. `apply` — the document to write to the page, plus its own pinned snapshot.
 *  Nothing in here deletes anything. */
export function planRestore({ currentDoc, versionDoc, versionAt, now = 0 }) {
  if (!versionDoc) return { ok: false, error: "that version has no document to restore" };
  return {
    ok: true,
    snapshotCurrent: currentDoc ? { doc: currentDoc, at: now, reason: "before-restore", pinned: true } : null,
    apply: { doc: versionDoc, at: now + 1, reason: "restored", pinned: true, restoredFrom: versionAt ?? null },
  };
}

/** How a version row describes itself. `reason` is a machine word; this is the sentence.
 *  One place, so the panel and any future export cannot word it differently. */
export function versionReasonLabel(reason) {
  if (reason === "before-restore") return "Before a restore";
  if (reason === "restored") return "Restored";
  if (reason === "closed") return "When you left the page";
  return "While you were typing";
}
