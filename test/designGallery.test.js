/* The /design gallery's STATUS_PREVIEW is a deliberate literal mirror of statusTokens.js — NOT an
 * import — because importing the real module from this lazy route hoisted it into a new shared
 * chunk pulled onto the Site route's plain load (bundle.siteRouteAllowlist went red). Same trap as
 * Notes mirroring controls.jsx's RADIUS scale (test/notesModule.test.js). This guards the mirror
 * can't silently drift, and that the real import doesn't creep back in. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { STATUS_TOKENS } from "../src/shared/ui/statusTokens.js";
import { SPACE, FONT_SIZE, CONTROL_H } from "../src/shared/ui/designTokens.js";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GALLERY = join(REPO, "src", "workspaces", "design-gallery", "DesignGallery.jsx");
const src = readFileSync(GALLERY, "utf8");

describe("DesignGallery's STATUS_PREVIEW mirror", () => {
  it("does not import statusTokens.js — that hoists a new shared chunk onto the Site route", () => {
    expect(src).not.toMatch(/^import.*shared\/ui\/statusTokens/m);
  });

  it("agrees with statusTokens.js on color/glyph/dim for every status key", () => {
    const m = src.match(/const STATUS_PREVIEW = \{([\s\S]*?)\n\};/);
    expect(m, "DesignGallery.jsx no longer declares STATUS_PREVIEW in the expected shape").toBeTruthy();
    const body = m[1];
    for (const [key, tok] of Object.entries(STATUS_TOKENS)) {
      const row = body.match(new RegExp(`${key}:\\s*\\{\\s*color:\\s*"([^"]+)",\\s*glyph:\\s*"([^"]*)",\\s*dim:\\s*(true|false)`));
      expect(row, `${key} missing or in an unrecognised shape in STATUS_PREVIEW`).toBeTruthy();
      const [, color, glyph, dim] = row;
      expect(color, `${key} color drifted from statusTokens.js`).toBe(tok.color);
      expect(glyph, `${key} glyph drifted from statusTokens.js`).toBe(tok.glyph);
      expect(dim === "true", `${key} dim drifted from statusTokens.js`).toBe(tok.dim);
    }
  });
});

describe("DesignGallery's FONT_SIZE/SPACE/CONTROL_H mirror", () => {
  it("does not import designTokens.js — that hoists a new shared chunk onto the Site route", () => {
    expect(src).not.toMatch(/^import.*shared\/ui\/designTokens/m);
  });

  it("agrees with designTokens.js on every scale value", () => {
    for (const [constName, real] of [["FONT_SIZE", FONT_SIZE], ["SPACE", SPACE], ["CONTROL_H", CONTROL_H]]) {
      const m = src.match(new RegExp(`const ${constName} = \\{([^}]*)\\}`));
      expect(m, `DesignGallery.jsx no longer declares ${constName} in the expected shape`).toBeTruthy();
      for (const [key, value] of Object.entries(real)) {
        const row = m[1].match(new RegExp(`\\b${key}:\\s*(-?\\d+(?:\\.\\d+)?)`));
        expect(row, `${constName}.${key} missing from DesignGallery.jsx's mirror`).toBeTruthy();
        expect(parseFloat(row[1]), `${constName}.${key} drifted from designTokens.js`).toBe(value);
      }
    }
  });
});
