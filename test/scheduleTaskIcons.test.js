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
  it("offers 77 distinct icons: 61 emoji + the 16 drawn for Planyr", () => {
    expect(TI.ALL_IDS.length).toBe(77);
    expect(TI.EMOJI_IDS.length).toBe(61);
    expect(TI.ALL_IDS.filter(TI.isCustom).length).toBe(16);
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
    expect(ids(TI.searchTaskIcons("")).length).toBeGreaterThan(77);   // 80 slots (3 ids sit in two categories)
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
  it("the name EDITOR's text starts where the displayed name starts (slot width folded in)", () => {
    expect(page).toContain("paddingLeft:20+ICON_SLOT_W+task.level*14");
    expect(page).toMatch(/const ICON_SLOT_W = 38;/);
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
