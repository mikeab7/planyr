/* NEW-1 (was B286000) — WHERE THE SMOOTH-ZOOM SWITCH LIVES, guarded in BOTH directions.
 *
 * B1449 shipped the toggle into the PLAN menu. B286000 moved it to the on-canvas View ▾ menu,
 * reasoning that per-device rendering behaviour belongs beside the view toggles — and the owner
 * STILL could not find it ("I don't know where the option went for it"). The corrected rule:
 * View ▾ is a per-DRAWING display menu (dock doors, column grid, dimensions, areas, grid, snap),
 * while smooth zoom follows the DEVICE across every plan and every project. Its one home is
 * Settings → Interface, beside the display theme.
 *
 * ⛔ A ONE-DIRECTION GUARD WOULD ROT. Asserting only "the toggle is in Settings" passes on a build
 * that renders it in BOTH places, which is the likeliest way this regresses (a merge that keeps
 * both sides) and is exactly what the owner ruled out. So the ABSENCE from the View menu and from
 * the plan menu is asserted as hard as the presence, by COUNTING occurrences across every file that
 * could hold one — and the three things the owner said not to change (the storage key, the default,
 * and the disarm on turn-off) are pinned by value, because a relocation that quietly flips the
 * default is a behaviour change wearing a refactor's clothes.
 *
 * Half of this is a SOURCE guard by necessity: which menu a control sits in is a rendering
 * arrangement inside a React component with nothing pure to call. The other half is a real
 * behavioural test of the shared preference module, which is where the decision now lives.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SMOOTH_ZOOM_KEY, SMOOTH_ZOOM_DEFAULT, readSmoothZoom, writeSmoothZoom, subscribeSmoothZoom,
} from "../src/shared/prefs/smoothZoom.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const planner = read("src/workspaces/site-planner/SitePlanner.jsx");
const viewMenu = read("src/workspaces/site-planner/components/ViewMenu.jsx");
const settings = read("src/shared/ui/InterfaceSettings.jsx");
const header = read("src/shared/ui/AppHeader.jsx");
const authPanel = read("src/workspaces/site-planner/components/AuthPanel.jsx");

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the smooth-zoom switch lives in Settings → Interface", () => {
  it("InterfaceSettings renders it, under the data-testid every harness addresses", () => {
    expect(settings).toContain('data-testid="smooth-zoom-toggle"');
    expect(settings).toContain("Smooth zoom");
  });

  it("…beside the display theme, in the SAME component both Settings homes render", () => {
    expect(settings).toContain("ThemePicker");
    // Signed-in (the account Settings panel) and signed-out (the row-1 gear) must render the one
    // component — two copies of an Interface section is how the two homes start disagreeing.
    expect(authPanel).toContain('import InterfaceSettings from "../../../shared/ui/InterfaceSettings.jsx"');
    expect(header).toContain('import InterfaceSettings from "./InterfaceSettings.jsx"');
    expect(stripComments(authPanel)).toContain("<InterfaceSettings />");
    expect(stripComments(header)).toContain("<InterfaceSettings />");
  });
});

describe("…and NOWHERE else", () => {
  it("the View menu no longer renders the toggle, and takes no props for it", () => {
    const body = stripComments(viewMenu);
    expect(body).not.toContain("smooth-zoom-toggle");
    expect(body).not.toContain("Smooth zoom");
    expect(body).not.toContain("onSmoothZoom");
    expect(body).not.toContain("smoothZoom");
  });

  it("the planner passes no smooth-zoom props to ViewMenu", () => {
    expect(stripComments(planner)).not.toContain("onSmoothZoom");
  });

  it("the testid appears exactly ONCE across every surface that could hold a switch", () => {
    // Belt and braces for the both-places merge: count rather than trust any one slice.
    const all = planner + viewMenu + settings + header + authPanel;
    expect(all.match(/data-testid="smooth-zoom-toggle"/g) || []).toHaveLength(1);
  });
});

describe("the relocation changed nothing about what the switch DOES", () => {
  it("the localStorage key keeps its `planarfit:` prefix, so nobody's setting resets", () => {
    expect(SMOOTH_ZOOM_KEY).toBe("planarfit:smoothZoom");
  });

  it("the default is still ON", () => {
    expect(SMOOTH_ZOOM_DEFAULT).toBe(true);
  });

  it("turning it OFF still disarms the live view anchor, in the same commit", () => {
    // Without this a gesture's scaled frame is left on screen with nothing to re-bake it. It now
    // hangs off the SUBSCRIPTION, because the control lives outside the planner.
    expect(planner).toMatch(/subscribeSmoothZoom\(\(on\) => \{\s*\n\s*setSmoothZoom\(on\);\s*\n\s*if \(!on\) disarmViewAnchor\(\);/);
  });

  it("the planner seeds from the shared reader, not from its own localStorage call", () => {
    expect(planner).toContain("const [smoothZoom, setSmoothZoom] = useState(readSmoothZoom);");
    expect(stripComments(planner)).not.toContain('lsGet("smoothZoom"');
    expect(stripComments(planner)).not.toContain('lsSet("smoothZoom"');
  });
});

/* The suite runs in the `node` environment (vitest.config.js — deliberately no jsdom, so the pure
 * suites stay fast), so the two browser globals this module touches are stubbed here. They are
 * small enough to be obviously correct, and stubbing them keeps the module's OWN contract under
 * test rather than a DOM implementation's. */
function installBrowserStubs() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
  };
  globalThis.window = new EventTarget();
}

describe("the shared preference module behaves", () => {
  beforeEach(() => { installBrowserStubs(); });

  it("an absent value is what the default is FOR", () => {
    expect(readSmoothZoom()).toBe(true);
  });

  it("round-trips both ways", () => {
    expect(writeSmoothZoom(false)).toBe(false);
    expect(localStorage.getItem(SMOOTH_ZOOM_KEY)).toBe("0");
    expect(readSmoothZoom()).toBe(false);
    writeSmoothZoom(true);
    expect(readSmoothZoom()).toBe(true);
  });

  it("notifies same-tab subscribers — `storage` never fires in the tab that wrote", () => {
    const seen = [];
    const off = subscribeSmoothZoom((v) => seen.push(v));
    writeSmoothZoom(false);
    writeSmoothZoom(true);
    off();
    writeSmoothZoom(false);
    expect(seen).toEqual([false, true]); // nothing after unsubscribe
  });

  it("notifies on another tab's write too (the native storage event)", () => {
    const seen = [];
    const off = subscribeSmoothZoom((v) => seen.push(v));
    localStorage.setItem(SMOOTH_ZOOM_KEY, "0");
    const ev = new Event("storage"); ev.key = SMOOTH_ZOOM_KEY;
    window.dispatchEvent(ev);
    off();
    expect(seen).toEqual([false]);
  });

  it("a blocked store never breaks the toggle, and never swallows the change", () => {
    const seen = [];
    const off = subscribeSmoothZoom((v) => seen.push(v));
    const spy = vi.spyOn(globalThis.localStorage, "setItem").mockImplementation(() => { throw new Error("QuotaExceeded"); });
    expect(() => writeSmoothZoom(false)).not.toThrow();
    spy.mockRestore();
    off();
    expect(seen).toEqual([false]); // the session still honours it even though it could not persist
  });
});
