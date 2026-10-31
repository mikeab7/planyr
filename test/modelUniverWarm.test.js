/* NEW-1 (B2587264) — hovering the Spreadsheet tab warms the Univer chunk too, but only where it will be used. */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REGULAR_GRID_KEY, LEGACY_UNIVER_KEY } from "../src/workspaces/model/lib/gridChoice.js";
import { univerWantedHere } from "../src/workspaces/model/lib/univerWarm.js";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const store = (obj) => ({ getItem: (k) => (k in obj ? obj[k] : null), removeItem: (k) => { delete obj[k]; } });

describe("univerWarm", () => {
  it("is wanted on EVERY device — the Univer grid is the Spreadsheet tab now — except one that asked for the owner's regular-grid hatch", () => {
    expect(univerWantedHere(store({}))).toBe(true);
    expect(univerWantedHere(store({ [REGULAR_GRID_KEY]: "1" }))).toBe(false);
    // the pre-cutover switch no longer decides anything, on or off
    expect(univerWantedHere(store({ [LEGACY_UNIVER_KEY]: "1" }))).toBe(true);
    expect(univerWantedHere(store({ [LEGACY_UNIVER_KEY]: "0" }))).toBe(true);
    // a blocked store reads as 'not asked for the hatch', i.e. warm
    expect(univerWantedHere({ getItem: () => { throw new Error("blocked"); } })).toBe(true);
    expect(univerWantedHere(null)).toBe(true);
  });
  it("warmUniver does nothing (returns null, imports nothing) on a device that asked for the regular grid", async () => {
    vi.resetModules();
    const m = await import("../src/workspaces/model/lib/univerWarm.js");
    expect(m.warmUniver({ storage: store({ [REGULAR_GRID_KEY]: "1" }) })).toBeNull();
  });
  it("warmUniver on an ordinary device starts the load, and drops the retired switch key as it goes", async () => {
    vi.resetModules();
    const m = await import("../src/workspaces/model/lib/univerWarm.js");
    const obj = { [LEGACY_UNIVER_KEY]: "0" };
    const p = m.warmUniver({ storage: store(obj) });
    expect(p).not.toBeNull();
    expect(LEGACY_UNIVER_KEY in obj).toBe(false);
    p.catch(() => {});
  });
  it("never imports the admin check (the always-loaded shell reaches this file)", () => {
    expect(read("src/workspaces/model/lib/univerWarm.js")).not.toMatch(/univerSwitch|useIsAdmin|supabase/);
    expect(read("src/workspaces/model/lib/gridChoice.js")).not.toMatch(/^import /m);
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
