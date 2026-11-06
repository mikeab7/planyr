import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { installModifierForward } from "../src/workspaces/scheduler/lib/modifierForward.js";

// NEW-1 (2026-11-06) — "i want ctrl zoom to always work if im hovering over the schedule".
// The browser half is ui-audit/verify-schedule-ctrl-zoom-hover.mjs (the real Schedule inside a parent page, focus parked
// in a parent input, red on the pre-fix behaviour). This is the CI-runnable half: the shell's forwarder, and source guards
// on the two ends of the bridge so neither can be quietly removed.
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const FRAME = read("../public/sequence/index.html");
const SCHEDULER = read("../src/workspaces/scheduler/Scheduler.jsx");

function fakeWindow() {
  const l = {};
  return {
    addEventListener: (t, fn) => { (l[t] ||= []).push(fn); },
    removeEventListener: (t, fn) => { l[t] = (l[t] || []).filter((f) => f !== fn); },
    fire: (t, e = {}) => (l[t] || []).slice().forEach((fn) => fn(e)),
    count: () => Object.values(l).reduce((n, a) => n + a.length, 0),
  };
}

describe("installModifierForward (the shell → Schedule frame bridge)", () => {
  const setup = () => {
    const win = fakeWindow(), sent = [];
    const frame = { postMessage: (m, o) => sent.push([m, o]) };
    const off = installModifierForward(win, () => frame, "https://planyr.io");
    return { win, sent, off };
  };
  it("forwards Ctrl down and up, to the exact origin, once per CHANGE", () => {
    const { win, sent } = setup();
    win.fire("keydown", { ctrlKey: true }); win.fire("keydown", { ctrlKey: true }); win.fire("keydown", { ctrlKey: true });
    win.fire("keyup", { ctrlKey: false });
    expect(sent).toEqual([
      [{ source: "planar-shell", type: "planar:modifier-keys", ctrl: true }, "https://planyr.io"],
      [{ source: "planar-shell", type: "planar:modifier-keys", ctrl: false }, "https://planyr.io"],
    ]);
  });
  it("treats Cmd (metaKey) the same as Ctrl", () => {
    const { win, sent } = setup();
    win.fire("keydown", { metaKey: true });
    expect(sent.map((s) => s[0].ctrl)).toEqual([true]);
  });
  it("a window blur releases it (a keyup is never delivered after a blur)", () => {
    const { win, sent } = setup();
    win.fire("keydown", { ctrlKey: true }); win.fire("blur");
    expect(sent.map((s) => s[0].ctrl)).toEqual([true, false]);
  });
  it("a plain key sends nothing, and a missing / throwing frame never throws", () => {
    const win = fakeWindow(); const sent = [];
    installModifierForward(win, () => ({ postMessage: () => { throw new Error("detached"); } }), "x");
    expect(() => { win.fire("keydown", { ctrlKey: true }); }).not.toThrow();
    const w2 = fakeWindow(); installModifierForward(w2, () => null, "x");
    expect(() => { w2.fire("keydown", { ctrlKey: true }); w2.fire("blur"); }).not.toThrow();
    const { win: w3, sent: s3 } = setup(); w3.fire("keydown", { key: "a" });
    expect(s3).toEqual([]); expect(sent).toEqual([]);
  });
  it("uninstalls cleanly", () => {
    const { win, off } = setup();
    expect(win.count()).toBe(3); off(); expect(win.count()).toBe(0);
  });
});

describe("source guards", () => {
  it("the Schedule frame arms its Ctrl+wheel zoom from pointer events and the shell message, not only its own keys", () => {
    expect(FRAME).toMatch(/window\.addEventListener\("pointermove", onPointer, \{capture: true, passive: true\}\)/);
    expect(FRAME).toMatch(/window\.addEventListener\("message", onShellKeys\)/);
    expect(FRAME).toMatch(/m\.type !== "planar:modifier-keys"/);
    expect(FRAME).toMatch(/window\.addEventListener\("keydown", onKey, true\)/);
  });
  it("…and still keeps NO blocking wheel listener at rest (a permanent one adds ~15 ms to every wheel→scroll — measured)", () => {
    const i = FRAME.indexOf("const onShellKeys"); expect(i).toBeGreaterThan(-1);
    expect((FRAME.match(/addEventListener\("wheel", onWheel, \{passive: false\}\)/g) || []).length).toBe(1);
    expect(FRAME.slice(i - 900, i)).toMatch(/if \(on\) window\.addEventListener\("wheel", onWheel, \{passive: false\}\);/);
  });
  it("the shell installs the forwarder against the iframe", () => {
    expect(SCHEDULER).toMatch(/import \{ installModifierForward \} from "\.\/lib\/modifierForward\.js"/);
    expect(SCHEDULER).toMatch(/installModifierForward\(window, \(\) => iframeRef\.current\?\.contentWindow, window\.location\.origin\)/);
  });
});
