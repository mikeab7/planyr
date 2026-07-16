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
import { NO_AUTOFILL } from "../src/shared/ui/noAutofill.js";

const here = dirname(fileURLToPath(import.meta.url));
const SEQ = resolve(here, "../public/sequence/index.html");
const AUTH = resolve(here, "../src/workspaces/site-planner/components/AuthPanel.jsx");
const seq = readFileSync(SEQ, "utf8");
const auth = readFileSync(AUTH, "utf8");

describe("NO_AUTOFILL shared attribute bag", () => {
  it("carries exactly the four extension opt-outs + autocomplete off", () => {
    expect(NO_AUTOFILL).toEqual({
      autoComplete: "off",
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

describe("Sequence iframe inline copy (drift guard)", () => {
  it("defines a NO_AUTOFILL constant identical to the shared module", () => {
    const m = seq.match(/const NO_AUTOFILL = \{([\s\S]*?)\};/);
    expect(m, "iframe must define `const NO_AUTOFILL = { … };`").toBeTruthy();
    const body = m[1];
    // Every module key/value must appear verbatim in the iframe object literal.
    const expectedLines = {
      autoComplete: 'autoComplete: "off"',
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
      .filter(({ line }) => !line.includes("NO_AUTOFILL"));
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
