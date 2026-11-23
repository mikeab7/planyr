import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sequenceSource } from "./helpers/sequenceSource.js";

// public/sequence/ is served to anyone, signed in or not, and its embedded seed (__PLANAR_DATA__ and
// SEED) is what a brand-new or signed-out visitor loads. It must be synthetic: no real project
// names, no email addresses. (Owner's real Goose Creek schedule once shipped here.)
const html = sequenceSource();
const dataLine = html.split("\n").find((l) => l.startsWith('<script id="planar-data">'));

describe("the public schedule seed carries no real data", () => {
  it("has a planar-data block", () => expect(dataLine).toBeTruthy());
  it("contains no email addresses", () => {
    expect(dataLine.match(/[\w.+-]+@[\w-]+\.[a-z]{2,}/gi) || []).toEqual([]);
  });
  it("uses only 'Sample Project' names", () => {
    const names = [...dataLine.matchAll(/"name":"(Sample Project [A-C])"/g)];
    expect(names.length).toBe(3);
    expect(dataLine).not.toMatch(/Goose Creek|Kilgore|Bee Sand|Grand Port/);
  });
  it("SEED has no Goose Creek project", () => {
    const from = html.indexOf("const SEED = {");
    const seed = html.slice(from, html.indexOf("\n};\n", from));
    expect(seed).not.toMatch(/Goose Creek/);
  });
});
