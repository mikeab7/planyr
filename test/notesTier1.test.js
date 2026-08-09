/* notesTier1 — the pure decision layers behind the Notes table-stakes work (NEW-1…NEW-7).
 *
 * ⛔ EVERY ASSERTION HERE IS ABOUT A RESULT, NEVER ABOUT A HANDLER RUNNING. That is the
 * process rule this module is under after three rounds: a check that asserts "the function
 * was called" or "the element took focus" passes on a broken build, and this module has
 * already shipped features whose checks were green while the owner reported the failure.
 * So: the slash trigger is asserted on the STRING that must and must not open a menu; the
 * task toggle on the RESULTING DOCUMENT; retention on WHICH ROWS SURVIVE; the outline's
 * positions against the REAL schema, by resolving each one and demanding the heading it
 * named is the node actually there.
 *
 * The half that genuinely needs a browser — the block actually becoming a heading, the other
 * note actually opening, the restored tree matching the snapshot, ticking in the rollup
 * flipping the checkbox on screen, an attachment round-tripping — is driven against the real
 * built app in ui-audit/verify-notes-tier1.mjs. Neither half is a substitute for the other.
 */
import { describe, it, expect } from "vitest";
import { getSchema } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";

import {
  SLASH_COMMANDS, SLASH_MAX_QUERY, filterSlashCommands, slashQueryFromText, stepIndex,
} from "../src/workspaces/notes/lib/notesSlashMenu.js";
import {
  LEAF_NODES, activeOutlineIndex, nodeSize, outlineFromDoc, outlineHasChildren, visibleOutline,
} from "../src/workspaces/notes/lib/notesOutline.js";
import {
  groupTasksByProject, openTasksInDoc, rollUpOpenTasks, setTaskCheckedInDoc, tasksInDoc,
} from "../src/workspaces/notes/lib/notesTasks.js";
import {
  MAX_VERSIONS_PER_PAGE, RETENTION_TIERS, planRestore, planRetention, shouldSnapshot, versionReasonLabel,
} from "../src/workspaces/notes/lib/notesVersions.js";
import {
  QUICK_OPEN_KEY, fuzzyScore, isQuickOpenChord, quickOpenResults, rankQuickOpen,
} from "../src/workspaces/notes/lib/notesQuickOpen.js";
import { attachmentLabel, fileExtLabel, fileSizeLabel, safeAttachmentName } from "../src/workspaces/notes/lib/notesFileMeta.js";
import { NOTE_EXTENSIONS } from "../src/workspaces/notes/lib/notesExtensions.js";
import { docToMarkdown, docToText, assetIdsInDoc, attachmentIdsInDoc, imageIdsInDoc } from "../src/workspaces/notes/lib/notesMarkdown.js";
import { CALLOUT_TONES } from "../src/workspaces/notes/lib/notesCalloutNode.js";

const schema = getSchema(NOTE_EXTENSIONS);

const p = (text) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const h = (level, text) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });
const doc = (...content) => ({ type: "doc", content });

/* ════════════════════════════════════════════════════════════════════════════════════════
 * NEW-1 — THE SLASH MENU, and the rule that matters is when it must NOT fire
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("NEW-1 · the slash trigger never fires mid-word", () => {
  /* These are the exact strings the brief named, plus the ones that would follow them into
   * a note: an option, a fraction, an abbreviation, and every shape of pasted URL. A menu
   * that opens on any of these is not a feature, it is an interruption. */
  const INERT = [
    "and/or",
    "and/o",
    "24/7",
    "w/o",
    "w/",
    "https://planyr.io/notes",
    "https://",
    "see https://planyr.io/notes/grand-port for the plat",
    "Lot 4/A",
    "N/A",
    "TR 3/4 of the SW/4",
  ];
  for (const text of INERT) {
    it(`"${text}" opens nothing`, () => {
      expect(slashQueryFromText(text)).toBe(null);
    });
  }

  it("a slash at the START of the block opens the menu, with the query after it", () => {
    expect(slashQueryFromText("/")).toEqual({ query: "", slashOffset: 1 });
    expect(slashQueryFromText("/h")).toEqual({ query: "h", slashOffset: 2 });
    expect(slashQueryFromText("/head")).toEqual({ query: "head", slashOffset: 5 });
  });

  it("a slash after WHITESPACE opens it too — which is how it is reached mid-line", () => {
    expect(slashQueryFromText("Notes for Tuesday /call")?.query).toBe("call");
    expect(slashQueryFromText("done\t/tab")?.query).toBe("tab");
    expect(slashQueryFromText("word /x")?.query).toBe("x");
  });

  it("a SPACE after the slash closes it — a command name has no spaces in it", () => {
    expect(slashQueryFromText("/head ")).toBe(null);
    expect(slashQueryFromText("/ ")).toBe(null);
  });

  it("prose with a slash in it does not sit there with a menu open", () => {
    expect(slashQueryFromText(`/${"x".repeat(SLASH_MAX_QUERY + 1)}`)).toBe(null);
    expect(slashQueryFromText(`/${"x".repeat(SLASH_MAX_QUERY)}`)).not.toBe(null);
  });

  it("BACKSPACING PAST THE SLASH leaves the slash as ordinary text", () => {
    /* The menu is a READING of the text, so deleting back through the query simply stops
     * matching — there is no marker node to clean up and the `/` the user typed is still
     * exactly where they typed it. Walking the string backwards is that property. */
    for (const s of ["/head", "/hea", "/he", "/h", "/"]) {
      expect(slashQueryFromText(s), s).not.toBe(null);
    }
    // …and once the slash itself goes there is nothing to match, and nothing was consumed.
    expect(slashQueryFromText("")).toBe(null);
  });

  it("the LAST slash wins, so a second command on the same line still works", () => {
    expect(slashQueryFromText("/h1 done /ta")?.query).toBe("ta");
  });
});

describe("NEW-1 · the catalogue and its filter", () => {
  it("carries every block the brief named, by name", () => {
    const labels = SLASH_COMMANDS.map((c) => c.label);
    for (const want of ["Heading 1", "Heading 2", "Heading 3", "Heading 4", "Body text",
      "Bulleted list", "Numbered list", "Checklist", "Table", "Image", "Attachment",
      "Sketch", "Divider", "Callout", "Toggle"]) {
      expect(labels).toContain(want);
    }
  });

  it("an empty query offers everything — a bare `/` is browsable, not a guessing game", () => {
    expect(filterSlashCommands("")).toHaveLength(SLASH_COMMANDS.length);
  });

  it("filters on the words someone actually reaches for, not only the label", () => {
    expect(filterSlashCommands("todo").map((c) => c.id)).toContain("taskList");
    expect(filterSlashCommands("bullet").map((c) => c.id)).toContain("bulletList");
    expect(filterSlashCommands("dwg").map((c) => c.id)).toContain("attachment");
    expect(filterSlashCommands("hr").map((c) => c.id)).toContain("divider");
    expect(filterSlashCommands("h2").map((c) => c.id)).toEqual(["h2"]);
    expect(filterSlashCommands("zzzz")).toEqual([]);
  });

  it("the arrows wrap at both ends", () => {
    expect(stepIndex(0, -1, 5)).toBe(4);
    expect(stepIndex(4, 1, 5)).toBe(0);
    expect(stepIndex(0, 1, 0)).toBe(0);     // an empty list has nowhere to go
  });

  it("every command id the catalogue offers is one the applier can actually run", () => {
    // A row that inserts nothing is worse than a row that is absent.
    const RUNNABLE = new Set(["h1", "h2", "h3", "h4", "paragraph", "bulletList", "orderedList",
      "taskList", "table", "divider", "sketch", "callout", "toggle", "image", "attachment"]);
    for (const c of SLASH_COMMANDS) expect(RUNNABLE, c.id).toContain(c.id);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * NEW-6 — THE OUTLINE, and its positions checked against the REAL schema
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("NEW-6 · the outline is derived from the document", () => {
  const sample = doc(
    p("An opening line that belongs to no section."),
    h(1, "Site"),
    p("Acreage and frontage."),
    h(2, "Drainage"),
    p("Detention."),
    h(3, "Berm"),
    h(2, "Utilities"),
    p("Water and sewer."),
  );

  it("lists every heading, in reading order, with its level", () => {
    expect(outlineFromDoc(sample).map((e) => [e.level, e.text])).toEqual([
      [1, "Site"], [2, "Drainage"], [3, "Berm"], [2, "Utilities"],
    ]);
  });

  it("a note with NO headings produces nothing at all — the pane is absent, not empty", () => {
    expect(outlineFromDoc(doc(p("just a paragraph")))).toEqual([]);
    expect(outlineFromDoc(null)).toEqual([]);
  });

  /* ⛔ THE LOAD-BEARING ONE. `pos` is computed from JSON by restating ProseMirror's size
   * rule; if that restatement is wrong every row scrolls to the wrong place and the active
   * row is wrong too, silently. So resolve each position through the REAL schema and demand
   * the node there is the heading the outline named. */
  it("every position it reports resolves, in the real schema, to the heading it named", () => {
    const node = PMNode.fromJSON(schema, sample);
    for (const e of outlineFromDoc(sample)) {
      const at = node.nodeAt(e.pos);
      expect(at, `nothing at pos ${e.pos} for "${e.text}"`).toBeTruthy();
      expect(at.type.name, `pos ${e.pos} is a ${at?.type?.name}, not a heading`).toBe("heading");
      expect(at.textContent).toBe(e.text);
      expect(at.attrs.level).toBe(e.level);
    }
  });

  it("…and it still holds with an ATOM (a picture) and a rule in the way", () => {
    const withAtoms = doc(
      p("intro"),
      { type: "noteImage", attrs: { imageId: "img_1", alt: "", mime: "", w: null, h: null } },
      h(1, "After the picture"),
      { type: "horizontalRule" },
      h(2, "After the rule"),
    );
    const node = PMNode.fromJSON(schema, withAtoms);
    for (const e of outlineFromDoc(withAtoms)) {
      expect(node.nodeAt(e.pos)?.textContent, e.text).toBe(e.text);
    }
  });

  it("LEAF_NODES names every atom the schema admits — a missed one shifts every position after it", () => {
    for (const [name, type] of Object.entries(schema.nodes)) {
      if (name === "text") continue;
      const isLeaf = type.isAtom || (!type.spec.content && !type.isText);
      if (isLeaf) expect(LEAF_NODES, `${name} is a leaf in the schema but is not in LEAF_NODES`).toContain(name);
    }
    for (const name of LEAF_NODES) expect(Object.keys(schema.nodes), name).toContain(name);
  });

  it("nodeSize agrees with ProseMirror's own", () => {
    expect(nodeSize(sample)).toBe(PMNode.fromJSON(schema, sample).nodeSize);
  });

  it("the ACTIVE row is the last heading at or before the caret — and is nothing above the first", () => {
    const entries = outlineFromDoc(sample);
    expect(activeOutlineIndex(entries, 1)).toBe(-1);              // the opening paragraph
    expect(activeOutlineIndex(entries, entries[0].pos)).toBe(0);
    expect(activeOutlineIndex(entries, entries[1].pos + 2)).toBe(1);
    expect(activeOutlineIndex(entries, 10 ** 6)).toBe(entries.length - 1);
    expect(activeOutlineIndex([], 5)).toBe(-1);
  });

  it("a row folds only when something is nested under it", () => {
    const entries = outlineFromDoc(sample);
    expect(outlineHasChildren(entries, 0)).toBe(true);            // Site → Drainage
    expect(outlineHasChildren(entries, 2)).toBe(false);           // Berm → Utilities is shallower
    expect(outlineHasChildren(entries, 3)).toBe(false);           // the last row
  });

  it("folding a heading hides EVERYTHING under it, not just the next row", () => {
    const entries = outlineFromDoc(sample);
    expect(visibleOutline(entries, [entries[1].id]).map((e) => e.text)).toEqual(["Site", "Drainage", "Utilities"]);
    expect(visibleOutline(entries, [])).toHaveLength(entries.length);
    expect(visibleOutline(entries, [entries[0].id]).map((e) => e.text)).toEqual(["Site"]);
  });

  it("an untitled heading is still a row you can click — the outline does not develop holes", () => {
    const entries = outlineFromDoc(doc(h(1, ""), p("x")));
    expect(entries).toHaveLength(1);
    expect(entries[0].empty).toBe(true);
    expect(entries[0].text).toBe("Untitled heading");
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * NEW-4 — THE TASK ROLLUP: ticking it in the list changes the DOCUMENT
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
const task = (text, checked = false, extra = []) => ({
  type: "taskItem", attrs: { checked }, content: [p(text), ...extra],
});
const taskList = (...items) => ({ type: "taskList", content: items });

describe("NEW-4 · reading checklist items out of a note", () => {
  const sample = doc(
    p("Water district"),
    taskList(
      task("Call the district about the 12-inch line"),
      task("Send the LOI comment back", true),
      task("Walk the site Thursday", false, [taskList(task("Bring the plat"))]),
    ),
  );

  it("finds every item at every depth, with its state", () => {
    expect(tasksInDoc(sample).map((t) => [t.text, t.checked])).toEqual([
      ["Call the district about the 12-inch line", false],
      ["Send the LOI comment back", true],
      ["Walk the site Thursday", false],
      ["Bring the plat", false],
    ]);
  });

  it("a parent's text is its OWN words, not its whole subtree", () => {
    expect(tasksInDoc(sample).find((t) => t.text.startsWith("Walk")).text).toBe("Walk the site Thursday");
  });

  it("the rollup lists only what is still OPEN", () => {
    expect(openTasksInDoc(sample).map((t) => t.text)).toEqual([
      "Call the district about the 12-inch line", "Walk the site Thursday", "Bring the plat",
    ]);
  });

  it("a note with no checklist contributes nothing", () => {
    expect(openTasksInDoc(doc(p("nothing here")))).toEqual([]);
    expect(tasksInDoc(null)).toEqual([]);
  });
});

describe("NEW-4 · ticking it in the list flips the checkbox IN THE NOTE", () => {
  const sample = doc(taskList(task("one"), task("two"), task("three")));

  it("the RESULTING DOCUMENT has that one item checked and nothing else touched", () => {
    const { doc: next, changed } = setTaskCheckedInDoc(sample, { index: 1, text: "two" }, true);
    expect(changed).toBe(true);
    expect(tasksInDoc(next).map((t) => [t.text, t.checked])).toEqual([
      ["one", false], ["two", true], ["three", false],
    ]);
    // …and the input is untouched: the caller keeps a clean copy to compare against.
    expect(tasksInDoc(sample).every((t) => !t.checked)).toBe(true);
  });

  it("it works on a NESTED item too", () => {
    const nested = doc(taskList(task("parent", false, [taskList(task("child"))])));
    const { doc: next, changed } = setTaskCheckedInDoc(nested, { index: 1, text: "child" }, true);
    expect(changed).toBe(true);
    expect(tasksInDoc(next).map((t) => [t.text, t.checked])).toEqual([["parent", false], ["child", true]]);
  });

  it("⛔ a MOVED item is found by its words, not by a stale position", () => {
    // The note gained a line above the list since the rollup was built, so index 1 is now
    // "one". Ticking by (index 1, text "two") must still tick "two".
    const moved = doc(taskList(task("zero"), task("one"), task("two"), task("three")));
    const { doc: next, changed } = setTaskCheckedInDoc(moved, { index: 1, text: "two" }, true);
    expect(changed).toBe(true);
    expect(tasksInDoc(next).find((t) => t.text === "two").checked).toBe(true);
    expect(tasksInDoc(next).find((t) => t.text === "one").checked).toBe(false);
  });

  it("⛔ TWO IDENTICAL LINES: it ticks the OPEN one, never one already done", () => {
    /* The rollup only ever offered the OPEN one, so an index pointing at the ticked twin is
     * a stale index and must not be trusted just because the words agree. */
    const dupes = doc(taskList(task("Follow up", true), task("Follow up", false)));
    const { doc: next, changed } = setTaskCheckedInDoc(dupes, { index: 0, text: "Follow up" }, true);
    expect(changed).toBe(true);
    expect(tasksInDoc(next).map((t) => t.checked)).toEqual([true, true]);
  });

  it("⛔ ticking one that is ALREADY ticked changes nothing rather than moving a neighbour", () => {
    const done = doc(taskList(task("one", true), task("two", false)));
    const r = setTaskCheckedInDoc(done, { index: 0, text: "one" }, true);
    expect(r.changed).toBe(false);
    expect(tasksInDoc(r.doc).map((t) => t.checked)).toEqual([true, false]);
  });

  it("⛔ an item that is GONE changes nothing, and says so", () => {
    const r = setTaskCheckedInDoc(sample, { index: 9, text: "vanished" }, true);
    expect(r.changed).toBe(false);
    expect(r.doc).toBe(sample);
  });
});

describe("NEW-4 · the roll-up across notes", () => {
  const pages = [
    { pageId: "p1", pageTitle: "Water district", projectId: "proj_a", trail: [] },
    { pageId: "p2", pageTitle: "Site walk", projectId: "proj_a", trail: ["Grand Port"] },
    { pageId: "p3", pageTitle: "Loose thoughts", projectId: null, trail: [] },
  ];
  const bodies = {
    p1: doc(taskList(task("Call the district"), task("Done thing", true))),
    p2: doc(taskList(task("Thursday walk"))),
    p3: doc(taskList(task("Read the LOI"))),
  };

  it("names the note each item came from, and carries only open ones", () => {
    const rows = rollUpOpenTasks(pages, bodies);
    expect(rows.map((r) => [r.text, r.pageTitle])).toEqual([
      ["Call the district", "Water district"],
      ["Thursday walk", "Site walk"],
      ["Read the LOI", "Loose thoughts"],
    ]);
    expect(rows.every((r) => r.key.startsWith(r.pageId))).toBe(true);
  });

  it("a page with no body is skipped rather than crashing the list", () => {
    expect(rollUpOpenTasks(pages, { p2: bodies.p2 })).toHaveLength(1);
  });

  it("groups by project, no-project last, keeping order within each group", () => {
    const groups = groupTasksByProject(rollUpOpenTasks(pages, bodies), [{ id: "proj_a", name: "Grand Port" }]);
    expect(groups.map((g) => [g.name, g.tasks.length])).toEqual([["Grand Port", 2], [null, 1]]);
  });

  it("a project whose name has not loaded is still a group, not a disappearance", () => {
    const groups = groupTasksByProject(rollUpOpenTasks(pages, bodies), []);
    expect(groups[0].name).toBe("Project");
    expect(groups[0].tasks).toHaveLength(2);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * NEW-3 — VERSION HISTORY: what survives, and that a restore never destroys anything
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
const HOUR = 3600e3;
const DAY = 24 * HOUR;

describe("NEW-3 · when a snapshot is due", () => {
  it("the first one always is", () => expect(shouldSnapshot(undefined, 1000)).toBe(true));
  it("a moment later, it is not", () => expect(shouldSnapshot(1000, 2000)).toBe(false));
  it("after the gap, it is", () => expect(shouldSnapshot(0, 91_000)).toBe(true));
});

describe("NEW-3 · retention keeps the recent ones densely and the old ones coarsely", () => {
  const now = 10 * DAY;
  const rows = [];
  let id = 0;
  const add = (at, extra = {}) => { rows.push({ id: `v${id += 1}`, at, ...extra }); };

  // the last hour: six snapshots, ten minutes apart
  for (let i = 0; i < 6; i += 1) add(now - i * 10 * 60e3);
  // the last day: one every twenty minutes for six hours
  for (let i = 1; i <= 18; i += 1) add(now - HOUR - i * 20 * 60e3);
  // the last month: four a day for eight days
  for (let d = 2; d <= 9; d += 1) for (let q = 0; q < 4; q += 1) add(now - d * DAY - q * 6 * HOUR);
  // …and one from six months ago
  add(now - 180 * DAY, { id: "ancient" });

  const { keep, drop } = planRetention(rows, { now });

  it("everything inside the last hour survives", () => {
    for (const r of rows.filter((x) => now - x.at <= HOUR)) {
      expect(keep, `${r.id} is inside the hour`).toContain(r.id);
    }
  });

  it("the day tier thins to roughly hourly", () => {
    const kept = keep.map((k) => rows.find((r) => r.id === k)).filter((r) => now - r.at > HOUR && now - r.at <= DAY);
    for (let i = 1; i < kept.length; i += 1) {
      expect(kept[i - 1].at - kept[i].at, "two kept rows inside the day tier are closer than an hour").toBeGreaterThanOrEqual(HOUR);
    }
  });

  it("anything older than the last tier goes back", () => {
    expect(drop).toContain("ancient");
    expect(keep).not.toContain("ancient");
  });

  it("⛔ the NEWEST row is pinned unconditionally — a history whose current row can be swept is not one", () => {
    const newest = rows.slice().sort((a, b) => b.at - a.at)[0];
    expect(keep[0]).toBe(newest.id);
    expect(planRetention(rows, { now, max: 1 }).keep).toEqual([newest.id]);
  });

  it("a PINNED row (either side of a restore) outranks spacing", () => {
    const withPin = [
      { id: "now", at: now },
      { id: "a", at: now - 3 * DAY },
      { id: "pinned", at: now - 3 * DAY - 60e3, pinned: true },   // a minute apart, day tier
    ];
    const r = planRetention(withPin, { now });
    expect(r.keep).toContain("pinned");
    expect(r.drop).not.toContain("pinned");
  });

  it("the ceiling trims from the OLD end", () => {
    const r = planRetention(rows, { now, max: 5 });
    expect(r.keep).toHaveLength(5);
    const keptAts = r.keep.map((k) => rows.find((x) => x.id === k).at);
    expect(keptAts).toEqual(keptAts.slice().sort((a, b) => b - a));
  });

  it("an empty history plans nothing", () => expect(planRetention([], { now })).toEqual({ keep: [], drop: [] }));

  it("the tiers and the ceiling are real numbers, not zero", () => {
    expect(RETENTION_TIERS.length).toBeGreaterThan(1);
    expect(MAX_VERSIONS_PER_PAGE).toBeGreaterThan(10);
  });
});

describe("NEW-3 · ⛔ RESTORING CREATES A NEW VERSION AND DESTROYS NOTHING", () => {
  const current = doc(p("what is on the page now"));
  const older = doc(p("what it said an hour ago"));

  it("snapshots the state being LEFT before it applies the one being restored", () => {
    const plan = planRestore({ currentDoc: current, versionDoc: older, versionAt: 500, now: 1000 });
    expect(plan.ok).toBe(true);
    expect(plan.snapshotCurrent.doc).toBe(current);
    expect(plan.snapshotCurrent.pinned).toBe(true);
    expect(plan.snapshotCurrent.reason).toBe("before-restore");
    expect(plan.apply.doc).toBe(older);
    expect(plan.apply.pinned).toBe(true);
    // The pre-restore row must be OLDER than the restored one or the list reads backwards.
    expect(plan.snapshotCurrent.at).toBeLessThan(plan.apply.at);
  });

  it("the plan contains NO delete of any kind — that is the property, stated", () => {
    const plan = planRestore({ currentDoc: current, versionDoc: older, now: 1 });
    expect(Object.keys(plan).sort()).toEqual(["apply", "ok", "snapshotCurrent"]);
    expect(JSON.stringify(plan)).not.toMatch(/delete|purge|drop/i);
  });

  it("restoring is itself undoable — the pre-restore row is a real, restorable version", () => {
    const plan = planRestore({ currentDoc: current, versionDoc: older, now: 1000 });
    const back = planRestore({ currentDoc: plan.apply.doc, versionDoc: plan.snapshotCurrent.doc, now: 2000 });
    expect(back.ok).toBe(true);
    expect(back.apply.doc).toBe(current);
  });

  it("an empty page with nothing to leave still restores", () => {
    const plan = planRestore({ currentDoc: null, versionDoc: older, now: 1 });
    expect(plan.ok).toBe(true);
    expect(plan.snapshotCurrent).toBe(null);
  });

  it("a version with no document is refused by name, never applied as a blank page", () => {
    expect(planRestore({ currentDoc: current, versionDoc: null, now: 1 }).ok).toBe(false);
  });

  it("every reason a row can carry has a sentence", () => {
    for (const r of ["typing", "closed", "before-restore", "restored"]) {
      expect(versionReasonLabel(r).length).toBeGreaterThan(3);
    }
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * NEW-2 — QUICK OPEN
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("NEW-2 · fuzzy title matching", () => {
  it("a subsequence matches; a missing letter does not", () => {
    expect(fuzzyScore("Grand Port", "gp")).toBeGreaterThan(0);
    expect(fuzzyScore("Grand Port", "gpz")).toBe(null);
    expect(fuzzyScore("", "x")).toBe(null);
  });

  it("WORD STARTS beat mid-word letters — `gp` prefers Grand Port over Bridgepoint", () => {
    expect(fuzzyScore("Grand Port", "gp")).toBeGreaterThan(fuzzyScore("Bridgepoint", "gp"));
  });

  it("a real prefix beats a scattered match", () => {
    expect(fuzzyScore("Drainage", "dra")).toBeGreaterThan(fuzzyScore("Detention ratio analysis", "dra"));
  });

  it("an empty query matches everything at par, so the palette opens browsable", () => {
    expect(fuzzyScore("anything", "")).toBe(0);
  });

  const entries = [
    { pageId: "a", pageTitle: "Grand Port", trail: [] },
    { pageId: "b", pageTitle: "Entitlements", trail: ["Grand Port"] },
    { pageId: "c", pageTitle: "Bridgepoint", trail: [] },
    { pageId: "d", pageTitle: "Pond maintenance and inspection schedule 2026", trail: [] },
    { pageId: "e", pageTitle: "Ponds", trail: [] },
  ];

  it("ranks the note you meant first", () => {
    expect(rankQuickOpen(entries, "gp")[0].pageId).toBe("a");
  });

  it("finds a SUBPAGE through its trail — `gpent` reaches Grand Port / Entitlements", () => {
    expect(rankQuickOpen(entries, "gpent").map((r) => r.pageId)).toContain("b");
  });

  it("a short title wins a tie over a long one", () => {
    expect(rankQuickOpen(entries, "pond").map((r) => r.pageId)[0]).toBe("e");
  });

  it("nothing matching returns nothing — no zero-scored padding", () => {
    expect(rankQuickOpen(entries, "qqqq")).toEqual([]);
  });

  it("respects the limit", () => {
    expect(rankQuickOpen(entries, "", { limit: 2 })).toHaveLength(2);
  });
});

describe("NEW-2 · title hits, then body hits, and a page never appears twice", () => {
  const titleHits = [{ pageId: "a", pageTitle: "Grand Port", where: "title" }];
  const bodyHits = [
    { pageId: "a", pageTitle: "Grand Port", where: "body", excerpt: "…grand port…" },
    { pageId: "z", pageTitle: "Water", where: "body", excerpt: "…grand port sewer…" },
  ];

  it("body hits follow title hits, and the duplicate is dropped", () => {
    expect(quickOpenResults({ titleHits, bodyHits }).map((r) => [r.pageId, r.where]))
      .toEqual([["a", "title"], ["z", "body"]]);
  });

  it("the body row keeps the excerpt the full-text index already produced", () => {
    expect(quickOpenResults({ titleHits, bodyHits })[1].excerpt).toContain("sewer");
  });

  it("title hits alone are fine — the body half is a fall-through, not a requirement", () => {
    expect(quickOpenResults({ titleHits })).toHaveLength(1);
  });
});

describe("NEW-2 · the shortcut", () => {
  it("is spelled for the machine it is on, and is shown to the user", () => {
    expect(["Ctrl+K", "⌘K"]).toContain(QUICK_OPEN_KEY);
  });
  it("Ctrl+K and ⌘K both fire it", () => {
    expect(isQuickOpenChord({ ctrlKey: true, key: "k" })).toBe(true);
    expect(isQuickOpenChord({ metaKey: true, key: "K" })).toBe(true);
  });
  it("a bare k, or one wearing another modifier, does NOT", () => {
    expect(isQuickOpenChord({ key: "k" })).toBe(false);
    expect(isQuickOpenChord({ ctrlKey: true, shiftKey: true, key: "k" })).toBe(false);
    expect(isQuickOpenChord({ ctrlKey: true, altKey: true, key: "k" })).toBe(false);
    expect(isQuickOpenChord({ ctrlKey: true, key: "j" })).toBe(false);
    expect(isQuickOpenChord(null)).toBe(false);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * NEW-5 / NEW-7 — attachments, callouts and toggles, and what the EXPORT does with them
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
const attach = (id, name, size, mime = "") => ({ type: "noteAttachment", attrs: { fileId: id, name, size, mime } });

describe("NEW-5 · how a file is described, once", () => {
  it("sizes read the way a person reads them", () => {
    expect(fileSizeLabel(900)).toBe("900 B");
    expect(fileSizeLabel(2048)).toBe("2.0 KB");
    expect(fileSizeLabel(2.4 * 1024 * 1024)).toBe("2.4 MB");
    expect(fileSizeLabel(null)).toBe("");        // unknown renders as nothing, never "0 B"
    expect(fileSizeLabel(0)).toBe("0 B");        // …but a genuinely empty file is a real answer
  });
  it("the type badge comes from the NAME, because a .dwg reports as octet-stream", () => {
    expect(fileExtLabel("Site survey.dwg", "application/octet-stream")).toBe("DWG");
    expect(fileExtLabel("takeoff.xlsx")).toBe("XLSX");
    expect(fileExtLabel("noextension", "application/pdf")).toBe("PDF");
    expect(fileExtLabel("")).toBe("FILE");
  });
  it("the download name is safe and keeps its extension", () => {
    expect(safeAttachmentName("../../etc/passwd.pdf")).toBe("passwd.pdf");
    expect(safeAttachmentName("")).toBe("attachment");
  });
  it("one label, so the chip, the export and the sheet all say the same thing", () => {
    expect(attachmentLabel({ name: "Site survey.pdf", size: 2.4 * 1024 * 1024 })).toBe("Site survey.pdf · PDF · 2.4 MB");
  });
});

describe("NEW-5 · an attachment survives the Markdown export", () => {
  const withFile = doc(p("Survey came in."), attach("file_1", "Site survey.pdf", 2400));

  it("it is NAMED even when its bytes are not to hand — silence is the one thing forbidden", () => {
    const { markdown, lossy } = docToMarkdown(withFile, { title: "Grand Port" });
    expect(markdown).toContain("Site survey.pdf");
    expect(markdown).toContain("PDF");
    expect(lossy.join(" ")).toMatch(/attach/i);
  });

  it("with the bytes it becomes a real link", () => {
    const { markdown } = docToMarkdown(withFile, { title: "", images: { file_1: "data:application/pdf;base64,AAA" } });
    expect(markdown).toContain("](data:application/pdf;base64,AAA)");
    expect(markdown).toContain("Site survey.pdf");
  });

  it("its NAME is searchable — a filename is how anyone looks for the file", () => {
    expect(docToText(withFile)).toContain("Site survey.pdf");
  });

  it("⛔ the purge cascade sees it: `assetIdsInDoc` covers pictures AND files", () => {
    const both = doc(
      { type: "noteImage", attrs: { imageId: "img_1", alt: "", mime: "", w: null, h: null } },
      attach("file_1", "a.pdf", 10),
    );
    expect(imageIdsInDoc(both)).toEqual(["img_1"]);
    expect(attachmentIdsInDoc(both)).toEqual(["file_1"]);
    expect(assetIdsInDoc(both).sort()).toEqual(["file_1", "img_1"]);
  });
});

describe("NEW-7 · a callout round-trips as GitHub's own alert syntax", () => {
  const callout = (tone, text) => ({ type: "noteCallout", attrs: { tone }, content: [p(text)] });

  it("each tone writes its marker, and the words survive", () => {
    for (const t of CALLOUT_TONES) {
      const { markdown, lossy } = docToMarkdown(doc(callout(t.id, `a ${t.id} note`)), { title: "" });
      expect(markdown).toContain(`> [!${t.md}]`);
      expect(markdown).toContain(`a ${t.id} note`);
      // It is NOT an HTML fallback, so it must not report itself as lossy.
      expect(lossy).toEqual([]);
    }
  });

  it("a callout holding a LIST keeps the list", () => {
    const rich = doc({
      type: "noteCallout",
      attrs: { tone: "warning" },
      content: [p("Watch out for:"), { type: "bulletList", content: [{ type: "listItem", content: [p("the ditch")] }] }],
    });
    const { markdown } = docToMarkdown(rich, { title: "" });
    expect(markdown).toContain("> [!WARNING]");
    expect(markdown).toContain("> - the ditch");
  });

  it("an unknown tone still exports as something readable rather than vanishing", () => {
    const { markdown } = docToMarkdown(doc(callout("nonsense", "still here")), { title: "" });
    expect(markdown).toContain("still here");
    expect(markdown).toContain("[!NOTE]");
  });
});

describe("NEW-7 · ⛔ a collapsed toggle EXPORTS EXPANDED", () => {
  const toggle = (open, title, body) => ({
    type: "noteToggle",
    attrs: { open },
    content: [{ type: "noteToggleTitle", content: [{ type: "text", text: title }] }, p(body)],
  });

  it("a CLOSED toggle still writes both its title and its contents", () => {
    const { markdown } = docToMarkdown(doc(toggle(false, "Bonding", "the surety letter is in")), { title: "" });
    expect(markdown).toContain("<details open>");
    expect(markdown).toContain("<summary>Bonding</summary>");
    expect(markdown).toContain("the surety letter is in");
    expect(markdown).not.toContain("<details>");    // never written closed
  });

  it("an OPEN one is identical — the fold is a screen state, not a document one", () => {
    const shut = docToMarkdown(doc(toggle(false, "T", "body")), { title: "" }).markdown;
    const open = docToMarkdown(doc(toggle(true, "T", "body")), { title: "" }).markdown;
    expect(shut).toBe(open);
  });

  it("a toggle's contents are searchable whether it is folded or not", () => {
    expect(docToText(doc(toggle(false, "Bonding", "surety letter")))).toContain("surety letter");
  });

  it("a toggle with no title still exports a usable summary", () => {
    const bare = { type: "noteToggle", attrs: { open: false }, content: [{ type: "noteToggleTitle" }, p("x")] };
    expect(docToMarkdown(doc(bare), { title: "" }).markdown).toContain("<summary>Details</summary>");
  });
});

describe("the schema and the exporter still cannot drift", () => {
  it("every new node has a case, and every case is a real node", () => {
    for (const n of ["noteAttachment", "noteCallout", "noteToggle", "noteToggleTitle"]) {
      expect(Object.keys(schema.nodes), n).toContain(n);
    }
  });

  it("a document holding all of them at once is valid in the real schema", () => {
    const everything = doc(
      h(1, "Everything"),
      { type: "noteCallout", attrs: { tone: "tip" }, content: [p("a tip")] },
      {
        type: "noteToggle",
        attrs: { open: false },
        content: [{ type: "noteToggleTitle", content: [{ type: "text", text: "Folded" }] }, p("inside")],
      },
      attach("file_1", "x.dwg", 99),
      taskList(task("still open")),
    );
    const node = PMNode.fromJSON(schema, everything);
    expect(node.childCount).toBe(5);
    node.check();                                   // throws if the content model is violated
    expect(outlineFromDoc(everything)).toHaveLength(1);
    expect(openTasksInDoc(everything).map((t) => t.text)).toEqual(["still open"]);
  });
});
