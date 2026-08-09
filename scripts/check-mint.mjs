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
  headingIdsIn, headingLinesIn, sameHeading, readRefFile, maxOnRef, assessFreshness, originMainSha,
  lastFetchAgeSeconds, fetchPeers, peerRefRows, selectPeerRefs, peerClaims, tryGit, selfBranchNames,
  dropContainedRefs, newCrossFileCollisions,
} from "./next-id.mjs";
import { ringFloor, nextFreeBlock, inBlock } from "./idBlocks.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

/**
 * PURE verdict. `added` = ids this branch introduces; `claimedMax` = the highest id anyone else
 * holds (main ∪ peers); `peerIds` maps an id to the branch already holding it.
 *
 * ONE FATAL FAILURE, and two advisories — a distinction NEW-2 introduced after the old rule took the
 * whole repository down:
 *   - TAKEN (fatal): the exact id is already on **origin/main** → a guaranteed, present collision:
 *     two headings, one number, the moment this merges. This is the property the gate exists to
 *     enforce and it is unchanged.
 *   - PEER-HELD (advisory, B36051): an UNMERGED peer branch holds the id. Owner decision
 *     2026-08-06, verbatim — *"a number is taken only if main has it. A guess made from stale
 *     information about an unmerged branch is not a collision and must not fail a build."* That
 *     branch may be renumbered, rebased or abandoned; whoever merges SECOND renumbers. The blocks
 *     make an overlap rare in the first place.
 *   - OUTSIDE (advisory): the id is unclaimed, but sits outside this branch's reserved block
 *     (`scripts/idBlocks.mjs`). Worth saying — in-block minting is what keeps concurrent sessions
 *     from ever racing — but it is a hygiene signal, never a merge blocker.
 *
 * WHY THE OLD `BELOW` RULE IS GONE (NEW-1/NEW-2, 2026-08-06). It failed any id at or under
 * `claimedMax`, the highest id across main ∪ every in-flight peer branch, on the theory that such
 * an id "was minted against a stale view, so the next merge will very likely take it". That theory
 * is false in a sparse space, and the rule was a RATCHET: its only remedy was to renumber UPWARD,
 * which raised the mark for every other in-flight branch, which then had to renumber higher still.
 * On 2026-08-06 it produced a repo-wide merge outage — seven open PRs, none mergeable, one PR's ids
 * moved six times (B1467 → … → B9001), and the claimed mark reached B25005 against an origin/main
 * maximum of B1449. The rejection that started the cascade was:
 *
 *     B3005 is at or below the claimed high-water mark B25005 — minted against a stale view
 *
 * B3005 collided with nothing. And because every renumber is a DOCS-ONLY push, and a docs-only push
 * is exactly the push that fails to produce a `build` check run, each escape attempt left the
 * required check permanently "Expected — waiting for status to be reported" (see
 * `docs/CI-REQUIRED-CHECK.md`). The gate was not catching collisions; it was manufacturing them.
 *
 * The strength is not reduced — it is relocated. What was removed is a HEURISTIC that never proved
 * a collision; what remains fatal is TAKEN, backed by `test/idUniqueness.test.js`; and what is
 * added is a STRUCTURAL guarantee (disjoint per-branch blocks) that stops concurrent sessions
 * drawing the same number at all. `claimedMax`/`nextFree` are still computed and reported, because
 * they are useful context in a failure message — they simply no longer fail a build on their own.
 *
 * Gaps remain explicitly legal (B1140 established they cost nothing).
 */
export function mintVerdict({
  letter, added, claimedMax, peerOwners = new Map(), mainIds = new Set(), block = null,
  headingsHere = new Map(), headingsOnMain = new Map(),
}) {
  const offenders = [];   // fatal — a proven collision
  const advisories = [];  // reported, never fatal
  for (const n of [...added].sort((a, b) => a - b)) {
    if (mainIds.has(n)) {
      /* ⛔ AN ID ON MAIN IS NOT AUTOMATICALLY AN ID THIS BRANCH MINTED (B290251).
       *
       * `added` is measured against the MERGE BASE — deliberately, and that reasoning stays (see
       * the comment at its call site: it is what catches B1140, where main and a branch minted the
       * same number independently). But the base-relative set also contains every id that arrived
       * from MAIN ITSELF when a session followed CLAUDE.md's own instruction to merge `origin/main`
       * in to clear a `dirty` PR. Measured 2026-08-09 on the branch that filed this: base cf4f77b,
       * tip ae2ce02, ELEVEN fatal offenders — B280402, B280403, B280704–B280707, B286000, B286001,
       * V78961, V79264, V84560 — every one appearing exactly once on main, exactly once here, and
       * nowhere at the base. The gate was blocking the documented recovery path, and the obvious
       * escape (renumber) would have renumbered MAIN'S items on this branch, manufacturing the very
       * duplicate the gate exists to prevent.
       *
       * WHAT SEPARATES THE TWO CASES IS THE HEADING TEXT, not the ancestry. Reproduced in a
       * throwaway-repo lab (`test/mintGateE2E.test.js`, the merge-recovery arms): a plain
       * `git merge origin/main` moves the merge base to main's tip and never had this problem at
       * all; the failure shape is a resolution that takes main's CONTENT without its ANCESTRY —
       * `git merge --squash`, `git checkout origin/main -- BACKLOG.md`, a rebuilt branch. In that
       * shape the heading here is BYTE-IDENTICAL to main's, because it IS main's. In B1140's shape
       * the two headings name two different features, which is precisely the duplicate that will
       * exist the moment they meet.
       *
       * So: identical heading → this came from main, ADVISORY. Different heading, or more than one
       * heading here → FATAL, unchanged, and the message now prints both titles so the reader can
       * see at a glance which case they are in. The relaxation is covered rather than merely
       * argued: any id that really does end up with two headings in this tree is caught by the
       * duplicate-heading check below (B308704), which is fatal and runs on every push.
       */
      const here = headingsHere.get(n) || [];
      const there = headingsOnMain.get(n) || [];
      if (here.length === 1 && there.length === 1 && sameHeading(here[0], there[0])) {
        advisories.push({ id: `${letter}${n}`, kind: "from-main", where: "origin/main" });
      } else {
        offenders.push({ id: `${letter}${n}`, kind: "taken", where: "origin/main", here: here[0], there: there[0] });
      }
    }
    /* ⛔ A PEER BRANCH HOLDING THE NUMBER IS AN ADVISORY, NOT A FAILURE (B36051, owner decision
     * 2026-08-06, verbatim: *"a number is taken only if main has it. A guess made from stale
     * information about an unmerged branch is not a collision and must not fail a build."*).
     * The blocks below make an overlap rare; when one does happen the peer may still be
     * renumbered, rebased or abandoned, and whoever merges SECOND renumbers — so failing here
     * blocks a build on something that has taken nothing. Only `main` can actually take an id,
     * and that case above stays fatal, untouched. */
    else if (peerOwners.has(n)) advisories.push({ id: `${letter}${n}`, kind: "peer-held", where: peerOwners.get(n) });
    else if (block && !inBlock(n, block)) {
      advisories.push({ id: `${letter}${n}`, kind: "outside", where: `this branch's block ${letter}${block.lo}–${letter}${block.hi}` });
    }
  }
  return { ok: offenders.length === 0, letter, offenders, advisories, claimedMax, nextFree: claimedMax + 1, block };
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

/** Working-tree text of a family's file pair. */
function localTexts(repo, files) {
  return files.map((f) => join(repo, f)).filter(existsSync).map((p) => readFileSync(p, "utf8"));
}

/** Local (working-tree) heading ids for a family — what this branch actually says today. */
function localIds(repo, files, letter) {
  return headingIdsIn(localTexts(repo, files), letter);
}

/** Heading ids for a family on a ref (across the whole file pair), plus the heading LINES —
 *  the lines are what B290251's same-item test compares. */
function refIds(repo, ref, files, letter) {
  const texts = [];
  for (const f of files) {
    const r = readRefFile(repo, ref, f);
    if (!r.ok) return { ok: false, reason: r.reason };
    texts.push(r.text);
  }
  return { ok: true, ids: headingIdsIn(texts, letter), headings: headingLinesIn(texts, letter) };
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

    // This branch's RESERVED BLOCK (NEW-3) — a pure function of the branch name, anchored just
    // above main's maximum, stepping past any block a peer already occupies. Nothing is allocated
    // and nothing is stored, so there is no allocator to race and none to go down.
    const block = nextFreeBlock(branch, {
      floor: ringFloor(mainMax.max),
      claimed: new Set([...onMain.ids, ...owners.keys()]),
    });

    /* B308704 — TWO HEADINGS FOR ONE ID IN THIS TREE IS FATAL, whatever the merge base says.
     * This is the backstop that makes B290251's "identical heading came from main" relaxation
     * safe rather than merely reasoned: a genuine independent double-mint that gets merged
     * together produces two headings, and that is now caught HERE, at push time, instead of
     * only in CI. The 58 grandfathered historical pairs are excluded at their exact counts —
     * `newCrossFileCollisions` is the same detector `test/idUniqueness.test.js` runs. */
    const freshDupes = newCrossFileCollisions(repo, files, letter);

    families.push({
      ...mintVerdict({
        letter, added, claimedMax: Math.max(mainMax.max, claims.max), peerOwners: owners,
        mainIds: onMain.ids, block,
        headingsHere: headingLinesIn(localTexts(repo, files), letter),
        headingsOnMain: onMain.headings,
      }),
      added, mainMax: mainMax.max, peerMax: claims.max, peersScanned: refs.length,
      duplicates: freshDupes,
    });
  }
  for (const f of families) {
    for (const d of f.duplicates) {
      f.offenders.push({ id: d.id, kind: "duplicate", where: `this branch's ${f.letter === "B" ? "BACKLOG" : "VERIFICATION"} files (${d.count} headings)` });
    }
    f.ok = f.offenders.length === 0;
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
  // Out-of-block ids are REPORTED, never fatal (NEW-2). The seven PRs blocked on 2026-08-06 all
  // hold ad-hoc numbers minted under the old rule; failing them here would be one more renumber
  // round — the exact tax this change exists to end. Grandfathered, and said out loud.
  const advisories = res.families ? res.families.flatMap((f) => f.advisories || []) : [];
  if (advisories.length && !json) {
    const blocks = res.families.filter((f) => f.block).map((f) => `${f.letter}${f.block.lo}–${f.letter}${f.block.hi}`);
    const outside = advisories.filter((a) => a.kind === "outside");
    const peerHeld = advisories.filter((a) => a.kind === "peer-held");
    // B290251: said out loud rather than silently swallowed — the reader should be able to see
    // that the gate CONSIDERED these ids and knows exactly why they are not this branch's mints.
    const fromMain = advisories.filter((a) => a.kind === "from-main");
    if (fromMain.length) {
      process.stderr.write(
        `\nℹ Mint gate: ${fromMain.map((a) => a.id).join(", ")} came in FROM origin/main (identical heading), not minted here.\n` +
          `   NOT a failure — this is what merging main into a stale branch looks like. Renumbering these\n` +
          `   would rename MAIN's items on this branch and create the duplicate the gate exists to prevent.\n`,
      );
    }
    if (outside.length) {
      process.stderr.write(
        `\nℹ Mint gate: ${outside.map((a) => a.id).join(", ")} ${outside.length > 1 ? "sit" : "sits"} outside this branch's reserved block ` +
          `(${blocks.join(" · ")}).\n` +
          `   Unclaimed, so NOT a failure — in-block minting is what keeps two concurrent sessions from\n` +
          `   ever drawing the same number. Next session: npm run next-id -- --against-main hands out in-block ids.\n`,
      );
    }
    // B36051: a peer holding the number is worth NAMING and never worth failing — only main can take one.
    for (const a of peerHeld) {
      process.stderr.write(
        `\nℹ Mint gate: ${a.id} is also held by ${a.where} (unmerged).\n` +
          `   NOT a failure — that branch may be renumbered, rebased or abandoned, and whoever merges\n` +
          `   second renumbers. Only origin/main can actually take a number.\n`,
      );
    }
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
      if (o.kind === "duplicate") {
        // B308704 — not a mint race at all: this tree already holds the collision.
        lines.push(`   ${o.id} has TWO HEADINGS in ${o.where} — one number, two items.\n`);
        continue;
      }
      lines.push(`   ${o.id} is ALREADY TAKEN on ${o.where}.\n`);
      // B290251: print BOTH titles. If they turn out to be the same item the reader is looking at
      // a heading edit, not a collision — and that distinction used to cost a whole debugging pass.
      if (o.here || o.there) {
        lines.push(`     here: ${(o.here || "(no heading in this tree)").slice(0, 110)}\n`);
        lines.push(`     main: ${(o.there || "(no heading on main)").slice(0, 110)}\n`);
      }
    }
    // Point at this branch's own reserved block, not at a global high-water mark. Moving into
    // your block invalidates nobody else's ids — which is what stops a rejection cascading.
    lines.push(f.block
      ? `   → renumber this branch's new ${f.letter}# ids into its reserved block: ` +
        `${f.letter}${f.block.lo}–${f.letter}${f.block.hi} (gaps are free).\n`
      : `   → renumber this branch's new ${f.letter}# ids starting at ${f.letter}${f.nextFree} (gaps are free).\n`);
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
