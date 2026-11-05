/*
 * scripts/lib/recordCheck.mjs — the LIGHT CHECK that replaces "the fix and its record merge together" (NEW-1, 2026-11-05).
 *
 * WHY. Until the ledger moved to its own branch, a work item's code and its backlog record travelled in ONE pull
 * request, so a merged `B123` always had a `B123` entry (the mint gate even failed a commit subject that announced
 * an id the branch never filed). With the record on another branch, nothing on main shows a MISSING record. This
 * reads the subjects of merged commits, pulls out the ids they cite, and reports any id that has no entry file
 * anywhere in the ledger.
 *
 * IT NEVER BLOCKS. It is a warning annotation + a step summary (and exit 0 unless --strict), because the whole point
 * of the move is that records are not a merge gate. A record filed a minute after the merge is normal, so the
 * scheduled run re-checks the last few days and a late record simply clears the warning.
 *
 * Only ids of 4+ digits count (a B/V followed by 1–3 digits in a subject is far more likely "V8", "B2B" than an id;
 * every id minted in the last year is longer).
 */
const ID_RE = /\b([BV])(\d{4,})\b/g;

export function extractIds(subject) {
  const out = new Set();
  for (const m of String(subject).matchAll(ID_RE)) out.add(m[1] + m[2]);
  return [...out];
}

/** rows: [{sha, subject}], ledgerIds: Set of ids that have an entry. → { checked, missing:[{id, sha, subject}] } */
export function recordVerdict(rows, ledgerIds) {
  const missing = [];
  const seen = new Set();
  let checked = 0;
  for (const r of rows) {
    if (/^(Merge |Nudge CI\b)/.test(r.subject)) continue; // merge commits and CI nudges announce nothing
    for (const id of extractIds(r.subject)) {
      checked++;
      if (ledgerIds.has(id) || seen.has(id)) continue;
      seen.add(id);
      missing.push({ id, sha: r.sha, subject: r.subject });
    }
  }
  return { checked, missing };
}

export function formatVerdict(v, { github = false } = {}) {
  if (!v.missing.length) return `✅ record check: ${v.checked} id mention(s) in merged commits — every one has a ledger record.`;
  const lines = [`⚠ record check: ${v.missing.length} id(s) cited by merged commits have NO ledger record (not blocking):`];
  for (const m of v.missing) {
    const text = `${m.id} is cited by ${m.sha.slice(0, 7)} "${m.subject.slice(0, 90)}" but has no entry on the ledger branch — file it: npm run ledger -- add …`;
    lines.push(github ? `::warning title=Missing ledger record ${m.id}::${text}` : `  • ${text}`);
  }
  return lines.join("\n");
}
