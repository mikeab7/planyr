#!/usr/bin/env node
/*
 * install-hooks.mjs — wire this clone's git hooks to the committed `.githooks/` directory, from
 * `npm install` / `npm ci`, automatically (NEW-1).
 *
 * WHY. The mint gate (B779, `scripts/check-mint.mjs`) shipped with a pre-push hook and a MANUAL
 * `npm run hooks:install` step. `.git/hooks` is not cloned, and nobody runs a manual step — so in
 * a fresh dispatch container, which is EVERY container, the local gate was silently absent. The
 * required CI step still blocked a bad merge, so `main` was never at risk; what was missing was
 * the fast local failure that saves a whole build cycle. That is the same defect class as the item
 * it follows: A PROTECTION PRESENT IN PRINCIPLE AND ABSENT IN PRACTICE. So installation becomes a
 * property of `npm install` rather than of somebody remembering.
 *
 * THE FIVE REQUIREMENTS THIS ENCODES (from the item):
 *   (a) works on a FRESH CLONE with no prior state — `prepare` runs on `npm install`/`npm ci`;
 *   (b) IDEMPOTENT — a second run detects the wiring is already correct and changes nothing;
 *   (c) NEVER SILENTLY NO-OPS — every outcome that leaves the gate un-armed prints a loud, named
 *       block on stderr (the B898 loud-failure rule this whole area lives under);
 *   (d) NEVER CLOBBERS a developer's own `core.hooksPath` — a foreign value is REPORTED, with the
 *       one command to opt in, and left exactly as it was;
 *   (e) the CI required step is untouched — this adds fast local feedback, it is NOT the guarantee.
 *       Which is why this NEVER fails `npm install`: a broken installer that wedges `npm ci` would
 *       take the build down over a convenience feature. `--check` is the strict mode, for tests.
 *
 *   node scripts/install-hooks.mjs            → install/verify; always exit 0 (safe in `prepare`)
 *   node scripts/install-hooks.mjs --check    → verify only, no writes; exit 1 if the gate is not armed
 *   node scripts/install-hooks.mjs --quiet     → suppress the one-line success note (still loud on failure)
 */
import { existsSync, statSync, chmodSync, constants } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, isAbsolute } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_DEFAULT = resolve(HERE, "..");

/** The committed hooks directory, repo-relative. Git resolves a relative `core.hooksPath` against
 *  the top level of the working tree, which is exactly where this lives. */
export const HOOKS_DIR = ".githooks";
/** The hook that must exist and be runnable for the install to mean anything. */
export const REQUIRED_HOOKS = ["pre-push"];

/** Run a git command; never throws. `{ ok, out, reason }` — same shape as next-id's tryGit. */
export function git(repo, args) {
  try {
    return { ok: true, out: execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (e) {
    return { ok: false, out: "", reason: (e?.stderr || e?.message || String(e)).trim() || "git failed" };
  }
}

/**
 * PURE decision. Given what git currently reports, say what should happen and what to tell the
 * human. Separated from the I/O so the unit test can pin every branch without a repo.
 *
 *   isRepo     — are we inside a git work tree at all (a tarball install is not)
 *   configured — the EFFECTIVE `core.hooksPath` (any scope), or null when unset
 *   scope      — where that value came from ("local" | "global" | "system" | null)
 *   hookFiles  — which of REQUIRED_HOOKS actually exist on disk
 *
 * Actions: "install" · "already" · "foreign" · "not-a-repo" · "missing-hooks".
 * `armed` answers the only question that matters: will a push actually run the mint gate?
 */
export function hooksPlan({ isRepo, configured, scope = null, hookFiles = REQUIRED_HOOKS, repo = "", desired = HOOKS_DIR, gitError = null }) {
  const missing = REQUIRED_HOOKS.filter((h) => !hookFiles.includes(h));
  if (missing.length)
    return {
      action: "missing-hooks", armed: false, ok: false,
      message:
        `the committed hooks directory is incomplete — ${missing.map((h) => `${desired}/${h}`).join(", ")} not found.\n` +
        `   Nothing was wired, because wiring an empty directory would look like success and arm nothing.`,
    };

  // A repo whose git is BROKEN (an unreadable/corrupt config, a bad `.git` file) answers the
  // work-tree question with an error, not with "false". Reporting that as "not a git repo" would
  // send someone looking for the wrong problem, so it gets its own verdict carrying git's own words.
  if (gitError)
    return {
      action: "git-unusable", armed: false, ok: false,
      message:
        `git could not answer whether this is a work tree — ${gitError}\n` +
        `   Nothing was changed. Fix git here, then re-run: npm run hooks:install`,
    };

  if (!isRepo)
    return {
      action: "not-a-repo", armed: false, ok: false,
      message:
        `not inside a git work tree, so no hook could be installed.\n` +
        `   Expected in a tarball/vendored install; in a CLONE this means the mint gate will NOT run on push —\n` +
        `   the required CI step still blocks a collision, but you will find out a whole build later.`,
    };

  const matches = configured != null && samePath(repo, configured, desired);
  if (matches) return { action: "already", armed: true, ok: true, message: `core.hooksPath already points at ${desired} — nothing to do.` };

  if (configured != null)
    return {
      action: "foreign", armed: false, ok: false,
      message:
        `core.hooksPath is already set to "${configured}"${scope ? ` (${scope} config)` : ""} — LEFT UNTOUCHED.\n` +
        `   That is somebody's deliberate choice and this script will not clobber it. But the mint gate is NOT armed here.\n` +
        `   Either copy ${desired}/pre-push into "${configured}", or opt in with:  npm run hooks:install -- --force`,
    };

  return { action: "install", armed: true, ok: true, message: `wired core.hooksPath → ${desired} (mint gate armed on push).` };
}

/** Do two path spellings name the same directory, relative to the repo root? */
export function samePath(repo, a, b) {
  const abs = (p) => (isAbsolute(p) ? resolve(p) : resolve(repo || ".", p));
  return abs(a) === abs(b);
}

/** Where an effective core.hooksPath came from, so a "foreign" report can name the scope. */
function configScope(repo) {
  for (const s of ["local", "global", "system"]) {
    const r = git(repo, ["config", `--${s}`, "--get", "core.hooksPath"]);
    if (r.ok && r.out.trim()) return s;
  }
  return null;
}

/** Make sure each committed hook is executable — an installed-but-unrunnable hook is the silent
 *  no-op this whole script exists to prevent. Returns the hooks that are present. */
function ensureExecutable(repo) {
  const present = [];
  for (const h of REQUIRED_HOOKS) {
    const p = join(repo, HOOKS_DIR, h);
    if (!existsSync(p)) continue;
    present.push(h);
    try {
      const mode = statSync(p).mode;
      if (!(mode & constants.S_IXUSR)) chmodSync(p, mode | 0o111);
    } catch {
      /* a filesystem without exec bits (Windows/CIFS) — git runs the hook through sh there anyway */
    }
  }
  return present;
}

/**
 * Install (or verify) the hooks wiring. `{ ok, armed, action, message }`.
 * `write:false` makes it a pure inspection — used by `--check`.
 */
export function installHooks(repo = REPO_DEFAULT, { write = true, force = false } = {}) {
  const probe = git(repo, ["rev-parse", "--is-inside-work-tree"]);
  const isRepo = probe.out.trim() === "true";
  // Only a git that ERRORED is a broken git. A plain "false" (or a directory outside any repo) is
  // the ordinary not-a-repo answer and must not be dressed up as a fault.
  const gitError = !probe.ok && !/not a git repository/i.test(probe.reason || "") ? probe.reason : null;
  const cfg = git(repo, ["config", "--get", "core.hooksPath"]);
  const configured = cfg.ok && cfg.out.trim() ? cfg.out.trim() : null;
  const hookFiles = ensureExecutable(repo);
  const scope = isRepo && configured ? configScope(repo) : null;

  const plan = hooksPlan({ isRepo, configured, scope, hookFiles, repo, gitError });

  if (plan.action === "foreign" && force) {
    // Explicit opt-in only. `npm run hooks:install -- --force` is the documented escape hatch out
    // of the "foreign value" report; nothing automatic ever takes this branch.
    const w = git(repo, ["config", "--local", "core.hooksPath", HOOKS_DIR]);
    return w.ok
      ? { ok: true, armed: true, action: "install", message: `replaced core.hooksPath "${configured}" → ${HOOKS_DIR} (--force).` }
      : { ok: false, armed: false, action: "failed", message: `could not set core.hooksPath — ${w.reason}` };
  }

  if (plan.action !== "install") return plan;
  if (!write) return { ...plan, armed: false, ok: false, action: "would-install", message: `core.hooksPath is NOT set — the mint gate would not run on push. Run: npm install (or npm run hooks:install)` };

  const w = git(repo, ["config", "--local", "core.hooksPath", HOOKS_DIR]);
  if (!w.ok) return { ok: false, armed: false, action: "failed", message: `could not set core.hooksPath — ${w.reason}` };

  // Trust nothing: read back what git now reports, so a write that "succeeded" but did not take
  // (a read-only .git/config, a worktree quirk) is reported as the failure it is.
  const back = git(repo, ["config", "--get", "core.hooksPath"]);
  if (!back.ok || !samePath(repo, back.out.trim(), HOOKS_DIR))
    return { ok: false, armed: false, action: "failed", message: `set core.hooksPath but git reads back "${back.out.trim() || "(nothing)"}" — the hook is NOT armed.` };

  return plan;
}

// ---- CLI -------------------------------------------------------------------------------
function main(argv) {
  const check = argv.includes("--check");
  const quiet = argv.includes("--quiet");
  const repoFlag = argv.find((a) => a.startsWith("--repo="));
  const repo = repoFlag ? resolve(repoFlag.split("=")[1]) : REPO_DEFAULT;

  let res;
  try {
    res = installHooks(repo, { write: !check, force: argv.includes("--force") });
  } catch (e) {
    // Belt and braces: `prepare` runs on every `npm ci`, including in CI. A convenience installer
    // must never be the reason a build cannot install its dependencies.
    res = { ok: false, armed: false, action: "failed", message: `unexpected error — ${e?.message || e}` };
  }

  if (res.ok && res.armed) {
    if (!quiet) process.stdout.write(`✅ Mint-gate hook: ${res.message}\n`);
    return 0;
  }

  process.stderr.write(
    `\n⚠ MINT-GATE HOOK NOT ARMED (${res.action}): ${res.message}\n` +
      `   Effect: a push that mints a backlog id someone else already holds will NOT be stopped locally.\n` +
      `   The required CI "Mint gate" step still blocks the merge — this is lost speed, not lost safety. (B779)\n\n`,
  );
  return check ? 1 : 0; // never fail `npm install`; `--check` is the strict mode
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
