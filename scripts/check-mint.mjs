#!/usr/bin/env node
/*
 * check-mint.mjs — the MINT GATE (B779). Mechanically enforces what B779's late-bind rule only
 * asked for politely: every backlog id this branch ADDS must be one nobody else has claimed.
 *
 * WHY A GATE AND NOT A BETTER RULE. B779 (2026-07-11) shipped `next-id --against-main` plus a
 * CLAUDE.md convention ("assign the real number as the LAST step before you push") and stated it
 * "collapses the collision window from a whole session to a few seconds." Six consecutive
 * dispatches collided anyway. The audit (see the header of next-id.mjs) found the convention was
 * being FOLLOWED and the collisions happened regardless, because the window that matters is
 * `push → merge` — PR open, CI nudge, build, auto-merge — not `mint → push`. A rule that fires at
 * the wrong moment cannot be fixed by asking sessions to obey it harder. So:
 *
 *   - `next-id --against-main` now reads the in-flight peer branches too, so the number it hands
 *     out is free on main AND on every branch currently racing us; and
 *   - this gate re-checks that property AT PUSH TIME and AT CI TIME, when the peer set is current.
 *
 * It checks the PROPERTY ("this id is unclaimed"), never the ceremony ("was it minted late?") —
 * a timestamp receipt would just be another thing to drift. A correct late mint passes; an early
 * or stale mint fails with the exact number to renumber to.
 *
 * WHAT COUNTS AS "ADDED": an id whose `### B###` / `### V###` heading exists in this branch's
 * BACKLOG.md ∪ BACKLOG-DONE.md (resp. VERIFICATION*.md) but in NEITHER file on origin/main. The
 * union matters: re-opening an archived item (a DEDUPE-FIRST recurrence, which is the correct
 * response to a repeat report) moves its heading between the two files without minting anything,
 * and must not be flagged.
 *
 *   node scripts/check-mint.mjs          → gate; exit 0 clean, 1 collision, 2 unverifiable
 *   node scripts/check-mint.mjs --ci     → a collision still fails; unverifiable warns loudly (0)
 *   node scripts/check-mint.mjs --json   → machine-readable verdict
 *   node scripts/check-mint.mjs --repo=<path>  → run against another checkout (the e2e self-test)
 *
 * Runs as a pre-push hook (installed automatically by `npm install` — `scripts/install-hooks.mjs`,
 * NEW-1) and as a step in the required build check.
 *
 * TESTED IN THREE LAYERS, because the first two alone let a broken gate look healthy:
 *   - `test/mintGuard.test.js` — the pure verdict logic (no git, no clock, no network);
 *   - `test/mintGateE2E.test.js` (NEW-2) — this whole file end to end, including the CLI's exit
 *     codes, against REAL git refs in throwaway repos with a local file remote. Still hermetic:
 *     "the remote" is a bare repo in a temp dir, so it runs in the ordinary required build. This
 *     is what proves the REJECTION path, which before it had never once fired on a real push;
 *   - the field (V531) — the parts only concurrent live dispatches can show: no false red at real
 *     branch counts, and the peer fetch staying affordable.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  B_FILES, V_FILES, PEER_NS, DEFAULT_MAX_FETCH_AGE_S, DEFAULT_PEER_DAYS,
  headingIdsIn, readRefFile, maxOnRef, assessFreshness, originMainSha, lastFetchAgeSeconds,
  fetchPeers, peerRefRows, selectPeerRefs, peerClaims, tryGit, selfBranchNames, dropContainedRefs,
} from "./next-id.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

/**
 * PURE verdict. `added` = ids this branch introduces; `claimedMax` = the highest id anyone else
 * holds (main ∪ peers); `peerIds` maps an id to the branch already holding it.
 *
 * Two distinct failures, because they read differently to a human:
 *   - TAKEN: the exact id is already on main or on a peer branch → a guaranteed collision.
 *   - BELOW: the id is free today but sits at or under the claimed high-water mark → it was minted
 *     against a stale view, so the next merge will very likely take it. This is the early-mint
 *     case, and catching it is the whole point of the gate.
 * Gaps are explicitly legal (B1140 established they cost nothing), so the test is `> claimedMax`,
 * never `=== claimedMax + 1`.
 */
export function mintVerdict({ letter, added, claimedMax, peerOwners = new Map(), mainIds = new Set() }) {
  const offenders = [];
  for (const n of [...added].sort((a, b) => a - b)) {
    if (mainIds.has(n)) offenders.push({ id: `${letter}${n}`, kind: "taken", where: "origin/main" });
    else if (peerOwners.has(n)) offenders.push({ id: `${letter}${n}`, kind: "taken", where: peerOwners.get(n) });
    else if (n <= claimedMax) offenders.push({ id: `${letter}${n}`, kind: "below", where: `the claimed high-water mark ${letter}${claimedMax}` });
  }
  return { ok: offenders.length === 0, letter, offenders, claimedMax, nextFree: claimedMax + 1 };
}

/* ---- the ANNOUNCEMENT check (NEW-H, 2026-07-30) -----------------------------------------
 *
 * The gate above proves the ids this branch FILES are unclaimed. It says nothing about the ids
 * this branch ANNOUNCES — the commit subject, which is what GitHub pre-fills the PR title from and
 * therefore the only number a human ever reads in `git log --oneline` or in the PR list.
 *
 * That gap produced a real, owner-visible defect. PR #865 and PR #866 both announced
 * "B1144 / B1145 / B1146 — V531". The FILES were fine and this gate did its job: #866's ids were
 * renumbered to B1151–B1153 / V534 before it merged, and `test/idUniqueness.test.js` is green.
 * Nobody updated the subject line, so main now carries two commits claiming the same three numbers
 * for entirely different features — which reads, correctly, as a collision. Renumbering is exactly
 * when this happens: the late-bind rule (B779) tells you to move the heading at the last moment,
 * and the subject was written before that.
 *
 * So: every B###/V### named in a commit subject this branch adds must actually exist as a heading
 * in this branch's backlog / verification files. It checks the property ("the number I announce is
 * the number I filed"), never the ceremony, so a correct late renumber that also fixes the subject
 * passes untouched, and a recurrence — which re-opens an existing heading and mints nothing —
 * passes too, because the heading is right there.
 */

/** Ids of a family named in a block of prose (a commit subject). `B1144 / B1145` → [1144, 1145]. */
export function idsNamedIn(text, letter) {
  const out = new Set();
  // `\b` after the digits so B11 does not match inside B1144; ranges ("B1156–B1163") expand.
  for (const m of (text || "").matchAll(new RegExp(`\\b${letter}(\\d+)\\s*[–—-]\\s*${letter}?(\\d+)\\b`, "g"))) {
    const a = Number(m[1]), b = Number(m[2]);
    if (b >= a && b - a < 64) for (let n = a; n <= b; n++) out.add(n);
  }
  for (const m of (text || "").matchAll(new RegExp(`\\b${letter}(\\d+)\\b`, "g"))) out.add(Number(m[1]));
  return out;
}

/**
 * PURE verdict for the announcement check. `subjects` are this branch's commit subject lines;
 * `filed` maps a letter to the set of heading ids present in the working tree.
 */
export function announceVerdict({ subjects = [], filed = {} }) {
  const offenders = [];
  for (const letter of ["B", "V"]) {
    const have = filed[letter] || new Set();
    for (const subject of subjects) {
      for (const n of [...idsNamedIn(subject, letter)].sort((a, b) => a - b)) {
        if (!have.has(n)) offenders.push({ id: `${letter}${n}`, subject });
      }
    }
  }
  return { ok: offenders.length === 0, offenders };
}

/** Local (working-tree) heading ids for a family — what this branch actually says today. */
function localIds(repo, files, letter) {
  const texts = files.map((f) => join(repo, f)).filter(existsSync).map((p) => readFileSync(p, "utf8"));
  return headingIdsIn(texts, letter);
}

/** Heading ids for a family on a ref (across the whole file pair). */
function refIds(repo, ref, files, letter) {
  const texts = [];
  for (const f of files) {
    const r = readRefFile(repo, ref, f);
    if (!r.ok) return { ok: false, reason: r.reason };
    texts.push(r.text);
  }
  return { ok: true, ids: headingIdsIn(texts, letter) };
}

/** Run the gate. Returns { ok, unverifiable, reason, families:[verdict] }. */
export function runGate(repo = REPO, { peerDays = DEFAULT_PEER_DAYS, maxAgeSeconds = DEFAULT_MAX_FETCH_AGE_S, fetch = true, now = Date.now() } = {}) {
  const MAIN = "refs/remotes/origin/main";

  // Freshness first: a gate that green-lights against a week-old ref is worse than no gate,
  // because it launders a stale answer as a verified one.
  if (fetch) {
    const f = tryGit(repo, "git fetch --no-tags --quiet origin main");
    if (!f.ok) return { unverifiable: true, reason: `could not fetch origin/main — ${f.reason}` };
  }
  const fresh = assessFreshness({ sha: originMainSha(repo), ageSeconds: lastFetchAgeSeconds(repo, now), maxAgeSeconds });
  if (!fresh.ok) return { unverifiable: true, reason: fresh.message };

  // Resolve OUR OWN ancestry before any peer fetch touches the object store, then fetch peers with
  // this branch and main excluded, and hand back .git/shallow untouched when we are done.
  const selfNamesEarly = selfBranchNames(repo);
  const mbEarly = tryGit(repo, `git merge-base ${MAIN} HEAD`);
  let releasePeers = () => {};
  if (fetch) {
    const p = fetchPeers(repo, { exclude: selfNamesEarly });
    if (!p.ok) return { unverifiable: true, reason: p.reason };
    releasePeers = p.restore;
  }
  const rows = peerRefRows(repo);
  if (!rows.ok) return { unverifiable: true, reason: rows.reason };
  const selfNames = selfNamesEarly;
  const refs = dropContainedRefs(repo, selectPeerRefs(rows.rows, { days: peerDays, now, exclude: selfNames }));
  const branch = selfNames[0] || "(detached)";

  // "Added by this branch" is measured against the MERGE BASE, not against main's tip. That
  // distinction is what catches the B1140 case: main merged an item under B1130 while this branch
  // was in flight holding B1130 for something else. Measured against main's tip, B1130 looks
  // pre-existing and passes; measured against the base, BOTH sides minted it independently — a
  // guaranteed duplicate heading the moment they meet. Falling back to main's tip is strictly
  // weaker, so when the base can't be computed the gate SAYS so rather than quietly narrowing.
  const baseRef = mbEarly.ok && mbEarly.out.trim() ? mbEarly.out.trim() : null;

  const families = [];
  for (const [letter, files] of [["B", B_FILES], ["V", V_FILES]]) {
    const onMain = refIds(repo, MAIN, files, letter);
    if (!onMain.ok) return { unverifiable: true, reason: onMain.reason };
    const onBase = baseRef ? refIds(repo, baseRef, files, letter) : null;
    if (onBase && !onBase.ok) return { unverifiable: true, reason: onBase.reason };
    const priorIds = onBase ? onBase.ids : onMain.ids;
    const mainMax = maxOnRef(repo, MAIN, files, letter);
    if (!mainMax.ok) return { unverifiable: true, reason: mainMax.reason };

    const claims = peerClaims(repo, files, letter, { refs, baseMax: mainMax.max });
    if (!claims.ok) return { unverifiable: true, reason: claims.reason };

    // Which branch holds each above-main id, so a failure names the session we'd have collided with.
    const owners = new Map();
    for (const c of claims.claimants) {
      const one = peerClaims(repo, files, letter, { refs: [{ name: c.ref, ts: 0 }], baseMax: mainMax.max });
      if (one.ok) for (const n of one.ids) if (!owners.has(n)) owners.set(n, c.ref);
    }

    const added = [...localIds(repo, files, letter)].filter((n) => !priorIds.has(n));
    families.push({
      ...mintVerdict({ letter, added, claimedMax: Math.max(mainMax.max, claims.max), peerOwners: owners, mainIds: onMain.ids }),
      added, mainMax: mainMax.max, peerMax: claims.max, peersScanned: refs.length,
    });
  }
  releasePeers(); // leave .git/shallow exactly as we found it

  // The ANNOUNCEMENT half: do this branch's commit subjects name ids it actually filed? Read from
  // the merge base so it covers exactly the commits this push adds. A branch with no readable
  // ancestry simply skips it rather than inventing a verdict — the mint check above is unaffected.
  let announce = { ok: true, offenders: [], skipped: "no merge base" };
  if (baseRef) {
    const log = tryGit(repo, `git log --format=%s ${baseRef}..HEAD`);
    if (log.ok) {
      const subjects = log.out.split("\n").map((s) => s.trim())
        .filter((s) => s && !/^(Merge |Nudge CI\b)/.test(s)); // merge commits + CI nudges announce nothing
      announce = announceVerdict({
        subjects,
        filed: { B: localIds(repo, B_FILES, "B"), V: localIds(repo, V_FILES, "V") },
      });
    }
  }

  return { ok: families.every((f) => f.ok) && announce.ok, families, announce, branch, sha: fresh.sha, peersScanned: refs.length, baseRef };
}

// ---- CLI -------------------------------------------------------------------------------
function main(argv) {
  const ci = argv.includes("--ci");
  const json = argv.includes("--json");
  // `--repo=<path>` runs the gate against ANOTHER checkout. Its only caller is the end-to-end
  // self-test (NEW-2, `test/mintGateE2E.test.js`), which builds throwaway repos with real git refs
  // and asserts this CLI's exit codes and wording — the half `test/mintGuard.test.js` cannot reach
  // because it is pure. Without it the rejection path could only ever be proven by an organic
  // collision in the field, which is what B779 already tried and lost a second time.
  const repoFlag = argv.find((a) => a.startsWith("--repo="));
  const repo = repoFlag ? resolve(repoFlag.split("=")[1]) : REPO;
  const res = runGate(repo, {
    peerDays: Number((argv.find((a) => a.startsWith("--peer-days=")) || "=" + DEFAULT_PEER_DAYS).split("=")[1]),
    fetch: !argv.includes("--no-fetch"),
  });

  if (json) process.stdout.write(JSON.stringify(res, (k, v) => (v instanceof Set ? [...v] : v)) + "\n");

  if (res.unverifiable) {
    const msg = `\n${ci ? "⚠" : "⛔"} MINT GATE UNVERIFIED: ${res.reason}\n` +
      `   The gate could not prove this branch's new backlog ids are unclaimed.\n` +
      `   ${ci ? "Not failing the build on an infrastructure problem — but this PR is UNGUARDED (B779).\n" : "Fix the git/network problem, or push with --no-verify if you accept the collision risk.\n"}`;
    process.stderr.write(msg);
    return ci ? 0 : 2;
  }
  if (res.ok) {
    if (!json) {
      const added = res.families.flatMap((f) => f.added.map((n) => `${f.letter}${n}`));
      process.stdout.write(
        `✅ Mint gate: ${added.length ? added.join(", ") + " " + (added.length > 1 ? "are" : "is") : "no new ids —"} unclaimed on origin/main ` +
          `(${res.sha.slice(0, 7)}) and on ${res.peersScanned} in-flight branches.\n` +
          (res.baseRef ? "" : "⚠ merge base unavailable — checked against main's tip only, which cannot see a number main took while this branch was in flight.\n"),
      );
    }
    return 0;
  }

  if (res.announce && !res.announce.ok) {
    const lines = [
      `\n⛔ MINT GATE FAILED — a commit subject ANNOUNCES a backlog id this branch never filed (NEW-H).\n`,
      `   This is the #865/#866 defect: both PRs announced "B1144 / B1145 / B1146 — V531" in their\n`,
      `   titles. The FILES were fine — #866's ids were correctly renumbered to B1151–B1153 / V534\n`,
      `   before it merged — but the subject was written before the renumber and never updated, so\n`,
      `   main carries two commits claiming the same numbers for different features.\n\n`,
    ];
    for (const o of res.announce.offenders) {
      lines.push(`   ${o.id} is named in a commit subject but has no "### ${o.id}" heading in this branch:\n`);
      lines.push(`     "${o.subject.length > 96 ? o.subject.slice(0, 93) + "…" : o.subject}"\n`);
    }
    lines.push(`\n   → amend the subject to the ids you actually filed (and the PR title with it).\n`,
      `     git commit --amend   ·   git rebase -i is unavailable here, so squash before amending.\n\n`);
    process.stderr.write(lines.join(""));
    if (res.families.every((f) => f.ok)) return 1;
  }

  const lines = [`\n⛔ MINT GATE FAILED — this branch claims backlog ids someone else already holds (B779).\n`];
  for (const f of res.families) {
    if (f.ok) continue;
    for (const o of f.offenders) {
      lines.push(o.kind === "taken"
        ? `   ${o.id} is ALREADY TAKEN on ${o.where}.\n`
        : `   ${o.id} is at or below ${o.where} — minted against a stale view; the next merge will take it.\n`);
    }
    lines.push(`   → renumber this branch's new ${f.letter}# ids starting at ${f.letter}${f.nextFree} ` +
      `(gaps are free — leaving one is cheaper than a second renumber pass).\n`);
  }
  lines.push(`\n   Only the BACKLOG/VERIFICATION heading lines carry the real number — code, tests and\n` +
    `   commits keep the provisional NEW-# label, so this is a few-line text edit, not a rebuild.\n` +
    `   Re-mint with: git fetch origin main && npm run next-id -- --against-main\n\n`);
  process.stderr.write(lines.join(""));
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}

export { PEER_NS };
