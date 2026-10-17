/* B865 — password-manager autofill suppression on inline grid editors.
 *
 * The shared NO_AUTOFILL attribute bag (src/shared/ui/noAutofill.js) is spread onto every
 * inline cell / free-text editor so 1Password / LastPass / Bitwarden / Dashlane don't inject
 * an inline icon + identity-autofill card over a scheduling-grid cell. This test:
 *   1. pins the exact attribute set (a wrong/missing key would silently un-suppress an extension),
 *   2. guards the Sequence iframe's byte-identical inline copy against drift (it can't import
 *      the module — it runs in-browser Babel with no bundler),
 *   3. enforces completeness: every non-immune <input> editor in the iframe carries the spread,
 *      so a future grid editor added without it fails CI instead of shipping the bug again,
 *   4. asserts the auth/login/signup forms are deliberately EXCLUDED (real autofill must work). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { NO_AUTOFILL, autofillToken, isIosLike, contactField, CONTACT_TOKENS } from "../src/shared/ui/noAutofill.js";

const here = dirname(fileURLToPath(import.meta.url));
const SEQ = resolve(here, "../public/sequence/index.html");
const AUTH = resolve(here, "../src/workspaces/site-planner/components/AuthPanel.jsx");
const seq = readFileSync(SEQ, "utf8");
const auth = readFileSync(AUTH, "utf8");

describe("NO_AUTOFILL shared attribute bag", () => {
  it("carries exactly the four extension opt-outs + autocomplete off", () => {
    expect(NO_AUTOFILL).toEqual({
      autoComplete: "off", // node/desktop; iOS gets "x-planyr" (B2088384) — see the token tests below
      "data-1p-ignore": true,
      "data-lpignore": "true",
      "data-bwignore": true,
      "data-form-type": "other",
    });
  });

  it("is a plain, JSX-spreadable attribute object (no functions/undefined)", () => {
    for (const v of Object.values(NO_AUTOFILL)) {
      expect(["string", "boolean"]).toContain(typeof v);
    }
  });
});

describe("autofillToken — NEW-1: the token Chrome honours, except on iOS", () => {
  const chromeWin = { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130", platform: "Win32", maxTouchPoints: 0 };
  const iphone = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari", platform: "iPhone", maxTouchPoints: 5 };
  const ipadDesktopUa = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari", platform: "MacIntel", maxTouchPoints: 5 };
  const mac = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome", platform: "MacIntel", maxTouchPoints: 0 };
  it("is genuine off on desktop Chrome / Mac (an unknown token leaves Chrome's saved-entry list on)", () => {
    expect(autofillToken(chromeWin)).toBe("off");
    expect(autofillToken(mac)).toBe("off");
  });
  it("is the non-standard token on iPhone and iPadOS-as-Mac (iOS ignores off)", () => {
    expect(autofillToken(iphone)).toBe("x-planyr");
    expect(autofillToken(ipadDesktopUa)).toBe("x-planyr");
    expect(isIosLike(undefined)).toBe(false);
  });
});

describe("Sequence iframe inline copy (drift guard)", () => {
  it("defines a NO_AUTOFILL constant identical to the shared module", () => {
    const m = seq.match(/const NO_AUTOFILL = \{([\s\S]*?)\};/);
    expect(m, "iframe must define `const NO_AUTOFILL = { … };`").toBeTruthy();
    const body = m[1];
    // Every module key/value must appear verbatim in the iframe object literal.
    const expectedLines = {
      autoComplete: 'autoComplete: (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) ? "x-planyr" : "off"',
      "data-1p-ignore": '"data-1p-ignore": true',
      "data-lpignore": '"data-lpignore": "true"',
      "data-bwignore": '"data-bwignore": true',
      "data-form-type": '"data-form-type": "other"',
    };
    for (const key of Object.keys(NO_AUTOFILL)) {
      expect(body, `iframe NO_AUTOFILL missing/altered: ${key}`).toContain(expectedLines[key]);
    }
    // …and no extra keys crept into the iframe copy.
    const keyCount = (body.match(/^\s*(?:"[^"]+"|[A-Za-z]+)\s*:/gm) || []).length;
    expect(keyCount).toBe(Object.keys(NO_AUTOFILL).length);
  });
});

describe("Sequence iframe editor completeness", () => {
  // An <input> that a password manager would target: free-text / value-bound editors.
  // Immune types (checkbox, radio, range, file, number, color, native date) never get the
  // identity-autofill card, so they're excluded — matching the fix's scope.
  const IMMUNE = /type=("?)(checkbox|radio|range|file|number|color|date)\1/;
  it("every non-immune <input> editor carries {...NO_AUTOFILL}", () => {
    const offenders = seq
      .split("\n")
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => /<input\s/.test(line))
      .filter(({ line }) => !line.trim().startsWith("//"))   // skip code comments
      .filter(({ line }) => !IMMUNE.test(line))
      .filter(({ line }) => !line.includes("NO_AUTOFILL") && !line.includes("contactField("));
    expect(
      offenders.map((o) => `L${o.n}: ${o.line.trim().slice(0, 90)}`),
      "these iframe editors are missing the {...NO_AUTOFILL} spread",
    ).toEqual([]);
  });
});

describe("auth forms stay excluded (real autofill must keep working)", () => {
  it("AuthPanel does NOT suppress autofill", () => {
    expect(auth).not.toContain("NO_AUTOFILL");
    // Sign-in / sign-up fields keep their semantic autocomplete tokens so 1Password fills them.
    expect(auth).toContain('autoComplete="email"');
    expect(auth).toContain('autoComplete="new-password"');
    expect(auth).toContain("current-password"); // present in the sign-in password field's ternary
  });
});

describe("B2308848 amended — contact / address fields keep browser suggestions, everything else stays off", () => {
  const read = (rel) => readFileSync(resolve(here, "..", rel), "utf8");
  it("contactField stamps the standard token and the app-wide opt-in marker; an unknown kind throws (default stays off)", () => {
    expect(contactField("email")).toEqual({ autoComplete: "email", "data-contact-field": "" });
    expect(contactField("street").autoComplete).toBe("street-address");
    expect(contactField("name").autoComplete).toBe("name");
    expect(() => contactField("dimension")).toThrow();
  });
  it("only real WHATWG contact tokens are in the table (nothing 'off' / non-standard)", () => {
    for (const t of Object.values(CONTACT_TOKENS)) expect(t).toMatch(/^(name|email|tel|organization|street-address|address-level[12]|postal-code)$/);
  });
  it("the iframe's inline contactField copy matches the shared table", () => {
    const m = seq.match(/const CONTACT_TOKENS = \{([^}]*)\};/);
    expect(m, "iframe must define CONTACT_TOKENS").toBeTruthy();
    for (const [k, v] of Object.entries(CONTACT_TOKENS).filter(([k]) => ["name", "email", "phone", "company"].includes(k))) {
      expect(m[1]).toContain(`${k}: "${v}"`);
    }
    expect(seq).toContain('const contactField = (kind) => ({ autoComplete: CONTACT_TOKENS[kind], "data-contact-field": "" });');
  });
  it("the contacts editor and the address / invite fields opt in; filters and Planyr's own search stay off", () => {
    expect(seq).toMatch(/contactField\("name"\)\} autoFocus value=\{newName\}/);
    expect(seq).toMatch(/contactField\("email"\)\} value=\{newEmail\}/);
    expect(seq).toMatch(/contactField\("name"\)\} autoFocus value=\{editName\}|contactField\("name"\)\} value=\{editName\}/);
    expect(read("src/workspaces/site-planner/components/SetLocationDialog.jsx")).toContain('{...contactField("street")}');
    expect(read("src/workspaces/site-planner/components/TeamPanel.jsx")).toContain('{...contactField("email")}');
    expect(read("src/workspaces/site-planner/MapFinder.jsx")).toMatch(/<input \{\.\.\.NO_AUTOFILL\} value=\{nameFilter\}/);
    expect(read("src/workspaces/site-planner/components/ParcelsPanel.jsx")).toMatch(/\{\.\.\.NO_AUTOFILL\} value=\{filter\}/);
    // Planyr's own live-suggestion boxes keep "off": a second (Chrome) dropdown would collide with theirs
    expect(read("src/workspaces/site-planner/components/PlaceSearchField.jsx")).toContain('autoComplete="off"');
    expect(read("src/shared/comps/components/PartyNameField.jsx")).toContain('autoComplete="off"');
  });
});
