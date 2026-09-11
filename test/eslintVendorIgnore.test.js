/* eslint.config.js ignored `ui-audit/.cache-vendor/**` for the CDN libs the Schedule live-verify
 * harnesses vendor locally (React/Babel/Supabase) — but the actual vendoring code
 * (`ui-audit/lib/vendorCdn.mjs`) writes to `ui-audit/.vendor/`, a different directory that was
 * renamed at some point without updating this ignore list. `.gitignore` had the correct name;
 * `eslint.config.js` did not. Running any of the `verify-*.mjs` Schedule harnesses locally before
 * `npm run lint` therefore left 32 real `no-undef`/`no-func-assign` errors from a vendored,
 * pre-minified third-party bundle on disk — a gitignored artifact nobody meant to lint, and a
 * false lint failure for the next session that happens to run the harnesses first (discovered
 * exactly that way while shipping the multi-owner Schedule feature).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const eslintConfigSrc = readFileSync(resolve(here, "../eslint.config.js"), "utf8");
const vendorCdnSrc = readFileSync(resolve(here, "../ui-audit/lib/vendorCdn.mjs"), "utf8");

describe("eslint.config.js ignores the REAL vendor cache directory the harnesses actually write to", () => {
  it("vendorCdn.mjs's own DIR constant is reflected in the ignore list", () => {
    const dirMatch = vendorCdnSrc.match(/const DIR = new URL\("\.\.\/(\..*?)\/", import\.meta\.url\)/);
    expect(dirMatch, "vendorCdn.mjs must define DIR relative to ui-audit/").toBeTruthy();
    const vendorDirName = dirMatch[1]; // e.g. ".vendor"
    expect(eslintConfigSrc, `eslint.config.js must ignore ui-audit/${vendorDirName}/** — the directory vendorCdn.mjs actually writes to`)
      .toContain(`ui-audit/${vendorDirName}/**`);
  });
  it("the gitignore'd name and the eslint-ignored name agree", () => {
    const gitignore = readFileSync(resolve(here, "../.gitignore"), "utf8");
    expect(gitignore).toMatch(/ui-audit\/\.vendor\//);
    expect(eslintConfigSrc).toContain("ui-audit/.vendor/**");
  });
});
