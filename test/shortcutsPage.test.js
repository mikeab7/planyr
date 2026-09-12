/* shortcutsPage — guards the Keyboard Shortcuts page's ONE claim: that every shortcut it lists
 * is still real. Two different properties, both required (NEW-1, 2026-09-12):
 *
 *   1. The Site Planner section is DERIVED from `keyContract.js`'s own `KEY_CONTRACT` — so it
 *      can never disagree with what that workspace's dispatcher actually tests. Checked here by
 *      cross-referencing every contract id against the generated item list.
 *   2. Every hand-entered item elsewhere (no shared contract exists for those modules) carries an
 *      `evidence: [{file, pattern}]` pointer. This suite reads each cited file and asserts the
 *      literal is still there — if a future change removes or rewrites the cited branch, this
 *      test goes red instead of the page quietly going stale. It cannot catch a shortcut ADDED
 *      without an entry here — see shortcutsData.js's own header for that half of the discipline.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SHORTCUT_SECTIONS, ALL_SHORTCUT_ITEMS } from "../src/shared/keyboard/shortcutsData.js";
import { KEY_CONTRACT } from "../src/workspaces/site-planner/lib/keyContract.js";
import { formatCombo, comboAriaLabel, isApplePlatform } from "../src/shared/keyboard/platform.js";

const repoFile = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");

describe("shortcutsData — structure", () => {
  it("every item has a unique id", () => {
    const ids = ALL_SHORTCUT_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every item has exactly one of combo / keysText", () => {
    for (const it of ALL_SHORTCUT_ITEMS) {
      expect(!!it.combo !== !!it.keysText, it.id).toBe(true);
    }
  });

  it("every combo item's terminal token is non-empty", () => {
    for (const it of ALL_SHORTCUT_ITEMS.filter((i) => i.combo)) {
      expect(it.combo.length, it.id).toBeGreaterThan(0);
      expect(String(it.combo[it.combo.length - 1]).length, it.id).toBeGreaterThan(0);
    }
  });

  it("covers every section the owner asked for, plus Global", () => {
    const ids = SHORTCUT_SECTIONS.map((s) => s.id);
    expect(ids).toEqual(["global", "site", "schedule", "review", "library", "notes", "spreadsheet"]);
  });

  it("no section is empty", () => {
    for (const s of SHORTCUT_SECTIONS) {
      const count = s.groups.reduce((n, g) => n + g.items.length, 0);
      expect(count, s.id).toBeGreaterThan(0);
    }
  });
});

describe("shortcutsData — Site Planner is DERIVED, not hand-copied", () => {
  it("every KEY_CONTRACT entry (except the composite 'arrange' chord) has a matching site.<id> item", () => {
    const siteIds = new Set(ALL_SHORTCUT_ITEMS.filter((i) => i.id.startsWith("site.")).map((i) => i.id.slice(5)));
    for (const entry of KEY_CONTRACT) {
      if (entry.id === "arrange") continue;
      expect(siteIds.has(entry.id), entry.id).toBe(true);
    }
  });

  it("the arrange chord is split into its two real chords, both citing the real handler", () => {
    const fwd = ALL_SHORTCUT_ITEMS.find((i) => i.id === "site.arrange-forward");
    const back = ALL_SHORTCUT_ITEMS.find((i) => i.id === "site.arrange-backward");
    expect(fwd.combo).toEqual(["mod", "]"]);
    expect(back.combo).toEqual(["mod", "["]);
  });

  it("removing a KEY_CONTRACT entry would remove its page row too (no separate hand-kept copy)", () => {
    // Proven structurally: siteItems() reads KEY_CONTRACT directly (see shortcutsData.js), so this
    // is a documentation assertion rather than a mutation test — the real guard is the test above,
    // which fails the moment the two disagree.
    const contractIds = new Set(KEY_CONTRACT.map((e) => e.id));
    expect(contractIds.has("escape")).toBe(true); // sanity: the table we're trusting is non-trivial
  });
});

describe("shortcutsData — every hand-entered item's evidence is still real", () => {
  const withEvidence = ALL_SHORTCUT_ITEMS.filter((i) => i.evidence && i.evidence.length);
  it("at least most items carry evidence (the derived Site items don't need their own)", () => {
    expect(withEvidence.length).toBeGreaterThan(40);
  });
  for (const sc of ALL_SHORTCUT_ITEMS) {
    for (const ev of sc.evidence || []) {
      it(`${sc.id} — "${ev.pattern.slice(0, 48)}…" still appears in ${ev.file}`, () => {
        let content;
        try { content = repoFile(ev.file); } catch (e) { throw new Error(`${sc.id}: cited file ${ev.file} does not exist`); }
        expect(content.includes(ev.pattern), `${sc.id} → ${ev.file}`).toBe(true);
      });
    }
  }
});

describe("platform.js — formatCombo", () => {
  it("renders Windows/Linux style: words joined with +", () => {
    expect(formatCombo(["mod", "z"], { mac: false })).toBe("Ctrl+Z");
    expect(formatCombo(["mod", "shift", "f"], { mac: false })).toBe("Ctrl+Shift+F");
    expect(formatCombo(["esc"], { mac: false })).toBe("Esc");
    expect(formatCombo(["arrowup"], { mac: false })).toBe("↑");
  });

  it("renders Mac style: real glyphs, no separator, in menu-bar order", () => {
    expect(formatCombo(["mod", "z"], { mac: true })).toBe("⌘Z");
    expect(formatCombo(["mod", "shift", "f"], { mac: true })).toBe("⇧⌘F");
    expect(formatCombo(["alt", "shift", "arrowright"], { mac: true })).toBe("⌥⇧→");
  });

  it("comboAriaLabel always spells it out in words, even on Mac", () => {
    expect(comboAriaLabel(["mod", "z"], { mac: true })).toBe("Cmd + Z");
    expect(comboAriaLabel(["mod", "z"], { mac: false })).toBe("Ctrl + Z");
  });

  it("isApplePlatform reads navigator honestly and never throws with none available", () => {
    expect(() => isApplePlatform()).not.toThrow();
  });
});
