/* NEW-4 (owner report, 2026-09-15 — "sometimes when I'm clicking between modules... it takes me
 * to the wrong place"). One strand of the investigation instrumented `pushState`/`replaceState`/
 * `hashchange`/`popstate` on a real click and found a `popstate` firing ~1ms after the click,
 * ahead of the `hashchange` the app actually listens to, and read this as "the router runs twice
 * per navigation." Re-checked here: `git grep -n "addEventListener(\"popstate\""` across `src/`
 * finds NOTHING — no code in this app ever listens to `popstate`, so that early event has no
 * observable effect on React state (only `hashchange` drives `useHashRoute`'s `route` state, and
 * it fires exactly once per hash write). The popstate/hashchange pair is a well-documented,
 * browser-native side effect of assigning `location.hash` (a same-document navigation queues a
 * `popstate` ahead of the `hashchange` task) — not application code dispatching anything, and not
 * itself a bug. `pushState`/`replaceState` were confirmed NEVER called for an ordinary navigation
 * (route.js's `navigate()` assigns `location.hash` directly, which is what makes a hash route
 * shareable/refresh-stable without a server-side catch-all — see route.js's own header).
 *
 * The REAL risk the investigation named is real, though, and this is the guard for it: a SECOND
 * piece of code writing `window.location.hash` directly — bypassing `navigate()`/`onNavigate` —
 * races whatever the deliberate navigation just committed. `route.js`'s own `navigate()` is
 * already the ONE canonical writer every module tab, breadcrumb pick and cross-module intent goes
 * through; NEW-1 in this same session closed exactly this class for Scheduler.jsx's carry-out
 * effect (it went through `onProjectChange` → `navigate()`, but was triggered by ambient state
 * rather than a real user choice — see schedulerLinkPanel.test.js). Two call sites bypass
 * `navigate()` on purpose, each for a documented, narrow reason (see the allowlist below); this
 * test pins the COMPLETE set of direct `window.location.hash =` writers in `src/`, so a THIRD one
 * added anywhere else — the shape that would silently reopen this bug family — fails CI by name
 * instead of surviving unreviewed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsx?|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

// A direct assignment to `location.hash` — never a comparison (`===`/`!==`), never `.replace(`,
// never a read, never a comment. The negative lookahead on `=` excludes `==`/`===`.
const HASH_ASSIGN_RE = /(?:window\.)?location\.hash\s*=(?!=)/;

function findWriteSites() {
  const sites = [];
  for (const file of walk(SRC)) {
    const text = readFileSync(file, "utf8");
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      // Skip a line that is (or starts) a `//` comment — the guard is about live code, and this
      // repo's convention is to discuss past writers/workarounds in prose right beside the real one.
      const codePart = line.split("//")[0];
      if (HASH_ASSIGN_RE.test(codePart)) {
        sites.push({ file: file.slice(ROOT.length), line: i + 1, text: line.trim() });
      }
    });
  }
  return sites.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
}

// The COMPLETE, reviewed set. Each entry names WHY it may write directly instead of going
// through `navigate()`/`onNavigate` — adding a row here is a real review, not a rubber stamp.
const ALLOWED = [
  {
    file: "src/app/route.js",
    // navigate() — the one canonical writer every module tab, breadcrumb pick and cross-module
    // intent (onNavigate) goes through. This IS the choke point every other writer is measured
    // against.
    match: /window\.location\.hash = nextHash;/,
  },
  {
    file: "src/app/Shell.jsx",
    // goDashboard() — the Dashboard is not a {module,projectId,cross,org} value `navigate()`'s
    // partial-merge shape can express (see route.js's isDashboardRoute + this function's own
    // header comment), so it writes the literal hash directly. Guarded against re-writing an
    // UNCHANGED hash (the `!==` check), which is what makes leaving admin/design always fire a
    // real hashchange while re-clicking the wordmark while already on the Dashboard is a no-op.
    match: /if \(typeof window !== "undefined" && window\.location\.hash !== DASHBOARD_HASH\) window\.location\.hash = DASHBOARD_HASH;/,
  },
  {
    file: "src/app/AccountControl.jsx",
    // The account menu's "Admin" row — #/admin is deliberately NOT a module slug `navigate()`
    // resolves (route.js's own header: "never shows up in route.module"), so it is reached the
    // same direct way Shell.jsx reads it back off the raw hash (`isAdminRoute`).
    match: /setAcctOpen\(false\); window\.location\.hash = "#\/admin";/,
  },
];

describe("NEW-4 — window.location.hash is written from exactly the reviewed set of places", () => {
  const sites = findWriteSites();

  it("finds at least the three known writers (the sweep itself is working)", () => {
    expect(sites.length).toBeGreaterThanOrEqual(3);
  });

  it("every write site in src/ is on the reviewed allowlist, by file AND exact shape", () => {
    const unmatched = sites.filter((s) => !ALLOWED.some((a) => a.file === s.file && a.match.test(s.text)));
    expect(unmatched, `Unreviewed window.location.hash write(s):\n${JSON.stringify(unmatched, null, 2)}`).toEqual([]);
  });

  it("every allowlist row is actually used — the list can only shrink by review, never rot stale", () => {
    const unused = ALLOWED.filter((a) => !sites.some((s) => s.file === a.file && a.match.test(s.text)));
    expect(unused, `Allowlist row(s) with no matching site left in src/ (stale — remove them):\n${JSON.stringify(unused, null, 2)}`).toEqual([]);
  });

  it("no application code listens for popstate — the early event the investigation flagged is inert here", () => {
    for (const file of walk(SRC)) {
      const text = readFileSync(file, "utf8");
      expect(text, `${file.slice(ROOT.length)} adds a popstate listener — re-check whether this reopens the "two commits per click" risk`)
        .not.toMatch(/addEventListener\(\s*["']popstate["']/);
    }
  });

  // MUTATION PROOF — a synthetic third writer, in a file that is not on the allowlist, must be
  // caught. Runs the real detector logic against an in-memory fixture rather than trusting the
  // shape of the assertion above.
  it("MUTATION PROOF — a new, unreviewed direct hash write is caught by the same regex the sweep uses", () => {
    const rogueLine = '  const goSomewhereElse = () => { window.location.hash = "#/rogue"; };';
    expect(HASH_ASSIGN_RE.test(rogueLine.split("//")[0])).toBe(true);
    const looksAllowed = ALLOWED.some((a) => a.match.test(rogueLine.trim()));
    expect(looksAllowed).toBe(false);
  });
});
