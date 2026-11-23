/* ONE cached source reader for source-scan tests (audit batch D, 2026-11-23). ~200 tests each defined their own
 * `read` / `src` that re-read the same files from disk; use this instead. `srcRead("src/app/Shell.jsx")` reads a
 * repo-relative path (UTF-8) once per worker and returns the cached text afterwards.
 * A NEW test that scans source text must carry a `// source-scan: <reason>` comment — see test/sourceScanGuard.test.js. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const cache = new Map();
export function srcRead(relPath) {
  let t = cache.get(relPath);
  if (t === undefined) { t = readFileSync(ROOT + relPath, "utf8"); cache.set(relPath, t); }
  return t;
}
export const repoRoot = ROOT;
