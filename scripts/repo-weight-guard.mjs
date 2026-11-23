// Repo-weight guard (audit batch D, 2026-11-23). Fails when a tracked .png/.jpg/.gif/.webp/.pdf is over
// LIMIT_BYTES and not on the allowlist. Screenshots are regenerated output — never commit them (they stay
// in git history only). A genuine test input/asset that must be committed: add it to ALLOW with a reason.
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";

const LIMIT_BYTES = 200 * 1024;
const ALLOW = new Map([
  ["public/landing/og.png", "the landing page's social-share image"],
  ["test/fixtures/deeds/deed-poa-parcel3.pdf", "deed-parse test fixture"],
]);
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 })
  .split("\0").filter((f) => /\.(png|jpe?g|gif|webp|pdf)$/i.test(f));
const bad = [];
for (const f of files) {
  let size; try { size = statSync(f).size; } catch { continue; }
  if (size > LIMIT_BYTES && !ALLOW.has(f)) bad.push(`${f} (${Math.round(size / 1024)} KB)`);
}
if (bad.length) {
  console.error(`Repo-weight guard: ${bad.length} tracked image/PDF file(s) over ${LIMIT_BYTES / 1024} KB and not on the allowlist:\n  ` + bad.join("\n  ") +
    `\nScreenshots are generated output: write them to a gitignored folder (ui-audit/.artifacts/) or attach them to the PR. A real test input goes in ALLOW in scripts/repo-weight-guard.mjs, with a reason.`);
  process.exit(1);
}
console.log(`Repo-weight guard: ok (${files.length} images/PDFs tracked, none over the limit outside the allowlist).`);
