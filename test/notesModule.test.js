/* notesModule — the guards that keep the Notes workspace wired up and inside the house rules.
 *
 * These are the checks that catch the failures nobody notices at review time:
 *   • a workspace registered in seven of the EIGHT places it has to be (the Library shipped
 *     with a generic "Loading…" until B524 for exactly this reason);
 *   • the LAZY EDITOR BOUNDARY quietly collapsing, which puts ~464 KB of rich-text engine
 *     onto the route's static path and breaks the perf budget;
 *   • a raw hex creeping into module chrome, which reads fine until the theme flips (B341);
 *   • a `window.prompt` creeping back in;
 *   • the mirrored control-radius constants drifting from the shared scale they copy;
 *   • an extension admitted into the schema that the Markdown exporter cannot spell.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { getSchema } from "@tiptap/core";

import { MODULE_BY_SLUG, SLUG_BY_MODULE, parseRoute, buildHash } from "../src/app/route.js";
import { MODULE_ACCENT } from "../src/shared/ui/moduleAccent.js";
import { LOADER_SKINS, resolveLoaderTheme } from "../src/shared/ui/moduleLoaderTheme.js";
import { ROUTE_KEYS } from "../ui-audit/lib/bundleMetrics.mjs";
import { PALETTES } from "../src/shared/theme/palette.js";
import { NOTE_EXTENSIONS } from "../src/workspaces/notes/lib/notesExtensions.js";
import { NOTE_MD_HANDLED } from "../src/workspaces/notes/lib/notesMarkdown.js";
import { deleteNode, restoreNode } from "../src/workspaces/notes/lib/notesModel.js";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NOTES = join(REPO, "src", "workspaces", "notes");
const read = (...p) => readFileSync(join(...p), "utf8");
const src = (rel) => read(NOTES, rel);

/* Guards must scan CODE, not prose. Every one of these files documents the rule it obeys —
 * "never `window.prompt`", "nothing here may import `@tiptap`" — and a scanner that reads
 * comments turns each of those sentences into a false positive. (It also means a real
 * violation could hide inside a comment and pass.) So the source scans below run against a
 * comment-stripped copy. `://` is protected so a URL in a string is not mistaken for a
 * line comment. */
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");
const code = (rel) => stripComments(src(rel));

const MODULE_ID = "notes";
const JSX_SURFACES = ["Notes.jsx", "components/NotesTree.jsx", "components/NoteEditor.jsx"];
const ALL_NOTES_FILES = [
  "Notes.jsx", "components/NotesTree.jsx", "components/NoteEditor.jsx", "components/NoteToolbar.jsx",
  "lib/notesModel.js", "lib/notesStore.js", "lib/notesCloud.js", "lib/notesMarkdown.js", "lib/notesExtensions.js",
  "lib/notesTime.js", "lib/notesPrint.js", "lib/notesImageDb.js", "lib/notesImageIntake.js",
  "lib/notesImageNode.js", "lib/notesSearchHighlight.js", "lib/notesDocHtml.js",
];

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 1. THE EIGHT-PLACE REGISTRATION CHECKLIST
 * A new workspace touches eight surfaces and missing ONE fails quietly — the module still
 * "works", it just loses its accent, or its loader caption, or its prefetch, or its budget.
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("workspace registration — all EIGHT places", () => {
  it("(1) the Shell's WORKSPACES registry lazy-loads the workspace", () => {
    const shell = read(REPO, "src/app/Shell.jsx");
    expect(shell).toMatch(/id:\s*"notes"/);
    expect(shell).toMatch(/import\("\.\.\/workspaces\/notes\/Notes\.jsx"\)/);
    expect(shell, "the workspace must be lazy() like its peers, never a static import")
      .toMatch(/lazy\(\(\) => import\("\.\.\/workspaces\/notes\/Notes\.jsx"\)\)/);
  });

  it("(1b) the Shell passes the signed-in user id down, so Notes can scope its storage per account", () => {
    expect(read(REPO, "src/app/Shell.jsx")).toMatch(/userId=\{user\?\.id \|\| null\}/);
  });

  it("(2) route.js maps the slug BOTH ways, and the two maps agree", () => {
    expect(MODULE_BY_SLUG.notes).toBe(MODULE_ID);
    expect(SLUG_BY_MODULE[MODULE_ID]).toBe("notes");
    for (const [slug, mod] of Object.entries(MODULE_BY_SLUG)) expect(SLUG_BY_MODULE[mod]).toBe(slug);
  });

  it("(2b) the route round-trips, including with a project", () => {
    expect(parseRoute("#/notes").module).toBe(MODULE_ID);
    expect(buildHash({ module: MODULE_ID })).toBe("#/notes");
    expect(parseRoute("#/project/abc/notes")).toEqual({ module: MODULE_ID, projectId: "abc", cross: false });
    expect(buildHash({ module: MODULE_ID, projectId: "abc" })).toBe("#/project/abc/notes");
  });

  it("(3) modulePrefetch can warm the chunk on navigation intent", () => {
    const pf = read(REPO, "src/app/modulePrefetch.js");
    expect(pf).toMatch(/"notes":\s*\(\) => import\("\.\.\/workspaces\/notes\/Notes\.jsx"\)/);
  });

  it("(3b) the prefetch specifier is byte-identical to the Shell's, so Vite dedupes to ONE chunk", () => {
    const spec = /import\("(\.\.\/workspaces\/notes\/Notes\.jsx)"\)/;
    expect(read(REPO, "src/app/Shell.jsx").match(spec)[1]).toBe(read(REPO, "src/app/modulePrefetch.js").match(spec)[1]);
  });

  it("(4) moduleAccent carries the module's hue", () => {
    expect(MODULE_ACCENT[MODULE_ID]).toBe("#B8418C");
  });

  it("(5) moduleLoaderTheme gives it a NAMED caption, not the generic fallback", () => {
    expect(LOADER_SKINS[MODULE_ID]).toBeTruthy();
    const theme = resolveLoaderTheme(MODULE_ID);
    expect(theme.label, "this is the B524 regression — a workspace with no skin shows a bare 'Loading…'").not.toBe("Loading…");
    expect(theme.accent).toBe(MODULE_ACCENT[MODULE_ID]);
  });

  it("(6) AppHeader has a module tab, with an icon and BOTH accent maps", () => {
    const hdr = read(REPO, "src/shared/ui/AppHeader.jsx");
    expect(hdr).toMatch(/id:\s*"notes",\s*\n\s*label:\s*"Notes"/);
    expect(hdr, "the tab needs an inline SVG icon like its peers").toMatch(/id:\s*"notes"[\s\S]{0,600}?<path/);
    expect(hdr).toMatch(/"notes":\s*"var\(--accent-notes\)"/);
    expect(hdr).toMatch(/"notes":\s*"var\(--accent-notes-text\)"/);
  });

  it("(7) bundleMetrics ROUTE_KEYS names the route, so its budget can be evaluated at all", () => {
    expect(ROUTE_KEYS.notes).toEqual({ src: "src/workspaces/notes/Notes.jsx", stem: "Notes" });
  });

  it("(8) the route carries a committed byte budget, wired into the audit AND the ratchet", () => {
    const budgets = JSON.parse(read(REPO, "ui-audit/perf-budgets.json"));
    expect(budgets.bundle.notesRouteJsBytes, "no budget = the route can grow without limit").toBeTruthy();
    expect(budgets.bundle.notesRouteJsBytes.baseline).toBeTypeOf("number");
    expect(budgets.bundle.notesRouteJsBytes.ceiling, "byte metrics derive their ceiling; they never hand-pin one").toBeUndefined();
    expect(read(REPO, "ui-audit/perf-bundle-audit.mjs")).toContain("bundle.notesRouteJsBytes");
    expect(read(REPO, "scripts/perf-ratchet.mjs")).toContain("bundle.notesRouteJsBytes");
  });

  it("every registry that names the peer workspaces also names this one — no gaps", () => {
    const peers = ["site-planner", "doc-review", "library", "scheduler"];
    for (const registry of [MODULE_ACCENT, LOADER_SKINS, SLUG_BY_MODULE]) {
      for (const p of peers) expect(registry[p], `peer ${p}`).toBeTruthy();
      expect(registry[MODULE_ID], "notes is missing from a registry every peer is in").toBeTruthy();
    }
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 2. THE LAZY EDITOR BOUNDARY
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("the editor is split off the route's static path", () => {
  /* Walk the STATIC import graph from the workspace root across the whole of src/,
   * refusing to follow a dynamic import(). Whatever this reaches is what a plain Notes
   * route must download and evaluate — including SHARED modules, because a shared module
   * that imported the engine would put it on the route just as surely as a local one. */
  function staticClosure(entryRepoRel) {
    const seen = new Set();
    const resolveFile = (base) => {
      for (const cand of [base, `${base}.js`, `${base}.jsx`, join(base, "index.js")]) {
        if (existsSync(join(REPO, cand)) && !existsSync(join(REPO, cand, "."))) return cand;
        if (existsSync(join(REPO, cand))) return cand;
      }
      return null;
    };
    const walk = (rel) => {
      if (seen.has(rel)) return;
      seen.add(rel);
      const text = stripComments(readFileSync(join(REPO, rel), "utf8"));
      for (const m of text.matchAll(/^\s*import\s+(?:[\w*{},\s]+\s+from\s+)?["']([^"']+)["']/gm)) {
        const spec = m[1];
        if (!spec.startsWith(".")) continue;                      // bare package — not a file to walk
        const joined = join(dirname(rel), spec).replace(/\\/g, "/");
        const target = resolveFile(joined);
        if (target && /\.(js|jsx)$/.test(target)) walk(target);
      }
    };
    walk(entryRepoRel);
    return [...seen];
  }

  const ROOT_REL = "src/workspaces/notes/Notes.jsx";
  const reached = staticClosure(ROOT_REL);
  const reachedNotes = reached.filter((r) => r.startsWith("src/workspaces/notes/")).map((r) => r.slice("src/workspaces/notes/".length));

  it("nothing on the static path imports @tiptap — that is the whole point of the split", () => {
    expect(reached.length, "the walker resolved nothing — the graph walk is broken, not the code").toBeGreaterThan(3);
    for (const rel of reached) {
      const text = stripComments(readFileSync(join(REPO, rel), "utf8"));
      expect(text.includes("@tiptap"), `${rel} statically imports @tiptap; it must sit behind the lazy boundary`).toBe(false);
    }
  });

  it("the static path does NOT reach the editor, the toolbar, or anything that pulls the engine", () => {
    for (const forbidden of ["components/NoteEditor.jsx", "components/NoteToolbar.jsx", "lib/notesExtensions.js",
      "lib/notesImageNode.js", "lib/notesSearchHighlight.js", "lib/notesDocHtml.js"]) {
      expect(reachedNotes, `${forbidden} is on the static path — the engine will ride the route chunk`).not.toContain(forbidden);
    }
  });

  it("the static path DOES reach the tree, the model, the store and the exporter", () => {
    for (const needed of ["components/NotesTree.jsx", "lib/notesModel.js", "lib/notesStore.js", "lib/notesMarkdown.js"]) {
      expect(reachedNotes).toContain(needed);
    }
  });

  it("the workspace root pulls the editor with lazy() + import(), inside a Suspense", () => {
    const root = src("Notes.jsx");
    expect(root).toMatch(/lazy\(\(\) => import\("\.\/components\/NoteEditor\.jsx"\)\)/);
    expect(root).toMatch(/<Suspense/);
  });

  it("the editor is the ONLY notes file that imports the React editor binding", () => {
    const importers = ALL_NOTES_FILES.filter((f) => /from "@tiptap\/react"/.test(code(f)));
    expect(importers).toEqual(["components/NoteEditor.jsx"]);
  });

  it("lib/notesExtensions.js is the ONE declaration of what a note may contain", () => {
    const declarers = ALL_NOTES_FILES.filter((f) => /from "@tiptap\/(starter-kit|extension-|extensions")/.test(code(f)));
    expect(declarers).toEqual(["lib/notesExtensions.js"]);
  });

  it("the print serializer is reached from the workspace root by a DYNAMIC import only", () => {
    const root = code("Notes.jsx");
    expect(root, "a static import of the print serializer puts the engine back on the route")
      .not.toMatch(/^\s*import\s+.*notesDocHtml/m);
    expect(root).toMatch(/import\("\.\/lib\/notesDocHtml\.js"\)/);
  });

  it("the editor is REMOUNTED per page — the key is a bug fix, not a style choice", () => {
    const root = code("Notes.jsx");
    expect(root, "without key={pageId} the outgoing page's autosave cannot flush on unmount").toMatch(/key=\{activePage\.id\}/);
  });

  it("there is NO 'sync content on pageId change' effect — that is the crash this shape removed", () => {
    const editor = code("components/NoteEditor.jsx");
    expect(editor, "setContent against a torn-down instance is the null-commands crash").not.toMatch(/\.commands\.setContent/);
    expect(editor).not.toMatch(/setContent\(/);
  });

  it("the pending snapshot is plain JSON captured at edit time, not queried at flush time", () => {
    const editor = src("components/NoteEditor.jsx");
    expect(editor, "onUpdate must snapshot getJSON() into pendingRef").toMatch(/pendingRef\.current = \{ id: pageId, doc: ed\.getJSON\(\) \}/);
    expect(editor, "the flush writes the captured object").toMatch(/writePage\(pending\.id, pending\.doc\)/);
  });

  it("beforeunload uses the SAME flush as unmount", () => {
    const editor = src("components/NoteEditor.jsx");
    expect(editor).toMatch(/addEventListener\("beforeunload"/);
    expect(editor).toMatch(/useEffect\(\(\) => flush, \[flush\]\)/);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 3. HOUSE RULES — theme tokens, no dialogs, module-scope components
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("chrome is theme tokens only", () => {
  for (const f of JSX_SURFACES) {
    it(`${f} contains no raw hex — a hardcoded colour is the B341 trap`, () => {
      const hits = [...code(f).matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
      expect(hits, `${f} hardcodes ${hits.join(", ")} instead of a theme token`).toEqual([]);
    });
  }

  it("the toolbar's only literal colours are the CONTENT palettes — a text colour is not chrome", () => {
    const text = code("components/NoteToolbar.jsx");
    const paletteBlock = text.slice(text.indexOf("const TEXT_COLORS"), text.indexOf("const FONTS"));
    const all = [...text.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
    const inPalette = [...paletteBlock.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
    expect(all.length).toBeGreaterThan(0);
    expect(all.sort(), "a hex outside the content palette is chrome and must be a token").toEqual(inPalette.sort());
  });

  it("the module's chrome actually USES its accent tokens", () => {
    const all = JSX_SURFACES.map(code).join("\n");
    for (const token of ["var(--accent-notes)", "var(--on-accent-notes)", "var(--accent-notes-text)"]) {
      expect(all, `${token} is declared but never used`).toContain(token);
    }
  });

  it("the CSS tokens exist in BOTH themes and are mirrored into the JS palette", () => {
    const css = read(REPO, "src/index.css");
    expect(css).toMatch(/--accent-notes:\s*#B8418C/);
    expect(css).toMatch(/--on-accent-notes:\s*#FFFFFF/);
    // light + dark each declare the -text variant
    expect([...css.matchAll(/--accent-notes-text:\s*(#[0-9A-Fa-f]{6})/g)].map((m) => m[1])).toEqual(["#8C2F69", "#F0A6D2"]);
    expect(PALETTES.light.accentNotes).toBe("#B8418C");
    expect(PALETTES.dark.accentNotes).toBe("#B8418C");
    expect(PALETTES.light.accentNotesText).toBe("#8C2F69");
    expect(PALETTES.dark.accentNotesText).toBe("#F0A6D2");
    expect(PALETTES.light.onAccentNotes).toBe("#FFFFFF");
  });

  it("the JS palette mirror matches the CSS, token for token", () => {
    const css = read(REPO, "src/index.css");
    expect(css).toContain(PALETTES.light.accentNotes);
    expect(css).toContain(PALETTES.light.accentNotesText);
    expect(css).toContain(PALETTES.dark.accentNotesText);
  });
});

describe("no dialog boxes anywhere in the module (owner rule)", () => {
  for (const f of ALL_NOTES_FILES) {
    it(`${f} uses no window.prompt / confirm / alert`, () => {
      const text = code(f);
      for (const bad of ["window.prompt", "window.confirm", "window.alert"]) {
        expect(text, `${f} uses ${bad} — editing must be inline`).not.toContain(bad);
      }
      expect(text, `${f} calls a bare prompt()/confirm()/alert()`).not.toMatch(/(?<![.\w])(prompt|confirm|alert)\s*\(/);
    });
  }

  it("rename is an inline field that commits on Enter and cancels on Esc", () => {
    const tree = src("components/NotesTree.jsx");
    expect(tree).toMatch(/e\.key === "Enter"/);
    expect(tree).toMatch(/e\.key === "Escape"/);
    expect(tree).toContain("RenameField");
  });

  it("delete asks with an inline confirmation row, not a modal", () => {
    expect(src("components/NotesTree.jsx")).toContain("ConfirmDelete");
    expect(src("components/NotesTree.jsx")).toMatch(/Delete\?/);
  });

  it("toolbar controls cancel mousedown so the caret survives a click", () => {
    const bar = code("components/NoteToolbar.jsx");
    expect(bar).toMatch(/onMouseDown=\{stop\}/);
    expect(bar).toMatch(/const stop = \(e\) => e\.preventDefault\(\)/);
  });

  it("toolbar active states are read from the editor, never mirrored into React state", () => {
    const bar = code("components/NoteToolbar.jsx");
    expect(bar).toMatch(/editor\.isActive\(/);
    /* The sharper form of the rule, and the one that actually states it: no piece of React
     * state here may be SEEDED from the editor. That is what "mirrored" means — a copy taken
     * once and then drifting every time the caret moves by a route the toolbar didn't
     * originate. A `useState` that never reads the editor cannot drift. */
    expect(bar).not.toMatch(/useState\([^)]*editor\s*\./);
    /* The count stays capped as a second, blunter net. The bar's useStates are: the two
     * colour popovers' open flags, the link editor's open + href, the overflow drawer's
     * open flag, and the table grid picker's open + hovered size + grown grid (B1372) —
     * every one of them a transient control-chrome flag, none of them a formatting state. */
    const states = [...bar.matchAll(/useState\(/g)].length;
    expect(states, "a mirrored active-state copy drifts the moment the caret moves").toBeLessThanOrEqual(7);
  });
});

describe("components are declared at module scope (MODULE-SCOPE-COMPONENTS)", () => {
  for (const f of [...JSX_SURFACES, "components/NoteToolbar.jsx"]) {
    it(`${f} declares no component inside another component's body`, () => {
      // A capitalised `function Foo(` or `const Foo = (` that is INDENTED is nested.
      const nested = code(f).split("\n").filter((l) => /^\s+(function|const)\s+[A-Z]\w*\s*[=(]/.test(l) && !/^\s+const\s+[A-Z]\w*\s*=\s*[^(]/.test(l));
      expect(nested, `${f} defines a component in a render body — React remounts it every render`).toEqual([]);
    });
  }
});

describe("the mirrored control scale still matches the shared one", () => {
  it("controls.jsx is the source, and every notes copy agrees with it", () => {
    const shared = read(REPO, "src/shared/ui/controls.jsx");
    const m = shared.match(/export const RADIUS = \{\s*control:\s*(\d+),\s*pill:\s*(\d+),/);
    expect(m, "controls.jsx no longer declares RADIUS in the expected shape").toBeTruthy();
    const [, control, pill] = m;

    const copies = ALL_NOTES_FILES.filter((f) => code(f).includes("const RADIUS ="));
    expect(copies.length, "no file mirrors the scale — did the copies get removed?").toBeGreaterThan(0);
    for (const f of copies) {
      const c = code(f).match(/const RADIUS = \{\s*control:\s*(\d+),\s*pill:\s*(\d+)\s*\}/);
      expect(c, `${f} mirrors RADIUS in an unrecognised shape`).toBeTruthy();
      expect(c[1], `${f} control radius drifted from controls.jsx`).toBe(control);
      expect(c[2], `${f} pill radius drifted from controls.jsx`).toBe(pill);
    }
  });

  it("no notes file imports controls.jsx — that hoists a THIRD shared chunk onto the Site route", () => {
    for (const f of ALL_NOTES_FILES) {
      expect(code(f), `${f} imports controls.jsx; the Site route's chunk allowlist goes red`).not.toMatch(/shared\/ui\/controls/);
    }
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 4. THE SCHEMA AND THE EXPORTER CANNOT DRIFT APART
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("every node and mark a note may contain has a case in the Markdown exporter", () => {
  const schema = getSchema(NOTE_EXTENSIONS);

  it("every schema NODE is handled", () => {
    for (const name of Object.keys(schema.nodes)) {
      expect(NOTE_MD_HANDLED.nodes, `node "${name}" is admitted into notes but the exporter has no case for it`).toContain(name);
    }
  });

  it("every schema MARK is handled", () => {
    for (const name of Object.keys(schema.marks)) {
      expect(NOTE_MD_HANDLED.marks, `mark "${name}" is admitted into notes but the exporter has no case for it`).toContain(name);
    }
  });

  it("the manifest claims nothing the schema does not actually admit", () => {
    for (const n of NOTE_MD_HANDLED.nodes) expect(Object.keys(schema.nodes), `node "${n}"`).toContain(n);
    for (const m of NOTE_MD_HANDLED.marks) expect(Object.keys(schema.marks), `mark "${m}"`).toContain(m);
  });

  it("the features the owner asked for by name are all in the schema", () => {
    for (const n of ["table", "tableCell", "taskList", "taskItem", "heading", "codeBlock", "blockquote"]) {
      expect(Object.keys(schema.nodes)).toContain(n);
    }
    for (const m of ["bold", "italic", "underline", "strike", "highlight", "textStyle", "link"]) {
      expect(Object.keys(schema.marks)).toContain(m);
    }
  });

  it("the constructs with no toolbar control are kept OUT of the schema", () => {
    // backgroundColor / lineHeight would be admitted by TextStyleKit's defaults; they are
    // switched off so nothing can enter a document that the exporter has to guess at.
    expect(Object.keys(schema.marks)).not.toContain("backgroundColor");
    expect(Object.keys(schema.marks)).not.toContain("lineHeight");
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 5. LOUD-FAILURE + the delete cascade, at the storage seam
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("LOUD-FAILURE — storage is one seam and it never fails silently", () => {
  it("every read and write goes through lib/notesStore.js, so cloud sync is a change THERE and nowhere else", () => {
    for (const f of ALL_NOTES_FILES.filter((x) => x !== "lib/notesStore.js")) {
      expect(code(f), `${f} touches localStorage directly, bypassing the storage seam`).not.toMatch(/localStorage/);
    }
  });

  it("lib/notesImageDb.js is the ONE file that touches indexedDB — images ride the same seam", () => {
    for (const f of ALL_NOTES_FILES.filter((x) => x !== "lib/notesImageDb.js")) {
      expect(code(f), `${f} reaches for indexedDB directly, bypassing the storage seam`).not.toMatch(/indexedDB/);
    }
    const store = src("lib/notesStore.js");
    for (const fn of ["putNoteImage", "readNoteImage", "deleteNoteImages", "purgePages"]) {
      expect(store, `${fn} must live on the seam`).toContain(`function ${fn}`);
    }
  });

  it("the image ceilings are enforced at the STORE, so no future intake path can slip past them", () => {
    const store = src("lib/notesStore.js");
    expect(store).toMatch(/export const MAX_IMAGE_BYTES/);
    expect(store).toMatch(/export const MAX_NOTEBOOK_IMAGE_BYTES/);
    // Over-limit is a NAMED refusal on the same one error channel, never a silent drop.
    expect(store).toMatch(/was NOT added/);
    expect(store).toMatch(/function failImage/);
  });

  it("an image whose bytes are gone renders a VISIBLE broken state, never a blank gap", () => {
    const node = src("lib/notesImageNode.js");
    expect(node).toMatch(/Image missing/);
    expect(node).toMatch(/data-missing/);
    expect(src("components/NoteEditor.jsx")).toMatch(/planyr-note-image\[data-missing\]/);
  });

  it("the store exposes a failure subscription and a named, human-readable message", () => {
    const store = src("lib/notesStore.js");
    expect(store).toMatch(/export function onNotesStorageError/);
    expect(store).toMatch(/quota/i);
    expect(store).toMatch(/was NOT saved/);
  });

  it("no catch block in the store is empty — a swallowed failure reads as success", () => {
    const store = src("lib/notesStore.js");
    // A catch whose body has no fail() / broadcast() / return is the silent path.
    for (const m of store.matchAll(/catch\s*\([^)]*\)\s*\{([^}]*)\}/g)) {
      const body = m[1].trim();
      const benign = /a bad listener must not mute the rest|Safari private mode/.test(m[0]) || /return\s+(null|\[\]|false|0)/.test(body);
      expect(body.length > 0 && (/fail\(|broadcast\(/.test(body) || benign), `empty or silent catch: ${m[0].slice(0, 90)}`).toBe(true);
    }
  });

  it("writes report whether the bytes landed, so a badge cannot say Saved when nothing was", () => {
    const store = src("lib/notesStore.js");
    expect(store).toMatch(/export function writeTree[\s\S]*?return true[\s\S]*?return false/);
    expect(store).toMatch(/export function writePage[\s\S]*?return true[\s\S]*?return false/);
    expect(src("components/NoteEditor.jsx")).toMatch(/ok \? "saved" : "error"/);
  });

  it("the workspace renders the failure as a NAMED banner", () => {
    const root = src("Notes.jsx");
    expect(root).toContain("onNotesStorageError");
    expect(root).toMatch(/role="alert"/);
    expect(root).toContain("StorageBanner");
  });

  /* ⛔ THIS TEST WAS INVERTED BY B1291, deliberately and with the feature in the same commit.
   * It used to assert the store never said "Synced" — which was the right guard while notes
   * were device-only, because the label claiming a cloud copy before one existed is the
   * B209 / B595 / B610 class LOUD-FAILURE exists to prevent. Now that sync is real, the same
   * rule points the other way: the line must be DERIVED from what actually happened, and the
   * old "not synced to the cloud yet" sentence must be gone rather than sitting beside it. */
  it("the footer says what is TRUE — a `Synced` state exists, and it is derived, never hardcoded", () => {
    const store = src("lib/notesStore.js");
    const root = code("Notes.jsx");   // CODE, not prose — the comments discuss the old sentence
    expect(store).toMatch(/Saved on this device/);
    expect(store).toMatch(/Synced to your account/);
    // Signed out is unchanged: no cloud claim at all.
    expect(store).toMatch(/scope === LOCAL_SCOPE\) return \{ text: "Saved on this device"/);
    // Every honest state has a branch, including the ones nobody likes.
    for (const mode of ["syncing", "synced", "offline", "error", "conflict"]) {
      expect(store, `notesStorageLine has no branch for "${mode}"`).toContain(`case "${mode}":`);
    }
    expect(store, "a failed sync must say WHY").toMatch(/sync failed: \$\{syncState\.reason\}/);
    // PANEL-BREVITY: the new line REPLACES the old sentence; it does not accumulate beside it.
    expect(root, "the pre-sync sentence must be gone, not joined").not.toMatch(/not synced to the cloud yet/);
    expect(root, "the footer renders the store's one line, never its own wording").toContain("{storageLine.text}");
    expect(root.match(/data-testid="notes-scope-label"/g), "there is exactly ONE storage line").toHaveLength(1);
  });

  it("the storage keys are scoped and versioned, so two accounts never read each other's notes", () => {
    const store = src("lib/notesStore.js");
    expect(store).toMatch(/planyr:notes:tree:v1/);
    expect(store).toMatch(/planyr:notes:page:v1/);
    expect(store).toMatch(/LOCAL_SCOPE = "local"/);
  });

  it("the TREE and the page BODIES are separate keys — one blob would rewrite every note per keystroke", () => {
    const store = src("lib/notesStore.js");
    expect(store).toMatch(/export const treeKey/);
    expect(store).toMatch(/export const pageKey = \(pageId/);
  });
});

describe("the delete cascade reaches storage (TOMBSTONE-DELETES)", () => {
  it("the delete computes the FULL cascade and stamps it on the trash entry, not just the clicked node", () => {
    const root = src("Notes.jsx");
    expect(root).toMatch(/const \{ tree: next, removedPageIds, entry \} = deleteNode\(/);
    expect(root, "the cascade set is what the bin entry carries").toMatch(/pageIds: entry\.pageIds/);
  });

  it("the PURGE is what clears bytes, it takes the entry's cascade set, and it is the ONLY caller", () => {
    const root = code("Notes.jsx");
    // Every purge path hands `purgePages` the ids the model returned — never a guessed one.
    expect(root).toMatch(/purgePages\(r\.pageIds\)/);
    expect(root).toMatch(/purgePages\(ids\)/);
    const store = src("lib/notesStore.js");
    expect(store, "the purge must clear the page BODY and its IMAGES together").toMatch(/export async function purgePages/);
    expect(store).toMatch(/imageIdsInDoc\(readPage\(id\)\)/);
    expect(store).toMatch(/deletePages\(ids\)/);
    expect(store).toMatch(/deleteNoteImages\(imageIds\)/);
  });

  it("a binned page's body survives until the purge — the bin is not a delayed delete of nothing", () => {
    const t = { v: 2, notebooks: [{ id: "nb", title: "N", projectId: null, sections: [
      { id: "s1", title: "A", pages: [{ id: "p1", title: "1" }, { id: "p2", title: "2" }] },
    ] }], trash: [] };
    const del = deleteNode(t, "s1");
    expect(del.entry.pageIds.sort()).toEqual(["p1", "p2"]);
    expect(del.tree.trash).toHaveLength(1);
    // Restoring gives back exactly what went in, at the index it came from.
    const back = restoreNode(del.tree, del.entry.id);
    expect(back.tree.trash).toHaveLength(0);
    expect(back.tree.notebooks[0].sections.map((s) => s.id)).toEqual(["s1"]);
  });

  it("the store's delete takes a LIST, so it cannot be called with one id by accident", () => {
    expect(src("lib/notesStore.js")).toMatch(/export function deletePages\(pageIds\)/);
  });

  it("model and workspace agree: a notebook delete cascades across ALL its sections", () => {
    const tree = { v: 1, notebooks: [{ id: "nb", title: "N", projectId: null, sections: [
      { id: "s1", title: "A", pages: [{ id: "p1", title: "1" }, { id: "p2", title: "2" }] },
      { id: "s2", title: "B", pages: [{ id: "p3", title: "3" }] },
    ] }] };
    expect(deleteNode(tree, "nb").removedPageIds.sort()).toEqual(["p1", "p2", "p3"]);
  });

  it("there is an orphan sweep as a safety net for an interrupted delete", () => {
    expect(src("lib/notesStore.js")).toMatch(/export function sweepOrphans/);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 5b. CLOUD SYNC (B1291) — the properties that cannot be checked by reading the happy path
 *
 * The merge and conflict DECISIONS are proven in test/notesSync.test.js, against the real
 * pure functions. These are the structural guards: that the seam held, that the revision
 * guard is actually on every write, that nothing hard-deletes, and that signing out still
 * costs nothing.
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("cloud sync rides the SAME one seam", () => {
  it("lib/notesCloud.js has exactly ONE importer — the store — so storage still has one door", () => {
    const importers = ALL_NOTES_FILES.filter((f) => /notesCloud\.js/.test(code(f)));
    expect(importers).toEqual(["lib/notesStore.js"]);
  });

  it("…and the store reaches it by a DYNAMIC import, so the network never rides the rail's first paint", () => {
    const store = code("lib/notesStore.js");
    expect(store, "a static import would put Supabase on the Notes route's critical path")
      .not.toMatch(/^import .* from "\.\/notesCloud\.js"/m);
    expect(store).toMatch(/import\("\.\/notesCloud\.js"\)/);
  });

  it("no component talks to Supabase — the workspace imports the store, never a client", () => {
    for (const f of ALL_NOTES_FILES.filter((x) => x !== "lib/notesCloud.js")) {
      expect(code(f), `${f} reaches for Supabase directly, bypassing the storage seam`).not.toMatch(/supabase/i);
    }
  });

  it("THE SERVER OWNS `rev`: no write sends one, and every guarded update carries .eq(\"rev\")", () => {
    const cloud = code("lib/notesCloud.js");
    // A client-chosen rev would be silently discarded by the notes_touch_rev trigger, and the
    // guard would then be the only thing between two devices and a lost note.
    expect(cloud, "a push must not send its own rev").not.toMatch(/\.(update|insert)\(\{[^}]*\brev:/);
    for (const fn of ["pushPage", "pushTree"]) {
      const body = cloud.slice(cloud.indexOf(`function ${fn}`));
      expect(body.slice(0, 900), `${fn} does not guard on the revision it read`).toMatch(/\.eq\("rev", baseRev\)/);
    }
  });

  it("a refused write is a CONFLICT, never a blind retry that clobbers", () => {
    const cloud = code("lib/notesCloud.js");
    expect(cloud).toMatch(/if \(!data \|\| !data\.length\) return \{ ok: false, conflict: true \}/);
    const store = code("lib/notesStore.js");
    expect(store, "the store must surface a refusal rather than pushing again").toMatch(/if \(r\.conflict\)/);
  });

  it("TOMBSTONE-DELETES on the wire: nothing hard-deletes a note row", () => {
    const cloud = code("lib/notesCloud.js");
    expect(cloud, "a vanished row reads as 'not uploaded yet' and gets resurrected")
      .not.toMatch(/from\((?:PAGE_TABLE|TREE_TABLE|IMAGE_TABLE)\)\s*\.delete\(/);
    expect(cloud).toMatch(/purged_at: stamp/);
    expect(cloud).toMatch(/export async function purgePagesCloud/);
    // Binning keeps the body — that is what a restore on the other device needs to find.
    expect(cloud).toMatch(/export async function binPages/);
  });

  it("ADOPTION IS ALSO A DELETE PATH — an adopted-once notebook is recorded, so a delete sticks", () => {
    const store = code("lib/notesStore.js");
    expect(store, "the plan must be told what this device already adopted").toMatch(/planAdoption\(localTree, accountTree, \{ already: sync\.adopted/);
    expect(store, "…and the record must be persisted, or the guard resets every sign-in").toMatch(/sync\.adopted = \[\.\.\.new Set\(/);
    expect(store).toMatch(/out\.adopted = \(Array\.isArray\(raw\.adopted\)/);
  });

  it("the purge cascade reaches the cloud, for bodies AND pictures", () => {
    const store = code("lib/notesStore.js");
    expect(store).toMatch(/purgePagesCloud\(client\(\), ids\)/);
    expect(store).toMatch(/purgeImagesCloud\(client\(\), scope, imageIds\)/);
  });

  it("PICTURES SYNC — bytes go up, and a device that has never seen one fetches it", () => {
    const store = code("lib/notesStore.js");
    expect(store, "readNoteImage must fall through to the cloud on a cache miss").toMatch(/fetchImage\(client\(\), scope, imageId\)/);
    expect(store, "and cache what it fetched, so the second open is instant").toMatch(/idbPutImage\(\{[\s\S]{0,200}dataUrl: r\.dataUrl/);
    expect(store, "a pasted picture is uploaded, not left on one machine").toMatch(/uploadImage\(\{ id, pageId, dataUrl/);
  });

  it("SIGNING OUT COSTS NOTHING: every cloud path is behind an explicit gate", () => {
    const store = code("lib/notesStore.js");
    expect(store).toMatch(/const scoped = \(\) => scope !== LOCAL_SCOPE/);
    expect(store).toMatch(/const syncOn = \(\) => scoped\(\) && !!cloudClient/);
    expect(store, "starting sync signed out must be a no-op").toMatch(/if \(scope === LOCAL_SCOPE\) \{ setSyncState\(\{ mode: "local" \}\)/);
  });

  it("NEVER A LOST EDIT: choosing the other device's copy parks this one first", () => {
    const root = code("Notes.jsx");
    expect(root).toMatch(/if \(choice === "theirs"\)/);
    expect(root, "the local body must be written to a NEW page before the conflict resolves")
      .toMatch(/addPage\(base, hit\.section\.id[\s\S]{0,160}writePage\(r\.pageId, localDoc\)/);
    expect(root, "and the resolution happens after that").toMatch(/resolveNotesConflict\(pageId, choice\)/);
    expect(root).toContain("ConflictBar");
  });

  it("the applied schema is committed as a record, naming the migration and the date", () => {
    const sql = read(NOTES, "db", "notes_cloud_sync.sql");
    const ddl = sql.replace(/^\s*--.*$/gm, "");   // statements, not the prose around them
    expect(sql).toContain("notes_cloud_sync_b1291");
    expect(sql).toMatch(/2026-07-31/);
    for (const t of ["public.notes_trees", "public.notes_pages", "public.notes_images"]) {
      expect(sql, `${t} is missing from the record`).toContain(t);
    }
    expect(sql, "RLS must be on for every table").toMatch(/notes_trees enable row level security/);
    expect(sql).toMatch(/notes_pages enable row level security/);
    expect(sql).toMatch(/notes_images enable row level security/);
    // Own-row only, private by default — no team columns, no cross-user path (KEY DECISIONS).
    expect(ddl, "a team predicate would be a sharing decision nobody made").not.toMatch(/is_team_member\s*\(/);
    expect((ddl.match(/user_id = \(select auth\.uid\(\)\)/g) || []).length).toBeGreaterThanOrEqual(12);
    // The bucket is PRIVATE and keyed on the owner's own folder.
    expect(ddl).toMatch(/'notes-images',\s*\n?\s*false/);
    expect(ddl).toMatch(/\(storage\.foldername\(name\)\)\[1\]/);
  });

  it("and the client codes against THAT schema — the table and bucket names match the record", () => {
    const sql = read(NOTES, "db", "notes_cloud_sync.sql");
    const cloud = src("lib/notesCloud.js");
    for (const [constant, name] of [["TREE_TABLE", "notes_trees"], ["PAGE_TABLE", "notes_pages"], ["IMAGE_TABLE", "notes_images"], ["IMAGE_BUCKET", "notes-images"]]) {
      expect(cloud, `${constant} does not name the applied table`).toContain(`export const ${constant} = "${name}"`);
      expect(sql).toContain(name);
    }
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 6. THE FOLDER POINTER
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("the folder pointer", () => {
  it("exists", () => {
    expect(existsSync(join(NOTES, "CLAUDE.md"))).toBe(true);
  });

  it("names every file in the module, and every file it names exists", () => {
    const pointer = src("CLAUDE.md");
    for (const f of ALL_NOTES_FILES) {
      const base = f.split("/").pop();
      expect(pointer, `the pointer does not mention ${base}`).toContain(base);
    }
    for (const m of pointer.matchAll(/`(?:components\/|lib\/)?(\w+\.(?:jsx|js))`/g)) {
      const named = m[1];
      const found = ALL_NOTES_FILES.some((f) => f.endsWith(named));
      expect(found, `the pointer names ${named}, which does not exist`).toBe(true);
    }
  });

  it("records the decision the module is built on, so the next session does not re-litigate it", () => {
    const pointer = src("CLAUDE.md");
    expect(pointer).toMatch(/document model/i);
    expect(pointer).toMatch(/ProseMirror JSON/);
    expect(pointer).toMatch(/never Markdown/i);
  });
});
