/* NEW-1 (2026-11-08) — the sign-in panel closes only when the person asked.
 * Pure rules (shared/auth/panelDismiss.js) + a source guard that lists EVERY path that can close or unmount the panel, so
 * a new one cannot appear without being named here and judged "asked" or "not asked". */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  escapeMayClose, backdropMayClose, saveDraft, readDraft, clearDraft, DRAFT_KEY, DRAFT_MAX_AGE_MS,
} from "../src/shared/auth/panelDismiss.js";

const el = (over = {}) => ({ tagName: "INPUT", closest: () => null, ...over });
const panelOf = (...inside) => ({ contains: (n) => inside.includes(n) });

describe("escapeMayClose", () => {
  it("closes for the person's own Escape from inside the panel", () => {
    const t = el(); expect(escapeMayClose({ target: t, panel: panelOf(t) })).toBe(true);
  });
  it("does not close when something already handled the key (password manager menu, autofill list)", () => {
    const t = el(); expect(escapeMayClose({ defaultPrevented: true, target: t, panel: panelOf(t) })).toBe(false);
  });
  it("does not close during an IME composition", () => {
    const t = el(); expect(escapeMayClose({ isComposing: true, target: t, panel: panelOf(t) })).toBe(false);
  });
  it("does not close when focus is outside the panel", () => {
    const t = el(); expect(escapeMayClose({ target: t, panel: panelOf() })).toBe(false);
    expect(escapeMayClose({ target: null, panel: panelOf(t) })).toBe(false);
    expect(escapeMayClose({ target: t, panel: null })).toBe(false);
  });
  it("does not close from inside an open dropdown or a native select", () => {
    const open = el();
    const t = el({ closest: () => open });
    expect(escapeMayClose({ target: t, panel: panelOf(t, open) })).toBe(false);
    const sel = el({ tagName: "SELECT" });
    expect(escapeMayClose({ target: sel, panel: panelOf(sel) })).toBe(false);
  });
});

describe("backdropMayClose", () => {
  const b = {};
  it("needs the press AND the click on the backdrop itself", () => {
    expect(backdropMayClose({ pressedOnBackdrop: true, target: b, currentTarget: b })).toBe(true);
    expect(backdropMayClose({ pressedOnBackdrop: false, target: b, currentTarget: b })).toBe(false);     // press began in the card / an injected click
    expect(backdropMayClose({ pressedOnBackdrop: true, target: {}, currentTarget: b })).toBe(false);
    expect(backdropMayClose({})).toBe(false);
  });
});

describe("draft: email + tab only, fresh only, never a password", () => {
  const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }; };
  it("round-trips the email and the tab", () => {
    const s = mem(); expect(saveDraft(s, { email: " a@b.co ", mode: "signup", now: 1000 })).toBe(true);
    expect(readDraft(s, 2000)).toEqual({ email: "a@b.co", mode: "signup" });
  });
  it("stores nothing but email, tab and a timestamp", () => {
    const s = mem(); saveDraft(s, { email: "a@b.co", mode: "signin", password: "hunter2", pw: "hunter2", now: 5 });
    expect(Object.keys(JSON.parse(s._m.get(DRAFT_KEY))).sort()).toEqual(["at", "email", "mode"]);
    expect(s._m.get(DRAFT_KEY)).not.toContain("hunter2");
  });
  it("refuses a recovery / unknown tab, a stale draft, a malformed one, and a broken storage", () => {
    const s = mem();
    expect(saveDraft(s, { email: "a@b.co", mode: "recovery" })).toBe(false);
    saveDraft(s, { email: "a@b.co", mode: "signin", now: 1000 });
    expect(readDraft(s, 1000 + DRAFT_MAX_AGE_MS + 1)).toBeNull();
    s.setItem(DRAFT_KEY, "{not json"); expect(readDraft(s)).toBeNull();
    s.setItem(DRAFT_KEY, JSON.stringify({ email: "x", mode: "admin", at: Date.now() })); expect(readDraft(s)).toBeNull();
    const bad = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
    expect(saveDraft(bad, { email: "a", mode: "signin" })).toBe(false); expect(readDraft(bad)).toBeNull(); expect(() => clearDraft(bad)).not.toThrow();
    expect(readDraft(null)).toBeNull();
  });
  it("clearDraft forgets it", () => {
    const s = mem(); saveDraft(s, { email: "a@b.co", mode: "signin" }); clearDraft(s); expect(readDraft(s)).toBeNull();
  });
});

describe("every path that can close or unmount the sign-in panel is named", () => {
  const panel = readFileSync(new URL("../src/workspaces/site-planner/components/AuthPanel.jsx", import.meta.url), "utf8");
  const shell = readFileSync(new URL("../src/app/Shell.jsx", import.meta.url), "utf8");

  it("Shell: authOpen goes false in exactly two places — the panel's own close, and the dead-link-notice effect for a signed-in person (+ a restored panel for a live session)", () => {
    const sites = shell.split("\n").filter((l) => /setAuthOpen\(false\)/.test(l));
    expect(sites.length).toBe(3);
    expect(sites.some((l) => /onClose=\{\(\) =>/.test(l))).toBe(true);                       // the panel's close (asked)
    expect(sites.some((l) => /user && authNotice && !recovery/.test(l))).toBe(true);          // signed in: nothing to fill in
    expect(sites.some((l) => /restoredRef\.current\) \{ restoredRef\.current = false; setAuthOpen\(false\)/.test(l))).toBe(true); // restored panel, session turned out live
  });

  it("the panel has NO document-level Escape listener (the old capture listener beat every menu that wanted the key)", () => {
    expect(panel).not.toMatch(/e\.key === "Escape"[^\n]*onCloseRef\.current\(\)/);
    expect(panel).toMatch(/onKeyDown=\{onCardKeyDown\}/);
    expect(panel).toMatch(/escapeMayClose\(/);
  });

  it("the backdrop never closes on a bare click: it asks backdropMayClose with the recorded press", () => {
    expect(panel).not.toMatch(/onClick=\{dismissable \? onClose : undefined\}/);
    expect(panel).toMatch(/onPointerDown=\{onBackdropPointerDown\}/);
    expect(panel).toMatch(/backdropMayClose\(/);
  });

  it("Wrap calls its onClose only from: Close buttons, the card's Escape, the backdrop's press+release", () => {
    const calls = panel.match(/onClose\("[a-z]+"\)|onCloseRef\.current\("[a-z]+"\)/g) || [];
    expect(calls.sort()).toEqual(['onClose("button")', 'onClose("button")', 'onClose("button")', 'onCloseRef.current("backdrop")', 'onCloseRef.current("escape")']);
  });

  it("AuthPanel's own onClose callers are all consequences of what the person did (submit outcome, Sign out instead, the 900 ms after a saved password)", () => {
    const body = panel.slice(panel.indexOf("export default function AuthPanel"));
    const lines = body.split("\n").filter((l) => /\bonClose\b/.test(l) && !/onClose = close|const onClose|^export default function AuthPanel/.test(l));
    for (const l of lines) {
      expect(l).toMatch(/Wrap onClose=\{onClose\}|AccountView|res\.error \? setMsg|outcome === "signed-in"|setTimeout\(onClose, 900\)|recovery-signout/);
    }
  });

  it("the panel forgets its draft on every close it was asked for, and keeps it otherwise", () => {
    expect(panel).toMatch(/closedByPerson\.current = true;\s*clearDraft\(draftStorage\(\)\)/);
    expect(panel).toMatch(/AUTH_EVENT\.PANEL_VANISHED/);
    expect(panel).not.toMatch(/saveDraft\([^)]*(pw|password)/);
  });

  it("the set-new-password view stays non-dismissable (unchanged)", () => {
    expect(panel).toMatch(/title="Set a new password" dismissable=\{false\}/);
    expect(panel).toMatch(/dismissRef\.current && backdropMayClose|dismissRef\.current\) return/);
  });
});
