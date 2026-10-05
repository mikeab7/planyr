/*
 * scripts/lib/ledger.mjs — the ONE reader/writer for the backlog + verification ledgers (NEW-1, 2026-10-05).
 *
 * WHY THIS EXISTS. BACKLOG.md and VERIFICATION.md used to be two big hand-edited files that every
 * session appended to at the same spot, so any two PRs that each filed an entry conflicted — and
 * GitHub's server-side mergeability does NOT honour `merge=union` in .gitattributes (measured
 * 2026-10-05: two PRs prepending different lines to a `merge=union` file both read
 * `mergeable_state: dirty`, while a local `git merge` of the same pair is clean). Only a layout in
 * which two entries never share a file makes the conflict impossible by construction:
 *
 *   ledger/backlog/_frame.md                 ← the prose around the entries (rules, legend, section
 *   ledger/verification/_frame.md              headings) with one `<!-- ledger:entries <state> -->`
 *                                              marker per section. Rarely edited.
 *   ledger/backlog/<state>/B<id>.md          ← ONE entry per file (the exact `### B…` block).
 *   ledger/verification/<state>/V<id>.md       A dup id inside one folder gets `.2`, `.3` …
 *
 * A state is a folder, so "move to Verify / Done" is a rename of one file: two PRs moving two
 * different entries never touch the same path.
 *
 * BACKLOG.md / VERIFICATION.md at the repo root are now GENERATED VIEWS of frame + live entries (the
 * nightly regen job refreshes them; a branch never edits them — scripts/generated-doc-touch-guard.mjs).
 * The two write-only archives (docs/archive/*-DONE.md) no longer exist as files; this module serves
 * them as VIRTUAL text so every older consumer (next-id, check-mint, the id-uniqueness tests …) keeps
 * working unchanged: `virtualText(repo, "docs/archive/BACKLOG-DONE.md")` is the done entries joined.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

export const LEDGER_DIR = "ledger";

export const KINDS = {
  backlog: {
    letter: "B",
    live: "BACKLOG.md",
    archive: "docs/archive/BACKLOG-DONE.md",
    states: ["open", "bug-audit", "verify", "later", "done"],
    doneState: "done",
    /** `## ` heading text → state (only consulted for the live file; every entry of the archive is `done`). */
    sectionState(h) {
      if (/Open\b/.test(h) && /🔲/.test(h)) return "open";
      if (/Bug audit/.test(h)) return "bug-audit";
      if (/Verify/.test(h) && /⏳/.test(h)) return "verify";
      if (/Later/.test(h)) return "later";
      return null;
    },
  },
  verification: {
    letter: "V",
    live: "VERIFICATION.md",
    archive: "docs/archive/VERIFICATION-DONE.md",
    states: ["pending", "checklist", "done"],
    doneState: "done",
    sectionState(h) {
      if (/Needs verification/.test(h)) return "pending";
      if (/THE CHECKLIST/.test(h)) return "checklist";
      return null;
    },
  },
};

export const MARKER_RE = /^<!-- ledger:entries (\S+) -->$/;
export const marker = (state) => `<!-- ledger:entries ${state} -->`;
const HEADING_RE = /^### ([BV])(\d+)\b/;
const ENTRY_FILE_RE = /^([BV])(\d+)(?:\.(\d+))?\.md$/;

export const ledgerEnabled = (repo) => existsSync(join(repo, LEDGER_DIR, "backlog", "_frame.md"));

/** Which ledger kind + role does a repo-relative path name? null when it is not a ledger path. */
export function pathRole(rel) {
  for (const [kind, k] of Object.entries(KINDS)) {
    if (rel === k.live) return { kind, role: "live" };
    if (rel === k.archive) return { kind, role: "archive" };
  }
  return null;
}

const idNum = (id) => Number(id.slice(1));
export const entryFileName = (id, dup = 1) => (dup > 1 ? `${id}.${dup}.md` : `${id}.md`);

/** Sort key: newest (highest) id first; a `.2` dup after its `.1`. */
export function byIdDesc(a, b) {
  return idNum(b.id) - idNum(a.id) || (a.dup || 1) - (b.dup || 1);
}

/* ------------------------------------------------------------------------------------------ *
 * Legacy parse: one old-style ledger file → { frameLines (with markers), entries }.
 * An entry = `### B123 …` through the line before the next heading of depth ≤ 3 (fenced code is
 * ignored), minus trailing blank / `---` lines, which are only separators and stay with the frame.
 * ------------------------------------------------------------------------------------------ */
export function parseLegacy(text, kind, { archive = false } = {}) {
  const k = KINDS[kind];
  const lines = text.replace(/\n$/, "").split("\n");
  const frame = [];
  const entries = [];
  const markerSeen = new Set();
  let section = null; // state of the current `## ` section (live file); null = frame-only section
  let fence = false;
  let cur = null;
  let pendingTail = null; // separator lines peeled off the last entry; flushed only if the run really ends

  const closeEntry = () => {
    if (!cur) return;
    let end = cur.lines.length;
    while (end > 0 && (cur.lines[end - 1].trim() === "" || cur.lines[end - 1].trim() === "---")) end--;
    entries.push({ id: cur.id, state: cur.state, text: cur.lines.slice(0, end).join("\n"), seq: entries.length });
    pendingTail = cur.lines.slice(end);
    cur = null;
  };
  const toFrame = (line) => {
    if (pendingTail) { frame.push(...pendingTail); pendingTail = null; }
    frame.push(line);
  };

  for (const line of lines) {
    const isFence = /^(```|~~~)/.test(line);
    const h = !fence && /^#{1,3} /.test(line);
    if (h) {
      const m = line.match(HEADING_RE);
      closeEntry();
      if (m && m[1] === k.letter) {
        const state = archive ? k.doneState : section;
        if (!state) throw new Error(`${kind}: entry ${m[1]}${m[2]} sits outside any known section`);
        cur = { id: m[1] + m[2], state, lines: [line] };
        if (!archive) {
          if (frame[frame.length - 1] !== marker(state)) {
            if (markerSeen.has(state)) throw new Error(`${kind}: entries of state "${state}" are split into two runs (at ${m[1]}${m[2]})`);
            markerSeen.add(state);
            toFrame(marker(state));
          } else pendingTail = null;
        }
        continue;
      }
      if (/^## /.test(line)) section = archive ? null : k.sectionState(line);
      toFrame(line);
      continue;
    }
    if (isFence) fence = !fence;
    if (cur) cur.lines.push(line);
    else toFrame(line);
  }
  closeEntry();
  if (pendingTail) frame.push(...pendingTail);

  return { frameLines: frame, entries };
}

/* Join entries the way every view does: blank line between blocks. */
export const joinEntries = (entries) => entries.map((e) => e.text).join("\n\n");

/** Frame + live entries → the BACKLOG.md / VERIFICATION.md view. */
export function renderView(kind, frameText, entries) {
  const k = KINDS[kind];
  const byState = new Map();
  for (const e of entries) {
    if (e.state === k.doneState) continue;
    (byState.get(e.state) || byState.set(e.state, []).get(e.state)).push(e);
  }
  const seen = new Set();
  const fl = frameText.replace(/\n$/, "").split("\n");
  const out = fl.map((l, i) => {
    const m = l.match(MARKER_RE);
    if (!m) return l;
    seen.add(m[1]);
    const list = (byState.get(m[1]) || []).slice().sort(byIdDesc);
    if (!list.length) return "";
    return joinEntries(list) + (fl[i + 1] !== undefined && fl[i + 1].trim() !== "" ? "\n" : "");
  });
  for (const s of byState.keys()) {
    if (!seen.has(s)) throw new Error(`${kind}: state "${s}" has entries but _frame.md has no ${marker(s)} line`);
  }
  return out.join("\n") + "\n";
}

/** The virtual write-only archive: every done entry, newest first. */
export function renderArchive(entries) {
  return joinEntries(entries.filter((e) => e.state === "done").slice().sort(byIdDesc)) + "\n";
}

/* ------------------------------------------------------------------------------------------ *
 * Reading the tree on disk.
 * ------------------------------------------------------------------------------------------ */
export function readLedgerDir(repo, kind) {
  const k = KINDS[kind];
  const root = join(repo, LEDGER_DIR, kind);
  const frame = readFileSync(join(root, "_frame.md"), "utf8");
  const entries = [];
  const stray = [];
  for (const d of readdirSync(root)) {
    const dp = join(root, d);
    if (!statSync(dp).isDirectory()) continue;
    if (!k.states.includes(d)) { stray.push(`${LEDGER_DIR}/${kind}/${d}/`); continue; }
    for (const f of readdirSync(dp)) {
      const m = f.match(ENTRY_FILE_RE);
      if (!m || m[1] !== k.letter) { stray.push(`${LEDGER_DIR}/${kind}/${d}/${f}`); continue; }
      const text = readFileSync(join(dp, f), "utf8").replace(/\n+$/, "");
      entries.push({ id: m[1] + m[2], dup: m[3] ? Number(m[3]) : 1, state: d, file: `${LEDGER_DIR}/${kind}/${d}/${f}`, text });
    }
  }
  return { frame, entries, stray };
}

/** Build the same shape from `git` at a ref (one ls-tree + one cat-file --batch; null if the ref has no ledger). */
export function readLedgerAtRef(repo, ref, kind) {
  const git = (args, input) => execFileSync("git", args, { cwd: repo, encoding: "buffer", maxBuffer: 1 << 29, input });
  let ls;
  try { ls = git(["ls-tree", "-r", ref, "--", `${LEDGER_DIR}/${kind}`]).toString("utf8"); } catch { return null; }
  const rows = ls.split("\n").filter(Boolean).map((l) => {
    const [meta, path] = l.split("\t");
    return { sha: meta.split(" ")[2], path };
  });
  if (!rows.length) return null;
  const blobs = new Map();
  const out = git(["cat-file", "--batch"], rows.map((r) => r.sha).join("\n") + "\n");
  let p = 0;
  for (const r of rows) {
    const nl = out.indexOf(10, p);
    const [, , size] = out.slice(p, nl).toString().split(" ");
    const n = Number(size);
    blobs.set(r.path, out.slice(nl + 1, nl + 1 + n).toString("utf8"));
    p = nl + 1 + n + 1;
  }
  const k = KINDS[kind];
  let frame = null;
  const entries = [];
  for (const r of rows) {
    const rel = r.path.slice(`${LEDGER_DIR}/${kind}/`.length);
    if (rel === "_frame.md") { frame = blobs.get(r.path); continue; }
    const [state, f] = rel.split("/");
    const m = f && f.match(ENTRY_FILE_RE);
    if (!m || m[1] !== k.letter || !k.states.includes(state)) continue;
    entries.push({ id: m[1] + m[2], dup: m[3] ? Number(m[3]) : 1, state, file: r.path, text: blobs.get(r.path).replace(/\n+$/, "") });
  }
  return frame == null ? null : { frame, entries, stray: [] };
}

/** View / archive text for a ledger path, or null when `rel` is not one. Falls back to the plain file
 *  when the repo has no ledger/ tree (older layout, and the throwaway repos several tests build). */
export function virtualText(repo, rel, { ref = null } = {}) {
  const role = pathRole(rel);
  if (!role) return null;
  if (ref) {
    const l = readLedgerAtRef(repo, ref, role.kind);
    if (!l) return null;
    return role.role === "live" ? renderView(role.kind, l.frame, l.entries) : renderArchive(l.entries);
  }
  if (!ledgerEnabled(repo)) return null;
  const l = cached(repo, role.kind);
  return role.role === "live" ? renderView(role.kind, l.frame, l.entries) : renderArchive(l.entries);
}

const _cache = new Map();
function cached(repo, kind) {
  const key = `${repo}::${kind}`;
  const sig = signature(repo, kind);
  const hit = _cache.get(key);
  if (hit && hit.sig === sig) return hit.value;
  const value = readLedgerDir(repo, kind);
  _cache.set(key, { sig, value });
  return value;
}
function signature(repo, kind) {
  // cheap staleness probe: entry-folder mtimes + counts (tests mutate the tree between reads)
  const root = join(repo, LEDGER_DIR, kind);
  let s = "";
  for (const d of readdirSync(root)) {
    const dp = join(root, d);
    const st = statSync(dp);
    s += d + ":" + st.mtimeMs + ":" + (st.isDirectory() ? readdirSync(dp).length : st.size) + ";";
  }
  return s;
}

/** Read a repo-relative file the way old code did, but ledger-aware. */
export function readText(repo, rel) {
  const v = virtualText(repo, rel);
  if (v != null) return v;
  return readFileSync(join(repo, rel), "utf8");
}
export const existsText = (repo, rel) => (pathRole(rel) && ledgerEnabled(repo)) || existsSync(join(repo, rel));

/* ------------------------------------------------------------------------------------------ *
 * Writing.
 * ------------------------------------------------------------------------------------------ */
export function writeEntry(repo, kind, state, id, text, dup = 1) {
  const dir = join(repo, LEDGER_DIR, kind, state);
  mkdirSync(dir, { recursive: true });
  const rel = `${LEDGER_DIR}/${kind}/${state}/${entryFileName(id, dup)}`;
  writeFileSync(join(repo, rel), text.replace(/\n+$/, "") + "\n");
  return rel;
}

/** Validation used by `ledger check` and the unit tests. Returns a list of problems. */
export function validateLedger(repo) {
  const problems = [];
  for (const kind of Object.keys(KINDS)) {
    const k = KINDS[kind];
    let l;
    try { l = readLedgerDir(repo, kind); } catch (e) { problems.push(`${kind}: cannot read (${e.message})`); continue; }
    for (const s of l.stray) problems.push(`${s}: not a valid ledger path (expected ${LEDGER_DIR}/${kind}/<${k.states.join("|")}>/${k.letter}<id>[.n].md)`);
    for (const e of l.entries) {
      const first = e.text.split("\n", 1)[0];
      const m = first.match(HEADING_RE);
      if (!m || m[1] + m[2] !== e.id) problems.push(`${e.file}: first line must be the heading "### ${e.id} — …" (found: ${first.slice(0, 60)})`);
    }
    const seenMarkers = new Set(l.frame.split("\n").map((x) => (x.match(MARKER_RE) || [])[1]).filter(Boolean));
    for (const s of k.states) {
      if (s === k.doneState) continue;
      if (!seenMarkers.has(s)) problems.push(`${LEDGER_DIR}/${kind}/_frame.md: missing ${marker(s)}`);
    }
    // same id in the same folder must be `.n` suffixed — the loader guarantees unique paths, so check two files with one id in one folder reading as ≥ .2
  }
  return problems;
}

export { HEADING_RE, ENTRY_FILE_RE };
