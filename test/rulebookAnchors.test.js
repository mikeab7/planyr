// source-scan: reads the rulebook (CLAUDE.md, docs/decisions) and the Site Planner folder pointer, which are documentation, not code under test
/* rulebookAnchors — guard for the SLIMMED CLAUDE.md (audit batch H, 2026-11-23).
 *
 * CLAUDE.md keeps each rule/constraint as a short statement with a stable anchor comment
 * (`<!--rule:NAME-->`, `<!--constraint:N-->`); the verbatim backstory lives in docs/decisions/. This suite is what stops
 * the split rotting: a rule that loses its anchor or its decision doc, a link to a doc that no longer exists, or the
 * always-loaded file growing back to its old size all fail here. Tests that need a rule's operative text read the
 * decision doc (see compositeSurfaceRule, cellEditorExitContract), not CLAUDE.md prose.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLAUDE = readFileSync(resolve(ROOT, "CLAUDE.md"), "utf8");

const CONSTRAINT_IDS = [
  ...Array.from({ length: 60 }, (_, i) => String(i + 1)).filter((n) => !["35", "41"].includes(n)),
  "35a", "35b", "41a", "41b",
];
const NAMED_RULES = [
  "LOUD-FAILURE", "AUDIT-FIRST", "PDF-PARITY", "MODULE-SCOPE-COMPONENTS", "VIEWPORT-STABLE", "CHROME-NEVER-EATS-A-PRESS",
  "FOREGROUND-OR-VOID", "DRIVER-SCROLL-IS-NOT-APP-SCROLL", "COUNT-EVERY-KIND", "NO-ONE-OWNS-A-COMPOSITE",
  "SYNTHETIC-KEYS-DONT-EDIT", "PERCEPTUAL-PARITY", "WRONG-CASE", "DEDUPE-FIRST", "TOMBSTONE-DELETES",
  "TIER-BY-REBUILDABILITY", "ROWS-CANONICAL-ON-SEED", "DANGEROUS-MEANS-UNOBSERVABLE", "LIVE-VERIFY",
  "EDITOR-EXIT-CONTRACT", "PANEL-BREVITY", "VIEW-INDEPENDENT-ONCE", "NO-PER-MOVE-WORK", "NO-RETRYABLE-ERRCODE",
  "CONSTRAINT-CAPTURE", "ONE-SHELL-ONE-TOOLBAR-ONE-SWEEP",
];
const STANDING = [
  "STANDING-RULE-1", "OWNER-CHAT-BLOCKS-ARE-SHIP-ORDERS", "STANDING-RULE-2", "STANDING-RULE-3", "NAMES-ONE-SOURCE",
  "SHARED-DATA-ONE-SOURCE", "THREE-STATE-LIFECYCLE", "MERGED-IS-NOT-LIVE", "SESSIONS-VERIFY-OWN-WORK",
  "COWORK-RECORDS-ITS-OWN-VERIFY", "LEDGER-BRANCH", "WORKFLOW-DEPLOY", "KEY-DECISIONS",
];

describe("CLAUDE.md rule anchors", () => {
  it("every owner product constraint (incl. the 35a/35b and 41a/41b duplicates) has its anchor and its decision doc", () => {
    for (const id of CONSTRAINT_IDS) {
      expect(CLAUDE, `constraint ${id} anchor`).toContain(`<!--constraint:${id}-->`);
      expect(existsSync(resolve(ROOT, `docs/decisions/constraint-${id}.md`)), `docs/decisions/constraint-${id}.md`).toBe(true);
    }
  });

  it("every named engineering rule has its anchor, a bold name and a decision doc with the verbatim text", () => {
    for (const n of NAMED_RULES) {
      expect(CLAUDE, `${n} anchor`).toContain(`<!--rule:${n}-->`);
      const doc = resolve(ROOT, `docs/decisions/${n.toLowerCase()}.md`);
      expect(existsSync(doc), `docs/decisions/${n.toLowerCase()}.md`).toBe(true);
      expect(readFileSync(doc, "utf8").length, `${n} decision doc is not a stub`).toBeGreaterThan(300);
    }
  });

  it("every standing rule keeps its anchor", () => {
    for (const n of STANDING) expect(CLAUDE, `${n} anchor`).toContain(`<!--rule:${n}-->`);
  });

  it("every docs/ file CLAUDE.md links exists", () => {
    const links = [...CLAUDE.matchAll(/\]\((docs\/[A-Za-z0-9_./#-]+?)\)/g)].map((m) => m[1].split("#")[0]);
    expect(links.length).toBeGreaterThan(30);
    for (const l of new Set(links)) expect(existsSync(resolve(ROOT, l)), l).toBe(true);
  });

  it("no anchor is duplicated or orphaned (each anchor appears once)", () => {
    const anchors = [...CLAUDE.matchAll(/<!--(rule|constraint):([A-Za-z0-9-]+)-->/g)].map((m) => m[0]);
    expect(new Set(anchors).size).toBe(anchors.length);
  });

  it("the always-loaded file stays slim (ceiling; the old file was ~250 KB)", () => {
    expect(Buffer.byteLength(CLAUDE)).toBeLessThan(80 * 1024);
    // the Site Planner folder pointer is a signpost, the bulk lives in docs/site-planner/
    const sp = readFileSync(resolve(ROOT, "src/workspaces/site-planner/CLAUDE.md"), "utf8");
    expect(Buffer.byteLength(sp)).toBeLessThan(12 * 1024);
    expect(readdirSync(resolve(ROOT, "docs/site-planner")).length).toBeGreaterThan(8);
  });
});
