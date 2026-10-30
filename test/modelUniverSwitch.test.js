/* The Univer spike's guard rails (docs/SPREADSHEET-UNIVER-SPIKE.md): who can see it, what it may import, where it may load,
 * and that it stands down the old grid's keyboard. Source-level checks on purpose — each one names a rule the owner set. */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { UNIVER_SWITCH_KEY, readUniverSwitch, writeUniverSwitch, univerGridActive } from "../src/workspaces/model/lib/univerSwitch.js";
import { scaleFrom, buildUniverTheme } from "../src/workspaces/model/lib/univerTheme.js";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), "utf8");
function walk(dir, out = []) {
  for (const n of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${n}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out); else if (/\.(jsx?|mjs)$/.test(n)) out.push(rel);
  }
  return out;
}
const fakeStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

describe("the owner-only switch", () => {
  it("is off by default and remembers its state per device", () => {
    const s = fakeStorage();
    expect(readUniverSwitch(s)).toBe(false);
    writeUniverSwitch(true, s);
    expect(readUniverSwitch(s)).toBe(true);
    expect(s.getItem(UNIVER_SWITCH_KEY)).toBe("1");
    writeUniverSwitch(false, s);
    expect(readUniverSwitch(s)).toBe(false);
  });
  it("never throws when storage is unavailable", () => {
    const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
    expect(readUniverSwitch(broken)).toBe(false);
    expect(writeUniverSwitch(true, broken)).toBe(false);
    expect(readUniverSwitch(null)).toBe(false);
  });
  it("activates only when the admin gate is open AND the device switch is on (a stored 'on' never activates a non-admin)", () => {
    expect(univerGridActive({ available: true, on: true })).toBe(true);
    expect(univerGridActive({ available: true, on: false })).toBe(false);
    expect(univerGridActive({ available: false, on: true })).toBe(false);
    expect(univerGridActive({ available: false, on: false })).toBe(false);
    expect(univerGridActive({})).toBe(false);
  });
  it("the gate IS is_admin() — the same hook the admin page and grading use — and nothing else", () => {
    const src = read("src/workspaces/model/lib/univerSwitch.js");
    expect(src).toMatch(/useIsAdmin\(/);
    expect(src).toMatch(/available: isAdmin/);
    expect(src).not.toMatch(/location\.(search|hash)|URLSearchParams|import\.meta\.env|__PLANYR_E2E/);
  });
  it("ModelApp hands the File menu the switch ONLY when the gate is open, so every other account sees today's menu", () => {
    const app = read("src/workspaces/model/ModelApp.jsx");
    expect(app).toMatch(/univerSwitch=\{univer\.available \? \{ on: univer\.on, setOn: univer\.setOn \} : null\}/);
    const menu = read("src/workspaces/model/components/FileMenu.jsx");
    expect(menu).toMatch(/\{univerSwitch && \(/);
  });
});

describe("what the Univer code may import", () => {
  const pkg = JSON.parse(read("package.json"));
  it("open-source @univerjs/* only, pinned to an exact version — no Pro packages, no license key", () => {
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    const univer = Object.entries(all).filter(([k]) => k.startsWith("@univerjs"));
    expect(univer.length, "vacuity guard: the Univer packages must be declared").toBeGreaterThan(0);
    for (const [name, ver] of univer) expect(ver, `${name} must be pinned exactly`).toMatch(/^\d+\.\d+\.\d+$/);
    expect(Object.keys(all).some((k) => k.startsWith("@univerjs-pro"))).toBe(false);
    expect(read("package-lock.json")).not.toMatch(/@univerjs-pro/);
  });
  it("xlsx / csv stay on ExcelJS / SheetJS: no Univer exchange package", () => {
    expect(read("package-lock.json")).not.toMatch(/sheets-exchange|docs-exchange/);
  });
  it("only UniverSheet.jsx imports @univerjs/*; everything else reaches it through the lazy boundary", () => {
    const importers = walk("src").filter((f) => /from\s+["']@univerjs\/|import\s+["']@univerjs\/|import\(["']@univerjs\//.test(read(f)));
    expect(importers).toEqual(["src/workspaces/model/components/UniverSheet.jsx"]);
  });
  it("ModelApp loads UniverSheet with React.lazy and never statically (so it can only ride its own chunk)", () => {
    const app = read("src/workspaces/model/ModelApp.jsx");
    expect(app).toMatch(/const UniverSheet = lazy\(\(\) => import\("\.\/components\/UniverSheet\.jsx"\)\)/);
    expect(app).not.toMatch(/^import .*UniverSheet/m);
    expect(app).not.toMatch(/univerBridge|univerTheme/);
    const staticImporters = walk("src").filter((f) => /^import .*(UniverSheet|univerBridge|univerTheme)/m.test(read(f)) && f !== "src/workspaces/model/components/UniverSheet.jsx");
    expect(staticImporters).toEqual([]);
  });
  it("makes no call to a Univer host and uses no Pro / license / server configuration", () => {
    for (const f of ["src/workspaces/model/components/UniverSheet.jsx", "src/workspaces/model/lib/univerBridge.js", "src/workspaces/model/lib/univerTheme.js", "src/workspaces/model/lib/univerSwitch.js"]) {
      const src = read(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(src, f).not.toMatch(/univer\.ai|univer\.work|licenseKey|license:|univerjs-pro|fetch\(|XMLHttpRequest|collaboration/i);
    }
  });
  it("does not reach into the Site Planner (that would make a shared chunk on the Site route — measured)", () => {
    expect(read("src/workspaces/model/components/UniverSheet.jsx")).not.toMatch(/site-planner/);
  });
});

describe("the old grid keeps working exactly as before", () => {
  const app = read("src/workspaces/model/ModelApp.jsx");
  it("SheetView.jsx and sheetModel.js are untouched by the spike", () => {
    // They must not mention Univer at all: the only touch to the existing grid is the switch in ModelApp / FileMenu.
    expect(read("src/workspaces/model/components/SheetView.jsx")).not.toMatch(/univer/i);
    expect(read("src/workspaces/model/lib/sheetModel.js")).not.toMatch(/univer/i);
  });
  it("the four window-level listeners (undo chords, Excel chords, Alt key-tips, clipboard) stand down while Univer owns the keyboard", () => {
    expect(app).toMatch(/const gridKeysOn = isActive && !univerOn;/);
    expect((app.match(/if \(!gridKeysOn\) return undefined;/g) || []).length).toBe(4);
    expect(app).not.toMatch(/if \(!isActive\) return undefined;/);
  });
  it("edits come back through the ONE commit path, so persistence / file mode / org workbooks are unchanged", () => {
    expect(app).toMatch(/onChange=\{\(next\) => \{ commit\(\(\) => next\);/);
  });
});

describe("the theme is built from Planyr's tokens", () => {
  it("builds a 50..900 scale around the accent and never throws on a bad token", () => {
    const s = scaleFrom("#3D6FD1");
    expect(s[500]).toBe("#3D6FD1");
    expect(Object.keys(s)).toEqual(["50", "100", "200", "300", "400", "500", "600", "700", "800", "900"]);
    expect(scaleFrom("not a colour")).toBeNull();
    const base = { primary: { 500: "#000000" }, gray: { 0: "#fff", 200: "#eee", 900: "#111" } };
    const t = buildUniverTheme(base, { accent: "#3D6FD1", border: "#D7DDE5", surface: "#FFFFFF", text: "#1B1E26" });
    expect(t.primary[500]).toBe("#3D6FD1");
    expect(t.gray[200]).toBe("#D7DDE5");
    expect(t.gray[900]).toBe("#1B1E26");
    expect(base.primary[500], "the base theme must not be mutated").toBe("#000000");
    expect(buildUniverTheme(base, { accent: "garbage" }).primary[500]).toBe("#000000");
  });
});
