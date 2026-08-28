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
import { MODULE_TAB_LABEL } from "../src/shared/ui/moduleTabLabel.js";
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
const JSX_SURFACES = [
  "Notes.jsx", "components/NotesTree.jsx", "components/NoteEditor.jsx",
  // NEW-1…NEW-6 chrome. Added to the SURFACE list, not just the file list, so the
  // theme-token and module-scope guards cover them like every other visible surface.
  "components/NoteSlashMenu.jsx", "components/NoteOutline.jsx", "components/NoteHistory.jsx",
  "components/QuickOpen.jsx",
];
const ALL_NOTES_FILES = [
  "Notes.jsx", "components/NotesTree.jsx", "components/NoteEditor.jsx", "components/NoteToolbar.jsx",
  "components/NoteSlashMenu.jsx", "components/NoteOutline.jsx", "components/NoteHistory.jsx", "components/QuickOpen.jsx",
  "components/IntegrityBanner.jsx",
  "lib/notesModel.js", "lib/notesStore.js", "lib/notesCloud.js", "lib/notesMarkdown.js", "lib/notesExtensions.js",
  "lib/notesTime.js", "lib/notesPrint.js", "lib/notesImageDb.js", "lib/notesImageIntake.js",
  "lib/notesImageNode.js", "lib/notesSearchHighlight.js", "lib/notesDocHtml.js", "lib/notesTabKey.js",
  "lib/notesSketchModel.js", "lib/notesSketchRender.js", "lib/notesSketchNode.js", "lib/notesSketchEditor.js",
  "lib/notesPastePlain.js", "lib/notesBlockKeys.js",
  "lib/notesSlashMenu.js", "lib/notesQuickOpen.js", "lib/notesVersions.js", "lib/notesTasks.js",
  "lib/notesOutline.js", "lib/notesFileMeta.js", "lib/notesAttachNode.js", "lib/notesCalloutNode.js",
  "lib/notesToggleNode.js",
  // NEW-1/NEW-4 — a copy never changes project, and the machine that notices when one did.
  "lib/notesDuplicates.js", "lib/notesScan.js",
  "lib/notesKeys.js", "lib/notesProjectFiling.js", "lib/notesProjectLink.js",
  // NEW-2/NEW-3 — a block that stays where you put it, and how big the writing is.
  "lib/notesAnchorNode.js", "lib/notesZoom.js",
  // An abandoned press leaves nothing behind: the ONE definition of an empty block.
  "lib/notesAnchorPrune.js",
  // How far apart the lines are — a BLOCK property, never a text style.
  "lib/notesSpacing.js",
  // B421494 — select several boxes and move them together; the place/select boundary lives here.
  "lib/notesMarquee.js",
  // NEW-TAB — Tab changes the LEVEL of the current item and never creates a node the user did
  // not type. The pure reader is split out because the Markdown exporter is on the static path.
  "lib/notesListIndent.js", "lib/notesIndentLevel.js",
  // NEW-ARROWS — while there is a caret in editable text, every global binding here is inert.
  "lib/notesKeyScope.js",
  // NEW-SAVE-BADGE — Notes joins the one app-wide save indicator.
  "lib/notesSaveState.js",
  // NEW-PICTURE-CANVAS — the placed box holds CONTENT, not only text, so it needed a geometry
  // rule: the floors, the edge pad, and resizing from any of eight handles.
  "lib/notesBoxResize.js",
  // NEW-ENTER-INHERIT — a new line continues the one above it.
  "lib/notesEnterInherit.js",
  // NEW-MINI-TOOLBAR — the content palettes, shared by the toolbar and the right-click strip.
  "lib/notesFormatPalette.js",
];
const SKETCH_FILES = ALL_NOTES_FILES.filter((f) => f.includes("Sketch"));

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
    // The label itself lives in MODULE_TAB_LABEL (shared with the browser tab title —
    // NEW-1/B821280), not inline in AppHeader's icon list — see moduleTabLabel.js.
    expect(MODULE_TAB_LABEL.notes).toBe("Notes");
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
    // The key LEADS with the page id (the original fix: switching pages must unmount the
    // outgoing editor so its autosave can flush) and now also carries the BODY EPOCH, which
    // remounts when the body changed underneath it — a second window, or a cloud adopt
    // (B1391). Both halves are a remount; neither may become a "sync content" effect.
    expect(root, "without the page id in the key the outgoing page's autosave cannot flush on unmount")
      .toMatch(/key=\{`\$\{activePage\.id\}/);
    expect(root, "the editor must also remount when the body changed underneath it").toMatch(/bodyEpoch/);
  });

  it("⛔ the self-audit hook is GATED, read/seed-only, and cannot reach a shipped session (B291537)", () => {
    const editor = code("components/NoteEditor.jsx");
    /* `window.__noteEditor` is how ui-audit/verify-notes-backspace.mjs states the case it is
     * testing — an exact document tree and an exact caret position. It is kept rather than
     * torn out after the run, and these are the three properties that make that safe. */
    expect(editor, "the hook must be installed behind the same gate every self-audit hook here uses")
      .toMatch(/window\.__PLANYR_E2E/);
    const install = editor.slice(editor.indexOf("window.__PLANYR_E2E"), editor.indexOf("window.__noteEditor = hook"));
    expect(install, "the gate must be an early return, not a branch around part of it").toMatch(/return undefined;/);
    expect(editor, "and it must be removed on unmount so a page switch cannot leave a stale editor reachable")
      .toMatch(/window\.__noteEditor === hook/);
    // Nothing in the app may READ it — a hook the product depends on is not a hook.
    for (const f of ALL_NOTES_FILES) {
      const body = code(f).replace(/window\.__noteEditor = hook|window\.__noteEditor === hook|window\.__noteEditor = null/g, "");
      expect(body, `${f} must not depend on the self-audit hook`).not.toMatch(/__noteEditor/);
    }
  });

  it("there is NO 'sync content on pageId change' effect — that is the crash this shape removed", () => {
    const editor = code("components/NoteEditor.jsx");
    expect(editor, "setContent against a torn-down instance is the null-commands crash").not.toMatch(/\.commands\.setContent/);
    expect(editor).not.toMatch(/setContent\(/);
  });

  it("the pending snapshot is plain JSON captured at edit time, not queried at flush time", () => {
    const editor = src("components/NoteEditor.jsx");
    expect(editor, "onUpdate must read getJSON() at EDIT time").toMatch(/onUpdate: \(\{ editor: ed \}\) => \{\s*\n\s*const doc = ed\.getJSON\(\);/);
    expect(editor, "…and put that plain object in pendingRef").toMatch(/pendingRef\.current = \{ id: pageId, doc \}/);
    expect(editor, "the flush writes the captured object").toMatch(/writePage\(pending\.id, pending\.doc\)/);
    /* NEW-3 added a SECOND ref holding the same document for the version snapshot, and the
     * separation is load-bearing: `pendingRef` is emptied by the flush, whose cleanup runs
     * BEFORE the snapshot's on unmount, so a snapshot reading it found null every time. */
    expect(editor, "the version snapshot keeps its own copy, which the flush never clears").toMatch(/lastDocRef\.current = \{ id: pageId, doc \}/);
    expect(editor, "…and the unmount snapshot reads THAT ref").toMatch(/const last = lastDocRef\.current;/);
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

  /* ⛔ AMENDED (NEW-MINI-TOOLBAR): the content palettes MOVED OUT of the toolbar into
   * `lib/notesFormatPalette.js`, because the right-click mini-toolbar offers the same choices and
   * two copies of a palette is how the bar and the menu come to disagree about what "Teal" is.
   * That makes this guard STRONGER rather than weaker: the toolbar is now pure chrome and may
   * carry no literal colour at all, and there is exactly ONE file in the module that may. */
  it("⛔ the content palettes live in ONE file, and it is not a component", () => {
    const palette = code("lib/notesFormatPalette.js");
    const hexes = [...palette.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
    expect(hexes.length, "the palette file must actually hold the colours").toBeGreaterThan(8);
    expect(palette).toMatch(/export const TEXT_COLORS/);
    expect(palette).toMatch(/export const HIGHLIGHT_COLORS/);
  });

  it("⛔ the toolbar is now pure chrome — no literal colour survives in it", () => {
    const hits = [...code("components/NoteToolbar.jsx").matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
    expect(hits, `NoteToolbar hardcodes ${hits.join(", ")}; content colours belong in lib/notesFormatPalette.js`).toEqual([]);
  });

  it("…and both consumers read that one list rather than keeping a copy", () => {
    for (const f of ["components/NoteToolbar.jsx", "components/NoteEditor.jsx"]) {
      expect(code(f), `${f} must import the shared palette`).toMatch(/from "\.\.\/lib\/notesFormatPalette\.js"/);
      expect(code(f), `${f} must not redeclare it`).not.toMatch(/const TEXT_COLORS\s*=/);
    }
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
     * open flag, the table grid picker's open + hovered size + grown grid (B1372), and the
     * callout tone picker's open flag (NEW-7) — every one of them a transient control-chrome
     * flag, none of them a formatting state. The callout control reads its CURRENT TONE from
     * `editor.getAttributes("noteCallout")` on every render, which is the sharper assertion
     * above and the reason raising this blunt cap by one is not a weakening. */
    const states = [...bar.matchAll(/useState\(/g)].length;
    expect(states, "a mirrored active-state copy drifts the moment the caret moves").toBeLessThanOrEqual(8);
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
  /* ⛔ THE SEAM HAS EXACTLY ONE EXEMPTION, AND IT IS WRITTEN DOWN WITH ITS REASON (NEW-3).
   *
   * `lib/notesProjectLink.js` answers "what is this project holding?" for the SHARED HEADER
   * BREADCRUMB — chrome on every route, very often nowhere near a mounted Notes module. It
   * cannot go through `notesStore.js` for two independent reasons, both measured:
   *   • the store points at whichever scope the workspace last set, so asking it while Notes
   *     has never been opened answers with the SIGNED-OUT tree for a signed-in user — a
   *     confident wrong number in a delete confirmation, the worst place for one;
   *   • routing that route's dynamic import through the store pulled the whole storage tier
   *     into a shared chunk and cost the Notes route 12 KB.
   * The exemption is kept narrow by the second check below rather than by good intentions. */
  const SEAM_EXEMPT = new Set(["lib/notesProjectLink.js"]);

  it("every read and write goes through lib/notesStore.js, so cloud sync is a change THERE and nowhere else", () => {
    for (const f of ALL_NOTES_FILES.filter((x) => x !== "lib/notesStore.js" && !SEAM_EXEMPT.has(x))) {
      expect(code(f), `${f} touches localStorage directly, bypassing the storage seam`).not.toMatch(/localStorage/);
    }
  });

  it("⛔ THE ONE SEAM EXEMPTION STAYS NARROW — the tree and the ledger, never a body, never a picture", () => {
    const link = code("lib/notesProjectLink.js");
    expect(link, "it may read the TREE key").toContain("TREE_KEY_BASE");
    expect(link, "…and stamp the sync LEDGER, or a seed would undo the move").toContain("SYNC_KEY_BASE");
    expect(link, "⛔ but never a page BODY — bodies belong to the store").not.toMatch(/PAGE_KEY_BASE|notes:page:/);
    expect(link, "⛔ and never the picture tier").not.toMatch(/indexedDB|notesImageDb/);
    expect(link, "⛔ and never the network").not.toMatch(/supabase|notesCloud/i);
    expect(link, "it takes the account EXPLICITLY rather than reading the module's scope").toMatch(/export function projectNotes\(userId,/);
    expect(link, "…and never re-points the store's own scope").not.toMatch(/setNotesScope/);
    // The key strings themselves are never restated here — they come from the one leaf that
    // holds them, so this file cannot drift from the store's idea of where a tree lives.
    expect(link, "no hardcoded key string").not.toMatch(/"planyr:notes:/);
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
      /* ⛔ A CATCH IS BENIGN ONLY WHEN IT SAYS WHY, IN THE CATCH. The list is deliberately a
         list of NAMED REASONS rather than a shape: "it returns a falsy value" would wave
         through the next real swallowed failure that happens to return null. "A preference is
         not data" covers the zoom level (NEW-3) — a refused read means 100%, which is a
         correct answer, not a hidden one. */
      const benign = /a bad listener must not mute the rest|Safari private mode|a preference is not data/.test(m[0])
        || /return\s+(null|\[\]|false|0)/.test(body);
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
    /* ⛔ AMENDED (B539649). This used to assert that Notes' own FOOTER rendered the line. The
     * footer is gone — it was the second of two save indicators, and no other module has one.
     * The line itself is unchanged and still the single source of the wording; what changed is
     * that it is READ into the shared badge's detail rather than painted in a bar of its own.
     * So the store half below is asserted exactly as before, and the surface half now checks the
     * badge is being fed instead. */
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
    expect(root, "the storage line must still reach a surface — now the shared badge's detail")
      .toMatch(/saveDetail=\{storageLine\./);
    /* ⛔ AMENDED (B539649): there is no longer a storage-line SURFACE in Notes at all — it was
     * the second of two save indicators. The line still exists and is still the single source of
     * the wording; "exactly one" is now asserted of where it GOES, which is the shared badge. */
    expect(root.match(/data-testid="notes-scope-label"/g), "the footer bar must stay gone").toBe(null);
    expect(root.match(/saveDetail=\{storageLine\./g), "the line reaches exactly one surface").toHaveLength(1);
  });

  it("the storage keys are scoped and versioned, so two accounts never read each other's notes", () => {
    // The strings live in `notesKeys.js` — a dependency-free leaf — so the ONE other module
    // allowed to touch them (`notesProjectLink.js`, which answers "what is this project
    // holding?" from a route where Notes is not mounted) cannot drift from the store's idea
    // of where a tree lives. `notesStore.js` re-exports them, so it is still the seam.
    const keys = src("lib/notesKeys.js");
    expect(keys).toMatch(/planyr:notes:tree:v1/);
    expect(keys).toMatch(/planyr:notes:page:v1/);
    expect(keys).toMatch(/planyr:notes:sync:v1/);
    expect(keys).toMatch(/LOCAL_SCOPE = "local"/);
    const store = src("lib/notesStore.js");
    expect(store, "the store re-exports them, so no importer learned they moved")
      .toMatch(/export \{[^}]*TREE_KEY_BASE[^}]*\} from "\.\/notesKeys\.js"/);
    const link = src("lib/notesProjectLink.js");
    expect(link, "and the one outside reader imports them rather than restating them")
      .toMatch(/from "\.\/notesKeys\.js"/);
    expect(link, "…and never hardcodes a key of its own").not.toMatch(/"planyr:notes:/);
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
    const t = { v: 3, trash: [], pages: [{ id: "s1", title: "A", projectId: null, pages: [
      { id: "p1", title: "1", pages: [] }, { id: "p2", title: "2", pages: [] },
    ] }] };
    const del = deleteNode(t, "s1");
    expect(del.entry.pageIds.slice().sort()).toEqual(["p1", "p2", "s1"]);
    expect(del.tree.trash).toHaveLength(1);
    // Restoring gives back exactly what went in, at the index it came from.
    const back = restoreNode(del.tree, del.entry.id);
    expect(back.tree.trash).toHaveLength(0);
    expect(back.tree.pages.map((p) => p.id)).toEqual(["s1"]);
  });

  it("the store's delete takes a LIST, so it cannot be called with one id by accident", () => {
    expect(src("lib/notesStore.js")).toMatch(/export function deletePages\(pageIds\)/);
  });

  it("model and workspace agree: deleting a branch cascades across its WHOLE subtree, at every depth", () => {
    const tree = { v: 3, trash: [], pages: [{ id: "top", title: "N", projectId: null, pages: [
      { id: "s1", title: "A", pages: [{ id: "p1", title: "1", pages: [{ id: "deep", title: "D", pages: [] }] }] },
      { id: "s2", title: "B", pages: [{ id: "p3", title: "3", pages: [] }] },
    ] }] };
    expect(deleteNode(tree, "top").removedPageIds.slice().sort()).toEqual(["deep", "p1", "p3", "s1", "s2", "top"]);
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
      .toMatch(/copyPageWithin\(base, pageId[\s\S]{0,600}writePage\(r\.pageId, localDoc\)/);
    expect(root, "and the resolution happens after that").toMatch(/resolveNotesConflict\(pageId, choice\)/);
    expect(root).toContain("ConflictBar");
  });

  /* ⛔ AND THE COPY NEVER CHANGES PROJECT (NEW-1). A note was copied into an unrelated
   * pursuit and nobody was told; it was found by hand a week later under a "from a project
   * you deleted" heading. The behaviour is proven in test/notesProjectIntegrity.test.js and
   * test/notesTwoClientConflict.test.js — this guards the SHAPE that makes it unprovable to
   * get wrong: the park may not reach for `projectId` at all, because `copyPageWithin` reads
   * it off the source record and has no argument for one. */
  it("⛔ THE PARK CANNOT BE HANDED A PROJECT — the fix is the missing argument", () => {
    const root = code("Notes.jsx");
    const park = root.slice(root.indexOf('if (choice === "theirs")'));
    const call = park.slice(0, park.indexOf("resolveNotesConflict"));
    expect(call, "the park must go through copyPageWithin, the one copy op").toContain("copyPageWithin(base, pageId");
    expect(call, "and must not file the copy by a project id of its own").not.toMatch(/projectId:/);
    expect(call, "an unknown source is REFUSED, never filed somewhere plausible").toMatch(/r\.refused/);
    expect(call, "and the copy is named out loud when it is made").toMatch(/setExportNote\(/);

    const model = code("lib/notesModel.js");
    const fn = model.slice(model.indexOf("export function copyPageWithin"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body, "the source root's project is the only project it may use")
      .toContain("const projectId = hit.root.projectId ?? null;");
    expect(body.match(/^export function copyPageWithin\([^)]*\)/m)[0], "no projectId parameter may exist")
      .not.toMatch(/projectId/);
  });

  /* ⛔ SUPERSEDED, AND THE REVERSAL IS THE POINT (NEW-4). This used to pin the opposite
   * property — "THE DETECTOR SEARCHES THE BIN" — because both copies of the original incident
   * were binned by the time anyone looked. That is right for a FORENSIC pass and wrong for a
   * BANNER: what it put on his screen was one copy in the bin and one in a project deleted a
   * week earlier, with nothing to act on and Dismiss the only exit. A bar that cannot be
   * satisfied teaches you to dismiss the one that will one day be real. */
  it("THE BANNER'S SCAN ONLY LOOKS WHERE SOMETHING CAN BE DONE — not the bin, not dead projects", () => {
    const scan = code("lib/notesScan.js");
    const fn = scan.slice(scan.indexOf("export function scanNoteDuplicates"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body, "the bin is not walked at all").not.toMatch(/trashEntries\(tree\)/);
    expect(body, "and a copy in a project that no longer exists is filtered out")
      .toMatch(/known\.has\(r\.projectId\)/);
    expect(body, "…while a page in NO project is never filtered — nowhere is a real place")
      .toMatch(/r\.projectId == null \|\|/);
    expect(body, "and a finding he has settled with 'keep both' stays settled").toMatch(/duplicateKey\(g\)/);

    /* ⛔ AND AN UNKNOWN PROJECT LIST NEVER READS AS "they are all dead". An empty READY list
     * and a FAILED lookup are opposite facts, and letting the second wear the first's clothes
     * would silently suppress a real finding. */
    expect(code("Notes.jsx")).toMatch(/liveProjectIds: projectList\.state === "ready" \? projects\.map\(\(p\) => p\.id\) : null/);
    // …and it is reached LAZILY, like the cloud tier: nothing on the rail's first paint
    // needs it, and this route's byte budget is what the lazy boundary exists to protect.
    expect(code("Notes.jsx")).toMatch(/await import\("\.\/lib\/notesScan\.js"\)/);
  });

  it("THE ORPHAN SWEEP WILL NOT DESTROY A BODY THAT STILL HAS WORDS IN IT", () => {
    const store = code("lib/notesStore.js");
    const fn = store.slice(store.indexOf("export function sweepOrphans"));
    expect(fn.slice(0, 600)).toMatch(/hasWords\(readPage\(id\)\)/);
    expect(code("lib/notesScan.js"), "and what it refused is surfaced, not silently kept forever")
      .toContain("export function unreachableNotes");
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
/* ════════════════════════════════════════════════════════════════════════════════════════
 * THE CARRY-FORWARD — a fresh session must be able to start cheap
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("⛔ docs/NOTES-CARRY-FORWARD.md is wired so a fresh session reads it WITHOUT being told", () => {
  /* ⛔ WHY THIS IS A TEST AND NOT A CONVENTION. The project rule is one task per session, then
   * archive. It was ignored for a week because everything a fresh session needed lived only in one
   * long-running session's memory — so continuing always looked cheaper than starting, until that
   * session was re-reading ~500k tokens of history on every dispatch. The write-up existed; it was
   * filed somewhere a Claude Code session does not read, which is the same mistake wearing a
   * different hat. These assertions are the wiring, so it cannot quietly come loose again. */
  const CARRY = join(process.cwd(), "docs/NOTES-CARRY-FORWARD.md");
  const carry = () => readFileSync(CARRY, "utf8");

  it("the file exists and carries its substance", () => {
    const t = carry();
    expect(t.length, "a stub is worse than nothing — it reads as covered").toBeGreaterThan(3000);
    for (const must of [
      "Instrument traps",            // the four false findings, plus the ones found since
      "MUD 377",                     // the fixture that finds real bugs
      "planyr:notes:tree:v1",        // the storage keys
      "live_but_purged",             // the standing health check
      "recurring bug families",      // what to suspect first
      "new session",                 // the standing instruction it exists to make cheap
    ]) {
      expect(t, `the carry-forward has lost its "${must}" section`).toContain(must);
    }
  });

  /* ⛔ THE WIRING. A carry-forward nobody reads is the failure this replaces, so BOTH doors are
   * pinned: the always-loaded root file, and the pointer that auto-loads inside the module. */
  it("⛔ the always-loaded CLAUDE.md points at it", () => {
    expect(readFileSync(join(process.cwd(), "CLAUDE.md"), "utf8"))
      .toMatch(/docs\/NOTES-CARRY-FORWARD\.md/);
  });

  it("⛔ …and so does the module's own pointer", () => {
    expect(read(NOTES, "CLAUDE.md")).toMatch(/docs\/NOTES-CARRY-FORWARD\.md/);
  });

  /* ⛔ AND IT MAY NOT ROT INTO NAMING THINGS THAT NO LONGER EXIST — the same rule the per-folder
   * pointers already live under. A document that confidently names a deleted harness sends the
   * next session looking for it, which is worse than saying nothing. */
  it("⛔ every repo path it names still exists", () => {
    const named = [...carry().matchAll(/`((?:src|ui-audit|test|docs)\/[A-Za-z0-9_\-./]+\.(?:m?js|jsx|md))`/g)]
      .map((m) => m[1]);
    expect(named.length, "it should be naming real files").toBeGreaterThan(3);
    const missing = named.filter((f) => !existsSync(join(process.cwd(), f)));
    expect(missing, `the carry-forward names files that do not exist: ${missing.join(", ")}`).toEqual([]);
  });

  /* ⛔ AND IT MAY NOT CONTRADICT A MEASURED FACT IN THE ROOT RULES. The version this file was
   * written from claimed "keyboard events do not register at all in this app" — measurably wrong
   * (a synthetic event with `bubbles: true`, or dispatched on `window`, works fine; see
   * SYNTHETIC-KEYS-DONT-EDIT). A false fact inside an always-read document is exactly the failure
   * mode the document exists to prevent, so the corrected mechanism is pinned here. */
  it("⛔ its synthetic-key guidance matches what the repo actually MEASURED", () => {
    const t = carry();
    expect(t, "it must name the real mechanism, not an absolute that is false").toContain("bubbles: false");
    expect(t).toMatch(/SYNTHETIC-KEYS-DONT-EDIT/);
    /* ⛔ THE PHRASE IS ALLOWED ONLY AS A QUOTED CORRECTION, never as an assertion. The document
     * deliberately QUOTES the wrong claim in order to correct it — that is how a reader learns the
     * difference — so a blunt "must not appear" ban would forbid the fix along with the fault.
     * What must hold is that every occurrence sits AFTER the correction marker. */
    const wrong = [...t.matchAll(/do not register at all/gi)].map((m) => m.index);
    const marker = t.indexOf("CORRECTED HERE");
    expect(marker, "the correction block itself has gone").toBeGreaterThan(-1);
    for (const at of wrong) {
      expect(at, "the overstated claim has come back as an assertion").toBeGreaterThan(marker);
    }
  });
});

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

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 6b. THE PROJECT A NOTE BELONGS TO — loaded, named, and never guessed at (B482 ×2, B1343 ×2,
 *     NEW-1).
 *
 * Three defects, one screen. The rail showed "OTHER PROJECT" on every notebook while the
 * header said "Select a project", on an account whose notebooks were all bound correctly.
 * Each guard below fails if its fix is reverted — the live behaviour is driven in
 * ui-audit/verify-notes.mjs §24, and these are the structural facts a browser check cannot
 * see (which call exists, in which file).
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("the project a notebook belongs to", () => {
  it("⛔ the SHELL binds the account to the project store — not the lazily-mounted Site Planner (B482 ×2)", () => {
    /* This is the whole bug. `setActiveUser` is what points the shared project store at the
     * signed-in user's own cache; while it was called only from SitePlannerApp, any boot that
     * did not visit the Site Planner (which "open where I left off" makes routine) left the
     * store bound to nobody and every project read returned stale logged-out data. */
    const shell = stripComments(read(REPO, "src", "app", "Shell.jsx"));
    expect(shell, "Shell.jsx must import setActiveUser").toMatch(/setActiveUser/);
    const auth = shell.slice(shell.indexOf("onAuthChange("));
    expect(auth.slice(0, 400), "setActiveUser must be called from the shell's auth subscription")
      .toMatch(/setActiveUser\(/);
  });

  it("the warm reports WHY it did nothing, so a failure can't read as 'no projects' (LOUD-FAILURE)", () => {
    const projects = stripComments(read(REPO, "src", "shared", "projects", "projects.js"));
    expect(projects).toMatch(/export async function warmProjects\b/);
    // The four outcomes the old boolean collapsed into one indistinguishable `false`.
    for (const reason of ["signed-out", "already-warm", "pull-failed"]) {
      expect(projects, `warmProjects must name the "${reason}" outcome`).toContain(reason);
    }
    // The old boolean contract still exists for the callers that only wanted "did it change?".
    expect(projects).toMatch(/export async function warmProjectsIfEmpty/);
    // A warm that lands must reach every OTHER reader — a same-tab write fires no storage event.
    expect(projects).toMatch(/export function onProjectsChanged/);
    expect(projects).toMatch(/notifyProjectsChanged\(\)/);
  });

  it("⛔ Notes hands the shared header its project, like every other workspace (B1343 ×2)", () => {
    const notes = code("Notes.jsx");
    expect(notes, "AppHeader must be given currentProject or the crumb forgets the project")
      .toMatch(/currentProject=\{/);
    // …and it is the ROUTE's project, so the crumb can never disagree with the URL.
    expect(notes).toMatch(/projectId \? \{ id: projectId/);
  });

  it("⛔ no caption describes a failed lookup as though it were the user's data (B1419)", () => {
    const rail = code("components/NotesTree.jsx");
    expect(rail, '"Other project" said the same thing whether the project was gone or merely unknown')
      .not.toMatch(/Other project/);
    /* ⛔ AMENDED BY B1420. The per-row badge is GONE — inside a project every row belongs to
     * where you are standing, so there is nothing for a badge to say. The honesty problem
     * moved to the Dashboard's group HEADING, which is the one place a project is named, and
     * an unresolved one is flagged there instead of quietly reading like a name. */
    expect(rail, "a row must not carry a project badge at all now").not.toMatch(/badge=/);
    /* ⛔ AMENDED (B1419 ×2). "Project not loaded" was itself the same quiet lie one layer up:
     * it described an internal loading state, not his data. The three genuinely different
     * situations now get three different sentences, and the middle one — a project that was
     * DELETED — is the one he can act on. */
    expect(rail, '"not loaded" describes our state, not his notes').not.toMatch(/Project not loaded/);
    expect(rail).toContain("From a project you deleted");
    expect(rail).toContain("Project names didn't load");
    expect(rail, "the three cases are told apart by a named function, not inline guesswork").toMatch(/function groupHeading/);
    // …and a real failure is loud, with a way out.
    expect(rail).toMatch(/notes-projects-error/);
    expect(rail).toMatch(/notes-projects-retry/);
  });

  it("⛔ A press in blank space places the caret and does NOTHING ELSE (B1393 ×3)", () => {
    /* ⛔ REWRITTEN TWICE. B1393's guard asserted focus; B1393 ×2's asserted the padding
     * machinery that reached the pressed height. The owner tested that shipped build and
     * rejected it — the centring made the line crawl left as he typed, the alignment was
     * inherited on Enter, and six empty paragraphs were permanent in his document. So these
     * assert what must NOT be there. */
    const ed = code("components/NoteEditor.jsx");
    expect(ed, "Click and Type must not set alignment from where you pressed").not.toMatch(/setTextAlign/);
    expect(ed, "and it must not pad the document to reach the press").not.toMatch(/MAX_CLICK_PARAGRAPHS|paragraphStep|gap \/ step/);
    expect(ed, "the padding's clean-up bookkeeping went with the padding").not.toMatch(/claimRef|dropClaim/);
    /* ⛔ AND THE RULE ITSELF CHANGED AGAIN, on his measurement: *"If I do a single click, it
     * goes still goes all the way to the left."* B1393 ×3's "nearest real text position" is a
     * LONG JUMP on a page that looks empty — the caret flies to the end of a paragraph far
     * above, or to the end of the document. So the nearest position is now CHECKED against the
     * page before it is taken, and a press that is not beside a line places at the press point
     * instead. Two things must therefore be true of this file, and both are properties rather
     * than spellings: */
    expect(ed, "the nearest position is checked, not trusted").toMatch(/pressIsBesideLine\(editor, hit\.pos, e\.clientY\)/);
    expect(ed, "and the tolerance is the LINE'S OWN height, read from the browser")
      .toMatch(/coordsAtPos\(pos\)[\s\S]{0,300}c\.bottom - c\.top/);
    // ⛔ THE END OF THE DOCUMENT IS NEVER WHERE A PRESS GOES ANY MORE — that WAS the fling.
    expect(ed, "no press may send the caret to the end of the document").not.toMatch(/focus\("end"\)/);
    expect(ed, "and the padding paragraph it used to add is gone with it")
      .not.toMatch(/insertContentAt\(doc\.content\.size, \{ type: "paragraph" \}\)/);
    expect(ed, "…along with the bookkeeping that took those paragraphs back").not.toMatch(/matInsertsRef/);
    // ⛔ ONE GESTURE, ONE RULE: there is no separate double-click handler to disagree with it.
    expect(ed, "a double-click must not be a second, different gesture").not.toMatch(/onDoubleClick=/);
    // …and a press ON text is still the browser's business, or word-select dies.
    expect(ed).toMatch(/if \(el\.closest\("\.ProseMirror"\)/);
  });

  /* ⛔ A BACKTICK INSIDE THE CSS TEMPLATE LITERALS ENDS THEM, and it has broken the build three
   * separate times — always in a COMMENT, where it reads as ordinary prose and nothing about it
   * looks like code. The failure is a parse error hundreds of lines away from the cause. */
  it("no backtick inside the editor's or the print sheet's CSS template literal", () => {
    for (const [file, marker] of [["components/NoteEditor.jsx", "const EDITOR_CSS = `"], ["lib/notesPrint.js", "const PRINT_CSS = `"]]) {
      const src = read(NOTES, ...file.split("/"));
      const at = src.indexOf(marker);
      expect(at, `${file} no longer has ${marker}`).toBeGreaterThan(-1);
      const body = src.slice(at + marker.length);
      const end = body.indexOf("\n`;");
      expect(end, `${file}: the CSS literal is unterminated`).toBeGreaterThan(-1);
      expect(body.slice(0, end), `${file}: a backtick inside the CSS ends the literal early`).not.toContain("`");
    }
  });

  it("⛔ A BOX CAN BE DELETED AND RESIZED, and neither control reaches the paper", () => {
    const node = read(NOTES, "lib", "notesAnchorNode.js");
    expect(node, "a delete, as one undoable transaction").toContain("removeNoteAnchor:");
    expect(node, "and a width — height is the words, deliberately").toContain("setNoteAnchorWidth:");
    /* ⛔ AMENDED (B539651, owner instruction 2026-08-14): the visible delete × is GONE. *"the
     * delete option shouldn't just be shown, like, anytime I click on the box… I should only be
     * able to use the keystroke to delete or a right click and then delete option."* The COMMAND
     * is still asserted above — both remaining routes (the key, and the right-click item) run it
     * — but no destructive control sits under the pointer any more, and this guard now says so in
     * the direction that matters: it must not come back. */
    expect(node, "no visible delete × on a box").not.toMatch(/note-anchor-delete/);
    /* ⛔ AMENDED AGAIN (NEW-PICTURE-CANVAS): there are EIGHT handles now, built in a loop, so the
     * test id is composed rather than written out. The east handle deliberately keeps the old
     * class and id — it IS the width handle three existing harnesses were written against, and
     * renaming it would take working guards red for no behavioural reason. */
    expect(node, "the east handle keeps the id the harnesses drive").toMatch(/"note-anchor-size"/);
    expect(node, "and the rest are built from the shared handle list").toMatch(/handlesFor\(/);
    const editor = read(NOTES, "components", "NoteEditor.jsx");
    expect(editor, "delete lives on the right-click menu instead").toMatch(/note-menu-delete-box|onDeleteBox/);
    // ⛔ A press that never moved writes NOTHING — not a transaction, not an undo frame.
    expect(node, "the drag commits only if it moved").toMatch(/if \(!dragged\) return;/);
    /* ⛔ AMENDED (B539652): the resize's no-move branch no longer just RETURNS — it forwards the
     * press to the box and puts the caret in it, because a handle that only exists once the box is
     * selected was swallowing press 2 of the two-stage gesture (CHROME-NEVER-EATS-A-PRESS clause
     * 4). It still writes nothing, which is the property this line was guarding. */
    expect(node, "and so does the resize").toMatch(/if \(!done\.moved\) \{/);
    expect(node, "…and a press that did not drag forwards to the box instead of vanishing")
      .toMatch(/setTextSelection\(pos \+ 1\)/);
    /* ⛔ THE DRAG IS SCROLL-PROOF: it keeps the grab offset and reads the host rect FRESH on
     * every move. The old form measured a delta between two CLIENT coordinates, which mean
     * different things once the scroller moves underneath the gesture. */
    expect(node).toMatch(/grabX: e\.clientX - boxRect\.left/);
    expect(node.slice(node.indexOf('grip.addEventListener("pointermove"'))).toMatch(/host\.getBoundingClientRect\(\);\s+\/\/ read FRESH/);
    const print = read(NOTES, "lib", "notesPrint.js");
    /* ⛔ MATCHED ON THE SHARED HANDLE CLASS (NEW-PICTURE-CANVAS). There are eight resize handles
     * now, and pinning the exact selector LIST would mean this guard has to be edited every time
     * one is added — which is the shape of a guard that gets edited to stay green rather than one
     * that catches anything. `.planyr-anchor-h` is the class they all carry, so a ninth handle is
     * covered by construction and cannot start printing by omission. */
    expect(print, "no chrome on paper").toMatch(/\.note-body \.planyr-anchor-h \{ display: none; \}/);
    expect(print, "…and the grip still does not print either").toMatch(/\.note-body \.planyr-anchor-grip/);
    /* ⛔ AND A PICTURE BOX PRINTS AT THE SIZE IT WAS DRAGGED TO (PDF-PARITY). The height rides the
     * node's own style attribute exactly as the position does, but BOTH DOM shapes have to be
     * named here: the node view builds a figure wrapping the img, while `renderHTML` — which is
     * what this sheet serialises through — emits a bare img with no figure. A rule written against
     * only the screen's shape matches nothing on paper. */
    expect(print, "an image box prints unpadded").toMatch(/data-anchor-kind="image"\]\s*\{ padding: 0/);
    expect(print, "…and the bare serialised img is named, not just the node view's figure")
      .toMatch(/img\.planyr-note-img/);
  });

  /* ════════════════════════════════════════════════════════════════════════════════════════
   * THE CARET IS EXPOSED WHERE IT ACTUALLY IS (NEW-CARET-BOUNDS)
   * ═══════════════════════════════════════════════════════════════════════════════════════ */
  it("⛔ THE WRITING SURFACE IS EXPOSED AS A REAL MULTILINE TEXTBOX, not a generic container", () => {
    /* The owner runs Windows 11's Text cursor indicator and reported its markers landing up and
     * to the LEFT of the box he is typing in. Windows takes that rectangle from the ACCESSIBILITY
     * layer, never from what is painted. Measured from the real tree before the fix:
     *     note-title  →  role=textbox   editable=plaintext   multiline=false   ✅
     *     note-body   →  role=GENERIC   editable=richtext    multiline=—       ⛔
     * A generic node exposes no text pattern to read a caret rectangle out of, so the platform
     * falls back to the bounds of the editable REGION — whose top-left is up and left of any
     * placed box, which is the direction he photographed. */
    const editor = read(NOTES, "components", "NoteEditor.jsx");
    expect(editor, "the body must declare itself a textbox").toMatch(/role:\s*"textbox"/);
    expect(editor, "…and that it is multiline, or its caret rect is one line's geometry")
      .toMatch(/"aria-multiline":\s*"true"/);
    // The keyboard-trap escape (B1392) rides the same accessible name and must not be lost to it.
    expect(editor).toMatch(/aria-label":\s*"Note body\./);
    expect(editor).toMatch(/press Escape then Tab to leave the note/);
  });

  it("⛔ A MOVE DRAG NEVER TOUCHES THE WIDTH (NEW-DRAG-NARROWS)", () => {
    /* *"when I grab this, it's normally wider if I let go, but when I grab it, it shortens up."*
     * The move handler ran `placeAnchor`, whose whole job is to narrow a block to the space
     * available — B539648's right-edge crush surviving in the one path that item did not touch.
     * The guard is on the SHAPE rather than on a number: the move path may not reach the width. */
    const node = read(NOTES, "lib", "notesAnchorNode.js");
    const move = node.slice(node.indexOf('grip.addEventListener("pointermove"'), node.indexOf("const end = (e) =>"));
    expect(move, "the move drag uses the point-only rule").toMatch(/moveAnchorPoint\(/);
    expect(move, "⛔ …and never calls the placement rule, which spends the width").not.toMatch(/placeAnchor\(/);
    expect(move, "⛔ …and never writes a width at all").not.toMatch(/style\.width/);
    const resize = read(NOTES, "lib", "notesBoxResize.js");
    expect(resize, "the move rule has no width arithmetic to re-enable")
      .toMatch(/export function moveAnchorPoint/);
  });

  it("⛔ A NEW LINE CONTINUES THE ONE ABOVE IT (NEW-ENTER-INHERIT)", () => {
    /* *"it doesn't seem like when I start a new line, it carries the formatting."* The owner
     * called the cause and was right about the mechanism: ProseMirror asks `defaultBlockAt` for
     * the new node when the caret is at the END of a block, and a default block has default
     * attributes. Measured before the fix: block fontSize 22 → null, run fontSize 22px → null,
     * marks bold+textStyle → none. */
    const ext = read(NOTES, "lib", "notesExtensions.js");
    expect(ext, "the rule is registered").toMatch(/noteEnterInherit/);
    expect(ext, "…above the list keymap, so it can run the split it displaces").toMatch(/priority:\s*200/);

    /* ⛔ THE TWO WAYS THE HOUSEKEEPING PASS UNDID THE CARRY, both guarded, because the fix was
     * complete and INVISIBLE until these were found: `deriveBlockSizes` ran one transaction
     * later, saw a brand-new EMPTY block, decided its runs disagreed and wrote null over the
     * inherited size — and cleared the stored marks in the same breath. */
    expect(ext, "an empty block keeps the size it was given").toMatch(/if \(node\.content\.size === 0\) return true;/);
    expect(ext, "…and the pass hands the stored marks back").toMatch(/tr\.setStoredMarks\(newState\.storedMarks\)/);
    // A line break is not a run, so a soft break must not make a block disagree with itself.
    expect(ext, "a hardBreak is skipped rather than counted as an unsized run")
      .toMatch(/if \(child\.type\.name === "hardBreak"\) return;/);
  });

  it("⛔ AN ABANDONED PRESS IS PROVISIONAL — enforced at the SEAM, not only in the gesture", () => {
    /* Five double-clicks with nothing typed produced five nodes in his storage, each with
     * x/y/w and no text, all surviving a reload. An empty block draws nothing and still takes
     * the press, so the next attempt at that spot lands in the leftover and appears to do
     * nothing — which is what "it works intermittently" turned out to be. */
    const store = read(NOTES, "lib", "notesStore.js");
    const fn = store.slice(store.indexOf("export function writePage"));
    expect(fn.slice(0, 900), "the save path prunes, so a crash or a closed tab cannot carry one out")
      .toMatch(/pruneEmptyAnchors\(doc\)/);
    expect(store, "and the one-time clean-up for notes already carrying them")
      .toContain("export function sweepEmptyAnchors");
    const ed = code("components/NoteEditor.jsx");
    expect(ed, "the caret leaving takes one away").toMatch(/onSelectionUpdate[\s\S]{0,200}dropEmptyAnchors/);
    expect(ed, "and so does losing focus altogether").toMatch(/onBlur[\s\S]{0,120}dropEmptyAnchors/);
    expect(ed, "and Escape, for the way out that needs no second click").toMatch(/Escape[\s\S]{0,200}dropEmptyAnchors/);
    /* ⛔ AND IT IS VISIBLE WHILE IT EXISTS. An invisible obstacle is the bug; the outline is
     * the fix, and it is driven by the SAME predicate the storage seam uses. */
    expect(ed).toMatch(/planyr-anchor\[data-empty="1"\]/);
    expect(read(NOTES, "lib", "notesAnchorNode.js"), "one definition of empty, not two")
      .toMatch(/anchorIsEmpty\(n\.toJSON\(\)\)/);
  });

  it("⛔ A PURGE IS A TOMBSTONED FACT, so emptying the bin survives a stale window", () => {
    /* Measured with revisions: he emptied the bin (cloud rev 991, one entry), a tab still on
     * rev 966 reloaded, and all 23 entries came back AND were pushed up as rev 992. A union
     * merge cannot represent a deletion, because a deletion is an absence. */
    const model = read(NOTES, "lib", "notesModel.js");
    expect(model).toContain("export function tombstoneIds");
    expect(model).toContain("export function withTombstones");
    const purge = model.slice(model.indexOf("export function purgeTrashEntry"));
    expect(purge.slice(0, 800), "the purge records the entry id AND every page id it named")
      .toMatch(/withTombstones\(next, \[entryId, e\?\.node\?\.id, \.\.\.pageIds\]/);
    const cloud = read(NOTES, "lib", "notesCloud.js");
    /* ⛔ THE SLICE IS THE WHOLE FUNCTION, NOT A CHARACTER COUNT. The fixed windows below had to be
     * widened twice in two days as `mergeTrees` gained the rules that made it correct — and a
     * guard that silently stops reaching its own subject is the rot-green failure this repo names
     * elsewhere. The function ends where the next top-level declaration begins. */
    const mergeStart = cloud.indexOf("export function mergeTrees");
    const nextDecl = cloud.indexOf("\nconst laterOf", mergeStart);
    const merge = cloud.slice(mergeStart, nextDecl > 0 ? nextDecl : undefined);
    expect(merge.length, "the slice must actually cover the whole merge").toBeGreaterThan(4000);
    expect(merge, "rule 0 runs before the union").toMatch(/const tombs = new Set\(\[\.\.\.tombstoneIds\(L\), \.\.\.tombstoneIds\(S\)\]\)/);
    expect(merge, "a tombstoned entry never survives").toMatch(/if \(tombs\.has\(String\(e\.id\)\)\) continue;/);
    expect(merge, "…nor a tombstoned live node").toMatch(/deleted\.has\(pg\.id\) \|\| tombs\.has\(String\(pg\.id\)\)/);
    /* The window is a character count over one function, so it has to grow when that function
     * is documented further — B342996 added rule 3's amendment above this line. Widened rather
     * than narrowed deliberately: a guard that silently stops reaching its own subject is the
     * rot-green failure this repo names elsewhere, so the slice must always cover the whole
     * merge. */
    expect(merge, "and the ledger rides on to the next stale client").toMatch(/tombs: withTombstones/);
  });

  /* ⛔ THE STORED TREE IS NEVER STALER THAN THE SCREEN (B400176).
   *
   * The rail renders from React state; the cloud sync reads `localStorage`. A debounce between
   * them meant that for 400 ms after every edit the two disagreed — and the sync does not just
   * READ the stored copy, it decides from it: `seed()` asks `sync.treeDirty` (only true once
   * `writeTree` has run) to decide whether this device owes anything, concludes it is clean,
   * and adopts the account's tree over the top. His report was a renamed note leaving the
   * sidebar until a reload; the same window loses a brand-new page outright.
   *
   * ⛔ THIS IS A SOURCE GUARD AND IT IS DELIBERATELY NARROW. The behaviour is covered by
   * `test/notesTreeWriteThrough.test.js` (the seam) and `ui-audit/verify-notes-rename-live.mjs`
   * (a real keyboard). What no runtime check can see is the shape coming BACK, because the
   * reintroduced timer would look correct in every test that waits a moment before reading —
   * which is nearly all of them. So the shape is what is pinned.
   *
   * The cost of the write-through is measured, not assumed: `ui-audit/measure-tree-write.mjs`. */
  it("⛔ THE TREE IS WRITTEN THROUGH, AND EVERY MUTATOR READS THE LIVE TREE (B400176)", () => {
    const workspace = read(NOTES, "Notes.jsx");

    // `persistTree` writes on the spot — no timer stands between the edit and the disk.
    const persist = workspace.slice(workspace.indexOf("const persistTree = useCallback"));
    const body = persist.slice(0, persist.indexOf("}, ["));
    expect(body, "persistTree writes the tree immediately").toMatch(/if \(!writeTree\(next\)\) setStatus\("error"\)/);
    expect(body, "no timer may sit between an edit and the stored copy the sync reads")
      .not.toMatch(/setTimeout|setInterval|requestIdleCallback|queueMicrotask/);
    expect(workspace, "the debounce constant is gone, not merely unused").not.toMatch(/TREE_SAVE_MS/);

    /* ⛔ AND THE SECOND HALF, which is the same defect one layer up: a callback that closes over
     * the render's `tree` writes an older tree back over a newer one. Two mutators already read
     * the ref and the rest did not — exactly the sort of split that survives review — so every
     * one of them goes through `treeNow()` now. */
    expect(workspace, "the live-tree accessor exists").toMatch(/const treeNow = useCallback\(\(\) => treeRef\.current \|\| emptyTree\(\), \[\]\)/);
    const MUTATORS = [
      "addPage(", "renameNode(", "setPageProject(", "deleteNode(",
      "restoreNode(", "purgeTrashEntry(", "movePage(", "commitTitle(", "touchPage(",
    ];
    for (const fn of MUTATORS) {
      const calls = workspace.split(fn).slice(1).map((s) => s.slice(0, 40));
      expect(calls.length, `${fn} is still called from the workspace`).toBeGreaterThan(0);
      for (const args of calls) {
        expect(args, `${fn} must read the LIVE tree, never a render's copy`).not.toMatch(/^\s*tree\s*[,)]/);
        expect(args, `${fn} must not read treeRef around a stale fallback`).not.toMatch(/treeRef\.current \|\| tree/);
      }
    }
  });

  it("⛔ TAB HAS A DEFINED ANSWER IN EVERY CONTEXT, and none of them destroys content (B1392 ×2)", () => {
    const tab = code("lib/notesTabKey.js");
    /* The destructive one: with a picture or a sketch SELECTED, `insertContent` replaced it.
     * And the guard must be an `instanceof` — a `constructor.name` test is correct in dev and
     * MEANINGLESS in the shipped bundle, because the minifier renames the class. */
    expect(tab, "a node selection must be detected by instanceof, never by class name")
      .toMatch(/selection instanceof NodeSelection/);
    expect(tab).not.toMatch(/constructor\.name/);
    expect(tab, "the last cell of a table grows the table instead of taking a tab character")
      .toMatch(/addRowAfter\(\)/);
    // The escape hatch is not optional and must survive every rewrite.
    expect(tab).toMatch(/Escape: \(\) => \{ this\.storage\.released = true/);
    // The two surfaces that are NOT the document, each with its own defined answer.
    expect(code("components/NoteEditor.jsx"), "Tab out of the page title goes into the body")
      .toMatch(/e\.key !== "Tab" \|\| e\.shiftKey[\s\S]{0,200}focus\("start"\)/);
    expect(code("lib/notesSketchEditor.js"), "Tab has a defined meaning in a sketch box's fields")
      .toMatch(/if \(e\.key === "Tab"\)/);
  });

  it("⛔ PASTE: three modes, the default untouched, and sanitisation in ALL of them (B36051)", () => {
    const paste = code("lib/notesPastePlain.js");
    // The default paste is watched, never intercepted — except the one list-nesting case.
    expect(paste, "the ordinary paste must fall through to the default").toMatch(/return false;/);
    expect(paste).toMatch(/export const PASTE_MODES = \["source", "merge", "text"\]/);
    // Merge keeps MEANING and drops APPEARANCE — the distinction is data, not a comment.
    expect(paste).toMatch(/export const STYLE_MARKS = \["textStyle", "highlight"\]/);
    for (const meaning of ["bold", "italic", "underline", "link"]) {
      expect(paste, `${meaning} is meaning, not appearance — it must NOT be stripped by merge`)
        .not.toMatch(new RegExp(`STYLE_MARKS[\\s\\S]{0,80}"${meaning}"`));
    }
    // Structural sanitisation runs on the ORDINARY paste too (transformPasted), so it cannot
    // get out of step with whichever mode is chosen afterwards.
    expect(paste).toMatch(/transformPasted\(slice, view\)/);
    expect(paste).toMatch(/export function isSpacerParagraph/);
    expect(paste).toMatch(/export function isLayoutTable/);
    // …and a multi-block paste into a list goes AFTER the list, never inside the item.
    expect(paste).toMatch(/enclosingListDepth/);
    expect(paste).toMatch(/\$from\.after\(listDepth\)/);
  });

  it("⛔ BACKSPACE at the start of a block takes ONE step, at EVERY boundary (B36051 → B291536)", () => {
    const keys = code("lib/notesBlockKeys.js");
    expect(keys, "it must be asked BEFORE the default joinBackward AND before ListKeymap").toMatch(/BLOCK_KEYS_PRIORITY = 160/);
    expect(keys, "only at the very start of a block, and only on an empty selection")
      .toMatch(/parentOffset !== 0/);
    expect(keys).toMatch(/if \(!selection\.empty\) return null/);
    // The alignment case B36051 shipped is still the FIRST thing it looks at.
    expect(keys).toMatch(/MEANINGFUL_ALIGN\.has/);
    expect(keys).toMatch(/textAlign: null/);
    /* ⛔ AND IT IS A TABLE NOW, NOT A SPECIAL CASE. The recurrence ("the backspace still acts
     * funny in certain spots") was lists, and the boundary nobody had looked at deleted a
     * PICTURE. Every row below is a boundary the decision has to name; the behaviour itself is
     * unit-tested against real ProseMirror states in test/notesBlockKeys.test.js and driven
     * for real in ui-audit/verify-notes-backspace.mjs. */
    for (const action of [
      "clear-align", "heading-to-paragraph", "codeblock-to-paragraph", "lift-blockquote",
      "outdent-list-item", "list-item-to-paragraph", "select-node-before", "into-table-cell",
      "join-textblock", "join", "none",
    ]) expect(keys, `the boundary table must name "${action}"`).toContain(`"${action}"`);
    expect(keys, "the decision is PURE, so it can be unit-tested").toMatch(/export function blockStartAction/);
    expect(keys, "typing '- ' then Backspace still takes the bullet back").toMatch(/undoInputRule\(\)/);
  });

  it("the three paste glyphs are OUR drawings, and there are three of them", () => {
    const ed = code("components/NoteEditor.jsx");
    expect(ed).toMatch(/const PASTE_ICONS = \{/);
    for (const mode of ["source", "merge", "text"]) expect(ed).toMatch(new RegExp(`${mode}: \\(`));
    expect(ed, "each mode is named with its Word access key").toMatch(/key: "K"/);
    expect(ed).toMatch(/key: "M"/);
    expect(ed).toMatch(/key: "T"/);
    expect(ed, "inline SVG on currentColor, like every other icon in the module").toMatch(/stroke="currentColor"/);
  });

  it("a notebook's 'Belongs to' panel offers each destination exactly once", () => {
    /* Both the "this project is not in the list" splice and the "this binding is unresolved"
     * push fired on an unresolved CURRENT project, emitting two rows with the same id — a
     * duplicate React key, and one of them naming a raw id at the user. */
    const rail = code("components/NotesTree.jsx");
    expect(rail).toMatch(/boundTo != null && boundTo !== currentProjectId/);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 7. TAB BELONGS TO THE DOCUMENT (B1392)
 *
 * The owner's Tab presses were landing in Chrome's toolbar. The fix is a FALLBACK, and the
 * two properties that make it a fallback rather than a blanket swallow are asserted here;
 * the behaviour itself is driven in a real browser in ui-audit/verify-notes.mjs §23.
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("the Tab key", () => {
  it("is claimed by an extension that IS in the one canonical extension list", () => {
    expect(NOTE_EXTENSIONS.map((e) => e.name)).toContain("noteTabKey");
  });

  it("⛔ runs BELOW the table's and the list's own Tab handlers, so indent and next-cell still win", () => {
    const tab = NOTE_EXTENSIONS.find((e) => e.name === "noteTabKey");
    const others = NOTE_EXTENSIONS.filter((e) => e.name !== "noteTabKey");
    for (const e of others) {
      const p = e.config?.priority ?? e.options?.priority ?? 100;
      expect(tab.config.priority, `${e.name} would be asked after the Tab fallback`).toBeLessThan(p + 1);
    }
    expect(tab.config.priority).toBeLessThan(100);
  });

  it("⛔ KEEPS AN ESCAPE HATCH — a key that can never leave is a keyboard trap", () => {
    const text = code("lib/notesTabKey.js");
    expect(text).toMatch(/Escape:/);
    expect(text).toMatch(/released/);
    // …and the way out is ANNOUNCED, not folklore: the editor's accessible name says it.
    expect(code("components/NoteEditor.jsx")).toMatch(/aria-label[^\n]*Escape/);
  });

  it("indents with a REAL character, so the indent survives storage and export", () => {
    expect(code("lib/notesTabKey.js")).toMatch(/TAB_CHAR = "\\t"/);
  });

  it("PDF-PARITY — the print sheet honours a tab at the SAME width the screen does", () => {
    const onScreen = src("components/NoteEditor.jsx").match(/tab-size:\s*(\d+)/);
    const onPaper = src("lib/notesPrint.js").match(/tab-size:\s*(\d+)/);
    expect(onScreen, "the editor CSS sets no tab-size").toBeTruthy();
    expect(onPaper, "the print sheet sets no tab-size").toBeTruthy();
    expect(onPaper[1]).toBe(onScreen[1]);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 8. THE CONFLICT BAR NAMES NOBODY (B1391)
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("the conflict surface", () => {
  it("takes its words from the ONE pure copy function, not from strings inlined in JSX", () => {
    expect(code("Notes.jsx")).toMatch(/notesConflictLine/);
  });

  it("⛔ no user-facing string in the module implies another PERSON edited your note", () => {
    for (const f of JSX_SURFACES.concat(["lib/notesStore.js"])) {
      const text = code(f);
      expect(text, `${f} implies a second person`).not.toMatch(/other person|someone else|another user/i);
    }
  });

  it("a moved revision alone may not raise the bar — the store compares the documents first", () => {
    const store = code("lib/notesStore.js");
    expect(store).toMatch(/settleQuietly/);
    // Both paths that can lose the race have to go through it: the seed and the push.
    expect(store.match(/settleQuietly\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("same-account MULTI-WINDOW is handled as a normal state: a sibling window is listened for", () => {
    const store = code("lib/notesStore.js");
    expect(store).toMatch(/addEventListener\("storage"/);
    expect(store).toMatch(/mergeSyncState|mergeState/);
    // …and an open editor re-reads a body that changed underneath it (the self-race).
    expect(store).toMatch(/emitPagesChanged/);
    expect(code("Notes.jsx")).toMatch(/onNotesPagesChanged/);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 9. SKETCH MODE LIVES IN THE SCHEMA — NOT IN A SECOND STORE
 *
 * The load-bearing claim of the whole feature is that a sketch is a NODE IN THE PROSEMIRROR
 * SCHEMA, so it persists, syncs, prints and exports through plumbing that already exists.
 * That claim is only true while nobody adds a second store or a second persistence path
 * beside it — which is exactly the kind of thing that gets added later, in good faith, by
 * someone who has not read the header. So it is asserted here, structurally.
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("sketch mode is a schema node, and there is no second store", () => {
  it("the schema really admits it — read off the REAL schema, not the extension list", () => {
    const schema = getSchema(NOTE_EXTENSIONS);
    expect(schema.nodes.noteSketch, "noteSketch is not in the schema").toBeTruthy();
    const attrs = schema.nodes.noteSketch.spec.attrs;
    /* `boxes` + `links` are the live shape — THE CANVAS OWNS EVERYTHING. `outline` and
     * `positions` are the SUPERSEDED shape (B1400), kept declared and defaulting to null for
     * one reason only: a note already in storage may carry one, and normalizeSketch migrates
     * it on read. Removing them would silently blank those sketches. */
    expect(Object.keys(attrs).sort()).toEqual(["boxes", "links", "outline", "positions"]);
    expect(attrs.outline.default).toBeNull();
    expect(attrs.positions.default).toBeNull();
  });

  it("⛔ NOT ONE sketch file touches storage — no localStorage, no IndexedDB, no Supabase", () => {
    for (const f of SKETCH_FILES) {
      const text = code(f);
      for (const forbidden of ["localStorage", "sessionStorage", "indexedDB", "supabase", "createClient", "fetch("]) {
        expect(text, `${f} reaches for ${forbidden} — a sketch persists as part of the DOCUMENT, nowhere else`)
          .not.toContain(forbidden);
      }
      expect(text, `${f} imports the store — the document IS the storage`).not.toMatch(/notesStore|notesCloud|notesImageDb/);
    }
  });

  it("⛔ THE ARROW CASCADE IS ENFORCED BY THE MODEL, so no caller can skip it", () => {
    const model = code("lib/notesSketchModel.js");
    // removeBox is the ONLY place a box is destroyed, and it reports the arrows it took.
    expect(model).toMatch(/export function removeBox/);
    expect(model).toMatch(/removedLinks/);
    // …and the editor never splices a box out by hand.
    const editor = code("lib/notesSketchEditor.js");
    expect(editor).toMatch(/removeBox\(/);
    expect(editor, "boxes must never be filtered out around the cascade").not.toMatch(/boxes\.filter\(/);
    expect(editor, "the editor must not assemble a box list of its own").not.toMatch(/boxes:\s*\[/);
  });

  it("the canvas owns the text AND the position — and each edit goes through its own function", () => {
    const editor = code("lib/notesSketchEditor.js");
    for (const fn of ["addBox(", "updateBox(", "moveBox(", "addLink(", "removeLink("]) {
      expect(editor, `the editor does not reach the model's ${fn} — an edit is being hand-rolled`).toContain(fn);
    }
    expect(editor, "a position is written through the model, never spliced in place").not.toMatch(/\.x\s*=\s*/);
    /* ⛔ THE SUPERSEDED OUTLINE PANE IS GONE AND MUST NOT COME BACK — two authoring paths is
     * the accumulation PANEL-BREVITY forbids, and the outline half is the one the owner
     * rejected. There is no outline text anywhere in the interactive layer. */
    expect(editor, "an outline authoring surface is back").not.toMatch(/outlineToText|parseOutlineText|applyOutlineText/);
    expect(editor, "an outline textarea is back").not.toMatch(/sketch-outline/);
  });

  it("ONE builder draws the screen and the paper — PDF-PARITY by construction", () => {
    expect(code("lib/notesSketchNode.js"), "renderHTML must use the shared spec").toMatch(/renderHTML[\s\S]{0,160}sketchSpec\(/);
    expect(code("lib/notesSketchNode.js"), "the node view must draw from the SAME spec").toMatch(/specToDom\(sketchSpec\(/);
    /* …and the ONLY difference between them carries no content: the screen gets the
     * affordances (`interactive`), paper gets the same boxes, words and arrows. */
    expect(code("lib/notesSketchNode.js")).toMatch(/interactive: editor\.isEditable/);
    expect(code("lib/notesSketchRender.js")).toMatch(/if \(interactive\)/);
  });

  it("the drawing carries CLASS NAMES and no colours — the ink is in the two CSS mirrors", () => {
    const render = code("lib/notesSketchRender.js");
    expect(render, "a literal colour here would print the screen's theme onto paper").not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(render).not.toMatch(/rgba?\(|var\(--/);
  });

  it("every sketch class the drawing emits is styled on BOTH surfaces", () => {
    const render = src("lib/notesSketchRender.js");
    const screen = src("components/NoteEditor.jsx");
    const paper = src("lib/notesPrint.js");
    const classes = new Set([...render.matchAll(/planyr-sketch[\w-]*/g)].map((m) => m[0]));
    /* One set is deliberately one-sided, and it is the same decision seen from its own end:
     * the AFFORDANCES (the grip you drag an arrow out of, the drag group's own cursor) cannot
     * be pressed on paper, so the spec does not draw them there. Everything that is CONTENT —
     * box, label, body, arrow, head — is styled on both, because both surfaces draw it. */
    const screenOnly = /grip|tools|kind|btn|status|offline|host|draw|pending|hint|edit|sketch-node/;
    for (const cls of classes) {
      expect(screen, `${cls} has no on-screen style`).toContain(cls);
      if (!screenOnly.test(cls)) expect(paper, `${cls} is drawn but has no PRINT style — the sheet will not match the screen`).toContain(cls);
    }
  });

  it("the INTERACTIVE half is behind a cached dynamic import, like notesCloud and the image DB", () => {
    const node = code("lib/notesSketchNode.js");
    expect(node, "a static import puts the whole editor on every note that has no sketch")
      .not.toMatch(/^\s*import\s+.*notesSketchEditor/m);
    expect(node).toMatch(/import\("\.\/notesSketchEditor\.js"\)/);
    expect(node, "the promise is cached, so a second sketch does not re-fetch").toMatch(/editorChunk/);
    // Nothing else may reach it either.
    for (const f of ALL_NOTES_FILES.filter((x) => x !== "lib/notesSketchNode.js")) {
      expect(code(f), `${f} imports the sketch editor directly`).not.toMatch(/^\s*import\s+.*notesSketchEditor/m);
    }
  });

  it("sketch code stays OFF the Notes route's static path — including out of the exporter", () => {
    expect(code("lib/notesMarkdown.js"), "the exporter is on the static path; importing the sketch model puts sketch bytes on every notebook's first paint")
      .not.toMatch(/notesSketch/);
    for (const f of ["Notes.jsx", "components/NotesTree.jsx", "lib/notesModel.js", "lib/notesStore.js"]) {
      expect(code(f), `${f} is on the static path and reaches sketch code`).not.toMatch(/notesSketch/);
    }
  });

  it("no dialog boxes in the sketch either (house rule) — every edit is in place", () => {
    for (const f of SKETCH_FILES) {
      expect(code(f), `${f} uses a browser dialog`).not.toMatch(/window\.(prompt|confirm|alert)|[^.\w](prompt|confirm|alert)\(/);
    }
    // A box's words are edited IN the box: two real fields laid over it.
    const editor = code("lib/notesSketchEditor.js");
    expect(editor).toMatch(/el\("input", "planyr-sketch-edit-label"/);
    expect(editor).toMatch(/el\("textarea", "planyr-sketch-edit-body"/);
  });

  it("⛔ DOUBLE-CLICKING EMPTY CANVAS IS THE AUTHORING SURFACE, and a drag between boxes is the arrow", () => {
    const editor = code("lib/notesSketchEditor.js");
    expect(editor, "nothing listens for a double-click on the canvas").toMatch(/addEventListener\("dblclick"/);
    expect(editor, "a double-click on empty canvas must make a box right there").toMatch(/beginBox\(pt\.x/);
    // The arrow is dragged off the box itself — not turned on with a mode button first.
    expect(editor).toMatch(/data-sketch-grip/);
    expect(editor, "an arrow MODE is back").not.toMatch(/linkMode/);
    // The surface the press has to land on is drawn, or an empty spot would swallow it.
    expect(code("lib/notesSketchRender.js")).toMatch(/planyr-sketch-surface/);
  });

  it("a refused act SAYS SO (LOUD-FAILURE) — addLink returns a reason and the editor shows it", () => {
    expect(code("lib/notesSketchModel.js")).toMatch(/added: false, reason:/);
    expect(code("lib/notesSketchEditor.js")).toMatch(/say\(`No arrow — \$\{reason\}/);
    // …and a deleted box states the arrows it took with it, rather than removing them quietly.
    expect(code("lib/notesSketchEditor.js")).toMatch(/removedLinks\.length/);
    // …and a failed chunk load leaves a named message rather than a dead-looking drawing.
    expect(src("lib/notesSketchNode.js")).toMatch(/Sketch editing could not load/);
  });

  it("the toolbar's BOX button is the one way in, and it makes a real box", () => {
    expect(code("components/NoteToolbar.jsx")).toMatch(/boxSelection\(\)/);
    expect(code("lib/notesSketchNode.js")).toMatch(/boxSelection:/);
    // The superseded "insert an empty sketch and go type an outline" command is gone.
    expect(code("components/NoteToolbar.jsx")).not.toMatch(/insertNoteSketch/);
    expect(code("lib/notesSketchNode.js")).not.toMatch(/insertNoteSketch/);
  });
});

/* ⛔ ONE SAVE INDICATOR, IN THE PLACE EVERY OTHER MODULE PUTS IT (B539649).
 *
 * His words: *"it should just mimic the Site Planning module exactly. Literally, all the modules
 * should show that save icon in the exact same place."* Notes had TWO of its own — a pill in the
 * note header and a sync line in a footer under the rail — while the app-wide `CloudSyncBadge`
 * said the same thing in the header. This guard is a source sweep rather than a screenshot,
 * because the failure mode is somebody re-adding a local one, and that is a fact about the code. */
describe("the save indicator", () => {
  it("⛔ Notes renders NO save chip of its own — the shared badge is the only one", () => {
    for (const f of ["components/NoteEditor.jsx", "Notes.jsx"]) {
      const code = src(f);
      expect(code, `${f} still renders a local save badge`).not.toMatch(/data-testid="note-save-badge"/);
      expect(code, `${f} still renders the footer sync line`).not.toMatch(/data-testid="notes-scope-label"/);
    }
  });

  it("…and it FEEDS the shared badge instead, like the other three modules do", () => {
    expect(src("Notes.jsx")).toMatch(/saveState=\{notesSaveState\(/);
  });

  it("⛔ a failed write is still LOUD — the storage line rides the badge's detail", () => {
    expect(src("Notes.jsx")).toMatch(/saveDetail=/);
  });

  it("the normaliser never dresses a failed write as success (LOUD-FAILURE)", async () => {
    const { notesSaveState } = await import("../src/workspaces/notes/lib/notesSaveState.js");
    expect(notesSaveState("error")).toBe("error");
    expect(notesSaveState("unsaved")).toBe("error");
    expect(notesSaveState("saving")).toBe("saving");
    expect(notesSaveState("saved", { signedIn: true })).toBe("synced");
    expect(notesSaveState("saved")).toBe("local");
    // Nothing open yet: say nothing rather than claim a save that never happened.
    expect(notesSaveState("saved", { idle: true })).toBe(null);
  });
});
