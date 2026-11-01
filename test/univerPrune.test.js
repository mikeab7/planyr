/* NEW-1 (B2587264) — the Univer build prune: Univer's ~77 lazy hyphenation-language files are dropped at build time, English stays,
 * and the plugin fails LOUDLY (not silently) if a Univer upgrade changes the table it edits. Also pins that both Vite configs (the
 * app's and the verification sandbox's) and the formula worker's bundle register it, and that the harness's language-file detector
 * recognises every real file name (its known-good arm). */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pruneHyphenationLoaders, shortenRenderDelay, RENDER_DELAY_MS, MIN_ENTRIES } from "../scripts/vite-plugin-univer-prune.mjs";
import { isLangFile } from "../ui-audit/lib/univerLangFiles.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const ENGINE = join(ROOT, "node_modules/@univerjs/engine-render/lib/es/index.js");

const table = (tags) => `const x = 1;\nconst PATTERN_LOADERS = {\n${tags.map((t) => `\t["${t}"]: () => import("./${t}-AAAAAAAA.js"),`).join("\n")}\n\t["en-us"]: () => Promise.resolve().then(() => en_us_exports)\n};\nconst y = 2;`;
const tags = Array.from({ length: 60 }, (_, i) => `l${i}`);

describe("pruneHyphenationLoaders", () => {
  it("removes every lazy language loader and keeps en-us", () => {
    const { code, removed } = pruneHyphenationLoaders(table(tags));
    expect(removed).toBe(60);
    expect(code).not.toMatch(/import\("\.\//);
    expect(code).toContain('["en-us"]: () => Promise.resolve()');
    expect(code).toContain("const y = 2;");
  });
  it("FAILS the build when the table is gone, when too few entries match, or when en-us disappeared", () => {
    expect(() => pruneHyphenationLoaders("const nothing = 1;")).toThrow(/PATTERN_LOADERS/);
    expect(() => pruneHyphenationLoaders(table(tags.slice(0, MIN_ENTRIES - 1)))).toThrow(/at least/);
    expect(() => pruneHyphenationLoaders(table(tags).replace('["en-us"]', '["xx-us"]'))).toThrow(/en-us/);
  });
  it.skipIf(!existsSync(ENGINE))("works on the REAL installed render engine: ~77 loaders out, en-us kept, nothing lazy left in the table", () => {
    const src = readFileSync(ENGINE, "utf8");
    const { code, removed } = pruneHyphenationLoaders(src);
    expect(removed).toBeGreaterThanOrEqual(MIN_ENTRIES);
    const start = code.indexOf("const PATTERN_LOADERS = {");
    const tableText = code.slice(start, code.indexOf("\n};", start));
    expect(tableText).toContain('["en-us"]');
    expect(tableText).not.toMatch(/import\(/);
  });
});

describe("the language-file detector (the harness's known-good arm)", () => {
  const dir = join(ROOT, "node_modules/@univerjs/engine-render/lib/es");
  it.skipIf(!existsSync(dir))("matches Univer's real language files with the bundler's hash added, and nothing a Planyr chunk looks like", () => {
    const langs = readdirSync(dir).filter((f) => /^[a-z]{2,3}(-[a-z0-9]+)*-[\w-]{8}\.js$/.test(f) && f !== "index.js");
    expect(langs.length).toBeGreaterThan(50);
    for (const f of langs) expect(isLangFile(`/assets/${f.replace(/\.js$/, "")}-C81U6qP1.js`), f).toBe(true);
    for (const n of ["UniverSheet-C89Sa1mK.js", "ModelApp-DZ_MyyVb.js", "cjs-interop-BosuxZz1.js", "univerFormulaWorker-SoM7R25M.js", "index-DgworQxn.js", "keyTips-BtBEVp4j.js"]) expect(isLangFile(`/assets/${n}`), n).toBe(false);
  });
});

describe("the prune is registered everywhere a Univer bundle is made", () => {
  it("the app's Vite config (plugins AND the worker bundle), and the sandbox's", () => {
    const cfg = read("vite.config.js");
    expect(cfg).toMatch(/import univerPrune from "\.\/scripts\/vite-plugin-univer-prune\.mjs"/);
    expect(cfg).toMatch(/^\s*univerPrune\(\),/m);
    expect(cfg).toMatch(/worker:\s*\{\s*plugins:\s*\(\)\s*=>\s*\[univerPrune\(\)\]\s*\}/);
    const sb = read("ui-audit/univer-sandbox/vite.config.mjs");
    expect(sb).toMatch(/plugins:\s*\[react\(\),\s*univerPrune\(\)\]/);
    expect(sb).toMatch(/worker:\s*\{\s*plugins:\s*\(\)\s*=>\s*\[univerPrune\(\)\]\s*\}/);
  });
});

describe("shortenRenderDelay — Univer's fixed 300 ms before it paints", () => {
  const shape = (n) => `class C {\n\t_bootstrap() {\n\t\t\ttry {\n\t\t\t\tthis._renderTimeout = window.setTimeout(() => {\n\t\t\t\t\tdoRender();\n\t\t\t\t\tthis.stage = 2;\n\t\t\t\t}, ${n});\n\t\t\t} catch (e) {}\n\t}\n}\nsetTimeout(x, 300);`;
  it("changes ONLY that timer's delay, leaves its body and every other 300 alone", () => {
    const { code } = shortenRenderDelay(shape(300), 0);
    expect(code).toContain("}, 0);\n\t\t\t} catch (e) {}");
    expect(code).toContain("doRender();");
    expect(code).toContain("setTimeout(x, 300);");              // an unrelated timer elsewhere in the file is untouched
    expect(code).not.toMatch(/\}, 300\);\n\t\t\t\} catch/);
  });
  it("FAILS the build when the timer is not found exactly once, or its close is not where it was", () => {
    expect(() => shortenRenderDelay("nothing here")).toThrow(/moved the 300 ms render delay/);
    expect(() => shortenRenderDelay(shape(300) + shape(300))).toThrow(/exactly one/);
    expect(() => shortenRenderDelay("this._renderTimeout = window.setTimeout(() => {\n x \n} , 250);")).toThrow(/could not find/);
  });
  it.skipIf(!existsSync(join(ROOT, "node_modules/@univerjs/ui/lib/es/index.js")))("works on the REAL installed @univerjs/ui: exactly one delay moves, to RENDER_DELAY_MS", () => {
    const src = readFileSync(join(ROOT, "node_modules/@univerjs/ui/lib/es/index.js"), "utf8");
    const { code } = shortenRenderDelay(src);
    expect(code.length - src.length).toBe(String(RENDER_DELAY_MS).length - 3);
    const at = code.indexOf("this._renderTimeout = window.setTimeout(");
    expect(code.slice(at, at + 2600)).toMatch(new RegExp(`\\}, ${RENDER_DELAY_MS}\\);\\n\\t+\\} catch`));
  });
  it("is applied to @univerjs/ui in the build (the plugin dispatches on the file)", () => {
    expect(readFileSync(join(ROOT, "scripts/vite-plugin-univer-prune.mjs"), "utf8")).toMatch(/UI_FILE\.test\(file\)\) return \{ code: shortenRenderDelay\(code\)\.code/);
  });
});
