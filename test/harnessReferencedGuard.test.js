/* GUARD (audit batch D, 2026-11-23) — a top-level ui-audit/*.mjs harness must be referenced from somewhere
 * (package.json, a workflow, scripts/, test/, e2e/, another harness, docs) or carry a `// one-off` header comment.
 * Otherwise it is dead weight: move it to ui-audit/archive/. The 160-odd harnesses cited only by open ledger items
 * when this was written are frozen in ui-audit/harness-unreferenced-allowlist.txt (never add to it). */
// source-scan: scans repo text for references to harness names; no src/ behaviour involved.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
describe("harness reference guard", () => {
  it("every top-level harness is referenced or marked one-off", () => {
    const allow = new Set(readFileSync(ROOT + "ui-audit/harness-unreferenced-allowlist.txt", "utf8").split("\n").filter(Boolean));
    const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 }).split("\0")
      .filter((f) => f && !/\.(png|jpe?g|gif|webp|pdf|woff2?|ico|xlsx|zip|gz|mp4|glb|tif)$/i.test(f));
    const texts = new Map();
    for (const f of tracked) { try { texts.set(f, readFileSync(ROOT + f, "utf8")); } catch { /* deleted in working tree */ } }
    const harnesses = readdirSync(ROOT + "ui-audit").filter((n) => n.endsWith(".mjs"));
    const bad = [];
    for (const h of harnesses) {
      if (allow.has(h)) continue;
      const self = `ui-audit/${h}`;
      const name = h.replace(/\.mjs$/, "");
      const own = texts.get(self) ?? "";
      if (/^\s*\/\/\s*one-off\b/im.test(own.split("\n").slice(0, 15).join("\n"))) continue;
      let referenced = false;
      for (const [f, t] of texts) { if (f !== self && t.includes(name)) { referenced = true; break; } }
      if (!referenced) bad.push(h);
    }
    expect(bad, `reference these from a gate/test/doc, add a "// one-off" header, or git mv to ui-audit/archive/:\n${bad.join("\n")}`).toEqual([]);
  });
});
