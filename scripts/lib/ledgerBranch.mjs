/*
 * scripts/lib/ledgerBranch.mjs — read/write the ledger on its OWN git branch (NEW-1, 2026-11-05).
 *
 * OWNER DECISION 2026-11-05: the BACKLOG / VERIFICATION records move off `main` onto a branch with no
 * required checks. WHY: after every live check a session used to open a ledger-only PR and wait a full
 * build — burning session and watcher tokens and delaying the close of a task — for a change that can
 * break nothing. Product code, workflows and CLAUDE.md stay on main behind the build exactly as before;
 * this changes WHERE records live, not WHAT is recorded.
 *
 * MEASURED BEFORE BUILDING (2026-11-05, see the item): a plain `git push` of a non-`claude/` branch from
 * a Claude Code session lands; the only ruleset ("Protect Main") includes just ~DEFAULT_BRANCH, so the
 * branch is unprotected; a second fresh clone fetched it and pushed; a stale clone's push was refused
 * with "fetch first" and succeeded after fetch + retry.
 *
 * THE MODEL.
 *   - The branch is `ledger`. Its tree is `ledger/<kind>/<state>/<ID>.md` + `_frame.md` (exactly the
 *     layout scripts/lib/ledger.mjs always read) plus a README. It is parented on main's history, so
 *     `git log -- ledger/backlog/done/B123.md` still shows every entry's full history.
 *   - A code clone keeps a shallow checkout of it in `.ledger/` (gitignored). `ledgerRoot()` finds it.
 *   - EVERY WRITE IS A TRANSACTION (`ledgerTx`): fetch the tip → hard-reset the checkout to it → run the
 *     mutation → commit → push. If the push loses a race ("fetch first") the whole thing is REDONE from the
 *     new tip — not rebased — so anything computed from the tree (above all a freshly minted id) is
 *     recomputed against what is really there. That is the whole ID-uniqueness guarantee: the push itself is
 *     the compare-and-swap, so two sessions on two containers can never both land the same id.
 *   - Tools that used to gate ledger edits inside a PR (check-mint, the touch guard) stand down when
 *     `.github/ledger-branch.json` exists on main (`isBranchMode`).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, renameSync, statSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import {
  KINDS, LEDGER_DIR, LEDGER_BRANCH, LEDGER_CHECKOUT, ENTRY_FILE_RE, entryFileName, readLedgerDir,
} from "./ledger.mjs";

/** A problem the caller must fix — never retried. */
export class LedgerError extends Error {}

export const REJECT_RE = /\[rejected\]|fetch first|non-fast-forward|failed to update ref|cannot lock ref|stale info/i;

export function git(cwd, args, { input, env, check = true } = {}) {
  const r = spawnSync("git", args, {
    cwd, input, encoding: "utf8", maxBuffer: 1 << 29,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...(env || {}) },
  });
  if (check && r.status !== 0) {
    const e = new Error(`git ${args.join(" ")} failed (${r.status}): ${(r.stderr || r.stdout || "").trim()}`);
    e.status = r.status; e.stderr = r.stderr; e.stdout = r.stdout;
    throw e;
  }
  return r;
}

export const checkoutDir = (repo) => join(repo, LEDGER_CHECKOUT);

/** Where the ledger branch is fetched from: explicit > $PLANYR_LEDGER_REMOTE > this clone's origin. */
export function remoteOf(repo, explicit) {
  if (explicit) return explicit;
  if (process.env.PLANYR_LEDGER_REMOTE) return process.env.PLANYR_LEDGER_REMOTE;
  const r = git(repo, ["remote", "get-url", "origin"], { check: false });
  if (r.status !== 0 || !r.stdout.trim()) throw new LedgerError(`cannot find the ledger remote: ${repo} has no "origin" (set PLANYR_LEDGER_REMOTE)`);
  return r.stdout.trim();
}

export const sleepSync = (ms) => { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

function identityEnv(repo) {
  const get = (k) => (git(repo, ["config", "--get", k], { check: false }).stdout || "").trim();
  const name = process.env.GIT_AUTHOR_NAME || get("user.name") || "planyr-ledger";
  const email = process.env.GIT_AUTHOR_EMAIL || get("user.email") || "ledger@planyr.invalid";
  return { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email };
}

/**
 * Make `.ledger/` equal to the remote tip of the ledger branch. Shallow (depth 1): the branch is parented
 * on main's whole history, and a cold session must not pay for it. With `fetch:false` it only checks the
 * checkout exists. A failed fetch on an EXISTING checkout is reported (`stale: true`) rather than thrown,
 * so a read still works offline — a write never uses a stale tree (ledgerTx always demands a fresh one).
 */
export function syncCheckout(repo, { fetch = true, remote, allowStale = true } = {}) {
  const dir = checkoutDir(repo);
  const has = existsSync(join(dir, ".git"));
  if (!has) {
    if (!fetch) throw new LedgerError("no ledger checkout here — run: npm run ledger -- sync");
    const url = remoteOf(repo, remote);
    rmSync(dir, { recursive: true, force: true });
    const r = git(repo, ["clone", "--depth", "1", "--single-branch", "--branch", LEDGER_BRANCH, "--quiet", url, dir], { check: false });
    if (r.status !== 0) {
      throw new LedgerError(`could not clone the \`${LEDGER_BRANCH}\` branch from ${url}: ${(r.stderr || "").trim()}`);
    }
    return { dir, fetched: true, stale: false, sha: head(dir) };
  }
  if (!fetch) return { dir, fetched: false, stale: false, sha: head(dir) };
  const url = remoteOf(repo, remote);
  const f = git(dir, ["fetch", "--depth", "1", "--quiet", url, LEDGER_BRANCH], { check: false });
  if (f.status !== 0) {
    if (allowStale) return { dir, fetched: false, stale: true, sha: head(dir), error: (f.stderr || "").trim() };
    throw new LedgerError(`could not fetch the \`${LEDGER_BRANCH}\` branch: ${(f.stderr || "").trim()}`);
  }
  git(dir, ["reset", "--hard", "--quiet", "FETCH_HEAD"]);
  git(dir, ["clean", "-fdq"]);
  return { dir, fetched: true, stale: false, sha: head(dir) };
}
const head = (dir) => git(dir, ["rev-parse", "HEAD"]).stdout.trim();

const READ_TTL_MS = 10 * 60 * 1000;
/** A READ needs a ledger on disk: fetch it when absent, when `fresh`, or when the last fetch is over 10 minutes old.
 *  A failed refresh of an existing checkout warns and reads the copy it has (a write never does that). No-op for the
 *  in-tree layout and the ledger branch's own checkout. */
export function ensureLedger(repo, { fresh = false, warn = (m) => console.error(m), remote } = {}) {
  if (existsSync(join(repo, LEDGER_DIR, "backlog", "_frame.md"))) return null;
  const co = checkoutDir(repo);
  let age = Infinity;
  try { age = Date.now() - statSync(join(co, ".git", "FETCH_HEAD")).mtimeMs; } catch { /* never fetched */ }
  if (existsSync(join(co, ".git")) && !fresh && age <= READ_TTL_MS) return null;
  const r = syncCheckout(repo, { remote });
  if (r.stale) warn(`⚠ could not refresh the ledger (${r.error || "offline"}) — reading the copy already in ${LEDGER_CHECKOUT}/.`);
  return r;
}

/* ---------------------------------------------------------------------------------------------- *
 * IDs. The id of an entry IS its file name (`ledger check` enforces heading == file name), so the
 * highest assigned id is read from directory listings alone — no entry is opened, and the write-only
 * `done/` folders cost a readdir, not 2,800 file reads.
 * ---------------------------------------------------------------------------------------------- */
export function maxIds(dir) {
  const out = { B: 0, V: 0 };
  for (const [kind, k] of Object.entries(KINDS)) {
    for (const s of k.states) {
      const p = join(dir, LEDGER_DIR, kind, s);
      if (!existsSync(p)) continue;
      for (const f of readdirSync(p)) {
        const m = f.match(ENTRY_FILE_RE);
        if (m && m[1] === k.letter) out[k.letter] = Math.max(out[k.letter], Number(m[2]));
      }
    }
  }
  return out;
}

/** Every id that has an entry file anywhere in the ledger (names only — no file is opened). */
export function allIds(dir) {
  const ids = new Set();
  for (const [kind, k] of Object.entries(KINDS)) {
    for (const s of k.states) {
      const p = join(dir, LEDGER_DIR, kind, s);
      if (!existsSync(p)) continue;
      for (const f of readdirSync(p)) { const m = f.match(ENTRY_FILE_RE); if (m && m[1] === k.letter) ids.add(m[1] + m[2]); }
    }
  }
  return ids;
}

export function findEntryFiles(dir, id) {
  const kind = id[0] === "B" ? "backlog" : id[0] === "V" ? "verification" : null;
  if (!kind) return [];
  const hits = [];
  for (const s of KINDS[kind].states) {
    const p = join(dir, LEDGER_DIR, kind, s);
    if (!existsSync(p)) continue;
    for (const f of readdirSync(p)) {
      const m = f.match(ENTRY_FILE_RE);
      if (m && m[1] + m[2] === id) hits.push({ kind, state: s, file: `${LEDGER_DIR}/${kind}/${s}/${f}`, dup: m[3] ? Number(m[3]) : 1 });
    }
  }
  return hits;
}

const kindOfLetter = (l) => (l === "B" ? "backlog" : "verification");
const defaultState = (kind) => (kind === "backlog" ? "open" : "pending");

/** `### B123 — …` (a real id), or a placeholder (`### NEW-1 — …`, `### B? — …`, `### V? — …`). */
export function parseNewHeading(text, kind) {
  const first = text.split("\n", 1)[0];
  const letter = KINDS[kind].letter;
  let m = first.match(/^###\s+([BV])(\d+)\b(.*)$/);
  if (m) {
    if (m[1] !== letter) throw new LedgerError(`a ${kind} entry's heading must start with ${letter}, found ${m[1]}${m[2]}`);
    return { real: m[1] + m[2], rest: m[3], body: text.slice(first.length) };
  }
  m = first.match(/^###\s+(?:NEW-\d+|([BV])\?+|\?+)(.*)$/);
  if (m) {
    if (m[1] && m[1] !== letter) throw new LedgerError(`a ${kind} entry's heading must start with ${letter}, found ${m[1]}?`);
    return { real: null, rest: m[2], body: text.slice(first.length) };
  }
  throw new LedgerError(`first line must be a heading: "### ${letter}? — title" (or "### NEW-1 — title"); found: ${first.slice(0, 70)}`);
}

/**
 * Add ONE entry inside an open transaction directory. The id is assigned HERE, from the tree as it is
 * right now — so it is unique by construction and, because this runs again from a fresh tip after a lost
 * race, unique across containers too.
 */
export function addEntryTo(dir, { kind, state, text }) {
  const k = KINDS[kind];
  if (!k) throw new LedgerError(`kind must be one of: ${Object.keys(KINDS).join(", ")}`);
  state = state || defaultState(kind);
  if (!k.states.includes(state)) throw new LedgerError(`${kind} states: ${k.states.join(", ")}`);
  const h = parseNewHeading(text.replace(/^﻿/, ""), kind);
  let id = h.real;
  if (id) {
    if (findEntryFiles(dir, id).length) throw new LedgerError(`${id} already exists in the ledger — omit the number ("### ${k.letter}? — title") and one is assigned.`);
  } else {
    id = k.letter + (maxIds(dir)[k.letter] + 1);
  }
  const full = `### ${id}${h.rest}${h.body}`;
  const rel = writeEntryAt(dir, kind, state, id, full);
  return { id, file: rel, state, kind };
}

function writeEntryAt(dir, kind, state, id, text, dup = 1) {
  const folder = join(dir, LEDGER_DIR, kind, state);
  mkdirSync(folder, { recursive: true });
  const rel = `${LEDGER_DIR}/${kind}/${state}/${entryFileName(id, dup)}`;
  writeFileSync(join(dir, rel), text.replace(/\n+$/, "") + "\n");
  return rel;
}

/** Reserve `n` ids as stub entries (for a session that must cite a number before the entry is written). */
export function mintStubsIn(dir, { letter, n, label = "" }) {
  const kind = kindOfLetter(letter);
  const ids = [];
  for (let i = 0; i < n; i++) {
    const id = letter + (maxIds(dir)[letter] + 1);
    const today = new Date().toISOString().slice(0, 10);
    writeEntryAt(dir, kind, defaultState(kind), id, `### ${id} — (reserved ${today}${label ? ` · ${label}` : ""}) — replace this entry with \`npm run ledger -- put ${id} --file <entry.md>\`\n- Status: RESERVED, not yet filed.`);
    ids.push(id);
  }
  return ids;
}

/** Replace the text of an existing entry (state unchanged). */
export function putEntryIn(dir, id, text) {
  const hits = findEntryFiles(dir, id);
  if (!hits.length) throw new LedgerError(`${id} not found in the ledger`);
  if (hits.length > 1) throw new LedgerError(`${id} is ambiguous (${hits.map((h) => h.file).join(", ")})`);
  const kind = hits[0].kind;
  const h = parseNewHeading(text, kind);
  if (h.real && h.real !== id) throw new LedgerError(`the text's heading names ${h.real}, not ${id}`);
  writeEntryAt(dir, kind, hits[0].state, id, `### ${id}${h.rest}${h.body}`, hits[0].dup);
  return hits[0].file;
}

/** Move an entry to another state folder (a rename), optionally replacing its text in the same step. */
export function moveEntryIn(dir, id, state, { text } = {}) {
  const kind = id[0] === "B" ? "backlog" : id[0] === "V" ? "verification" : null;
  if (!kind) throw new LedgerError(`not an id: ${id}`);
  const k = KINDS[kind];
  if (!k.states.includes(state)) throw new LedgerError(`${kind} states: ${k.states.join(", ")}`);
  const hits = findEntryFiles(dir, id);
  if (!hits.length) throw new LedgerError(`${id} not found in the ledger`);
  const away = hits.filter((h) => h.state !== state);
  if (hits.length > 1 && away.length !== 1) throw new LedgerError(`${id} is ambiguous (${hits.map((h) => h.file).join(", ")}) — move the file by hand`);
  const src = away[0] || hits[0];
  let body = readFileSync(join(dir, src.file), "utf8");
  if (text != null) {
    const h = parseNewHeading(text, kind);
    if (h.real && h.real !== id) throw new LedgerError(`the text's heading names ${h.real}, not ${id}`);
    body = `### ${id}${h.rest}${h.body}`;
  }
  if (src.state === state && text == null) return { id, from: src.file, to: src.file, unchanged: true };
  let dup = 1;
  while (existsSync(join(dir, LEDGER_DIR, kind, state, entryFileName(id, dup)))) dup++;
  if (src.state === state) { writeEntryAt(dir, kind, state, id, body, src.dup); return { id, from: src.file, to: src.file }; }
  const to = writeEntryAt(dir, kind, state, id, body, dup);
  rmSync(join(dir, src.file));
  return { id, from: src.file, to };
}

/* ---------------------------------------------------------------------------------------------- *
 * INBOX — how a writer with NO shell (a chat that can only create files through a GitHub connector)
 * records something new without needing a unique id: drop `ledger/inbox/<anything>.md` on the ledger
 * branch. Two writers can never collide on a free-form filename; the next session that writes the
 * ledger (or `npm run ledger -- inbox`) gives each file its real id and files it. The kind comes from
 * the heading (`### B…` / `### V…`) or the filename prefix (`backlog-…` / `verification-…`). A first line
 * `state: done` (case-insensitive) before the heading picks a non-default state.
 * ---------------------------------------------------------------------------------------------- */
export const INBOX_DIR = `${LEDGER_DIR}/inbox`;
export function processInboxIn(dir) {
  const p = join(dir, INBOX_DIR);
  if (!existsSync(p)) return [];
  const done = [];
  for (const f of readdirSync(p).sort()) {
    if (!f.endsWith(".md") || f === "README.md") continue;
    let text = readFileSync(join(p, f), "utf8");
    let state = null;
    const sm = text.match(/^\s*state:\s*(\S+)\s*\n/i);
    if (sm) { state = sm[1]; text = text.slice(sm[0].length); }
    const hm = text.match(/^###\s+([BV])\b/m);
    const fm = f.match(/^(backlog|verification)[-_]/i);
    const kind = fm ? fm[1].toLowerCase() : hm ? kindOfLetter(hm[1]) : null;
    if (!kind) throw new LedgerError(`${INBOX_DIR}/${f}: cannot tell backlog from verification — start the heading with B?/V? or name the file backlog-*.md / verification-*.md`);
    const r = addEntryTo(dir, { kind, state, text: text.replace(/^\s+/, "") });
    rmSync(join(p, f));
    done.push({ from: `${INBOX_DIR}/${f}`, ...r });
  }
  return done;
}

/* ---------------------------------------------------------------------------------------------- *
 * The transaction.
 * ---------------------------------------------------------------------------------------------- */
/** Cheap structural check on only the files this transaction touched (the whole-ledger check is a
 *  scheduled job — a pre-existing problem elsewhere must never block an unrelated record). */
export function validateTouched(dir) {
  const out = git(dir, ["status", "--porcelain", "--untracked-files=all"]).stdout.split("\n").filter(Boolean);
  const problems = [];
  for (const line of out) {
    const code = line.slice(0, 2);
    const path = line.slice(3).replace(/^"|"$/g, "").split(" -> ").pop();
    if (/D/.test(code) || !path.startsWith(`${LEDGER_DIR}/`)) continue;
    const m = path.match(/^ledger\/(backlog|verification)\/([^/]+)\/(.+)$/);
    if (!m) continue; // _frame.md, inbox/, README — not entry files
    const k = KINDS[m[1]];
    if (m[3] === "_frame.md") continue;
    const fm = m[3].match(ENTRY_FILE_RE);
    if (!k.states.includes(m[2]) || !fm || fm[1] !== k.letter) { problems.push(`${path}: not a valid ledger path (expected ledger/${m[1]}/<${k.states.join("|")}>/${k.letter}<id>[.n].md)`); continue; }
    const first = readFileSync(join(dir, path), "utf8").split("\n", 1)[0];
    const hm = first.match(/^### ([BV])(\d+)\b/);
    if (!hm || hm[1] + hm[2] !== fm[1] + fm[2]) problems.push(`${path}: first line must be the heading "### ${fm[1]}${fm[2]} — …" (found: ${first.slice(0, 60)})`);
  }
  return problems;
}

/**
 * Run `mutate(dir)` against the CURRENT remote tip and land the result with one commit. Returns
 * `{ result, pushed, sha, attempt }`. On a lost race, redoes everything from the new tip (backoff + jitter).
 * `mutate` must be a pure function of the tree it is given.
 */
export function ledgerTx(repo, mutate, {
  message = "ledger update", retries = 8, remote, sleep = sleepSync, onRetry, inbox = true,
} = {}) {
  const url = remoteOf(repo, remote);
  let lastErr = "";
  for (let attempt = 1; attempt <= retries; attempt++) {
    const sync = syncCheckout(repo, { remote: url, allowStale: false });
    const dir = sync.dir;
    const filed = inbox ? processInboxIn(dir) : [];
    const result = mutate(dir, { attempt, inboxFiled: filed });
    if (!git(dir, ["status", "--porcelain", "--untracked-files=all"]).stdout.trim()) return { result, pushed: false, attempt };
    const problems = validateTouched(dir);
    if (problems.length) { git(dir, ["reset", "--hard", "--quiet", "HEAD"]); git(dir, ["clean", "-fdq"]); throw new LedgerError("refusing to write an invalid ledger entry:\n  • " + problems.join("\n  • ")); }
    git(dir, ["add", "-A"]);
    const env = identityEnv(repo);
    git(dir, ["commit", "--quiet", "-m", filed.length ? `${message}\n\nfiled from inbox: ${filed.map((f) => `${f.from} → ${f.id}`).join(", ")}` : message], { env });
    const sha = head(dir);
    const p = git(dir, ["push", "--quiet", url, `HEAD:refs/heads/${LEDGER_BRANCH}`], { check: false });
    if (p.status === 0) return { result, pushed: true, sha, attempt };
    const err = `${p.stderr || ""}${p.stdout || ""}`;
    if (!REJECT_RE.test(err)) {
      // not a rejection: the push may still have landed while the reply was lost (seen through the sandbox proxy)
      const ls = git(dir, ["ls-remote", url, `refs/heads/${LEDGER_BRANCH}`], { check: false });
      if (ls.status === 0 && ls.stdout.startsWith(sha)) return { result, pushed: true, sha, attempt };
    }
    lastErr = err.trim().split("\n").slice(-3).join(" | ");
    if (onRetry) onRetry({ attempt, rejected: REJECT_RE.test(err), error: lastErr });
    sleep(Math.min(2000, 120 * attempt + Math.floor(Math.random() * 400)));
  }
  throw new LedgerError(`could not land the ledger change after ${retries} attempts (last: ${lastErr}). Nothing was lost — re-run the command.`);
}

/* High-level operations used by the CLI and the tests. */
export const addEntry = (repo, { kind, state, text, message, ...o }) =>
  ledgerTx(repo, (dir) => addEntryTo(dir, { kind, state, text }), { message: message || `ledger: add ${kind} entry`, ...o });
export const mintIds = (repo, { b = 0, v = 0, label, ...o }) =>
  ledgerTx(repo, (dir) => ({
    B: b ? mintStubsIn(dir, { letter: "B", n: b, label }) : [],
    V: v ? mintStubsIn(dir, { letter: "V", n: v, label }) : [],
  }), { message: `ledger: reserve ${b ? `${b}×B ` : ""}${v ? `${v}×V` : ""}`.trim(), ...o });
export const moveEntry = (repo, id, state, { text, message, ...o } = {}) =>
  ledgerTx(repo, (dir) => moveEntryIn(dir, id, state, { text }), { message: message || `ledger: ${id} → ${state}`, ...o });
export const putEntry = (repo, id, text, { message, ...o } = {}) =>
  ledgerTx(repo, (dir) => putEntryIn(dir, id, text), { message: message || `ledger: update ${id}`, ...o });

/** Commit + push whatever is already edited in `.ledger/` by hand. A lost race REBASES (entries are one
 *  file each, so two writers touching different entries never conflict); a same-entry conflict aborts. */
export function pushPending(repo, { message = "ledger update", remote, retries = 8, sleep = sleepSync } = {}) {
  const url = remoteOf(repo, remote);
  const dir = checkoutDir(repo);
  if (!existsSync(join(dir, ".git"))) throw new LedgerError("no ledger checkout here — run: npm run ledger -- sync");
  if (git(dir, ["status", "--porcelain", "--untracked-files=all"]).stdout.trim()) {
    const problems = validateTouched(dir);
    if (problems.length) throw new LedgerError("refusing to write an invalid ledger entry:\n  • " + problems.join("\n  • "));
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "--quiet", "-m", message], { env: identityEnv(repo) });
  }
  for (let attempt = 1; attempt <= retries; attempt++) {
    const p = git(dir, ["push", "--quiet", url, `HEAD:refs/heads/${LEDGER_BRANCH}`], { check: false });
    if (p.status === 0) return { pushed: true, sha: head(dir), attempt };
    const err = `${p.stderr || ""}${p.stdout || ""}`;
    if (REJECT_RE.test(err)) {
      git(dir, ["fetch", "--depth", "1", "--quiet", url, LEDGER_BRANCH]);
      const rb = git(dir, ["rebase", "FETCH_HEAD"], { check: false, env: identityEnv(repo) });
      if (rb.status !== 0) { git(dir, ["rebase", "--abort"], { check: false }); throw new LedgerError(`someone changed the same ledger entry — rebase conflict:\n${rb.stdout}${rb.stderr}`); }
    }
    sleep(Math.min(2000, 120 * attempt + Math.floor(Math.random() * 400)));
  }
  throw new LedgerError("could not land the pending ledger commit — re-run `npm run ledger -- push`.");
}

/* ---------------------------------------------------------------------------------------------- *
 * IMPORT a delta of `ledger/**` between two refs of a CODE repo into a ledger working dir. Used for
 *   - the cut-over (replaying each open PR's ledger edits onto the branch), and
 *   - `forward-main`, which catches a straggler PR that still adds ledger/ files to main.
 * Never loses an entry: a NEW id that already exists (different text) is renumbered and reported; a
 * change on top of a diverged entry is reported as a conflict and left for a human, never overwritten.
 * ---------------------------------------------------------------------------------------------- */
/** 3-way merge of text (git merge-file). Returns the merged text, or null when the edits overlap. */
function threeWay(ours, base, theirs) {
  const d = mkdtempSync(join(tmpdir(), "ledger-merge-"));
  try {
    writeFileSync(join(d, "o"), ours); writeFileSync(join(d, "b"), base); writeFileSync(join(d, "t"), theirs);
    const r = spawnSync("git", ["merge-file", "-p", join(d, "o"), join(d, "b"), join(d, "t")], { encoding: "utf8", maxBuffer: 1 << 26 });
    return r.status === 0 ? r.stdout : null;
  } finally { rmSync(d, { recursive: true, force: true }); }
}

export function importDelta(codeRepo, baseRef, tipRef, dir) {
  const report = { added: [], modified: [], removed: [], skipped: [], renumbered: [], conflicts: [] };
  const diff = git(codeRepo, ["diff", "--name-status", "--no-renames", `${baseRef}`, `${tipRef}`, "--", `${LEDGER_DIR}/backlog`, `${LEDGER_DIR}/verification`]).stdout.split("\n").filter(Boolean);
  const show = (ref, path) => { const r = git(codeRepo, ["show", `${ref}:${path}`], { check: false }); return r.status === 0 ? r.stdout : null; };
  const rows = diff.map((l) => { const [st, path] = l.split("\t"); return { st, path }; });
  const entryRe = /^ledger\/(backlog|verification)\/([^/]+)\/(.+)$/;
  // ⛔ A DELETION IS ONLY FORWARDED AS HALF OF A MOVE (the same id also appears as an add/edit in another state).
  // A bare deletion is NOT a record being retired — the ledger never deletes an entry — and the cut-over itself
  // deletes the whole `ledger/` tree from main: replaying that would erase the ledger it was just copied to.
  const addedIds = new Set(rows.filter((r) => r.st !== "D").map((r) => (r.path.match(entryRe) ? (r.path.split("/").pop().match(ENTRY_FILE_RE) || [])[0]?.replace(/\.md$/, "") : null)).filter(Boolean));
  const deletedIds = new Set(rows.filter((r) => r.st === "D").map((r) => { const f = r.path.split("/").pop().match(ENTRY_FILE_RE); return f ? f[0].replace(/\.md$/, "") : null; }).filter(Boolean));
  const keptMoves = new Set(); // ids whose old home could not be removed because the ledger changed it — the move is NOT applied
  // removals first, so a move (D old + A new) applies in order
  for (const { st, path } of rows.filter((r) => r.st === "D")) {
    const m = path.match(entryRe); if (!m) continue;
    const fm0 = path.split("/").pop().match(ENTRY_FILE_RE);
    if (!fm0 || !addedIds.has(fm0[0].replace(/\.md$/, ""))) { report.skipped.push(`${path} (bare deletion — never forwarded; the ledger does not delete entries)`); continue; }
    const target = join(dir, path);
    if (!existsSync(target)) { report.skipped.push(`${path} (already gone)`); continue; }
    const base = show(baseRef, path);
    if (base != null && readFileSync(target, "utf8") !== base) { keptMoves.add(fm0[0].replace(/\.md$/, "")); report.conflicts.push(`${path}: removed on the branch but changed on the ledger since — kept (the move is NOT applied)`); continue; }
    rmSync(target); report.removed.push(path);
  }
  for (const { st, path } of rows.filter((r) => r.st !== "D")) {
    const m = path.match(entryRe); if (!m) continue;
    const [, kind, state, fname] = m;
    const tip = show(tipRef, path);
    const base = show(baseRef, path);
    const target = join(dir, path);
    if (fname === "_frame.md") {
      if (existsSync(target) && readFileSync(target, "utf8") === base) { writeFileSync(target, tip); report.modified.push(path); }
      else report.conflicts.push(`${path}: the frame changed on both sides — apply by hand`);
      continue;
    }
    const fm = fname.match(ENTRY_FILE_RE);
    if (!fm) { report.skipped.push(`${path} (not an entry file)`); continue; }
    const id = fm[1] + fm[2];
    if (existsSync(target) && base != null) {
      const cur = readFileSync(target, "utf8");
      if (cur === tip) { report.skipped.push(`${path} (identical)`); continue; }
      if (cur === base) { writeFileSync(target, tip); report.modified.push(path); continue; }
      const merged = threeWay(cur, base, tip);        // both sides edited: a real merge would try a 3-way
      if (merged != null) { writeFileSync(target, merged); report.modified.push(`${path} (3-way merged with later ledger edits)`); continue; }
      report.conflicts.push(`${path}: changed on the ledger since this branch started and the edits overlap — branch's version NOT applied`);
      continue;
    }
    if (base != null) {
      // The path did not exist on the ledger. Either (a) this is a MOVE — the same id was removed from another state in this
      // diff, so the D row already cleared the old home and we write the new one — or (b) it is an EDIT of an entry the
      // ledger has since MOVED to another state. (b) must NEVER re-create the stale copy (that is a duplicate id): edit the
      // entry where it lives now, as a 3-way merge of (current, the PR's base, the PR's text), or report it.
      const homes = findEntryFiles(dir, id);
      if (!deletedIds.has(id) && homes.length) {
        if (homes.length > 1) { report.conflicts.push(`${path}: the entry exists in several states on the ledger (${homes.map((h) => h.file).join(", ")}) — apply the branch's edit by hand`); continue; }
        const homePath = join(dir, homes[0].file);
        const cur = readFileSync(homePath, "utf8");
        if (cur === tip) { report.skipped.push(`${path} (already identical in ${homes[0].state})`); continue; }
        const merged = cur === base ? tip : threeWay(cur, base, tip);
        if (merged == null) { report.conflicts.push(`${path}: the ledger MOVED this entry to \`${homes[0].state}\` and its text overlaps the branch's edit — NOT applied (apply by hand)`); continue; }
        writeFileSync(homePath, merged); report.modified.push(`${homes[0].file} (the branch edited it in \`${state}\`; applied where the ledger now keeps it)`); continue;
      }
      mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, tip); report.added.push(path); continue;
    }
    // a MOVE (the same id was removed from another state in this diff): never a new id, never renumbered
    if (deletedIds.has(id)) {
      if (keptMoves.has(id)) { report.conflicts.push(`${path}: the entry also changed on the ledger since this branch started — its move to \`${state}\` is NOT applied (reconcile by hand)`); continue; }
      if (existsSync(target)) { // re-running an import, or the destination was filled/edited since: never overwrite it
        if (readFileSync(target, "utf8") === tip) report.skipped.push(`${path} (identical)`);
        else report.conflicts.push(`${path}: already exists on the ledger with different text — the branch's moved copy NOT applied`);
        continue;
      }
      mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, tip); report.added.push(path); continue;
    }
    // brand-new id on the branch
    const others = findEntryFiles(dir, id);
    if (others.some((o) => readFileSync(join(dir, o.file), "utf8") === tip)) { report.skipped.push(`${path} (same entry already filed under ${id})`); continue; }
    if (others.length) { // same number, different entry: a collision between two un-merged mints — renumber
      const nid = fm[1] + (maxIds(dir)[fm[1]] + 1);
      const h = parseNewHeading(tip, kind);
      writeEntryAt(dir, kind, state, nid, `### ${nid}${h.rest}${h.body}`);
      report.renumbered.push({ from: id, to: nid, path });
      continue;
    }
    mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, tip); report.added.push(path);
  }
  return report;
}

export { readLedgerDir, renameSync };
