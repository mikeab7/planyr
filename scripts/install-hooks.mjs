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

 * ALSO WIRES THE LEDGER MERGE DRIVER (NEW-1, a second independent concern this same installer now
 * carries). `.gitattributes` names the zero-config, built-in `union` driver for MAP.md /
 * BACKLOG_OPEN.md directly — so a bare fresh clone with no installer run ever already merges these
 * two files without a shown conflict (git's `union` needs no local config at all: it is not a
 * custom driver). This installer's job is the UPGRADE on top of that floor: it writes a LOCAL,
 * uncommitted `.git/info/attributes` override pointing the same two paths at a smarter custom
 * driver instead (`merge=planyr-ledger` — inline regeneration during the merge itself, with the
 * B384432 hand-authored-description safety check, and the ability to leave a REAL conflict for a
 * human when regeneration fails outright, which the committed `union` default can never do), AND
 * configures the actual command that name refers to (`merge.planyr-ledger.driver` — LOCAL git
 * config; git refuses to let a repo commit an arbitrary shell command that runs on every clone).
 * `.git/info/attributes` takes precedence over the committed `.gitattributes` (gitattributes(5);
 * proved in test/freshCloneMerge.test.js) and is itself local/uncommitted, exactly like
 * `merge.<name>.driver` — writing to it needs no different trust boundary than the driver command
 * this file already writes. Skipping this installer is therefore NOT the silent, unguarded gap it
 * used to be (B1102688): the committed `union` default is always there underneath. The same five
 * requirements above still apply to both new pieces: fresh-clone install, idempotent, never a
 * silent no-op, never clobbers somebody's own local customization (report + `--force` to opt in),
 * never fails `npm install`. See `scripts/merge-driver-ledgers.mjs` for what the driver itself does
 * — and its OWN header for why that driver alone cannot always be correct. The `post-merge` hook
 * that closes that gap (`scripts/post-merge-regen.mjs`) is just another entry in `REQUIRED_HOOKS`
 * below, so it is armed by the exact same `core.hooksPath` wiring the mint gate already relies on —
 * no separate concern, and it corrects the result of EITHER driver identically.
 *
 *   node scripts/install-hooks.mjs            → install/verify all three; always exit 0 (safe in `prepare`)
 *   node scripts/install-hooks.mjs --check    → verify only, no writes; exit 1 if the hook or the merge driver isn't armed
 *   node scripts/install-hooks.mjs --quiet     → suppress the one-line success notes (still loud on failure)
 */
import { existsSync, statSync, chmodSync, constants, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, isAbsolute } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_DEFAULT = resolve(HERE, "..");

/** The committed hooks directory, repo-relative. Git resolves a relative `core.hooksPath` against
 *  the top level of the working tree, which is exactly where this lives. */
export const HOOKS_DIR = ".githooks";
/** The hooks that must exist and be runnable for the install to mean anything: `pre-push` arms the
 *  mint gate, `post-merge` is the ledger merge driver's correctness backstop (NEW-1) — see
 *  scripts/post-merge-regen.mjs. */
export const REQUIRED_HOOKS = ["pre-push", "post-merge"];

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

// ---- the ledger merge driver (NEW-1) --------------------------------------------------------
/** The git config name `.gitattributes`' `merge=planyr-ledger` refers to. */
export const MERGE_DRIVER_NAME = "planyr-ledger";
const MERGE_DRIVER_SCRIPT = "scripts/merge-driver-ledgers.mjs";
const MERGE_DRIVER_LABEL = "Planyr generated-ledger merge driver (MAP.md / BACKLOG_OPEN.md — NEW-1)";
/**
 * The exact command written to `merge.planyr-ledger.driver`. Resolves the toplevel at RUN time
 * (mirrors `.githooks/pre-push`'s own `$(git rev-parse --show-toplevel)` idiom) rather than baking
 * in an absolute path here, so the same config line is correct however the clone was made.
 */
export const MERGE_DRIVER_COMMAND = `node "$(git rev-parse --show-toplevel)/${MERGE_DRIVER_SCRIPT}" %O %A %B %P`;

/**
 * PURE decision for the merge driver — same shape as `hooksPlan`. `configured` is whatever
 * `git config --get merge.planyr-ledger.driver` currently reads (local scope only; unlike
 * `core.hooksPath` this has no meaningful global/system scope for a single repo's driver), or
 * `null` if unset.
 */
export function mergeDriverPlan({ configured }) {
  if (configured != null && configured === MERGE_DRIVER_COMMAND)
    return { action: "already", armed: true, ok: true, message: `merge.${MERGE_DRIVER_NAME}.driver already wired — nothing to do.` };

  if (configured != null)
    return {
      action: "foreign", armed: false, ok: false,
      message:
        `merge.${MERGE_DRIVER_NAME}.driver is already set to "${configured}" — LEFT UNTOUCHED.\n` +
        `   That is somebody's deliberate choice and this script will not clobber it. But MAP.md /\n` +
        `   BACKLOG_OPEN.md conflicts will NOT self-resolve here. Opt in with:  npm run hooks:install -- --force`,
    };

  return { action: "install", armed: true, ok: true, message: `wired merge.${MERGE_DRIVER_NAME}.driver (MAP.md / BACKLOG_OPEN.md conflicts now self-resolve on merge).` };
}

/** Install (or verify) the merge driver config. Mirrors `installHooks`'s shape and guarantees. */
export function installMergeDriver(repo = REPO_DEFAULT, { write = true, force = false } = {}) {
  const cfg = git(repo, ["config", "--get", `merge.${MERGE_DRIVER_NAME}.driver`]);
  const configured = cfg.ok && cfg.out.trim() ? cfg.out.trim() : null;
  const plan = mergeDriverPlan({ configured });

  const writeConfig = () => {
    const w1 = git(repo, ["config", "--local", `merge.${MERGE_DRIVER_NAME}.name`, MERGE_DRIVER_LABEL]);
    const w2 = git(repo, ["config", "--local", `merge.${MERGE_DRIVER_NAME}.driver`, MERGE_DRIVER_COMMAND]);
    if (!w1.ok || !w2.ok) return { ok: false, armed: false, action: "failed", message: `could not set the merge driver config — ${w1.reason || w2.reason}` };
    const back = git(repo, ["config", "--get", `merge.${MERGE_DRIVER_NAME}.driver`]);
    if (!back.ok || back.out.trim() !== MERGE_DRIVER_COMMAND)
      return { ok: false, armed: false, action: "failed", message: `set the merge driver but git reads back "${back.out.trim() || "(nothing)"}" — it is NOT armed.` };
    return null; // success — caller returns its own plan-shaped verdict
  };

  if (plan.action === "foreign" && force) {
    // Explicit opt-in only, mirroring installHooks's own --force branch.
    const fail = writeConfig();
    return fail || { ok: true, armed: true, action: "install", message: `replaced merge.${MERGE_DRIVER_NAME}.driver "${configured}" (--force).` };
  }

  if (plan.action !== "install") return plan;
  if (!write) return { ...plan, armed: false, ok: false, action: "would-install", message: `merge.${MERGE_DRIVER_NAME}.driver is NOT set — MAP.md/BACKLOG_OPEN.md conflicts will NOT self-resolve. Run: npm install (or npm run hooks:install)` };

  const fail = writeConfig();
  return fail || plan;
}

// ---- the local .git/info/attributes override (B1102688, NEW-1) -----------------------------
/** The two paths the committed `.gitattributes` hands to the zero-config `union` driver, but that
 *  get upgraded to the smarter `planyr-ledger` driver once this installer has run. */
export const OVERRIDE_PATHS = ["MAP.md", "BACKLOG_OPEN.md"];
const overrideLine = (path) => `${path} merge=${MERGE_DRIVER_NAME}`;

/** Find the `merge=<value>` a `.git/info/attributes`-style text currently sets for an EXACT path
 *  (our two paths are plain filenames at the repo root, so a simple first-token match is correct
 *  — no need for general gitattributes glob matching here). Returns the value, or `null` if unset. */
export function attrMergeValue(text, path) {
  for (const raw of (text || "").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [pattern, ...attrs] = line.split(/\s+/);
    if (pattern !== path) continue;
    for (const a of attrs) {
      const m = /^merge=(.+)$/.exec(a);
      if (m) return m[1];
    }
  }
  return null;
}

/** Drop every line whose first token is one of `paths`, keeping everything else (blank lines,
 *  comments, unrelated attributes) untouched and in order. Used only on the explicit `--force`
 *  path, so a stale or foreign override can be replaced without depending on gitattributes' own
 *  same-file precedence rules to make the replacement take effect. */
export function stripPathLines(text, paths) {
  return (text || "").split("\n").filter((raw) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return true;
    const [pattern] = line.split(/\s+/);
    return !paths.includes(pattern);
  }).join("\n");
}

/**
 * PURE decision for the local attributes override — same shape as `hooksPlan` / `mergeDriverPlan`.
 * `existingText` is the current `.git/info/attributes` content (empty string if the file is absent).
 */
export function attributesOverridePlan({ existingText = "" } = {}) {
  const current = Object.fromEntries(OVERRIDE_PATHS.map((p) => [p, attrMergeValue(existingText, p)]));
  const missing = OVERRIDE_PATHS.filter((p) => current[p] == null);
  const foreign = OVERRIDE_PATHS.filter((p) => current[p] != null && current[p] !== MERGE_DRIVER_NAME);

  if (missing.length === 0 && foreign.length === 0)
    return { action: "already", armed: true, ok: true, message: `.git/info/attributes already overrides ${OVERRIDE_PATHS.join(", ")} → merge=${MERGE_DRIVER_NAME} — nothing to do.` };

  if (foreign.length)
    return {
      action: "foreign", armed: false, ok: false,
      message:
        `.git/info/attributes already sets ${foreign.map((p) => `${p} → merge=${current[p]}`).join(", ")} — LEFT UNTOUCHED.\n` +
        `   That is somebody's deliberate choice. ${foreign.join("/")} still merge${foreign.length > 1 ? "" : "s"} safely via the committed\n` +
        `   zero-config \`union\` default either way — this override only upgrades that to the smarter inline\n` +
        `   regenerating driver. Opt in with:  npm run hooks:install -- --force`,
    };

  return { action: "install", armed: true, ok: true, message: `wired a local .git/info/attributes override for ${missing.join(", ")} → merge=${MERGE_DRIVER_NAME}.` };
}

/**
 * Install (or verify) the local attributes override. Mirrors `installHooks` / `installMergeDriver`'s
 * shape and guarantees: idempotent, never clobbers a foreign customization for these exact paths
 * without `--force`, never throws, and `write:false` makes it a pure inspection for `--check`.
 */
export function installAttributesOverride(repo = REPO_DEFAULT, { write = true, force = false } = {}) {
  const attrsPath = join(repo, ".git", "info", "attributes");
  const existingText = existsSync(attrsPath) ? readFileSync(attrsPath, "utf8") : "";
  const plan = attributesOverridePlan({ existingText });

  if (plan.action === "already") return plan;
  if (plan.action === "foreign" && !force) return plan;
  if (!write)
    return {
      ...plan, armed: false, ok: false, action: "would-install",
      message: `local .git/info/attributes override is not wired for ${OVERRIDE_PATHS.join(", ")} — Run: npm install (or npm run hooks:install${plan.action === "foreign" ? " -- --force" : ""})`,
    };

  // Rewrite cleanly on --force (drop any existing line for our exact paths, foreign or a stale
  // prior version of our own, then append fresh ones) rather than relying on gitattributes' own
  // "later pattern wins" precedence within one file to make a --force replacement take effect.
  const base = plan.action === "foreign" ? stripPathLines(existingText, OVERRIDE_PATHS) : existingText;
  const toAdd = plan.action === "foreign" ? OVERRIDE_PATHS : OVERRIDE_PATHS.filter((p) => attrMergeValue(existingText, p) == null);
  mkdirSync(dirname(attrsPath), { recursive: true });
  const sep = base && !base.endsWith("\n") ? "\n" : "";
  writeFileSync(attrsPath, base + sep + toAdd.map(overrideLine).join("\n") + "\n");

  return plan.action === "foreign"
    ? { ok: true, armed: true, action: "install", message: `replaced the foreign .git/info/attributes line(s) for ${OVERRIDE_PATHS.join(", ")} with merge=${MERGE_DRIVER_NAME} (--force).` }
    : plan;
}

// ---- CLI -------------------------------------------------------------------------------
/** Print one concern's outcome to the right stream and return whether it is armed. */
function report(label, res, effect, quiet) {
  if (res.ok && res.armed) {
    if (!quiet) process.stdout.write(`✅ ${label}: ${res.message}\n`);
    return true;
  }
  process.stderr.write(`\n⚠ ${label.toUpperCase()} NOT ARMED (${res.action}): ${res.message}\n   ${effect}\n\n`);
  return false;
}

function main(argv) {
  const check = argv.includes("--check");
  const quiet = argv.includes("--quiet");
  const force = argv.includes("--force");
  const repoFlag = argv.find((a) => a.startsWith("--repo="));
  const repo = repoFlag ? resolve(repoFlag.split("=")[1]) : REPO_DEFAULT;

  let hooksRes;
  try {
    hooksRes = installHooks(repo, { write: !check, force });
  } catch (e) {
    // Belt and braces: `prepare` runs on every `npm ci`, including in CI. A convenience installer
    // must never be the reason a build cannot install its dependencies.
    hooksRes = { ok: false, armed: false, action: "failed", message: `unexpected error — ${e?.message || e}` };
  }

  // The merge driver needs the same usable git work tree the hooks check already probed — reuse
  // ITS verdict for a broken/absent repo rather than re-probing and risking a different answer.
  let mergeRes, attrsRes;
  if (hooksRes.action === "not-a-repo" || hooksRes.action === "git-unusable") {
    mergeRes = { ok: false, armed: false, action: hooksRes.action, message: `(same repo problem reported above) ${hooksRes.message}` };
    attrsRes = mergeRes;
  } else {
    try {
      mergeRes = installMergeDriver(repo, { write: !check, force });
    } catch (e) {
      mergeRes = { ok: false, armed: false, action: "failed", message: `unexpected error — ${e?.message || e}` };
    }
    try {
      attrsRes = installAttributesOverride(repo, { write: !check, force });
    } catch (e) {
      attrsRes = { ok: false, armed: false, action: "failed", message: `unexpected error — ${e?.message || e}` };
    }
  }

  // Both pieces are needed for the SMART driver to actually take effect on this clone (the
  // command it runs, and something pointing at it) — combine into one verdict for reporting.
  // Either piece missing is safe, never broken: `.gitattributes` alone already gives every clone
  // the zero-config `union` floor (B1102688), so this combined verdict only ever gates the upgrade.
  const ledgerRes = {
    ok: mergeRes.ok && attrsRes.ok,
    armed: mergeRes.armed && attrsRes.armed,
    action: mergeRes.armed && attrsRes.armed ? "already" : (mergeRes.armed ? attrsRes.action : mergeRes.action),
    message: mergeRes.armed && attrsRes.armed
      ? "merge.planyr-ledger.driver configured and the local .git/info/attributes override wired — MAP.md/BACKLOG_OPEN.md conflicts self-resolve with full inline regeneration on merge."
      : [mergeRes, attrsRes].filter((r) => !(r.ok && r.armed)).map((r) => r.message).join("\n   "),
  };

  const hooksOk = report(
    "Mint-gate hook", hooksRes,
    "Effect: a push that mints a backlog id someone else already holds will NOT be stopped locally.\n" +
    '   The required CI "Mint gate" step still blocks the merge — this is lost speed, not lost safety. (B779)',
    quiet,
  );
  const mergeOk = report(
    "Ledger merge driver", ledgerRes,
    "Effect: MAP.md / BACKLOG_OPEN.md still merge safely with no shown conflict either way — the\n" +
    "   committed `.gitattributes` already gives every clone git's zero-config `union` driver as a\n" +
    "   floor (B1102688). This only upgrades that to the smarter inline-regenerating driver, with the\n" +
    "   B384432 hand-authored-description safety check and a real abort-on-failure. (NEW-1)",
    quiet,
  );

  return (hooksOk && mergeOk) ? 0 : (check ? 1 : 0); // never fail `npm install`; `--check` is the strict mode
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
