/* The mint-gate hook AUTO-INSTALLER (NEW-1) — `scripts/install-hooks.mjs`, run from npm's
 * `prepare` lifecycle so a plain `npm install` arms the pre-push gate.
 *
 * WHY. The gate shipped (B779 second pass) with a MANUAL `npm run hooks:install`. `.git/hooks` is
 * not cloned and nobody runs a manual step, so in a fresh dispatch container — which is every
 * container — the local gate was silently absent. Same defect class as the item it follows: a
 * protection present in principle and absent in practice.
 *
 * The five requirements, one describe block each:
 *   (a) fresh clone, no prior state → installs
 *   (b) idempotent → a second run changes nothing
 *   (c) never silently no-ops → every un-armed outcome is loud and named
 *   (d) never clobbers a deliberate custom `core.hooksPath` → reports instead
 *   (e) never fails `npm install` → exit 0 even when it cannot install (`--check` is the strict mode)
 *
 * Real git, real repos, in a temp dir — the same reason the gate's own e2e test uses real refs: a
 * mocked `git config` would prove nothing about whether a push actually runs the hook.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { hooksPlan, installHooks, samePath, HOOKS_DIR, REQUIRED_HOOKS } from "../scripts/install-hooks.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(REPO, "scripts", "install-hooks.mjs");
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

let ROOT;
/** A bare-bones clone-shaped repo carrying the committed hooks directory. */
function scratchRepo(name = "clone", { withHooks = true } = {}) {
  const dir = join(ROOT, name);
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  if (withHooks) {
    mkdirSync(join(dir, HOOKS_DIR), { recursive: true });
    for (const h of REQUIRED_HOOKS) {
      writeFileSync(join(dir, HOOKS_DIR, h), "#!/bin/sh\nexit 0\n");
      chmodSync(join(dir, HOOKS_DIR, h), 0o644); // deliberately NOT executable — the installer fixes it
    }
  }
  return dir;
}
const hooksPathOf = (dir) => {
  const r = spawnSync("git", ["config", "--get", "core.hooksPath"], { cwd: dir, encoding: "utf8" });
  return (r.stdout || "").trim();
};
const cli = (dir, ...flags) => {
  const r = spawnSync(process.execPath, [CLI, `--repo=${dir}`, ...flags], { encoding: "utf8" });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
};

beforeEach(() => { ROOT = mkdtempSync(join(tmpdir(), "install-hooks-")); });
afterEach(() => { if (ROOT) rmSync(ROOT, { recursive: true, force: true }); });

describe("(a) a FRESH CLONE with no prior state gets the gate armed", () => {
  it("sets core.hooksPath to the committed directory", () => {
    const dir = scratchRepo();
    expect(hooksPathOf(dir)).toBe(""); // .git/hooks is never cloned — this is the starting state
    const res = installHooks(dir);
    expect(res.ok).toBe(true);
    expect(res.armed).toBe(true);
    expect(res.action).toBe("install");
    expect(hooksPathOf(dir)).toBe(HOOKS_DIR);
  });

  it("makes the committed hook EXECUTABLE — an installed-but-unrunnable hook is the silent no-op", () => {
    const dir = scratchRepo();
    installHooks(dir);
    const mode = execFileSync("stat", ["-c", "%a", join(dir, HOOKS_DIR, "pre-push")], { encoding: "utf8" }).trim();
    expect(Number.parseInt(mode, 8) & 0o100).toBeTruthy();
  });

  it("the CLI reports it plainly, so `npm install` output is the receipt", () => {
    const { code, out } = cli(scratchRepo());
    expect(code).toBe(0);
    expect(out).toMatch(/Mint-gate hook: wired core\.hooksPath/);
  });
});

describe("(b) IDEMPOTENT — running it again changes nothing", () => {
  it("second run is a no-op and says so", () => {
    const dir = scratchRepo();
    installHooks(dir);
    const again = installHooks(dir);
    expect(again.action).toBe("already");
    expect(again.armed).toBe(true);
    expect(hooksPathOf(dir)).toBe(HOOKS_DIR);
  });

  it("an ABSOLUTE path spelling of the same directory counts as installed, not as a foreign value", () => {
    // `git config core.hooksPath /abs/path/.githooks` is the same wiring, written differently. A
    // path-string comparison would report it as somebody else's config and refuse to confirm.
    const dir = scratchRepo();
    git(dir, "config", "--local", "core.hooksPath", join(dir, HOOKS_DIR));
    expect(installHooks(dir).action).toBe("already");
  });
});

describe("(d) a DELIBERATE custom core.hooksPath is reported, never clobbered", () => {
  it("leaves the foreign value exactly as it was and names it", () => {
    const dir = scratchRepo();
    git(dir, "config", "--local", "core.hooksPath", "my-own-hooks");
    const res = installHooks(dir);
    expect(res.action).toBe("foreign");
    expect(res.armed).toBe(false);
    expect(res.message).toMatch(/my-own-hooks/);
    expect(res.message).toMatch(/LEFT UNTOUCHED/);
    expect(hooksPathOf(dir)).toBe("my-own-hooks"); // the developer's choice survives
  });

  it("names the SCOPE the value came from, so it can be found and changed", () => {
    const dir = scratchRepo();
    git(dir, "config", "--local", "core.hooksPath", "my-own-hooks");
    expect(installHooks(dir).message).toMatch(/local config/);
  });

  it("only an EXPLICIT --force replaces it — nothing automatic ever takes that branch", () => {
    const dir = scratchRepo();
    git(dir, "config", "--local", "core.hooksPath", "my-own-hooks");
    const res = installHooks(dir, { force: true });
    expect(res.armed).toBe(true);
    expect(hooksPathOf(dir)).toBe(HOOKS_DIR);
  });
});

describe("(c) it NEVER silently no-ops — every un-armed outcome is loud", () => {
  it("a foreign hooksPath prints the warning block and says what is lost", () => {
    const dir = scratchRepo();
    git(dir, "config", "--local", "core.hooksPath", "my-own-hooks");
    const { err, out } = cli(dir);
    expect(out).toBe("");
    expect(err).toMatch(/⚠ MINT-GATE HOOK NOT ARMED \(foreign\)/);
    expect(err).toMatch(/will NOT be stopped locally/);
    expect(err).toMatch(/required CI "Mint gate" step still blocks the merge/); // honest about the scope of the loss
  });

  it("NOT A GIT REPO is reported, not shrugged off", () => {
    const dir = join(ROOT, "tarball");
    mkdirSync(join(dir, HOOKS_DIR), { recursive: true });
    for (const h of REQUIRED_HOOKS) writeFileSync(join(dir, HOOKS_DIR, h), "#!/bin/sh\nexit 0\n");
    const { code, err } = cli(dir);
    expect(code).toBe(0); // (e) never fails `npm install`
    expect(err).toMatch(/NOT ARMED \(not-a-repo\)/);
  });

  it("a MISSING committed hook fails loudly instead of wiring an empty directory", () => {
    // Wiring core.hooksPath at an empty directory is the perfect silent no-op: git is happy, the
    // config looks right, and no hook ever runs.
    const dir = scratchRepo("no-hooks", { withHooks: false });
    const res = installHooks(dir);
    expect(res.action).toBe("missing-hooks");
    expect(res.armed).toBe(false);
    expect(hooksPathOf(dir)).toBe(""); // nothing was written
    expect(res.message).toMatch(/pre-push not found|\.githooks\/pre-push/);
  });

  it("`--check` is the strict mode: it exits 1 on an un-armed clone and writes nothing", () => {
    const dir = scratchRepo();
    const { code, err } = cli(dir, "--check");
    expect(code).toBe(1);
    expect(err).toMatch(/NOT ARMED \(would-install\)/);
    expect(hooksPathOf(dir)).toBe(""); // --check inspects, it does not install
  });

  it("`--check` passes once the clone is armed", () => {
    const dir = scratchRepo();
    installHooks(dir);
    expect(cli(dir, "--check").code).toBe(0);
  });
});

describe("(e) it can never be the reason a build fails to install its dependencies", () => {
  it("exits 0 on every failure mode except --check", () => {
    const foreign = scratchRepo("f");
    git(foreign, "config", "--local", "core.hooksPath", "my-own-hooks");
    expect(cli(foreign).code).toBe(0);
    expect(cli(join(ROOT, "does-not-exist-at-all")).code).toBe(0);
  });

  it("the CI required step is untouched by this: the gate itself is still what blocks a merge", () => {
    // Guards the one way this change could quietly weaken the mechanism — by becoming the
    // guarantee instead of the fast local warning. The workflow must keep running the gate itself.
    const wf = execFileSync("cat", [join(REPO, ".github", "workflows", "build.yml")], { encoding: "utf8" });
    expect(wf).toMatch(/node scripts\/check-mint\.mjs --ci/);
  });
});

describe("the real repo wires it through npm, so a fresh container gets it for free", () => {
  it("package.json runs the installer from `prepare` (npm install / npm ci both fire it)", () => {
    const pkg = JSON.parse(execFileSync("cat", [join(REPO, "package.json")], { encoding: "utf8" }));
    expect(pkg.scripts.prepare).toMatch(/install-hooks\.mjs/);
    expect(pkg.scripts["hooks:install"]).toMatch(/install-hooks\.mjs/);
  });

  it("the committed hook exists and actually invokes the gate", () => {
    const hook = execFileSync("cat", [join(REPO, HOOKS_DIR, "pre-push")], { encoding: "utf8" });
    expect(existsSync(join(REPO, HOOKS_DIR, "pre-push"))).toBe(true);
    expect(hook).toMatch(/check-mint\.mjs/);
  });
});

describe("hooksPlan — the pure decision, pinned branch by branch", () => {
  const ok = { isRepo: true, hookFiles: REQUIRED_HOOKS, repo: "/repo" };
  it("unset → install", () => expect(hooksPlan({ ...ok, configured: null }).action).toBe("install"));
  it("already ours → already", () => expect(hooksPlan({ ...ok, configured: HOOKS_DIR }).action).toBe("already"));
  it("someone else's → foreign, and NOT armed", () => {
    const p = hooksPlan({ ...ok, configured: "theirs", scope: "global" });
    expect(p.action).toBe("foreign");
    expect(p.armed).toBe(false);
  });
  it("no work tree → not-a-repo", () => expect(hooksPlan({ ...ok, isRepo: false, configured: null }).action).toBe("not-a-repo"));
  it("missing hook file beats every other verdict — it is checked first", () => {
    // Even a perfectly-configured hooksPath means nothing if the hook is not there.
    expect(hooksPlan({ ...ok, configured: HOOKS_DIR, hookFiles: [] }).action).toBe("missing-hooks");
  });
  it("samePath resolves relative and absolute spellings of the same directory", () => {
    expect(samePath("/repo", ".githooks", "/repo/.githooks")).toBe(true);
    expect(samePath("/repo", "other", ".githooks")).toBe(false);
  });
});
