/* BACKLOG_OPEN.md drift + tag-legend guard (B638). Fails CI if the committed repo-root BACKLOG_OPEN.md
 * differs from a fresh parse of BACKLOG.md (someone edited the backlog without regenerating the index),
 * or if an Open/Verify item uses a `#tag` not in the legend. Regenerate with
 * `node scripts/build-backlog-index.mjs`. Mirrors the ui-audit/*-audit.mjs guard pattern. */
import { describe, it, expect } from "vitest";
import { auditIndex, parseBacklog, parseLegend } from "../scripts/build-backlog-index.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("BACKLOG_OPEN.md stays in sync with BACKLOG.md", () => {
  it("no drift and no off-legend tags", () => {
    const { ok, problems } = auditIndex();
    expect(ok, "\n" + problems.join("\n") + "\n").toBe(true);
  });

  it("the legend is non-empty and every tagged item uses only legal tags", () => {
    const text = readFileSync(join(REPO, "BACKLOG.md"), "utf8");
    const legend = parseLegend(text);
    expect(legend.size).toBeGreaterThan(0);
    const items = parseBacklog(text);
    const bad = items.flatMap((i) => i.tags.filter((t) => !legend.has(t)).map((t) => `${i.id}:${t}`));
    expect(bad, JSON.stringify(bad)).toEqual([]);
  });
});
