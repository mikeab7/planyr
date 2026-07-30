/* NEW-3 (B1128) — THE DEAD-STORE RATCHET.
 *
 * WHY THIS EXISTS. Three "computed but never rendered" defects surfaced in five dispatches: the
 * invisible Buildability panel rows (B815-era), a ParcelDrawing swatch row reported missing though
 * B567 records it shipped, and `detVerdict`/`detTone`/`detSub` in `SitePlanner.jsx` — assigned by
 * every branch of the detention verdict block and read by none (B1110). That is not three
 * coincidences, it is a class, and it is invisible to every gate this repo had: the build compiles
 * a dead store happily, the unit suite never imports the JSX, and a test that asserts an element
 * EXISTS in the tree says nothing about whether its value reached the DOM.
 *
 * WHAT THIS CATCHES — and, just as importantly, what it does NOT.
 *
 *   ✅ CAUGHT: the VARIABLE variant. A local that is written (once or in every branch) and never
 *      read. This is exactly the B1110 shape, and ESLint's `no-unused-vars` already knows how to see
 *      it — the rule was simply never enabled (`eslint.config.js` is deliberately minimal).
 *
 *   ❌ NOT CAUGHT: the REACHABILITY variant. A variable that IS read, feeding JSX that never mounts,
 *      renders zero-height, or sits behind a condition that is never true — the Buildability-rows and
 *      swatch-row shape. No static rule can see that; it needs a headless assertion on the real DOM
 *      that the node is present AND has a non-zero box AND its text is non-empty. Filed separately
 *      rather than pretended away here.
 *
 * WHY A RATCHET RATHER THAN A CLEAN GATE. Turning `no-unused-vars` on as an error today fails in 136
 * places (90 in `src/`), most of them harmless (unused icon components, destructured setters). Fixing
 * all of them is not this block's job and would be a large untested diff across the whole app. So the
 * baseline is FROZEN per file and the count may only go DOWN: a new dead store fails CI immediately,
 * while the existing ones are paid off whenever a session is in that file anyway. Cheap, no
 * false-positive tax, and it makes the class non-recurring from today.
 *
 * Usage:
 *   node ui-audit/dead-store-audit.mjs            # report
 *   node ui-audit/dead-store-audit.mjs --check     # CI gate: fail if any file got WORSE
 *   node ui-audit/dead-store-audit.mjs --update    # rewrite the baseline (see the guard below)
 */
import { ESLint } from "eslint";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const BASELINE = resolve(here, "dead-store-baseline.json");

/* Only the "assigned a value but never used" half of `no-unused-vars`. Unused IMPORTS and unused
 * function PARAMS are a different (cosmetic) matter and are deliberately out of scope — mixing them
 * in would triple the baseline and bury the signal this audit exists for. */
const ASSIGNED_ONLY = /is assigned a value but never used/;

/* ⚠ A FALSE-POSITIVE CLASS, closed 2026-07-30 (B1064 tranche a).
 *
 * `no-unused-vars` alone cannot see a JSX reference. ESLint's React plugin supplies that with
 * `react/jsx-uses-vars`, and this audit's inline config has no plugins at all — so EVERY component
 * that is declared as a `const` and used only in markup was being counted as a dead store. That is
 * how the audit came to report "30 look like unused COMPONENTS/constants (cosmetic dead code)": most
 * of them are not dead at all, they are rendered.
 *
 * It stopped being merely cosmetic the moment a component had to be declared rather than imported.
 * `const SiteAnalysis = lazy(() => import(…))` — the exact shape this repo's own bundle budget asks
 * for, and the shape `PondSection` and `SiteReviewModal` already use — reads to the rule as an
 * assignment nobody uses, so moving a panel off the critical path made the ratchet go RED for doing
 * the right thing. A guard that fires on the fix it is supposed to encourage will be worked around,
 * and a worked-around guard protects nothing.
 *
 * Rather than add eslint-plugin-react as a dependency for one rule, the fix is the rule's own
 * definition, applied here: an identifier that appears as a JSX tag in the same file IS used. Named
 * conservatively — it only ever REMOVES reports, and only for a name that literally appears as
 * `<Name`, `</Name`, `<Name.Sub` or `<Name/>` in that file's source. Everything the audit exists to
 * catch (the B1110 `detVerdict` / `detTone` / `detSub` shape — plain values, never in markup) is
 * untouched. */
export function usedInJsx(source, name) {
  if (!/^[A-Z_$]/.test(name)) return false; // only a component-shaped identifier can be a JSX tag
  return new RegExp(`</?${name.replace(/[$]/g, "\\$")}(?=[\\s/>.])`).test(source);
}

export async function collect() {
  const eslint = new ESLint({
    cwd: repo,
    overrideConfig: [{
      files: ["**/*.{js,jsx}"],
      rules: { "no-unused-vars": ["error", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" }] },
    }],
  });
  const results = await eslint.lintFiles(["src", "ui-audit/lib", "server", "functions", "scripts"]);
  const byFile = {};
  const detail = [];
  for (const r of results) {
    const rel = r.filePath.replace(repo + "/", "");
    const source = r.source ?? readFileSync(r.filePath, "utf8");
    for (const m of r.messages) {
      if (m.ruleId !== "no-unused-vars" || !ASSIGNED_ONLY.test(m.message)) continue;
      if (usedInJsx(source, (m.message.match(/'([^']+)'/) || [])[1] || "")) continue; // rendered, not dead
      byFile[rel] = (byFile[rel] || 0) + 1;
      const name = (m.message.match(/'([^']+)'/) || [])[1] || "?";
      detail.push({ file: rel, line: m.line, name, kind: /^[A-Z]/.test(name) ? "component" : "value" });
    }
  }
  return { byFile, detail };
}

const readBaseline = () => JSON.parse(readFileSync(BASELINE, "utf8"));

/* The comparison. A file may improve or vanish freely; it may never regress, and a file absent from
 * the baseline must be clean. */
export function compare(byFile, baseline) {
  const base = baseline.files || {};
  const worse = [], better = [], fresh = [];
  for (const [file, n] of Object.entries(byFile)) {
    const b = base[file];
    if (b == null) fresh.push({ file, n });
    else if (n > b) worse.push({ file, was: b, now: n });
    else if (n < b) better.push({ file, was: b, now: n });
  }
  for (const [file, b] of Object.entries(base)) if (!byFile[file] && b > 0) better.push({ file, was: b, now: 0 });
  return { worse, better, fresh };
}

const args = process.argv.slice(2);
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const { byFile, detail } = await collect();
  const total = Object.values(byFile).reduce((a, b) => a + b, 0);

  if (args.includes("--update")) {
    const next = { note: "Frozen count of assigned-but-never-used locals per file. May only DECREASE — see ui-audit/dead-store-audit.mjs.", total, files: byFile };
    /* The baseline is a RATCHET, so --update refuses to raise a total. Paying one off writes a
     * smaller number; adding one has to be fixed, not blessed. */
    try {
      const prev = readBaseline();
      if (total > (prev.total ?? Infinity)) {
        console.error(`✗ refusing to raise the baseline (${prev.total} → ${total}). A NEW dead store must be fixed, not recorded.`);
        console.error("  If a value is genuinely needed-but-unread, prefix it with _ or delete it.");
        process.exit(1);
      }
    } catch { /* no baseline yet — first write */ }
    writeFileSync(BASELINE, JSON.stringify(next, null, 2) + "\n");
    console.log(`✓ baseline written: ${total} across ${Object.keys(byFile).length} files`);
    process.exit(0);
  }

  if (args.includes("--check")) {
    const { worse, fresh, better } = compare(byFile, readBaseline());
    for (const w of worse) console.error(`✗ ${w.file}: ${w.was} → ${w.now} dead stores`);
    for (const f of fresh) console.error(`✗ ${f.file}: ${f.n} dead store(s) in a file with none at baseline`);
    if (better.length) console.log(`✓ ${better.length} file(s) improved — run --update to bank it`);
    if (worse.length || fresh.length) {
      console.error("\nA value computed and never read is the B1110 class: it reads as a rendered fact and is not one.");
      console.error("Either render it, delete it, or prefix it with _ to declare it deliberately unused.");
      process.exit(1);
    }
    console.log(`✓ dead-store ratchet holds (${total} known, none new)`);
    process.exit(0);
  }

  console.log(`Assigned-but-never-used locals: ${total} across ${Object.keys(byFile).length} files\n`);
  const comps = detail.filter((d) => d.kind === "component").length;
  console.log(`  ${comps} look like unused COMPONENTS/constants (cosmetic dead code)`);
  console.log(`  ${detail.length - comps} look like unused VALUES (the B1110 risk shape)\n`);
  for (const [file, n] of Object.entries(byFile).sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    console.log(`  ${String(n).padStart(3)}  ${file}`);
  }
}
