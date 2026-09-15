/* B1341728 / B1341729 — THE CELL-EDITOR EXIT CONTRACT, guarded in CI.
 *
 * WHY THIS FILE EXISTS. The owner reported (2026-09-15, measured on a throwaway duplicate of a
 * real schedule) that the Owner cell threw away an owner he had just picked from the list: Escape
 * discarded it, Enter discarded it and moved on so the loss was silent, while Tab and click-away
 * saved. Owners already SAVED before the edit survived, so the defect destroyed new work only.
 *
 * The cause was not the Owner cell being careless about one key. It was that the Owner cell had
 * become the grid's first HYBRID editor: it rendered part of its value in FINISHED form — a chip
 * with its own remove control, indistinguishable from a saved owner — while holding that value as
 * unsaved component state. Every discard path in it exploited that single gap. So the guard is the
 * CONTRACT, asked of the whole grid, not a regression test for one key on one cell.
 *
 * THE CONTRACT — three editor classes, and one invariant that binds them (full text lives in
 * CLAUDE.md's EDITOR-EXIT-CONTRACT named rule):
 *   text   — Enter / Tab / click-away COMMIT; Escape abandons the typed text. Nothing is drawn as
 *            finished, so Escape destroys nothing a person could mistake for saved.
 *   select — a menu. CHOOSING is the commit; the highlight is in-progress, so an exit taken
 *            without choosing correctly leaves the value alone. Every exit closes the menu.
 *   tokens — a chip / token field. Every token is written through the moment it is added, removed
 *            or reordered; every exit merely closes, and none can discard.
 *   INVARIANT — no exit may remove anything the editor renders in FINISHED form.
 *
 * THIS IS THE CI-RUNNABLE HALF, and it is deliberately a source sweep: the behaviour itself is an
 * interaction, so the real check is ui-audit/verify-cell-editor-exit-contract.mjs, which drives
 * every editable cell through all four exits in a real browser and prints the audit table. What
 * this file stops is the shape CI *can* see — a new or edited cell editor that quietly omits one
 * of the four exits, or a token editor growing a deferred-commit path again.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const seq = readFileSync(resolve(here, "../public/sequence/index.html"), "utf8");

const bodyFrom = (src, startIdx) => {
  // Brace-match from the first "{" at or after startIdx.
  let i = src.indexOf("{", startIdx);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") { depth--; if (!depth) return src.slice(i, j + 1); }
  }
  return src.slice(i);
};
const fnBody = (src, name) => {
  const i = src.indexOf(`function ${name}(`);
  if (i === -1) return null;
  // Skip the PARAMETER list — a destructured `({value, onChange})` would otherwise be brace-matched
  // as the body, and every assertion below would silently pass against a two-word string.
  let j = src.indexOf("(", i), depth = 0;
  for (; j < src.length; j++) {
    if (src[j] === "(") depth++;
    else if (src[j] === ")") { depth--; if (!depth) break; }
  }
  return bodyFrom(src, j);
};

const pickerSrc = (() => {
  const start = seq.indexOf("function ContactPicker(");
  expect(start, "ContactPicker must exist").toBeGreaterThan(-1);
  const next = seq.indexOf("\nfunction ", start + 10);
  return seq.slice(start, next > -1 ? next : start + 20000);
})();

/* Every inline cell editor in the grid is an <input>/<textarea> carrying an onKeyDown that names
 * the exits. Collect them by their handler text so a new one cannot be added without an answer. */
const keydownHandlers = [...seq.matchAll(/onKeyDown=\{e\s*=>\s*\{[\s\S]*?\n?\s*\}\}/g)].map(m => ({
  src: m[0],
  line: seq.slice(0, m.index).split("\n").length,
}));

describe("EDITOR-EXIT-CONTRACT — text-class cell editors answer all four exits", () => {
  /* The grid's text editors are the ones whose keydown handler commits on Enter. Every one of them
   * must ALSO name Tab and Escape; click-away is onBlur on the same element. A handler that knows
   * about Enter but not Tab is the shape that leaves one exit undefined. */
  const textEditors = keydownHandlers.filter(h => /commitAndAdvance\(|commit\(t\s*,|commit\(task\.id|commit\(taskId/.test(h.src));

  it("finds the grid's text-class cell editors", () => {
    expect(textEditors.length, "expected the date / name / generic / predecessor / master-table editors")
      .toBeGreaterThanOrEqual(5);
  });

  it("every one commits on Enter", () => {
    const bad = textEditors.filter(h => !/"Enter"/.test(h.src)).map(h => "L" + h.line);
    expect(bad, "a cell editor with no Enter branch leaves that exit undefined").toEqual([]);
  });

  it("every one handles Escape (the one exit allowed to abandon in-progress text)", () => {
    const bad = textEditors.filter(h => !/"Escape"/.test(h.src)).map(h => "L" + h.line);
    expect(bad).toEqual([]);
  });

  it("every one that lives in the main grid commits on Tab rather than falling through", () => {
    // The MasterView editors commit on blur and have no column-stepping Tab; the main-grid ones
    // step columns, and stepping without committing is exactly how a value gets dropped.
    const stepping = textEditors.filter(h => /tabStep\(/.test(h.src));
    expect(stepping.length, "the main grid's editors step columns on Tab").toBeGreaterThanOrEqual(3);
    const bad = stepping.filter(h => !/commit\([^)]*\);\s*tabStep\(/.test(h.src.replace(/\s+/g, " ")))
      .map(h => "L" + h.line);
    expect(bad, "Tab must COMMIT before it steps to the next column").toEqual([]);
  });
});

describe("EDITOR-EXIT-CONTRACT — select-class editors close on every exit and commit only on a choice", () => {
  for (const name of ["HealthPicker", "StatusPicker"]) {
    it(`${name} closes on Escape and on Tab, and only Enter/Space chooses`, () => {
      const body = fnBody(seq, name);
      expect(body, `${name} must exist`).toBeTruthy();
      expect(body, "Escape closes the menu").toMatch(/e\.key === "Escape"\) \{ setOpen\(false\)/);
      expect(body, "Tab is an exit too — it closes the menu instead of leaving it floating")
        .toMatch(/e\.key === "Tab"\) \{ setOpen\(false\)/);
      expect(body, "a click outside closes it").toMatch(/addEventListener\("mousedown", handleDown\)/);
      expect(body, "only Enter/Space commit a choice").toMatch(/e\.key === "Enter" \|\| e\.key === " "/);
    });
  }
  it("HealthDropMenu (the master table's menu) answers all four exits", () => {
    const body = fnBody(seq, "HealthDropMenu");
    expect(body, "HealthDropMenu must exist").toBeTruthy();
    expect(body).toMatch(/e\.key==="Enter"\)\s*\{[^}]*onSelect/);
    expect(body).toMatch(/e\.key==="Escape"/);
    expect(body).toMatch(/e\.key==="Tab"\)\s*\{[^}]*onClose\(\)/);
    expect(body, "a click outside closes it").toMatch(/addEventListener\("mousedown", outside\)/);
  });
});

describe("EDITOR-EXIT-CONTRACT — the tokens-class editor writes through; no exit can discard", () => {
  it("ContactPicker takes onOwnersChange + onClose, and the old deferred onCommit/onCancel pair is gone", () => {
    const sig = pickerSrc.slice(0, pickerSrc.indexOf(")") + 1);
    expect(sig, "the write-through callback").toMatch(/\bonOwnersChange\b/);
    expect(sig, "closing is its own callback, distinct from saving").toMatch(/\bonClose\b/);
    expect(sig, "the single deferred commit is gone").not.toMatch(/\bonCommit\b/);
    expect(sig, "the discard callback is gone").not.toMatch(/\bonCancel\b/);
  });

  it("every chip mutation — add, remove, reorder — writes through immediately", () => {
    for (const fn of ["addChip", "removeChip", "reorderChips"]) {
      const b = fnBody(pickerSrc, fn);
      expect(b, `${fn} must exist`).toBeTruthy();
      expect(b, `${fn} must write the new list through, not merely set local state`)
        .toMatch(/writeThrough\(/);
    }
  });

  it("writeThrough is the ONE write path, and it skips a genuine no-op", () => {
    const b = fnBody(pickerSrc, "writeThrough");
    expect(b, "writeThrough must exist").toBeTruthy();
    expect(b, "it calls the caller's write").toMatch(/onOwnersChange\(next, news\)/);
    expect(b, "an unchanged list with no new contact writes nothing (no wasted undo step / save)")
      .toMatch(/if \(same && !news\.length\) return;/);
    expect(b, "a brand-new contact is handed over in the SAME call that assigns it")
      .toMatch(/newContactsRef\.current = \[\.\.\.newContactsRef\.current, \.\.\.news\]/);
  });

  it("no exit path in the component drops chips", () => {
    expect(pickerSrc, "the revert-the-session path is gone").not.toMatch(/cancelEditing/);
    const fin = fnBody(pickerSrc, "finishEditing");
    expect(fin, "finishEditing must exist").toBeTruthy();
    expect(fin, "finishEditing only folds in a recognised leftover, then closes")
      .toMatch(/closeEditor\(\)/);
    const close = fnBody(pickerSrc, "closeEditor");
    expect(close, "closeEditor must exist").toBeTruthy();
    expect(close, "closing calls onClose and nothing else that could change the value")
      .toMatch(/onClose\(\)/);
    expect(close, "closing must not write").not.toMatch(/onOwnersChange/);
  });

  it("every ContactPicker call site writes through without closing, and closes without writing", () => {
    const sites = [...seq.matchAll(/<ContactPicker\b[\s\S]*?\/>/g)].map(m => ({
      src: m[0], line: seq.slice(0, m.index).split("\n").length,
    }));
    expect(sites.length, "expected the grid cell + the master table cell").toBeGreaterThanOrEqual(2);
    for (const s of sites) {
      expect(s.src, `L${s.line}: must pass onOwnersChange`).toMatch(/onOwnersChange=/);
      expect(s.src, `L${s.line}: must pass onClose`).toMatch(/onClose=/);
      expect(s.src, `L${s.line}: onOwnersChange must use the non-closing write (applyCommit), never commit()`)
        .toMatch(/applyCommit\(/);
      // `commit(` would close the editor mid-multi-add — the whole point of splitting it out.
      const change = s.src.slice(s.src.indexOf("onOwnersChange="));
      expect(/[^y]commit\(/.test(change.slice(0, change.indexOf("onClose="))),
        `L${s.line}: the write-through handler must not call the closing commit()`).toBe(false);
    }
  });

  it("applyCommit exists in BOTH grids and commit() is exactly applyCommit + close", () => {
    expect(seq, "the project grid splits the write out of commit")
      .toMatch(/const applyCommit = \(taskId, col, val\) => \{/);
    expect(seq, "the project grid's commit is the write plus closing, nothing else")
      .toMatch(/const commit = \(taskId, col, val\) => \{ applyCommit\(taskId, col, val\); setEdit\(null\); \};/);
    expect(seq, "the master table splits it the same way")
      .toMatch(/const applyCommit = \(t, col, val\) => \{/);
    expect(seq, "the master table's commit is the write plus closing")
      .toMatch(/const commit = \(t, col, val\) => \{\s*applyCommit\(t, col, val\);\s*closeEdit\(\);\s*\};/);
  });
});

describe("EDITOR-EXIT-CONTRACT — the rule is written down where a new editor's author will read it", () => {
  const claude = readFileSync(resolve(here, "../CLAUDE.md"), "utf8");
  it("CLAUDE.md carries the named rule", () => {
    expect(claude, "the named rule must exist so a brief can invoke it by name")
      .toMatch(/\*\*EDITOR-EXIT-CONTRACT\*\*/);
  });
  it("the rule states all three classes and the binding invariant", () => {
    const i = claude.indexOf("**EDITOR-EXIT-CONTRACT**");
    const rule = claude.slice(i, i + 4000);
    for (const word of ["text", "select", "tokens", "FINISHED"]) {
      expect(rule, `the rule must name "${word}"`).toContain(word);
    }
    expect(rule, "the rule must point at its own runtime guard")
      .toContain("verify-cell-editor-exit-contract");
  });
});
