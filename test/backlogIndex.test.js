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

  /* ⛔ THE RECURRENCE MARKER MUST NOT HIDE AN ITEM, and for a long time it did. The heading pattern
   * required the em-dash to follow the id immediately, so `### B1121 (×3) — …` — the shape the
   * recurrence rule (B636) mandates for a fix that did not stick — failed to match and the item was
   * dropped from the index SILENTLY. Eleven Open/Verify items were missing when this was found
   * (2026-08-08), including **B1121**, the oldest unexplained bug in the speed program and the one
   * `CLAUDE.md` points sessions at. A dropped item is indistinguishable from an item that does not
   * exist, which is the worst failure mode an index can have — and it selected precisely for the
   * items that matter most. */
  it("indexes recurrence-marked items, and carries the count into the row", () => {
    const text = readFileSync(join(REPO, "BACKLOG.md"), "utf8");
    const items = parseBacklog(text);
    const headings = [...text.matchAll(/^###\s+(B\d+)\s*\(×(\d+)\)\s*[—-]/gm)].map((m) => m[1]);
    expect(headings.length, "no recurrence-marked heading in BACKLOG.md to test against").toBeGreaterThan(0);
    const indexed = new Set(items.map((i) => i.id));
    const index = readFileSync(join(REPO, "BACKLOG_OPEN.md"), "utf8");
    for (const id of headings) {
      /* Only Open/Verify items are indexed at all — a recurrence sitting in Later/Roadmap is
       * legitimately absent, so assert the row only for ids the parser actually collected. */
      if (!indexed.has(id)) continue;
      const it_ = items.find((i) => i.id === id);
      expect(it_.recurrences, `${id} lost its recurrence count`).toBeGreaterThan(1);
      expect(index, `${id} is missing from BACKLOG_OPEN.md`).toMatch(new RegExp(`^\\| ${id} \\(×${it_.recurrences}\\) \\|`, "m"));
    }
  });

  it("an item with no recurrence marker carries no count, and its row is the bare id", () => {
    const items = parseBacklog(readFileSync(join(REPO, "BACKLOG.md"), "utf8"));
    const plain = items.find((i) => !i.recurrences);
    expect(plain, "no plain item found").toBeTruthy();
    expect(plain.recurrences).toBeNull();
    expect(readFileSync(join(REPO, "BACKLOG_OPEN.md"), "utf8")).toMatch(new RegExp(`^\\| ${plain.id} \\|`, "m"));
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
