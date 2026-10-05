/* readLedgerAtRef must work on every supported Node: it used to pass `encoding: "buffer"` to
 * execFileSync, which newer Node rejects ("Unknown encoding: buffer"), so the pre-push mint gate
 * could not read origin/main's ledger and refused every push. Throwaway repo, no network. */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLedgerAtRef } from "../scripts/lib/ledger.mjs";

const git = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: "pipe" });

describe("readLedgerAtRef", () => {
  it("reads frame + entries (incl. non-ASCII) from a git ref without throwing", () => {
    const d = mkdtempSync(join(tmpdir(), "ledger-ref-"));
    try {
      git(d, "init", "-q");
      mkdirSync(join(d, "ledger/backlog/open"), { recursive: true });
      writeFileSync(join(d, "ledger/backlog/_frame.md"), "# frame\n");
      writeFileSync(join(d, "ledger/backlog/open/B123.md"), "### B123 — title ⛔ ünï\n\nbody\n");
      git(d, "add", "-A");
      git(d, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "x");
      const l = readLedgerAtRef(d, "HEAD", "backlog");
      expect(l.entries.map((e) => e.id)).toEqual(["B123"]);
      expect(l.entries[0].text).toContain("ünï");
      expect(l.frame).toContain("# frame");
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});
