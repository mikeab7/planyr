/* NEW-1 (B2587264) — hovering the Spreadsheet tab warms the Univer chunk too, but only where it will be used. */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { forgetRetiredGridKeys, RETIRED_GRID_KEYS } from "../src/workspaces/model/lib/univerWarm.js";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const store = (obj) => ({ getItem: (k) => (k in obj ? obj[k] : null), removeItem: (k) => { delete obj[k]; } });

describe("univerWarm", () => {
  it("drops the two retired grid-switch keys (and nothing else), silently, on any device", () => {
    const obj = { "planyr:model:univerGrid": "1", "planyr:model:regularGrid": "1", "planyr:other": "keep" };
    expect(forgetRetiredGridKeys(store(obj))).toBe(true);
    for (const k of RETIRED_GRID_KEYS) expect(k in obj).toBe(false);
    expect(obj["planyr:other"]).toBe("keep");
    expect(forgetRetiredGridKeys(store(obj))).toBe(false);
    // a blocked or missing store has nothing to forget and never throws
    expect(forgetRetiredGridKeys({ getItem: () => { throw new Error("blocked"); } })).toBe(false);
    expect(forgetRetiredGridKeys(null)).toBe(false);
  });
  it("warmUniver starts the load on every device, and drops the retired switch keys as it goes", async () => {
    vi.resetModules();
    const m = await import("../src/workspaces/model/lib/univerWarm.js");
    const obj = { "planyr:model:univerGrid": "0", "planyr:model:regularGrid": "1" };
    const p = m.warmUniver({ storage: store(obj) });
    expect(p).not.toBeNull();
    expect(Object.keys(obj)).toEqual([]);
    p.catch(() => {});
  });
  it("never imports the admin check (the always-loaded shell reaches this file)", () => {
    expect(read("src/workspaces/model/lib/univerWarm.js")).not.toMatch(/useIsAdmin|supabase/);
  });
  it("imports the SAME specifier ModelApp's React.lazy uses, so the browser makes one request", () => {
    expect(read("src/workspaces/model/lib/univerWarm.js")).toMatch(/import\("\.\.\/components\/UniverSheet\.jsx"\)/);
    expect(read("src/workspaces/model/ModelApp.jsx")).toMatch(/lazy\(\(\) => import\("\.\/components\/UniverSheet\.jsx"\)\)/);
  });
});

describe("a cold open starts the chunk without waiting for the admin check", () => {
  it("ModelApp calls warmUniver() at module scope (the gate lives inside it) and never imports UniverSheet statically", () => {
    const app = read("src/workspaces/model/ModelApp.jsx");
    expect(app).toMatch(/^warmUniver\(\);$/m);
    expect(app).toMatch(/import \{ warmUniver \} from "\.\/lib\/univerWarm\.js"/);
    expect(app).not.toMatch(/^import .*UniverSheet/m);
  });
});

describe("modulePrefetch warms Univer with the Spreadsheet tab — and only with it", () => {
  const src = read("src/app/modulePrefetch.js");
  it("prefetchModule('model') also schedules the Univer warm, idle-time, through a lazy import (the shell never statically imports it)", () => {
    expect(src).toMatch(/if \(id === "model"\) warmUniverGrid\(\);/);
    expect(src).toMatch(/import\("\.\.\/workspaces\/model\/lib\/univerWarm\.js"\)/);
    expect(src).toMatch(/requestIdleCallback/);
    expect(src).not.toMatch(/^import .*univer/im);
    expect(src).not.toMatch(/import\("[^"]*UniverSheet/);
  });
});
