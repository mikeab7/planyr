#!/usr/bin/env node
/* NEW-1 (one overlay engine) — RASTER PARITY, measured. Serves a repo checkout with vite dev, loads
 * ui-audit/fixtures/overlay-raster-parity-harness.html, hashes the real pixels both PDF rasterisers
 * produce for the committed sample sheets, and prints/writes them. Run it once in a checkout from
 * BEFORE the engine refactor and once AFTER; every hash must match.
 *   node ui-audit/verify-overlay-raster-parity.mjs <repoRoot> [--out file.json]
 * Fails (void run) if either rasteriser errored or produced nothing — never prints a score for a
 * path that did not run. */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { writeFile, copyFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const root = resolve(process.argv[2] || ".");
const outIdx = process.argv.indexOf("--out");
const outFile = outIdx > 0 ? process.argv[outIdx + 1] : null;
const PORT = 5200 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
// the harness page lives in THIS checkout's ui-audit; make sure the tree under test serves it too
try { await copyFile(new URL("./fixtures/overlay-raster-parity-harness.html", import.meta.url), join(root, "ui-audit/fixtures/overlay-raster-parity-harness.html")); } catch (_) { /* same tree */ }
const vite = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { cwd: root, stdio: "ignore" });
let ok = false;
try {
  for (let i = 0; i < 80 && !ok; i++) { try { const r = await fetch(BASE); ok = r.ok || r.status === 404; } catch (_) { await delay(500); } }
  if (!ok) throw new Error("dev server did not come up");
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(`${BASE}/ui-audit/fixtures/overlay-raster-parity-harness.html`, { waitUntil: "load" });
  await assertMeasurable(page, "verify-overlay-raster-parity");
  const res = await page.evaluate(() => window.runRasterParity());
  await browser.close();
  const rows = Object.entries(res);
  for (const [k, v] of rows) console.log((v.error ? "ERR " : "ok  ") + k.padEnd(52) + (v.error || `${v.w || v.imgW}x${v.h || v.imgH}  ${v.sha.slice(0, 16)}`));
  const bad = rows.filter(([, v]) => v.error || !v.sha);
  if (outFile) await writeFile(outFile, JSON.stringify(res, null, 1));
  console.log(bad.length || rows.length < 9 ? `VOID ❌ — ${bad.length} path(s) did not run (${rows.length} rows)` : "CAPTURED ✅ " + rows.length + " rasters hashed");
  if (errs.length) console.log("page errors:", errs.slice(0, 3));
  process.exitCode = bad.length || rows.length < 9 ? 1 : 0;
} finally { vite.kill(); }
