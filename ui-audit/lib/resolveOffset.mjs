/* resolveOffset — map a minified-chunk CHARACTER OFFSET (what LoAF's sourceCharPosition and perfcap's `…:13985` labels carry) to the original
 * source position through the chunk's sourcemap. Used to name the code behind a long task in a build made with `--sourcemap`. */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
const maps = new Map();
const traceMapOf = (f) => { if (!maps.has(f)) maps.set(f, new TraceMap(JSON.parse(readFileSync(f, "utf8")))); return maps.get(f); };
export function offsetToLineCol(text, off) { let line = 0, last = -1; for (let i = text.indexOf("\n"); i !== -1 && i < off; i = text.indexOf("\n", i + 1)) { line++; last = i; } return { line: line + 1, column: off - last - 1 }; }
export function resolveOffset(distDir, chunk, off) {
  const f = join(distDir, "assets", chunk), m = f + ".map";
  if (!existsSync(f) || !existsSync(m)) return null;
  const { line, column } = offsetToLineCol(readFileSync(f, "utf8"), off);
  const o = originalPositionFor(traceMapOf(m), { line, column });
  return { chunkLine: line, chunkCol: column, ...o };
}
export function resolveCallFrame(distDir, url, line0, col0) {
  const chunk = String(url).split("/").pop().split("?")[0], m = join(distDir, "assets", chunk + ".map");
  if (!existsSync(m)) return null;
  const o = originalPositionFor(traceMapOf(m), { line: line0 + 1, column: col0 });
  return o && o.source ? `${o.name || "?"} @ ${String(o.source).replace(/^(\.\.\/)+/, "")}:${o.line}` : null;
}
