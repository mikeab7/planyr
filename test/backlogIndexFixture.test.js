/* The BACKLOG_OPEN.md generator, exercised on the tiny FIXTURE ledger (test/fixtures/ledger-mini) — NEW-1, 2026-11-05.
 * The live-ledger checks (legend, recurrence counts on real data) moved to test/ledger-data/ because the ledger now lives on its
 * own branch; this keeps the generator itself covered in main's build without depending on any live record. */
import { describe, it, expect } from "vitest";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readText } from "../scripts/lib/ledger.mjs";
import { parseBacklog, renderIndex } from "../scripts/build-backlog-index.mjs";

const FIXTURE = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "test", "fixtures", "ledger-mini");

describe("BACKLOG_OPEN.md generator on the fixture ledger", () => {
  it("indexes Open and Verify entries only, with their tags, and renders a row per item", () => {
    const text = readText(FIXTURE, "BACKLOG.md");
    const items = parseBacklog(text);
    expect(items.map((i) => i.id).sort()).toEqual(["B100", "B90"]);   // B80 is done — never indexed
    const out = renderIndex(items);
    expect(out).toMatch(/^\| B100 \|/m);
    expect(out).toMatch(/^\| B90 \|/m);
    expect(out).not.toMatch(/B80/);
  });
});
