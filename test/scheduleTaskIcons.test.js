import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// SCHEDULE › TASK ICONS (NEW-1, owner-approved design 2026-11-06). The pure rules + the wiring, run against the REAL files:
// public/sequence/taskIcons.js is evaluated (not mirrored) and the page source is sliced for the few functions that must carry
// icons through a copy. The rendered behaviour (alignment, picker, summary, fallback) is ui-audit/verify-schedule-task-icons.mjs.
const root = (p) => fileURLToPath(new URL("../" + p, import.meta.url));
const libSrc = readFileSync(root("public/sequence/taskIcons.js"), "utf8");
const page = readFileSync(root("public/sequence/index.html"), "utf8");

const TI = (() => { const g = {}; new Function("globalThis", "window", libSrc.replace(/\}\)\(typeof window[^\n]*\n?$/, "})(globalThis);\n"))(g, undefined); return g.PlanyrTaskIcons; })();

const extractFn = (signature) => {
  const start = page.indexOf(signature);
  if (start === -1) throw new Error(`"${signature}" not found in public/sequence/index.html`);
  let depth = 0, i = start, seen = false;
  for (; i < page.length; i++) {
    if (page[i] === "{") { depth++; seen = true; }
    else if (page[i] === "}") { depth--; if (seen && depth === 0) { i++; break; } }
  }
  return page.slice(start, i);
};

const ids = (groups) => groups.flatMap(g => g.items.map(i => i.id));

describe("the icon library", () => {
  it("has the eight categories in the owner's order", () => {
    expect(TI.CATEGORIES.map(c => c.title)).toEqual(["Acquisition and diligence", "Entitlements and permits", "Design", "Utilities", "Sitework", "Building", "Leasing and finance", "Status and milestones"]);
  });
  it("offers 78 distinct icons: 61 emoji + the 16 coloured c: drawings + 1 built-in line-art svg:", () => {
    expect(TI.ALL_IDS.length).toBe(78);
    expect(TI.EMOJI_IDS.length).toBe(61);
    expect(TI.ALL_IDS.filter(TI.isCustom).length).toBe(16);
    expect(TI.ALL_IDS.filter(TI.isBuiltinSvg)).toEqual(["svg:plat"]);
  });
  it("every custom id has inline SVG markup, and nothing in CUSTOM_SVG is unused", () => {
    const used = new Set(TI.ALL_IDS.filter(TI.isCustom).map(TI.customName));
    for (const n of used) expect(TI.CUSTOM_SVG[n], "c:" + n).toBeTruthy();
    expect([...Object.keys(TI.CUSTOM_SVG)].sort()).toEqual([...used].sort());
  });
  it("reproduces the owner's markup as given (spot-checked verbatim)", () => {
    expect(TI.CUSTOM_SVG.permit).toBe('<rect x="6" y="3" width="20" height="28" rx="2" fill="#E1E8ED" stroke="#99AAB5"/><path d="M10 9h12M10 13h12M10 17h7" stroke="#99AAB5" stroke-width="2"/><circle cx="25" cy="25" r="8" fill="#77B255"/><path d="M21 25l3 3 5-6" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>');
    expect(TI.CUSTOM_SVG.manhole).toBe('<circle cx="18" cy="18" r="16" fill="#66757F"/><circle cx="18" cy="18" r="13" fill="#8899A6"/><path d="M8 13h20M6 18h24M8 23h20M13 7v22M18 5v26M23 7v22" stroke="#66757F" stroke-width="1.5"/>');
    expect(TI.CUSTOM_SVG.joist).toBe('<path d="M1 11h34M1 25h34" stroke="#66757F" stroke-width="3"/><path d="M3 25l4.5-14 4.5 14 4.5-14 4.5 14 4.5-14 4.5 14 4.5-14" stroke="#8899A6" stroke-width="2" fill="none"/>');
    for (const [n, m] of Object.entries(TI.CUSTOM_SVG)) {
      const open = (m.match(/<(rect|path|circle|ellipse|g)\b/g) || []).length, closedG = (m.match(/<\/g>/g) || []).length, openG = (m.match(/<g\b/g) || []).length;
      expect(openG, n + " <g> balanced").toBe(closedG);
      expect(open, n).toBeGreaterThan(1);
    }
  });
  it("the three ids that sit in two categories appear once in EACH, never twice in one", () => {
    for (const dupe of ["c:pond", "c:joist", "🏦"]) {
      const cats = TI.CATEGORIES.filter(c => c.items.some(i => i[0] === dupe));
      expect(cats.length, dupe).toBe(2);
      for (const c of cats) expect(c.items.filter(i => i[0] === dupe).length).toBe(1);
    }
  });
  it("the owner's icon decisions hold: permit ≠ contract scroll, TIA is the traffic light, sewer is the manhole, roof is the flat roof, civil ≠ design", () => {
    const where = (id) => TI.CATEGORIES.find(c => c.items.some(i => i[0] === id)).items.find(i => i[0] === id);
    expect(where("c:permit")[2]).toMatch(/permit/);
    expect(where("📜")[2]).toMatch(/contract/);
    expect(where("📜")[2]).not.toMatch(/permit/);
    expect(where("🚦")[2]).toMatch(/TIA/);
    expect(where("c:manhole")[2]).toMatch(/sewer/);
    expect(where("c:dump")[2]).toMatch(/grading/);
    expect(where("c:roof")[2]).toMatch(/roof/);
    expect(where("c:civil")[0]).not.toBe(where("📐")[0]);
  });
});

describe("the built-in Plat icon (svg:plat, B2671217)", () => {
  const plat = TI.BUILTIN_SVG.plat;
  it("is a stored KEY, kept by normalize, and is recognised as a built-in drawing (not an emoji, not a c: id)", () => {
    expect(TI.isBuiltinSvg("svg:plat")).toBe(true);
    expect(TI.isBuiltinSvg("c:plat")).toBe(false);
    expect(TI.isBuiltinSvg("🗺️")).toBe(false);
    expect(TI.svgName("svg:plat")).toBe("plat");
    expect(TI.isKnown("svg:plat")).toBe(true);
    expect(TI.normalizeTaskIcons(["🚦", "svg:plat"])).toEqual(["🚦", "svg:plat"]);
    expect(TI.normalizeTaskIcons(["svg:from-a-newer-client"])).toEqual(["svg:from-a-newer-client"]);   // kept, just not drawn
    expect(TI.toggleTaskIcon(["svg:plat"], "🚦")).toEqual(["svg:plat", "🚦"]);
  });
  it("is offered once, in Entitlements and permits, labelled Plat, and found by every keyword the owner named", () => {
    const cats = TI.CATEGORIES.filter(c => c.items.some(i => i[0] === "svg:plat"));
    expect(cats.map(c => c.key)).toEqual(["ent"]);
    for (const q of ["plat", "final plat", "mylar", "recordation", "subdivision", "lots"]) expect(ids(TI.searchTaskIcons(q)), q).toContain("svg:plat");
    expect(ids(TI.searchTaskIcons("zoning"))).not.toContain("svg:plat");
    expect(TI.iconLabel("svg:plat")).toBe("Plat · drawn for Planyr");
    expect(TI.EMOJI_IDS).not.toContain("svg:plat");   // no Twemoji file is looked up for it
  });
  it("the older c:plat is untouched: still offered, still drawable", () => {
    expect(TI.ALL_IDS).toContain("c:plat");
    expect(TI.CUSTOM_SVG.plat).toBeTruthy();
  });
  it("carries the approved artwork exactly (24x24, frame, street outline, lot lines)", () => {
    expect(plat.viewBox).toBe("0 0 24 24");
    expect(plat.markup).toContain('<path d="M2.5 10.7H10.75A3.5 3.5 0 1 1 10.75 13.3H2.5" stroke-width="1.3"/>');
    expect(plat.markup).toContain('<path d="M7 2.5V10.7M12 2.5V9.13M7 13.3V21.5M12 14.87V21.5M16.47 9.53L21.5 4.5M17.5 12H21.5M16.47 14.47L21.5 19.5" stroke-width="1"/>');
    expect(plat.markup).toContain('<rect x="2.5" y="2.5" width="19" height="19" rx="1.5" stroke-width="1.4"/>');
  });
  it("the street is a TRUE cut-out: one shading outline that walks round the street; no mask, no id, no fixed colour", () => {
    expect(plat.markup).not.toMatch(/<mask|\sid=|url\(|#[0-9a-fA-F]{3,8}\b|rgb|white|black/);
    expect(plat.markup).toMatch(/currentColor/);
    const shade = plat.markup.match(/<path d="([^"]+)" fill="currentColor" fill-opacity="\.2" stroke="none"\/>/);
    expect(shade, "shading path").toBeTruthy();
    expect((shade[1].match(/M/g) || []).length).toBe(1);                 // ONE outline (not a square with a second shape on it)
    expect(shade[1]).toContain("H10.75A3.5 3.5 0 1 0 10.75 10.7H2.5");   // it goes round the cul-de-sac bulb, the long way
    expect(plat.markup).not.toMatch(/<rect[^>]*fill-opacity/);           // the old "full shaded square" form is gone
  });
});

describe("Twemoji files", () => {
  it("names follow the codepoint rule: hex codepoints joined by '-', fe0f dropped", () => {
    expect(TI.twemojiFile("🧭")).toBe("1f9ed");
    expect(TI.twemojiFile("✍️")).toBe("270d");       // 270d + fe0f
    expect(TI.twemojiFile("🗺️")).toBe("1f5fa");     // 1f5fa + fe0f
    expect(TI.twemojiFile("⚠️")).toBe("26a0");
    expect(TI.twemojiFile("🛣️")).toBe("1f6e3");
    expect(TI.twemojiFile("🏁")).toBe("1f3c1");
  });
  it("EVERY emoji the library offers has its SVG bundled (a missing one would be a broken image)", () => {
    const dir = root("public/sequence/vendor/twemoji/");
    const missing = TI.EMOJI_IDS.filter(e => !existsSync(dir + TI.twemojiFile(e) + ".svg"));
    expect(missing).toEqual([]);
  });
  it("only the SVGs the library uses are bundled (+ the credits note) — nothing hot-linked, nothing extra", () => {
    const want = new Set(TI.EMOJI_IDS.map(e => TI.twemojiFile(e) + ".svg"));
    want.add("CREDITS.txt");
    const have = readdirSync(root("public/sequence/vendor/twemoji/"));
    expect(have.sort()).toEqual([...want].sort());
    expect(page).not.toMatch(/cdn\.jsdelivr\.net\/gh\/jdecked|twemoji\.maxcdn|cdnjs[^"']*twemoji/i);
  });
  it("each bundled file is a real SVG", () => {
    for (const e of TI.EMOJI_IDS) expect(readFileSync(root("public/sequence/vendor/twemoji/" + TI.twemojiFile(e) + ".svg"), "utf8").trimStart().startsWith("<svg")).toBe(true);
  });
  it("the CC-BY 4.0 attribution is in the credits note, and the picker links it", () => {
    const credits = readFileSync(root("public/sequence/vendor/twemoji/CREDITS.txt"), "utf8");
    expect(credits).toMatch(/CC-BY 4\.0/);
    expect(credits).toMatch(/jdecked\/twemoji/);
    expect(credits).toMatch(/15\.1\.0/);
    expect(page).toContain("/sequence/vendor/twemoji/CREDITS.txt");
  });
});

describe("search", () => {
  it('"tia" finds the traffic light — and nothing else ("substantial" must not match)', () => {
    expect(ids(TI.searchTaskIcons("tia"))).toEqual(["🚦"]);
  });
  it('"sewer" finds the manhole, "roof" the roof, "tilt" the tilt-wall icon', () => {
    expect(ids(TI.searchTaskIcons("sewer"))).toEqual(["c:manhole"]);
    expect(ids(TI.searchTaskIcons("roof"))).toEqual(["c:roof"]);
    expect(ids(TI.searchTaskIcons("tilt"))).toEqual(["c:tilt"]);
  });
  it("is case-insensitive, matches word starts, and every word must match", () => {
    expect(ids(TI.searchTaskIcons("SEWER"))).toEqual(["c:manhole"]);
    expect(ids(TI.searchTaskIcons("sprink"))).toEqual(["c:sprink"]);
    expect(ids(TI.searchTaskIcons("fire hydrant"))).toEqual(["c:hydrant"]);
    expect(ids(TI.searchTaskIcons("fire zzz"))).toEqual([]);
  });
  it("empty search = everything, in order; nothing matching = no groups", () => {
    expect(ids(TI.searchTaskIcons("")).length).toBeGreaterThan(78);   // 81 slots (3 ids sit in two categories)
    expect(TI.searchTaskIcons("   ").length).toBe(8);
    expect(TI.searchTaskIcons("qqqq")).toEqual([]);
  });
  it("a duplicated id never shows twice inside one category, but is found under both", () => {
    const g = TI.searchTaskIcons("pond");
    expect(g.map(x => x.key)).toEqual(["ent", "sit"]);
    for (const c of g) expect(new Set(c.items.map(i => i.id)).size).toBe(c.items.length);
    expect(ids(TI.searchTaskIcons("bond")).filter(i => i === "🏦").length).toBe(2);   // 🏦 sits in ent (MUD / district / bond) and fin (loan / lender); either category's words find it in both
  });
  it("hover labels: custom icons add ' · drawn for Planyr'; emoji do not", () => {
    expect(TI.iconLabel("c:manhole")).toBe("Sanitary sewer · drawn for Planyr");
    expect(TI.iconLabel("🚦")).toBe("Traffic impact analysis (TIA)");
    expect(TI.iconLabel("c:pond", "Detention / drainage review")).toBe("Detention / drainage review · drawn for Planyr");
  });
});

describe("the two-icon rule", () => {
  it("adds up to two; a third replaces the OLDEST; a picked one is removed", () => {
    let c = [];
    c = TI.toggleTaskIcon(c, "🚦"); expect(c).toEqual(["🚦"]);
    c = TI.toggleTaskIcon(c, "c:manhole"); expect(c).toEqual(["🚦", "c:manhole"]);
    c = TI.toggleTaskIcon(c, "c:roof"); expect(c).toEqual(["c:manhole", "c:roof"]);
    c = TI.toggleTaskIcon(c, "c:manhole"); expect(c).toEqual(["c:roof"]);
    c = TI.toggleTaskIcon(c, "c:roof"); expect(c).toEqual([]);
  });
  it("normalize: only short distinct strings, at most two (newest kept), anything else is no icons", () => {
    expect(TI.normalizeTaskIcons(undefined)).toEqual([]);
    expect(TI.normalizeTaskIcons("🚦")).toEqual([]);
    expect(TI.normalizeTaskIcons(["🚦", "🚦", "", 5, null, "c:roof", "💧"])).toEqual(["c:roof", "💧"]);
    expect(TI.normalizeTaskIcons(["x".repeat(40)])).toEqual([]);
    expect(TI.normalizeTaskIcons(["c:from-a-newer-client"])).toEqual(["c:from-a-newer-client"]);   // kept, just not drawn
  });
});

describe("collapsed-phase summary", () => {
  const T = (id, parentId, icons) => ({ id, parentId, name: "t" + id, ...(icons ? { icons } : {}) });
  const tasks = [T(1, null), T(2, 1, ["🚦"]), T(3, 1, ["🚦", "c:roof"]), T(4, 1), T(5, 4, ["💧"]), T(6, null, ["⭐"])];
  it("lists the DISTINCT icons of every leaf inside the phase, in tree order, with the leaf count", () => {
    expect(TI.phaseIconSummary(tasks, 1)).toEqual({ icons: ["🚦", "c:roof", "💧"], leaves: 3 });
  });
  it("a sub-summary's own icons are not leaves; the other phase is untouched", () => {
    const withMid = tasks.map(t => t.id === 4 ? { ...t, icons: ["🔥"] } : t);
    expect(TI.phaseIconSummary(withMid, 1).icons).not.toContain("🔥");
    expect(TI.phaseIconSummary(tasks, 6)).toEqual({ icons: [], leaves: 0 });
  });
  it("a parentId cycle cannot hang it", () => {
    const cyc = [T(1, 2), T(2, 1, ["⭐"])];
    expect(() => TI.phaseIconSummary(cyc, 1)).not.toThrow();
  });
});

describe("wiring in public/sequence/index.html", () => {
  it("loads the library before the app compiles, and the app never touches the icons without it", () => {
    const a = page.indexOf('<script src="/sequence/taskIcons.js"></script>'), b = page.indexOf('<script type="text/babel">');
    expect(a).toBeGreaterThan(-1);
    expect(a).toBeLessThan(b);
  });
  it("updateTask sanitises `icons` on write and an empty list removes the key", () => {
    const i = page.indexOf("if ('icons' in updates)");
    expect(i).toBeGreaterThan(-1);
    const line = page.slice(i, page.indexOf("\n", i));
    expect(line).toContain("PlanyrTaskIcons.normalizeTaskIcons(updates.icons)");
    expect(line).toContain("delete u.icons");
  });
  it("an icon edit is NOT a schedule edit (no date cascade) and the name is never composed from icons", () => {
    const keys = page.match(/const SCHEDULE_INPUT_KEYS = \[([^\]]*)\]/)[1];
    expect(keys).not.toContain("icons");
    expect(page).not.toMatch(/name:\s*[^,}]*\bicons\b/);
  });
  it("the name cell is chevron → icon slot → name; the text triangle is gone from it", () => {
    const i = page.indexOf('case "name": return (\n      <span style={{...s,paddingLeft:4+task.level*14');
    expect(i).toBeGreaterThan(-1);
    const block = page.slice(i, page.indexOf("rowCanFocus(task) && (", i));
    const chev = block.indexOf("ti-chevron-right"), slot = block.indexOf("<TaskIconSlot"), nm = block.indexOf('{task.name || "New task"}'), sum = block.indexOf("<PhaseIconSummary");
    expect(chev).toBeGreaterThan(-1);
    expect(chev).toBeLessThan(slot);
    expect(slot).toBeLessThan(nm);
    expect(nm).toBeLessThan(sum);
    expect(block).toContain("ti-chevron-down");
    expect(block).not.toMatch(/[▾▸]/);
    expect(block).toContain('title={task.isExpanded?"Collapse":"Expand"}');   // harnesses find the toggle by this
    expect(block).toMatch(/!task\.isExpanded && task\.hasChildren && <PhaseIconSummary/);
  });
  it("the name EDITOR's text starts where the displayed name starts (the icons' own width folded in — zero when there are none)", () => {
    expect(page).toContain("paddingLeft:20+taskIconsW(window.PlanyrTaskIcons.normalizeTaskIcons(task.icons).length)+task.level*14");
    const fn = page.match(/const taskIconsW = n => [^\n]*;/)[0];
    const taskIconsW = new Function(`const TASK_ICON_PX = 16, TASK_ICON_GAP = 2, TASK_ICON_PAD = 2, TASK_ICON_AFTER = 2; ${fn}; return taskIconsW;`)();
    expect(taskIconsW(0)).toBe(0);                                // no icons → no reserved width at all
    expect(taskIconsW(2)).toBeGreaterThan(taskIconsW(1));         // width follows the icons
    expect(page).not.toContain("ICON_SLOT_W");                    // the fixed-width slot is gone (owner, 2026-11-09)
  });
  it("NO hover 'add icon' glyph: an empty slot renders nothing and no add-glyph markup / CSS remains (owner: \"This is a serious software\")", () => {
    const i = page.indexOf("function TaskIconSlot(");
    const body = page.slice(i, page.indexOf("function TaskIconPickerHost(", i));
    expect(body).toMatch(/if \(icons\.length === 0\) return null;/);
    expect(body).not.toMatch(/ti-mood|ti-slot-add|Add an icon/);
    expect(page).not.toMatch(/ti-mood-plus|ti-slot-add/);
  });
  it("NO 'N tasks' count on a collapsed phase; the faded icon summary stays, and an icon-free phase shows nothing", () => {
    const i = page.indexOf("function PhaseIconSummary(");
    const body = page.slice(i, page.indexOf("function Cell(", i));
    expect(body).not.toMatch(/ti-count|data-phase-count|" tasks"|sum\.leaves/);
    expect(body).toContain("if (!sum.icons.length) return null;");
    expect(body).toContain("faded");
    expect(page).not.toContain(".ti-count");
  });
  it("proposed (review) rows reserve no icon slot", () => {
    expect(page).not.toMatch(/aria-hidden="true" style=\{\{width:ICON/);
  });
  it("the row's right-click menu carries Set icon… / Change icon… / Remove icon, wired to the app-level picker host", () => {
    const m = page.slice(page.indexOf("function TaskContextMenu("), page.indexOf("// ── HealthColHeader"));
    expect(m).toContain('label={hasIcons ? "Change icon…" : "Set icon…"}');
    expect(m).toMatch(/\{hasIcons && <Item icon="ti-icons-off" label="Remove icon" onClick=\{onRemoveIcon\} \/>\}/);
    expect(page).toContain("hasIcons={window.PlanyrTaskIcons.normalizeTaskIcons(taskCtx.task.icons).length > 0}");
    expect(page).toContain("onRemoveIcon={() => { updateTask(taskCtx.task.id, {icons: []}, taskCtx.projId); setTaskCtx(null); }}");
    expect(page).toMatch(/onSetIcon=\{\(\) => \{ setIconPickerCtx\(\{taskId: taskCtx\.task\.id/);
    expect(page).toContain("<TaskIconPickerHost ctx={iconPickerCtx}");
    // not gated on a task kind: phase (hasChildren) and leaf rows both get it
    expect(m.slice(m.indexOf("Set icon"), m.indexOf("Set icon") + 5)).toBe("Set i");
    expect(m).not.toMatch(/hasChildren[^\n]*Set icon/);
  });
  it("the picker host anchors to the task's NAME (data-task-name), falling back to the click point; it writes through the live task", () => {
    const i = page.indexOf("function TaskIconPickerHost(");
    const body = page.slice(i, page.indexOf("// Collapsed summary/phase row", i));
    expect(body).toContain("[data-task-name]");
    expect(body).toContain("anchorHidden(");
    expect(body).toContain("updateTask(ctx.taskId, {icons: next}, ctx.projId)");
    expect(page).toContain("title={task.name || undefined} data-task-name style=");
  });
  it("the picker: no-autofill search box; portal root carries the grid-press isolation; anchored popover; Clear + Done + Esc", () => {
    const i = page.indexOf("function TaskIconPicker(");
    const body = page.slice(i, page.indexOf("function TaskIconSlot(", i));
    expect(body).toContain("<input {...NO_AUTOFILL}");
    expect(body).toContain("{...MENU_STOPS_GRID}");
    expect(body).toContain("useAnchoredPopover(true, anchorRef");
    expect(body).toContain("data-icon-clear");
    expect(body).toContain("data-icon-done");
    expect(body).toContain('e.key === "Escape"');
    expect(body).toContain("Nothing matches “");
    expect(body).toContain("Try another word.");
    expect(body).not.toMatch(/getBoundingClientRect\(\)[^;]*;[^]{0,80}setPos\(/);   // positioning is the shared hook's, not a one-shot read
  });
  it("a missing Twemoji file falls back to the plain character (never a broken image)", () => {
    const i = page.indexOf("function TaskIconGlyph(");
    const body = page.slice(i, page.indexOf("function TaskIconPicker(", i));
    expect(body).toContain("onError={() => setFailed(true)}");
    expect(body).toMatch(/if \(failed\) return <span[^>]*>\{id\}<\/span>/);
  });
  it("TaskIconGlyph draws an svg: key as inline currentColor line art (no image fetch), a newer client's unknown svg: key as nothing", () => {
    const i = page.indexOf("function TaskIconGlyph(");
    const body = page.slice(i, page.indexOf("function TaskIconPicker(", i));
    expect(body).toContain("TI.isBuiltinSvg(id)");
    expect(body).toContain("TI.BUILTIN_SVG[TI.svgName(id)]");
    expect(body).toContain('stroke="currentColor"');
    expect(body).toMatch(/if \(!b\) return null;/);
    expect(page).toContain("TI.isDrawn(it.id) && <span");   // the picker's green "drawn for Planyr" dot covers both drawn kinds
  });
  it("a Duplicate schedule carries the icons (a fresh array, not shared)", () => {
    const fn = extractFn("const buildDuplicateProject = (src, newId) => {");
    const build = new Function("copyMeetingBodyWithNewId", `${fn}; return buildDuplicateProject;`)(() => ({ id: "x" }));
    const src = { id: 1, name: "S", meetingBodies: undefined, tasks: [{ id: 1, name: "a", notes: [], icons: ["🚦", "c:roof"] }, { id: 2, name: "b", notes: [] }] };
    const copy = build(src, 9);
    expect(copy.tasks[0].icons).toEqual(["🚦", "c:roof"]);
    expect(copy.tasks[0].icons).not.toBe(src.tasks[0].icons);
    expect("icons" in copy.tasks[1]).toBe(false);
  });
  it("a copied / pasted row carries its icons", () => {
    const fn = extractFn("const collectSubtreeFor = (rootId, allTasks) => {");
    const collect = new Function(`${fn}; return collectSubtreeFor;`)();
    const all = [{ id: 1, parentId: null, notes: [], predecessors: [], icons: ["⭐"] }, { id: 2, parentId: 1, notes: [], predecessors: [] }];
    const out = collect(1, all);
    expect(out[0].icons).toEqual(["⭐"]);
    expect(out[0].icons).not.toBe(all[0].icons);
    expect("icons" in out[1]).toBe(false);
  });
});
