/* Vite plugin — prune what the Univer grid never loads (NEW-1, B2587264; docs/SPREADSHEET-UNIVER-SPIKE.md cutover step 4).
 *
 * WHAT. Univer's render engine carries a table of ~77 per-language HYPHENATION pattern files, each a lazily imported chunk
 * (`["de-1901"]: () => import("./de-1901-….js")`). They are used only for a document whose section turns automatic hyphenation
 * ON; a spreadsheet cell never does (the grid draws wrapped text, it does not hyphenate), so on a sheet — English or not —
 * Univer never asks for one. Left in, the bundler emits all 77 as separate files (about 4.4 MB raw / 1 MB compressed in every
 * deploy) and, worse, makes the render engine a CODE-SPLITTING input, which a Web Worker bundle cannot be (the formula worker,
 * lib/univerFormulaWorker.js, pulls the engine in through @univerjs/sheets).
 * WHAT STAYS. The `en-us` entry (already inside the render engine's own file and preloaded by its constructor) — English text
 * hyphenates as before. Univer's own loader returns quietly when a language has no entry (`if (!loader) return;`), so a
 * non-English paragraph that DID ask for a pattern would simply not hyphenate: the cell still draws, wrapped.
 * LOUD-FAILURE. This edits a third-party file by shape, so it must not fail silently when Univer is upgraded: if the table is not
 * found, or fewer than MIN_ENTRIES loaders are removed, or the en-us entry is gone, the BUILD FAILS naming this file.
 * Guard: repo-root `test/` **univerPrune** (the transform, its failure modes, and that both Vite configs register it). */
const ENGINE_FILE = /[\\/]@univerjs[\\/]engine-render[\\/]lib[\\/]es[\\/]index\.js$/;
const LOADER_LINE = /^[ \t]*\["[\w-]+"\]: \(\) => import\("\.\/[^"]+"\),?[ \t]*\r?\n/gm;
export const MIN_ENTRIES = 50;                 // Univer 1.3.1 has 77; a handful means the table's shape changed
const TABLE_MARK = "const PATTERN_LOADERS = {";

export function pruneHyphenationLoaders(code) {
  if (!code.includes(TABLE_MARK)) throw new Error("vite-plugin-univer-prune: @univerjs/engine-render no longer has `PATTERN_LOADERS` — the Univer upgrade changed it; update scripts/vite-plugin-univer-prune.mjs (do NOT just delete the plugin: the build would emit ~77 unused files again and the formula worker would stop bundling)");
  let removed = 0;
  const out = code.replace(LOADER_LINE, () => { removed++; return ""; });
  if (removed < MIN_ENTRIES) throw new Error(`vite-plugin-univer-prune: expected to remove at least ${MIN_ENTRIES} lazy hyphenation loaders, removed ${removed} — the shape of Univer's table changed`);
  if (!/\["en-us"\]: \(\) => Promise\.resolve\(\)/.test(out)) throw new Error("vite-plugin-univer-prune: the en-us hyphenation entry is gone from Univer's table — English would lose hyphenation");
  if (/PATTERN_LOADERS[\s\S]{0,4000}?import\("\.\//.test(out.slice(out.indexOf(TABLE_MARK), out.indexOf(TABLE_MARK) + 4000))) throw new Error("vite-plugin-univer-prune: a lazy hyphenation loader survived the prune");
  return { code: out, removed };
}

export default function univerPrune() {
  return {
    name: "planyr-univer-prune",
    apply: "build",
    enforce: "pre",
    transform(code, id) {
      if (!ENGINE_FILE.test(id.split("?")[0])) return null;
      return { code: pruneHyphenationLoaders(code).code, map: null };
    },
  };
}
