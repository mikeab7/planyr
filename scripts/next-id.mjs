#!/usr/bin/env node
/*
 * next-id.mjs — print the next free backlog B# and verification V#, instantly, from the shell (B755).
 *
 * WHY THIS EXISTS: minting a new B# means "highest B# across BOTH BACKLOG.md (464 KB) and the
 * write-only BACKLOG-DONE.md (1.4 MB) + 1", and a new V# the same across VERIFICATION*.md. Every
 * session was doing that by reading those giant files INTO MODEL CONTEXT to eyeball the max — the
 * single biggest avoidable token burn in this repo, and the recurring "which number do we ship/merge
 * with?" tax. BACKLOG_OPEN.md didn't fix it: it lists only Open + Verify items, so the true max —
 * which routinely sits on a *Done* item in the archive — isn't even in it, and it's grouped by theme,
 * not sorted by number. This script computes the answer on disk with ZERO model tokens: one command,
 * one line of output.
 *
 *   node scripts/next-id.mjs           → human-friendly:  "Next free → B755 · V268"
 *   node scripts/next-id.mjs --json     → { "nextB": 755, "nextV": 268, "maxB": 754, "maxV": 267 }
 *   node scripts/next-id.mjs --b         → just "B755"   (paste-ready label to mint from)
 *   node scripts/next-id.mjs --v         → just "V268"
 *
 * HOUSE RULES (mirrors build-backlog-index.mjs): dependency-free (Node fs + regex), deterministic
 * (no volatile date/random), exports the pure fns the unit test imports; runnable standalone.
 *
 * WHY THIS PARSE IS SAFE: we take the max only over the two CURATED, authoritative forms an assigned
 * id ever appears in — a `### B123` heading (every real item has exactly one) and a `**B123**` bold
 * mint — including range forms (`### B300–B302`, `**B378–B379**`). We deliberately do NOT scan every
 * inline "B12" prose mention: those are only *re-mentions* of already-counted items, so ignoring them
 * can never UNDER-count (reuse a live number, the one dangerous error), while it makes us immune to a
 * stray prose typo like "B99999" permanently inflating every future id.
 */
import { readFileSync, existsSync, statSync, writeFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { ringFloor, nextFreeBlock } from "./idBlocks.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

// The files each id family lives across. Open + write-only Done archive both hold `### <letter>###`
// headings for every id ever assigned, so the union's max is the true max.
export const B_FILES = ["BACKLOG.md", "BACKLOG-DONE.md"];
export const V_FILES = ["VERIFICATION.md", "VERIFICATION-DONE.md"];
// The LIVE (active) surfaces — where a fresh concurrent-mint collision between two currently-worked
// items shows up, and where the uniqueness guard is enforced. The write-only *-DONE.md archives are
// excluded on purpose: they carry ~50 historical cross-file collisions (e.g. B755, V275) + benign
// same-item re-listings that predate this guard and can't be safely renumbered in-place; `--against-main`
// prevents minting OVER an archived id in the first place, and the full-pair audit stays available via
// findDuplicateIds(REPO, B_FILES, "B") for a future archive cleanup. (B779.)
export const LIVE_B_FILES = ["BACKLOG.md"];
export const LIVE_V_FILES = ["VERIFICATION.md"];

/**
 * Highest assigned id of a family (`letter` = "B" or "V") in `text`.
 * Scans `### <L>123` headings and `**<L>123**` bold mints, both with optional range ends
 * (`123–125` / `123-B125`). Returns 0 when none present.
 */
export function maxId(text, letter) {
  let max = 0;
  const consider = (s) => {
    const n = parseInt(s, 10);
    if (Number.isFinite(n) && n > max) max = n;
  };
  const patterns = [
    // heading:  ^### B123   or   ^### B300–B302 / ^### B300-302
    new RegExp(`^###\\s+${letter}(\\d+)(?:\\s*[–—-]\\s*${letter}?(\\d+))?`, "gm"),
    // bold mint: **B123**   or   **B378–B379**
    new RegExp(`\\*\\*${letter}(\\d+)(?:\\s*[–—-]\\s*${letter}?(\\d+))?\\*\\*`, "g"),
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      consider(m[1]);
      if (m[2]) consider(m[2]);
    }
  }
  return max;
}

/** Max id of a family across several repo-relative files (missing files are skipped). */
export function maxAcross(repo, files, letter) {
  let max = 0;
  for (const f of files) {
    const p = join(repo, f);
    if (!existsSync(p)) continue;
    const m = maxId(readFileSync(p, "utf8"), letter);
    if (m > max) max = m;
  }
  return max;
}

/** The whole answer: current maxes + the next free number for each family. */
export function computeNextIds(repo = REPO) {
  const maxB = maxAcross(repo, B_FILES, "B");
  const maxV = maxAcross(repo, V_FILES, "V");
  return { maxB, maxV, nextB: maxB + 1, nextV: maxV + 1 };
}

/* --- Collision guard (B779): every assigned id has EXACTLY ONE `### <L>###` heading across its
 * file pair. A second heading for the same id = a concurrent-mint collision that slipped through
 * (two branches minted it before either merged). Count each heading's PRIMARY id (its first number,
 * so range headings like `### B300–B302` count once, at 300) and flag any id seen more than once.
 * Pure over the given text set → the CI uniqueness test imports it. Returns [{id, count}] sorted. */
export function findDuplicateIdsIn(texts, letter) {
  const counts = new Map();
  const re = new RegExp(`^###\\s+${letter}(\\d+)\\b`, "gm");
  for (const text of texts) {
    for (const m of (text || "").matchAll(re)) {
      const id = `${letter}${m[1]}`;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
  }
  return [...counts.entries()].filter(([, n]) => n > 1)
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
}

/** findDuplicateIdsIn over the on-disk file pair for a family (missing files skipped). */
export function findDuplicateIds(repo, files, letter) {
  const texts = files.map((f) => join(repo, f)).filter(existsSync).map((p) => readFileSync(p, "utf8"));
  return findDuplicateIdsIn(texts, letter);
}

/* Known-legacy collision baseline (B780, audited 2026-07-11): every id below is ALREADY assigned to
 * two (B445/V45: three) DIFFERENT features across the live+archive pair — historical concurrent-mint
 * collisions that merged silently before the uniqueness guard existed. They are GRANDFATHERED, not
 * approved: renumbering them now would break scattered cross-references in the write-only archives,
 * `--against-main` prevents minting over them, and the ids never drive runtime behavior (comments/
 * provenance only). The cross-file guard (test/idUniqueness.test.js) allows AT MOST these, at AT MOST
 * these counts — any id newly collided, or any listed id collided one more time, fails the build.
 * Shrinking is welcome (fix a legacy dup → delete its row here in the same commit). */
export const KNOWN_LEGACY_ID_COLLISIONS = {
  B: { B127: 2, B128: 2, B131: 2, B147: 2, B151: 2, B180: 2, B181: 2, B182: 2, B183: 2, B239: 2, B316: 2, B341: 2, B343: 2, B348: 2, B350: 2, B360: 2, B364: 2, B417: 2, B418: 2, B445: 3, B471: 2, B485: 2, B489: 2, B495: 2, B562: 2, B566: 2, B568: 2, B569: 2, B590: 2, B594: 2, B597: 2, B664: 2, B682: 2, B717: 2, B737: 2, B755: 2, B757: 2 },
  V: { V24: 2, V25: 2, V39: 2, V40: 2, V45: 3, V92: 2, V99: 2, V100: 2, V119: 2, V120: 2, V122: 2, V123: 2, V130: 2, V131: 2, V132: 2, V136: 2, V137: 2, V152: 2, V154: 2, V173: 2, V275: 2 },
};

/* Cross-file collision check for a family: duplicates across the FULL live+archive pair that are NOT
 * covered by the grandfathered baseline (unknown id, or a known id at a higher count). This is the
 * detector for the race the live-only guard can't see — session A ships + ARCHIVES its item while
 * session B's same-numbered item stays open, so the two headings land in different files. Pure. */
export function newCrossFileCollisions(repo, files, letter, baseline = KNOWN_LEGACY_ID_COLLISIONS[letter] || {}) {
  return findDuplicateIds(repo, files, letter).filter(({ id, count }) => count > (baseline[id] || 1));
}

/* ============================================================================================
 * B779 — WHY THIS SECTION WAS REWRITTEN. B779 shipped `--against-main` + the late-bind rule and
 * claimed it "collapses the collision window from a whole session to a few seconds." Six
 * consecutive dispatches collided anyway (B1030/B1031 · B1032/B1036 · B1081/B1082 · B1093/B1094 ·
 * B1095/B1096 · B1130–B1132 vs B1140–B1143). The audit found three defects, none of them in the
 * uniqueness guard (which fired RED pre-merge every time, exactly as designed):
 *
 *   1. WRONG WINDOW. Late-binding closes `mint → push`. The collisions happen in `push → merge`
 *      — PR open, CI nudge (often two), build, auto-merge — minutes to hours, during which other
 *      sessions' PRs merge. B1140's own note records the mint being late-bound with
 *      `--against-main` and main STILL taking B1130/B1131 and B1132 while the PR was in flight.
 *      Minting later cannot close a window that opens after the mint.
 *   2. NO PEER VISIBILITY. `--against-main` reads exactly one ref. Two branches in flight are
 *      invisible to each other until one merges — the structural cause of all six. Fixed by
 *      `peerClaims()`: the ids other in-flight branches have already claimed are readable from
 *      the remote RIGHT NOW, no bot and no merge required.
 *   3. UNANNOUNCED STALENESS. `git show origin/main:…` reads the local remote-tracking ref, which
 *      is only as fresh as the last fetch — and nothing verified a fetch had happened. Measured in
 *      this very repo 2026-07-30: `origin/main` sat 7 days / 169 ids behind (maxB 974 vs 1143)
 *      while the banner still read "[incl. origin/main]". Plus the B898 shape survived in two more
 *      swallowed paths (missing ref, git-not-found), each degrading to the local-only max silently.
 *
 * So `--against-main` is now STRICT: it proves freshness, folds in peer branches, and REFUSES
 * (exit 2) rather than return a plausible-but-stale number. No path returns a number it can't
 * stand behind. The B779/B780 uniqueness guards are deliberately UNTOUCHED — they are the
 * backstop, and they work.
 * ========================================================================================== */

/** execSync buffer for every git read. Well above BACKLOG-DONE.md (1.4 MB and growing): the
 * default 1 MB is what threw ENOBUFS in B898, and the swallowed throw degraded `--against-main`
 * to a stale local-only max that read exactly like success. Exported so the regression test can
 * assert the real value instead of scraping the source. */
export const GIT_MAX_BUFFER = 64 * 1024 * 1024;
const git = (repo, cmd, maxBuffer = GIT_MAX_BUFFER) =>
  execSync(cmd, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer });

/** A git call that reports failure instead of throwing. Never swallows: `ok:false` carries why. */
export function tryGit(repo, cmd) {
  try { return { ok: true, out: git(repo, cmd) }; }
  catch (e) { return { ok: false, reason: `${e.code || "failed"}: ${String(e.stderr || e.message || "").trim().split("\n")[0]}` }; }
}

/* ---- freshness: is the ref we are about to trust actually current? -------------------- */

/** How stale `--against-main` may be before it refuses. A mint should immediately precede a push,
 * so five minutes is already generous; `--max-age=N` overrides for an unusual workflow. */
export const DEFAULT_MAX_FETCH_AGE_S = 300;
/** How far back a peer branch stays "in flight". A PR's open→merge life here is hours, not days. */
export const DEFAULT_PEER_DAYS = 3;
/** Peer branch tips land in their own ref namespace so `refs/remotes/origin/*` is never disturbed. */
export const PEER_NS = "refs/remotes/planyr-peers";

/** Seconds since this repo last fetched (FETCH_HEAD mtime — every `git fetch` rewrites it), or
 * null if it has never fetched. Impure by nature; the verdict it feeds is pure. */
export function lastFetchAgeSeconds(repo, now = Date.now()) {
  const p = tryGit(repo, "git rev-parse --git-path FETCH_HEAD");
  if (!p.ok) return null;
  const abs = resolve(repo, p.out.trim());
  if (!existsSync(abs)) return null;
  return Math.max(0, Math.round((now - statSync(abs).mtimeMs) / 1000));
}

/** The commit `origin/main` currently points at locally, or null if the ref doesn't exist. */
export function originMainSha(repo) {
  const r = tryGit(repo, "git rev-parse --verify --quiet refs/remotes/origin/main");
  return r.ok && r.out.trim() ? r.out.trim() : null;
}

/** PURE verdict on whether origin/main may be trusted. `ok:false` means REFUSE — never warn-and-
 * continue, because a stale ref silently degrades `--against-main` to the local-only max, which is
 * indistinguishable from success (defect 3 above). */
export function assessFreshness({ sha, ageSeconds, maxAgeSeconds = DEFAULT_MAX_FETCH_AGE_S }) {
  const fix = "run `git fetch origin main` and re-run";
  if (!sha) return { ok: false, code: "no-ref", message: `refs/remotes/origin/main does not exist in this clone — ${fix}.` };
  if (ageSeconds == null) return { ok: false, code: "never-fetched", message: `this clone has never fetched (no FETCH_HEAD) — ${fix}.` };
  if (ageSeconds > maxAgeSeconds)
    return { ok: false, code: "stale", message: `last fetch was ${ageSeconds}s ago, older than the ${maxAgeSeconds}s freshness limit — ${fix}.` };
  return { ok: true, code: "fresh", sha, ageSeconds, message: `origin/main ${sha.slice(0, 7)}, fetched ${ageSeconds}s ago` };
}

/* ---- reading ids out of a git ref ----------------------------------------------------- */

/** Read `<ref>:<file>`. A file genuinely absent from that commit is fine (empty text). ANY other
 * failure — ENOBUFS, no such ref, git missing — is reported as `ok:false` so the caller refuses.
 * This is the B898 lesson generalised: the only tolerated "empty" is one we can explain. */
export function readRefFile(repo, ref, file) {
  const r = tryGit(repo, `git show ${ref}:${file}`);
  if (r.ok) return { ok: true, text: r.out };
  // git's two ways of saying "that ref is fine, the FILE just isn't in it" — the only tolerated empty.
  if (/path '[^']*' (does not exist|exists on disk, but not) in/i.test(r.reason))
    return { ok: true, text: "", absent: true };
  return { ok: false, reason: `${ref}:${file} — ${r.reason}` };
}

/** Max id of a family across a ref's copies of `files`. `ok:false` on any unexplained read. */
export function maxOnRef(repo, ref, files, letter) {
  let max = 0;
  for (const f of files) {
    const r = readRefFile(repo, ref, f);
    if (!r.ok) return r;
    const m = maxId(r.text, letter);
    if (m > max) max = m;
  }
  return { ok: true, max };
}

/** Every id of a family that has a `### <L>###` heading in `texts`, as a Set of numbers. */
export function headingIdsIn(texts, letter) {
  const re = new RegExp(`^###\\s+${letter}(\\d+)\\b`, "gm");
  const out = new Set();
  for (const t of texts) for (const m of (t || "").matchAll(re)) out.add(Number(m[1]));
  return out;
}

/* ---- peer branches: the ids already claimed by other sessions still in flight ---------- */

/** Mirror every remote head into PEER_NS. This is the one network call, and it is the whole fix
 * for defect 2: the ids other sessions have claimed but not yet merged are sitting on the remote,
 * readable now. `--depth=1` only when the clone is already shallow (deepening a shallow clone is
 * expensive; marking a full clone shallow is rude). */
export function fetchPeers(repo, { exclude = [] } = {}) {
  const shallow = tryGit(repo, "git rev-parse --is-shallow-repository").out?.trim() === "true";
  // `--depth=1` keeps the mirror cheap, but in a shallow clone it GRAFTS every tip it fetches into
  // .git/shallow — and one of those tips is OUR OWN branch, which makes git treat our own HEAD as
  // parentless and severs `git merge-base` (observed on this very branch: the gate then lost the
  // merge base it needs for the B1140 case, and `git log` went one commit deep). Two defences:
  //   (1) negative refspecs so main and this checkout's own branch are never mirrored at all, and
  //   (2) a snapshot/restore of .git/shallow, so whatever grafts the fetch adds are undone and the
  //       clone is left byte-identical to how we found it. A tool that inspects the repo must not
  //       damage it.
  const neg = ["main", ...exclude].filter(Boolean).map((b) => ` "^refs/heads/${b}"`).join("");
  const shallowPath = tryGit(repo, "git rev-parse --git-path shallow");
  const file = shallowPath.ok ? resolve(repo, shallowPath.out.trim()) : null;
  const before = file && existsSync(file) ? readFileSync(file) : null;
  const restore = () => {
    if (!file) return;
    if (before == null) { if (existsSync(file)) rmSync(file, { force: true }); }
    else writeFileSync(file, before);
  };
  const r = tryGit(repo, `git fetch --no-tags --prune --quiet${shallow ? " --depth=1" : ""} origin "+refs/heads/*:${PEER_NS}/*"${neg}`);
  if (!r.ok) { restore(); return { ok: false, reason: `peer fetch failed — ${r.reason}`, restore: () => {} }; }
  return { ok: true, restore };
}

/** PURE: which mirrored refs count as "in flight" — recent enough to still be racing us, and not
 * our own branch or main. An abandoned branch ageing out only ever LOWERS the claimed max back
 * toward main's, and a stale claim just leaves a numbering gap, which costs nothing (B1140). */
export function selectPeerRefs(rows, { days = DEFAULT_PEER_DAYS, now = Date.now(), exclude = [] } = {}) {
  const cutoff = now / 1000 - days * 86400;
  const skip = new Set(["main", ...exclude].map((b) => `${PEER_NS.split("/").pop()}/${b}`));
  return rows.filter((r) => r.ts >= cutoff && !skip.has(r.name));
}

/**
 * Every name this checkout might be known by, so a peer scan never mistakes US for a rival.
 * `git rev-parse --abbrev-ref HEAD` alone is NOT enough: on a `pull_request` build,
 * actions/checkout lands on the test-merge commit in DETACHED HEAD, so it returns the literal
 * string "HEAD" and the branch's own mirrored ref reads as a peer holding our number. That false
 * red is exactly the failure mode a mint gate must not have — a gate that cries wolf gets
 * bypassed. GITHUB_HEAD_REF (PR builds) / GITHUB_REF_NAME (push builds) name it correctly there.
 */
export function selfBranchNames(repo, env = process.env) {
  const names = new Set();
  for (const n of [env.GITHUB_HEAD_REF, env.GITHUB_REF_NAME]) if (n) names.add(n);
  const local = (tryGit(repo, "git rev-parse --abbrev-ref HEAD").out || "").trim();
  if (local && local !== "HEAD") names.add(local);
  return [...names];
}

/** Drop peer refs already CONTAINED in HEAD — an older push of this same branch, or anything
 * merged into us. Name-independent, so it catches the detached-HEAD case even if the env vars are
 * absent. Ancestry is unavailable in some shallow clones; there the name filter carries it. */
export function dropContainedRefs(repo, refs) {
  return refs.filter((r) => !tryGit(repo, `git merge-base --is-ancestor ${r.name} HEAD`).ok);
}

/** The mirrored peer refs with their tip dates. */
export function peerRefRows(repo) {
  const r = tryGit(repo, `git for-each-ref "--format=%(refname:short)%09%(committerdate:unix)" ${PEER_NS}`);
  if (!r.ok) return { ok: false, reason: r.reason };
  const rows = r.out.trim().split("\n").filter(Boolean).map((l) => {
    const [name, ts] = l.split("\t");
    return { name, ts: Number(ts) };
  });
  return { ok: true, rows };
}

/** Blob sha per file at a ref — lets us skip re-reading a file a peer never touched, and cache by
 * content so the 1.4 MB archive is parsed once no matter how many peers share that blob. */
function blobShas(repo, ref, files) {
  const r = tryGit(repo, `git ls-tree ${ref} -- ${files.join(" ")}`);
  if (!r.ok) return { ok: false, reason: r.reason };
  const out = {};
  for (const line of r.out.trim().split("\n").filter(Boolean)) {
    const m = /^\d+\s+blob\s+(\S+)\t(.+)$/.exec(line);
    if (m) out[m[2]] = m[1];
  }
  return { ok: true, shas: out };
}

/**
 * What ids the in-flight peer branches have already claimed for a family.
 * Returns `{ ok, max, ids:Set, scanned, claimants:[{ref,max}] }` — `claimants` are the branches
 * that hold an id ABOVE main's max, i.e. the sessions we would have collided with.
 * Any unexplained read fails the whole scan (`ok:false`) rather than under-reporting the max,
 * because under-reporting is the one error that hands out a number someone else already has.
 */
export function peerClaims(repo, files, letter, { refs, baseRef = "refs/remotes/origin/main", baseMax = 0 } = {}) {
  const base = blobShas(repo, baseRef, files);
  if (!base.ok) return { ok: false, reason: `base blobs — ${base.reason}` };
  const byBlob = new Map();
  let max = 0; const ids = new Set(); const claimants = [];
  for (const ref of refs) {
    const b = blobShas(repo, ref.name, files);
    if (!b.ok) return { ok: false, reason: `${ref.name} — ${b.reason}` };
    let refMax = 0;
    for (const [file, sha] of Object.entries(b.shas)) {
      if (base.shas[file] === sha) continue; // untouched by this peer — nothing new can be in it
      if (!byBlob.has(sha)) {
        const r = tryGit(repo, `git cat-file blob ${sha}`);
        if (!r.ok) return { ok: false, reason: `${ref.name}:${file} — ${r.reason}` };
        byBlob.set(sha, { max: maxId(r.out, letter), ids: headingIdsIn([r.out], letter) });
      }
      const got = byBlob.get(sha);
      if (got.max > refMax) refMax = got.max;
      for (const n of got.ids) if (n > baseMax) ids.add(n);
    }
    if (refMax > max) max = refMax;
    if (refMax > baseMax) claimants.push({ ref: ref.name, max: refMax });
  }
  claimants.sort((a, b) => b.max - a.max);
  return { ok: true, max, ids, scanned: refs.length, claimants };
}

/* ---- the composed answer --------------------------------------------------------------- */

/**
 * The ship-time mint: local ∪ origin/main ∪ every in-flight peer branch, with freshness PROVEN.
 * `{ ok:false, refusal }` when anything cannot be verified — the caller must not print a number.
 */
export function computeNextIdsStrict(repo = REPO, {
  maxAgeSeconds = DEFAULT_MAX_FETCH_AGE_S, peers = true, peerDays = DEFAULT_PEER_DAYS,
  now = Date.now(), currentBranch = null, fetch = true,
} = {}) {
  const fresh = assessFreshness({ sha: originMainSha(repo), ageSeconds: lastFetchAgeSeconds(repo, now), maxAgeSeconds });
  if (!fresh.ok) return { ok: false, refusal: fresh };

  const provenance = { sha: fresh.sha, fetchedSecondsAgo: fresh.ageSeconds, peers: null };
  const out = {};
  for (const [letter, files] of [["B", B_FILES], ["V", V_FILES]]) {
    const local = maxAcross(repo, files, letter);
    const onMain = maxOnRef(repo, "refs/remotes/origin/main", files, letter);
    if (!onMain.ok) return { ok: false, refusal: { code: "read-failed", message: onMain.reason } };
    out[letter] = { max: Math.max(local, onMain.max), local, main: onMain.max, peer: 0, claimants: [] };
  }

  let releasePeers = () => {};
  if (peers) {
    if (fetch) {
      const f = fetchPeers(repo, { exclude: currentBranch ? [currentBranch] : selfBranchNames(repo) });
      if (!f.ok) return { ok: false, refusal: { code: "peer-fetch-failed", message: f.reason } };
      releasePeers = f.restore;
    }
    const rows = peerRefRows(repo);
    if (!rows.ok) return { ok: false, refusal: { code: "peer-list-failed", message: rows.reason } };
    const exclude = currentBranch ? [currentBranch] : selfBranchNames(repo);
    const refs = dropContainedRefs(repo, selectPeerRefs(rows.rows, { days: peerDays, now, exclude }));
    for (const [letter, files] of [["B", B_FILES], ["V", V_FILES]]) {
      const c = peerClaims(repo, files, letter, { refs, baseMax: out[letter].main });
      if (!c.ok) return { ok: false, refusal: { code: "peer-read-failed", message: c.reason } };
      out[letter].peer = c.max;
      out[letter].claimants = c.claimants;
      out[letter].peerIds = c.ids;
      if (c.max > out[letter].max) out[letter].max = c.max;
    }
    provenance.peers = { scanned: refs.length, windowDays: peerDays };
    releasePeers(); // leave .git/shallow exactly as we found it
  }

  const maxB = out.B.max, maxV = out.V.max;

  // NEW-3 — hand out ids from THIS BRANCH'S RESERVED BLOCK rather than from `max + 1`.
  //
  // `max + 1` is what made two concurrent sessions collide: both fetch the same fresh main, both
  // compute the same maximum, both are handed the same number. Reproduced in a two-clone lab and
  // recorded in CLAUDE.md. A block is a pure function of the branch name, so the same view of the
  // world now yields DIFFERENT numbers to different branches — the collision cannot form.
  //
  // `nextB`/`nextV` (the `max + 1` answer) are preserved for callers and tests that predate this,
  // and because they remain the honest "highest assigned" report. `blockB`/`blockV` are what a
  // session should mint from.
  const branch = currentBranch || selfBranchNames(repo)[0] || "";
  const blocks = {};
  for (const [letter, key] of [["B", "B"], ["V", "V"]]) {
    const claimed = new Set([
      ...(out[key].peerIds || []),
      ...Array.from({ length: out[key].main }, (_, i) => i + 1), // everything at or below main's max
    ]);
    blocks[letter] = nextFreeBlock(branch, { floor: ringFloor(out[key].main), claimed });
  }

  return {
    ok: true, maxB, maxV, nextB: maxB + 1, nextV: maxV + 1, provenance, detail: out,
    branch, blockB: blocks.B, blockV: blocks.V,
  };
}

/* Kept for callers/tests that predate the strict path (B779 shape): local ∪ origin/main only, and
 * it now REPORTS rather than swallows a failed read. Prefer computeNextIdsStrict. */
export function maxAgainstMain(repo, files, letter) {
  const local = maxAcross(repo, files, letter);
  const r = maxOnRef(repo, "refs/remotes/origin/main", files, letter);
  return r.ok ? Math.max(local, r.max) : local;
}

// ---- CLI -------------------------------------------------------------------------------
const flagNum = (argv, name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split("=")[1]) : dflt;
};

export function main(argv, io = { out: process.stdout, err: process.stderr }) {
  // `--against-main` (B779, hardened B779): the ship-time mint. Folds in origin/main AND every
  // in-flight peer branch, after PROVING origin/main was just fetched. Refuses rather than guess.
  // Default (no flag) stays the cheap local-only read for orientation, and says so.
  const againstMain = argv.includes("--against-main");
  const json = argv.includes("--json");
  let res;
  if (againstMain) {
    res = computeNextIdsStrict(REPO, {
      maxAgeSeconds: flagNum(argv, "max-age", DEFAULT_MAX_FETCH_AGE_S),
      peerDays: flagNum(argv, "peer-days", DEFAULT_PEER_DAYS),
      peers: !argv.includes("--no-peers"),
    });
    if (!res.ok) {
      io.err.write(
        `\n⛔ next-id --against-main REFUSED (${res.refusal.code}): ${res.refusal.message}\n` +
          `   No number printed on purpose. A stale answer here is how B1030…B1143 collided —\n` +
          `   it looks exactly like a correct one. (B779)\n\n`,
      );
      if (json) io.out.write(JSON.stringify({ ok: false, refusal: res.refusal }) + "\n");
      return 2;
    }
  } else {
    res = { ok: true, ...computeNextIds() };
  }
  const { nextB, nextV, maxB, maxV } = res;

  // NEW-3 — mint from THIS BRANCH'S BLOCK when we have one (only `--against-main` reads the peer
  // set needed to compute it). `max + 1` is what handed two concurrent sessions the same number.
  const mintB = res.blockB ? res.blockB.lo : nextB;
  const mintV = res.blockV ? res.blockV.lo : nextV;

  if (json) {
    io.out.write(JSON.stringify({
      ok: true, nextB, nextV, maxB, maxV, mintB, mintV,
      block: res.blockB ? { B: res.blockB, V: res.blockV, branch: res.branch } : null,
      againstMain, provenance: res.provenance ?? null,
      claimants: res.detail ? { B: res.detail.B.claimants, V: res.detail.V.claimants } : null,
    }) + "\n");
    return 0;
  }
  if (argv.includes("--b")) { io.out.write(`B${mintB}\n`); return 0; }
  if (argv.includes("--v")) { io.out.write(`V${mintV}\n`); return 0; }

  let banner = "";
  if (againstMain) {
    const p = res.provenance;
    banner = `  [origin/main ${p.sha.slice(0, 7)}, fetched ${p.fetchedSecondsAgo}s ago` +
      (p.peers ? ` · ${p.peers.scanned} in-flight branches` : ` · PEERS NOT SCANNED`) + `]`;
  }
  if (res.blockB) {
    io.out.write(
      `Your block → B${res.blockB.lo}–B${res.blockB.hi} · V${res.blockV.lo}–V${res.blockV.hi}` +
        `   (branch ${res.branch})${banner}\n` +
        `Mint from B${mintB} · V${mintV}, running consecutively (e.g. B${mintB}, B${mintB + 1}). ` +
        `Highest assigned anywhere: B${maxB} / V${maxV}.\n` +
        `This block is yours alone — reserved by branch name, so a session minting at the same moment\n` +
        `cannot draw the same number. Stay inside it and you will never need to renumber (NEW-3).\n`,
    );
  } else {
    io.out.write(
      `Next free → B${nextB} · V${nextV}   (highest assigned: B${maxB} / V${maxV})${banner}\n` +
        `Mint from here. Multi-mint runs consecutively (e.g. B${nextB}, B${nextB + 1}). ` +
        `Don't grep the archives — this is the whole answer.\n`,
    );
  }
  // Name the sessions we just stepped around, so a collision that WAS about to happen is visible.
  for (const [letter, d] of Object.entries(res.detail || {})) {
    for (const c of d.claimants || [])
      io.out.write(`  · ${letter}${c.max} is already claimed on ${c.ref} (unmerged) — stepped over it.\n`);
  }
  if (againstMain && argv.includes("--no-peers"))
    io.err.write(`⚠ --no-peers: other in-flight branches were NOT consulted. This is the exact gap that caused B1030…B1143.\n`);
  if (!againstMain)
    io.err.write(`ℹ local-only read. Before you PUSH, re-mint with: git fetch origin main && npm run next-id -- --against-main\n`);

  // Loud heads-up if two ACTIVE items share an id (a fresh concurrent-mint collision) — the CI
  // uniqueness guard (test/idUniqueness.test.js) enforces the same on the live files. Scoped to the
  // live surfaces so it's actionable, not drowned by the historical archive collisions.
  const dupB = findDuplicateIds(REPO, LIVE_B_FILES, "B");
  const dupV = findDuplicateIds(REPO, LIVE_V_FILES, "V");
  if (dupB.length || dupV.length) {
    const fmt = (d) => d.map((x) => `${x.id}×${x.count}`).join(", ");
    io.err.write(`⚠ DUPLICATE ACTIVE ids — renumber before shipping: ${fmt([...dupB, ...dupV])}\n`);
  }
  return 0;
}

// Run only as a script, not when imported by the test.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
