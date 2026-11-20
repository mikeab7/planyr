import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// NEW-1 (2026-11-03) — "scrolling on the schedule module is kinda shakey vertically".
// The browser half is ui-audit/verify-schedule-scroll-smooth.mjs (real wheel input, frame by frame). This is the
// CI-runnable half: the row-window arithmetic that decides which rows are mounted, and source guards on the two
// other causes (a blocking wheel listener; a rAF-released lock in the Split scroll sync).
const SRC = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");

const grab = (name) => { const s = SRC.indexOf(`const ${name} = `); expect(s, `${name} not found`).toBeGreaterThan(-1); const e = SRC.indexOf("\n});", s); const e2 = SRC.indexOf(";\n", s); return SRC.slice(s, e > -1 && e < SRC.indexOf("\nconst ", s + 5) ? e + 4 : e2 + 2); };
const make = (ROW_H) => new Function("ROW_H", `${grab("WIN_CHUNK").split("\n")[0].replace(/^const WIN_CHUNK = 8, WIN_OVER = 12;.*/, "const WIN_CHUNK = 8, WIN_OVER = 12;")}\n${grab("rowWindowTop")}\n${grab("rowWindow")}\nreturn { rowWindowTop, rowWindow, WIN_CHUNK, WIN_OVER };`)(ROW_H);

describe("row window arithmetic", () => {
  for (const ROW_H of [20, 24, 34]) {
    const { rowWindowTop, rowWindow, WIN_CHUNK, WIN_OVER } = make(ROW_H);
    it(`ROW_H ${ROW_H}: every scroll position has its visible rows mounted, with a full overscan each side`, () => {
      const total = 700, viewH = 869;
      for (let st = 0; st <= total * ROW_H; st += 7) {
        const { startIdx, endIdx } = rowWindow(rowWindowTop(st), viewH, total);
        const firstVisible = Math.floor(st / ROW_H), lastVisible = Math.min(total - 1, Math.ceil((st + viewH) / ROW_H));
        expect(startIdx).toBeLessThanOrEqual(Math.max(0, firstVisible - WIN_OVER + 1));
        expect(endIdx - 1).toBeGreaterThanOrEqual(Math.min(total - 1, lastVisible + WIN_OVER - WIN_CHUNK));
        expect(startIdx).toBeGreaterThanOrEqual(0);
        expect(endIdx).toBeLessThanOrEqual(total);
      }
    });
    it(`ROW_H ${ROW_H}: the window only moves once per ${WIN_CHUNK} rows of travel (not on every row boundary)`, () => {
      let changes = 0, prev = rowWindowTop(0);
      for (let st = 0; st <= 100 * ROW_H; st += 1) { const w = rowWindowTop(st); if (w !== prev) { changes++; prev = w; } }
      expect(changes).toBe(Math.floor(100 / WIN_CHUNK));
    });
  }
});

describe("source guards", () => {
  it("the window-level wheel listener is registered only while Ctrl/Cmd is down", () => {
    expect(SRC).not.toMatch(/useEffect\(\(\) => \{\s*const onWheel = e => \{\s*if \(!e\.ctrlKey && !e\.metaKey\) return;[\s\S]{0,900}?window\.addEventListener\("wheel", onWheel, \{passive: false\}\);\s*return \(\) => \{/);
    expect(SRC).toMatch(/const arm = on =>/);
    expect(SRC).toMatch(/window\.addEventListener\("keydown", onKey, true\)/);
  });
  it("the Split scroll sync recognises its own echo by value and has no rAF-released lock", () => {
    const s = SRC.indexOf("function DesktopSplitView"); const body = SRC.slice(s, s + 3500);
    expect(body).toMatch(/echo\.current\[src\] === st/);
    expect(body).not.toMatch(/lock\.current/);
  });
  it("both panes window by chunk, not by the raw scrollTop", () => {
    expect(SRC).not.toMatch(/const \[scrollTop, setScrollTop\] = useState\(0\);\s*\n\s*const localRef = useRef\(null\);\s*\n\s*const ref = scrollRef \|\| localRef;/);
    expect((SRC.match(/rowWindow\(winTop,/g) || []).length).toBe(2);
  });
});
