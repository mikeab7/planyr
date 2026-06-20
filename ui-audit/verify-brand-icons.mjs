/* Brand-icon verification (dev tool — not part of the app build). B240 + B241.
 *
 * Two parts:
 *  1) Assert the generated raster set is structurally correct: public/favicon.ico
 *     carries 16/32/48 PNG-embedded frames, and public/apple-touch-icon.png is 180x180.
 *  2) Screenshot the running app's header so the new BrandMark (coral stack + "planyr"
 *     wordmark) can be eyeballed → ui-audit/screens/brand-header.png.
 *
 * Run:  npm run build && npx vite preview    (preview must be up on :4173)
 *       node ui-audit/verify-brand-icons.mjs
 * Set PW_CHROME if the managed Chromium revision differs.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const PUBLIC = join(ROOT, "public");
const OUT = join(ROOT, "ui-audit", "screens");
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || "http://localhost:4173/";

let ok = true;
const check = (label, cond, detail = "") => { console.log(`${cond ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`); if (!cond) ok = false; };

// 1a) favicon.ico directory.
const ico = readFileSync(join(PUBLIC, "favicon.ico"));
const count = ico.readUInt16LE(4);
const sizes = [];
for (let i = 0; i < count; i++) {
  const e = 6 + i * 16;
  const w = ico.readUInt8(e) || 256;
  const off = ico.readUInt32LE(e + 12);
  const isPng = ico.slice(off, off + 8).toString("hex") === "89504e470d0a1a0a";
  sizes.push(`${w}${isPng ? "" : "(not-png!)"}`);
}
check("favicon.ico has 16/32/48 PNG frames", count === 3 && ["16", "32", "48"].every((s) => sizes.includes(s)), sizes.join("/"));

// 1b) apple-touch-icon dimensions.
const apple = readFileSync(join(PUBLIC, "apple-touch-icon.png"));
const aw = apple.readUInt32BE(16), ah = apple.readUInt32BE(20);
check("apple-touch-icon.png is 180x180", aw === 180 && ah === 180, `${aw}x${ah}`);

// 1c) scalable sources present in the deploy folder.
check("public/favicon.svg present", existsSync(join(PUBLIC, "favicon.svg")));
check("public/planyr-mark.svg present", existsSync(join(PUBLIC, "planyr-mark.svg")));

// 2) Header screenshot from the running preview.
function findChrome() {
  if (process.env.PW_CHROME && existsSync(process.env.PW_CHROME)) return process.env.PW_CHROME;
  const base = "/opt/pw-browsers";
  const revs = existsSync(base) ? readdirSync(base).filter((d) => d.startsWith("chromium-")).sort() : [];
  for (const r of revs.reverse()) { const p = join(base, r, "chrome-linux", "chrome"); if (existsSync(p)) return p; }
  throw new Error("No Chromium binary found; set PW_CHROME.");
}
const shot = join(OUT, "brand-header.png");
try {
  execFileSync(findChrome(), [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
    "--ignore-certificate-errors", "--force-device-scale-factor=1",
    "--virtual-time-budget=12000", "--window-size=1280,220",
    `--screenshot=${shot}`, BASE,
  ], { stdio: ["ignore", "ignore", "ignore"] });
  const png = readFileSync(shot);
  check("captured header screenshot", png.readUInt32BE(16) === 1280, `ui-audit/screens/brand-header.png ${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`);
} catch (e) {
  check("captured header screenshot", false, "preview not reachable on " + BASE + " (start `npx vite preview`) — " + e.message);
}

console.log(ok ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
process.exit(ok ? 0 : 1);
