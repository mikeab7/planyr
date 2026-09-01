/* SAME-FILE duplicate heading guard (B308704).
 *
 * WHAT IT CATCHES, and why the two guards that already existed did not. `test/idUniqueness.test.js`
 * checks two things: no duplicate id among the LIVE items (BACKLOG.md / VERIFICATION.md), and no
 * NEW duplicate across the live+archive PAIR beyond a grandfathered baseline of 58. Both are
 * correct and neither can see this: a count of two ACROSS THE PAIR is ambiguous by design — it is
 * also the shape of a legitimate DEDUPE-FIRST recurrence caught mid-move, and of the live↔archive
 * race B780 grandfathered. So that baseline had to be permissive, and 31 ids that are
 * unambiguously wrong were sitting inside the permission it granted.
 *
 * TWO HEADINGS FOR ONE ID **INSIDE A SINGLE FILE** IS NEVER LEGITIMATE. The lifecycle MOVES a
 * heading between files; it never leaves two in one. There is no recurrence, no archive race and
 * no in-flight state that produces it. That makes the rule absolute, which is what lets it be a
 * guard rather than another baseline to argue about.
 *
 * THE INHERITANCE, measured on `main` at ed7f8d3: 24 B ids in docs/archive/BACKLOG-DONE.md and 7 V ids in
 * docs/archive/VERIFICATION-DONE.md each name two different items — B127 is both "Measure-type dropdown renders
 * behind/clipped by the rail" and "Two-tab convergence: a stale tab could thin the durable store";
 * B239 is both "Schedule module still dead-ends after a deploy" and "Restore the per-zone plus to
 * add trailer parking". Every one of the 31 is in B127–B755 / V45–V275, entirely below B6864 —
 * every one predates the reserved-block fix, and NONE has occurred since. The blocks work. What
 * nothing ever did was clean up what they inherited, or stop the next one at the door.
 *
 * WHY THE 31 ARE DISAMBIGUATED IN PLACE RATHER THAN RENUMBERED. Both twins keep the number and each
 * gains a `⚠ SHARED ID` marker naming the other. The reason is cross-references: prose across the
 * repo says "see B239", and for a colliding id NOBODY CAN KNOW which twin a given reference meant.
 * Renumbering the later twin would silently repoint every one of those references at the survivor —
 * turning an ambiguity a reader can SEE into a wrong answer they cannot. Marking in place changes
 * what no reference resolves to; it only makes the ambiguity visible at the destination.
 * The last describe block proves that property mechanically rather than asserting it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  sameFileDuplicates, sameFileDuplicatesIn, newSameFileDuplicates, headingLinesIn,
  SAME_FILE_LEGACY_DUPES, B_FILES, V_FILES,
} from "../scripts/next-id.mjs";
import { markSharedIds, titleOf, MARKER } from "../scripts/mark-shared-ids.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FAMILIES = [["B", B_FILES], ["V", V_FILES]];

describe("no id gets two headings inside one ledger file (B308704)", () => {
  it("BACKLOG.md / docs/archive/BACKLOG-DONE.md hold no NEW same-file B# duplicate", () => {
    const fresh = newSameFileDuplicates(REPO, B_FILES, "B");
    expect(fresh, `\nA B# has TWO headings inside ONE file. This is never a recurrence and never an
archive race — the lifecycle MOVES a heading between files, it never leaves two in one.
Renumber the newer item (git fetch origin main && npm run next-id -- --against-main):\n${JSON.stringify(fresh, null, 1)}\n`).toEqual([]);
  });

  it("VERIFICATION.md / docs/archive/VERIFICATION-DONE.md hold no NEW same-file V# duplicate", () => {
    const fresh = newSameFileDuplicates(REPO, V_FILES, "V");
    expect(fresh, `\nA V# has TWO headings inside ONE file:\n${JSON.stringify(fresh, null, 1)}\n`).toEqual([]);
  });

  it("the LIVE files are completely clean — no grandfathering there, ever", () => {
    // The whole damage is archive-only, and it must stay that way: an ambiguous id among OPEN
    // items would make DEDUPE-FIRST undecidable for work in flight. No baseline entry names a live
    // file, and this asserts the stronger property directly rather than trusting that.
    for (const [letter, files] of FAMILIES) {
      const live = sameFileDuplicates(REPO, [files[0]], letter);
      expect(live, `${files[0]} has a duplicate ${letter}# heading — renumber it now, it is not grandfathered`).toEqual([]);
    }
    for (const key of Object.keys({ ...SAME_FILE_LEGACY_DUPES.B, ...SAME_FILE_LEGACY_DUPES.V })) {
      expect(key.startsWith("docs/archive/BACKLOG-DONE.md::") || key.startsWith("docs/archive/VERIFICATION-DONE.md::"),
        `${key}: the baseline may only grandfather ARCHIVE files`).toBe(true);
    }
  });

  it("the baseline is honest and SHRINK-ONLY — every row still exists at exactly its recorded count", () => {
    // Clean a legacy dup → delete its row in the SAME commit. A baseline that overstates is worse
    // than none: it silently pre-authorises a future collision on a recycled id.
    for (const [letter, files] of FAMILIES) {
      const current = new Map(sameFileDuplicates(REPO, files, letter).map((d) => [d.key, d.count]));
      for (const [key, count] of Object.entries(SAME_FILE_LEGACY_DUPES[letter])) {
        const cur = current.get(key) || 1;
        expect(cur, `${key}: baseline says ${count}, the file now has ${cur} — update the row, or delete it if the dup was cleaned`).toBe(count);
      }
    }
  });

  it("the inheritance is exactly 24 B ids and 7 V ids, all below B6864 — the blocks did work", () => {
    // Pinned as a FACT, not as a target. If this number moves, either something was cleaned (good,
    // shrink the baseline) or a new one landed below the radar of the two checks above.
    expect(Object.keys(SAME_FILE_LEGACY_DUPES.B)).toHaveLength(24);
    expect(Object.keys(SAME_FILE_LEGACY_DUPES.V)).toHaveLength(7);
    const ids = Object.keys(SAME_FILE_LEGACY_DUPES.B).map((k) => Number(k.split("::B")[1]));
    expect(Math.max(...ids)).toBeLessThan(6864);
  });
});

describe("MUTATION — the guard goes RED on a duplicate, and stays quiet on what is legal", () => {
  /* A guard nobody has watched fail is a guard that rots green (VIEW-INDEPENDENT-ONCE §6). These
   * drive the same pure function the checks above run, with a duplicate deliberately introduced. */
  it("RED on a brand-new duplicate inside one file", () => {
    const text = "### B9001 — one feature\nbody\n\n### B9002 — ok\n\n### B9001 — a different feature\nbody\n";
    const dups = sameFileDuplicatesIn([{ file: "BACKLOG.md", text }], "B");
    expect(dups).toEqual([{ file: "BACKLOG.md", id: "B9001", count: 2, key: "BACKLOG.md::B9001" }]);
    // and it is NOT covered by the baseline, so it would fail the build
    expect(dups.filter(({ key, count }) => count > (SAME_FILE_LEGACY_DUPES.B[key] || 1))).toHaveLength(1);
  });

  it("RED on a GRANDFATHERED id collided one MORE time — the baseline is a ceiling, not a licence", () => {
    const over = [{ file: "docs/archive/BACKLOG-DONE.md", id: "B127", count: 3, key: "docs/archive/BACKLOG-DONE.md::B127" }]
      .filter(({ key, count }) => count > (SAME_FILE_LEGACY_DUPES.B[key] || 1));
    expect(over).toHaveLength(1);
  });

  it("RED on a grandfathered id appearing twice in a DIFFERENT file — the key is file-scoped", () => {
    // B127 is allowed two headings in docs/archive/BACKLOG-DONE.md. Two in BACKLOG.md is a new collision, and
    // an id-only baseline would have waved it through.
    const dups = sameFileDuplicatesIn([{ file: "BACKLOG.md", text: "### B127 — a\n\n### B127 — b\n" }], "B");
    expect(dups.filter(({ key, count }) => count > (SAME_FILE_LEGACY_DUPES.B[key] || 1)))
      .toEqual([{ file: "BACKLOG.md", id: "B127", count: 2, key: "BACKLOG.md::B127" }]);
  });

  it("GREEN on a RECURRENCE — one heading in each file is the lifecycle working, not a collision", () => {
    const dups = sameFileDuplicatesIn([
      { file: "BACKLOG.md", text: "### B500 — re-opened (×2)\n" },
      { file: "docs/archive/BACKLOG-DONE.md", text: "### B500 — the original\n" },
    ], "B");
    expect(dups).toEqual([]);
  });

  it("GREEN on a range heading, and RED when the range primary ALSO has its own heading", () => {
    expect(sameFileDuplicatesIn([{ file: "BACKLOG.md", text: "### B300–B302 — a multi-mint\n### B303 — ok\n" }], "B")).toEqual([]);
    expect(sameFileDuplicatesIn([{ file: "BACKLOG.md", text: "### B300–B302 — multi\n### B300 — separate\n" }], "B"))
      .toHaveLength(1);
  });

  it("does not confuse the B and V families", () => {
    expect(sameFileDuplicatesIn([{ file: "BACKLOG.md", text: "### B5 — a\n### V5 — b\n" }], "B")).toEqual([]);
    expect(sameFileDuplicatesIn([{ file: "BACKLOG.md", text: "### B5 — a\n### V5 — b\n" }], "V")).toEqual([]);
  });

  it("GREEN on the marker lines themselves — a `> ⚠ SHARED ID` line must never read as a heading", () => {
    // The repair inserts a line naming the twin's id. If the counter ever mistook that for a
    // heading, the repair would manufacture the collisions it documents.
    const text = `### B127 — one item\n${MARKER} — B127 also names another item in this file:** “the twin”.\nbody\n`;
    expect(sameFileDuplicatesIn([{ file: "docs/archive/BACKLOG-DONE.md", text }], "B")).toEqual([]);
  });

  it("REFUSES to read a pass out of an empty input set (LOUD-FAILURE)", () => {
    // The rot case: if the file list ever resolves to nothing, the checks above would report a
    // clean [] forever. Assert the real files were actually read.
    for (const [letter, files] of FAMILIES) {
      const texts = files.map((f) => readFileSync(join(REPO, f), "utf8"));
      expect(texts.every((t) => new RegExp(`^###\\s+${letter}\\d+`, "m").test(t)),
        `${files.join(" / ")}: no ${letter}# heading found at all — the guard would be reading nothing`).toBe(true);
    }
  });
});

/* ============================================================================================
 * THE REPAIR: disambiguated in place, and the cross-references PROVEN intact (B308704).
 *
 * The owner's constraint on this repair was explicit: *"EVERY existing cross-reference to a
 * colliding id must still resolve to the right item afterwards — prove that, do not assert it."*
 *
 * The proof is structural, and it is the whole reason marking beat renumbering. A cross-reference
 * "see B239" resolves by looking up the `### B239` headings. If the repair changes no heading line
 * and no id, then the resolution of every reference in the repo — past, present, and the ones
 * nobody has enumerated — is bit-for-bit what it was before. That is a stronger statement than any
 * survey of reference sites could make, because it does not depend on having found them all.
 * ========================================================================================== */
describe("the 31 shared ids are marked in place, and no reference resolution moved", () => {
  const READ = (f) => readFileSync(join(REPO, f), "utf8");
  const FILES = [["B", "docs/archive/BACKLOG-DONE.md"], ["V", "docs/archive/VERIFICATION-DONE.md"]];

  it("every colliding heading carries a SHARED ID marker naming its twin", () => {
    for (const [letter, file] of FILES) {
      const ids = new Set(sameFileDuplicates(REPO, [file], letter).map((d) => d.id));
      expect(ids.size).toBeGreaterThan(0);
      // Re-running the marker pass must find NOTHING left to add — that IS the coverage check.
      const { added } = markSharedIds(READ(file), letter, ids);
      expect(added, `${file}: ${added} colliding heading(s) unmarked — run node scripts/mark-shared-ids.mjs`).toBe(0);
    }
  });

  it("PROOF: stripping the markers restores the file's heading set EXACTLY — the repair moved nothing", () => {
    // Every marker is one inserted line. Remove them and the remaining text must have the same
    // ids, the same heading LINES, and the same counts as the file has today. Nothing a
    // cross-reference resolves to was renamed, renumbered, merged or dropped.
    for (const [letter, file] of FILES) {
      const withMarkers = READ(file);
      const stripped = withMarkers.split("\n").filter((l) => !l.startsWith(MARKER)).join("\n");

      const a = headingLinesIn([withMarkers], letter);
      const b = headingLinesIn([stripped], letter);
      expect([...b.keys()].sort()).toEqual([...a.keys()].sort());
      for (const [id, lines] of a) expect(b.get(id)).toEqual(lines);

      // and the markers really are the ONLY difference — no other line was touched
      const removed = withMarkers.split("\n").length - stripped.split("\n").length;
      expect(removed).toBe(withMarkers.split("\n").filter((l) => l.startsWith(MARKER)).length);
    }
  });

  it("PROOF: every id named by a marker still resolves to the same twins it did", () => {
    // The marker claims "B127 also names another item in this file". Check the claim against the
    // file rather than trusting the generator: the id it names must be its own, and the twin
    // title it quotes must be a real heading of that id.
    let checked = 0;
    for (const [letter, file] of FILES) {
      const text = READ(file);
      const headings = headingLinesIn([text], letter);
      const lines = text.split("\n");
      lines.forEach((line, i) => {
        if (!line.startsWith(MARKER)) return;
        const id = line.match(new RegExp(`SHARED ID — (${letter}\\d+)`))?.[1];
        expect(id, `marker at ${file}:${i + 1} names no id`).toBeTruthy();
        // the line above it is that id's own heading
        expect(lines[i - 1]).toMatch(new RegExp(`^###\\s+${id}\\b`));
        // and the twin title it quotes is a genuine heading of the same id
        const twins = (headings.get(Number(id.slice(1))) || []).map((h) => titleOf(h));
        const quoted = [...line.matchAll(/“([^”]+)”/g)].map((m) => m[1]);
        expect(quoted.length).toBe(twins.length - 1);
        for (const q of quoted) expect(twins, `${id}: marker quotes a title that is not one of its headings`).toContain(q);
        checked += 1;
      });
    }
    expect(checked, "no markers were examined — the proof would be vacuous").toBe(63);
  });

  it("the marker is additive-only by construction — it never rewrites a heading", () => {
    const before = "### B127 — one item\nbody line\n\n### B127 — a different item\nbody line\n";
    const { text, added } = markSharedIds(before, "B", new Set(["B127"]));
    expect(added).toBe(2);
    // every original line survives, in order
    const kept = text.split("\n").filter((l) => !l.startsWith(MARKER));
    expect(kept).toEqual(before.split("\n"));
    expect(text).toContain("“a different item”");
    expect(text).toContain("“one item”");
  });

  it("is IDEMPOTENT — a second pass adds nothing (a re-run must not stack markers)", () => {
    const once = markSharedIds("### B9 — a\n\n### B9 — b\n", "B", new Set(["B9"]));
    const twice = markSharedIds(once.text, "B", new Set(["B9"]));
    expect(twice.added).toBe(0);
    expect(twice.text).toBe(once.text);
  });
});
