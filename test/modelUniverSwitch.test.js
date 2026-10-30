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
    // The Excel-keys plugin (NEW-1) is part of the same lazy chunk: UniverSheet.jsx is its only importer (asserted below).
    expect(importers).toEqual([
      "src/workspaces/model/components/UniverSheet.jsx",
      "src/workspaces/model/lib/univerExcelKeys/actions.js",
      "src/workspaces/model/lib/univerExcelKeys/index.js",
    ]);
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

  // NEW-2: Univer's scale keeps its direction in dark mode (0 lightest … 900 darkest; its dark classes pick the other end), so
  // writing the dark surface into gray.0 and the light text into gray.900 made every dark label dark-on-dark.
  const dark = { accent: "#3D6FD1", border: "#262A33", surface: "#1D2027", text: "#E8EBF0" };
  const light = { accent: "#3D6FD1", border: "#D7DDE5", surface: "#FFFFFF", text: "#1B1E26" };
  const base = { primary: { 500: "#000" }, gray: { 0: "#FFFFFF", 50: "#F9FAFB", 200: "#E5E7EB", 600: "#4B5563", 700: "#374151", 800: "#1F2124", 900: "#111827" } };
  it("light theme: surface in gray.0, text in gray.900, the hairline in gray.200", () => {
    const t = buildUniverTheme(base, light);
    expect([t.gray[0], t.gray[900], t.gray[200]]).toEqual(["#FFFFFF", "#1B1E26", "#D7DDE5"]);
  });
  it("dark theme: LIGHT text in gray.0 (what dark labels and icons use), the dark surface in gray.800 / 900, never the other way round", () => {
    const t = buildUniverTheme(base, dark, { dark: true });
    expect(t.gray[0]).toBe("#E8EBF0");
    expect(t.gray[800]).toBe("#1D2027");
    expect(t.gray[900]).toBe("#1D2027");
    const lightness = (h) => parseInt(h.slice(1, 3), 16);
    expect(lightness(t.gray[0]), "gray.0 is text in dark: must be light").toBeGreaterThan(200);
    expect(lightness(t.gray[800]), "gray.800 is the surface in dark: must be dark").toBeLessThan(60);
    expect(lightness(t.gray[700]) > lightness(t.gray[800]) && lightness(t.gray[600]) > lightness(t.gray[700]), "hover steps climb away from the surface").toBe(true);
  });
  it("dark theme: the hairline and header tint are written PRE-INVERTED so Univer's canvas inversion lands them on the token", () => {
    // Univer paints the canvas through out_i = in_i − 0.667·(r+g+b) + 1 (normalised) in dark mode; apply it to what we wrote.
    const univerInvert = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); const s = c[0] + c[1] + c[2]; return c.map((v) => Math.round(Math.min(1, Math.max(0, v - 0.667 * s + 1)) * 255)); };
    const t = buildUniverTheme(base, dark, { dark: true });
    const got = univerInvert(t.gray[200]);
    const want = [0x26, 0x2A, 0x33];
    got.forEach((v, i) => expect(Math.abs(v - want[i]), `channel ${i}`).toBeLessThanOrEqual(2));
  });
  it("a bad token in dark leaves the base theme's step alone (never a blank colour)", () => {
    const t = buildUniverTheme(base, { ...dark, surface: "nope", text: "" }, { dark: true });
    expect(t.gray[0]).toBe("#FFFFFF");
    expect(t.gray[800]).toBe("#1F2124");
  });
  it("UniverSheet rebuilds the theme from the live tokens on every light/dark flip (a theme built once at mount goes stale)", () => {
    const src = read("src/workspaces/model/components/UniverSheet.jsx");
    expect(src).toMatch(/univerAPI\.setTheme\(buildUniverTheme\(defaultTheme, readTokens\(\), \{ dark \}\)\)/);
    expect(src).toMatch(/new MutationObserver\(applyTheme\)/);
    expect(src).toMatch(/addEventListener\("change", applyTheme\)/);
  });
});
