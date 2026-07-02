/* Per-folder CLAUDE.md pointer freshness guard.
 *
 * The per-folder `src/** /CLAUDE.md` notes exist to give a session working in that folder a
 * quick "what's here + key files" orientation without bloating the always-loaded root
 * CLAUDE.md. Their one failure mode is going stale: a key file gets renamed or deleted and
 * the pointer still names the old path, silently misleading the next session.
 *
 * This guard catches exactly that. For every `src/** /CLAUDE.md`, it extracts each code-file
 * reference (a backtick-or-bare token ending in .js/.jsx/.mjs/.ts/.tsx/.sql/.css) and asserts
 * a file matching it still exists somewhere under that pointer's own folder. A miss = the
 * folder's contents changed but the pointer wasn't updated → fail (exit 1 / red test).
 *
 * It deliberately does NOT require every file in the folder to be mentioned — pointers are a
 * curated shortlist of KEY files, so listing new files is a judgement call, not a hard rule.
 * It only fails on a reference that no longer resolves.
 *
 * Run: node ui-audit/doc-pointer-audit.mjs   (exit 1 on any stale reference)
 * Mirrors ui-audit/gis-source-audit.mjs + ui-audit/contrast-audit.mjs (parse real files,
 * export an audit fn the unit test imports, exit non-zero standalone).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, basename, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const SRC = join(REPO, "src");

const CODE_EXT = /\.(?:js|jsx|mjs|ts|tsx|sql|css)$/;

function walk(dir, onFile) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, onFile);
    else onFile(full);
  }
}

// All per-folder pointer files under src/.
export function findPointerFiles() {
  const out = [];
  walk(SRC, (f) => {
    if (basename(f) === "CLAUDE.md") out.push(f);
  });
  return out.sort();
}

// Extract code-file references from a pointer's text. Matches tokens like `siteModel.js`,
// `components/LayerPanel.jsx`, `tools.matrix.js`, `theme/palette.js`. Ignores .md (those are
// cross-doc pointers, not folder contents) and non-file identifiers (no code extension).
export function referencedFiles(text) {
  const refs = new Set();
  for (const m of text.matchAll(/[A-Za-z0-9_./-]+\.(?:js|jsx|mjs|ts|tsx|sql|css)\b/g)) {
    refs.add(m[0]);
  }
  return [...refs];
}

// Every filesystem path under a folder (relative to that folder, forward slashes).
function filesUnder(dir) {
  const out = [];
  walk(dir, (f) => out.push(relative(dir, f).split("\\").join("/")));
  return out;
}

export function auditDocPointers() {
  const problems = [];
  for (const pointer of findPointerFiles()) {
    const folder = dirname(pointer);
    const files = filesUnder(folder);
    const text = readFileSync(pointer, "utf8");
    for (const ref of referencedFiles(text)) {
      const hit = files.some(
        (f) => f === ref || f.endsWith("/" + ref) || basename(f) === basename(ref)
      );
      if (!hit) {
        problems.push(
          `${relative(REPO, pointer)} references \`${ref}\` — no matching file under ${relative(REPO, folder)}/ (renamed or deleted? update the pointer)`
        );
      }
    }
  }
  return { problems, ok: problems.length === 0 };
}

// Run as a script → print + exit non-zero on any stale reference.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { problems, ok } = auditDocPointers();
  const n = findPointerFiles().length;
  if (!ok) {
    console.error("✗ Stale per-folder CLAUDE.md pointer(s):");
    for (const p of problems) console.error("  - " + p);
  } else {
    console.log(`✓ Doc pointers OK — ${n} per-folder CLAUDE.md file(s), every code-file reference resolves.`);
  }
  process.exit(ok ? 0 : 1);
}
