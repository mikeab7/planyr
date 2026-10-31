/* NEW-1 (B2587264) — hovering the Spreadsheet tab warms the Univer chunk too, but only where it will be used. */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { UNIVER_SWITCH_KEY } from "../src/workspaces/model/lib/univerSwitch.js";
import { UNIVER_DEVICE_KEY, univerWantedHere } from "../src/workspaces/model/lib/univerWarm.js";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const store = (v) => ({ getItem: (k) => (k === UNIVER_SWITCH_KEY ? v : null) });

describe("univerWarm", () => {
  it("repeats the switch's storage key exactly (univerSwitch.js cannot be imported by the always-loaded shell)", () => {
    expect(UNIVER_DEVICE_KEY).toBe(UNIVER_SWITCH_KEY);
  });
  it("is wanted only where the device switch is on; a blocked store reads as not wanted", () => {
    expect(univerWantedHere(store("1"))).toBe(true);
    expect(univerWantedHere(store(null))).toBe(false);
    expect(univerWantedHere(store("0"))).toBe(false);
    expect(univerWantedHere({ getItem: () => { throw new Error("blocked"); } })).toBe(false);
    expect(univerWantedHere(null)).toBe(false);
  });
  it("warmUniver does nothing (returns null, imports nothing) when the device will not use the grid", async () => {
    vi.resetModules();
    const m = await import("../src/workspaces/model/lib/univerWarm.js");
    expect(m.warmUniver({ storage: store(null) })).toBeNull();
  });
  it("imports the SAME specifier ModelApp's React.lazy uses, so the browser makes one request", () => {
    expect(read("src/workspaces/model/lib/univerWarm.js")).toMatch(/import\("\.\.\/components\/UniverSheet\.jsx"\)/);
    expect(read("src/workspaces/model/ModelApp.jsx")).toMatch(/lazy\(\(\) => import\("\.\/components\/UniverSheet\.jsx"\)\)/);
  });
});

describe("a cold open on a Univer device starts the chunk without waiting for the admin check", () => {
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
