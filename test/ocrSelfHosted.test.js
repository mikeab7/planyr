// source-scan: guards that the built-in engine paths and production wiring in src/ match the files the build copies; the engine cannot run in node.
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { OCR_FILES } from "../scripts/build-ocr-assets.mjs";
import { OCR_WORKER_PATH, OCR_CORE_PATH, OCR_LANG_PATH, selfHostedEngine } from "../src/shared/files/ocrAssets.js";

const root = (p) => new URL(`../${p}`, import.meta.url);

describe("OCR engine is self-hosted (audit batch A)", () => {
  it("every file the build copies exists in node_modules", () => {
    for (const [from] of OCR_FILES) expect(existsSync(root(from)), from).toBe(true);
  });
  it("the served paths match the folders the build step writes", () => {
    const outs = OCR_FILES.map(([, to]) => "/" + to);
    expect(outs).toContain(OCR_WORKER_PATH);
    expect(outs.some((o) => o.startsWith(OCR_CORE_PATH + "/"))).toBe(true);
    expect(outs.some((o) => o.startsWith(OCR_LANG_PATH + "/"))).toBe(true);
  });
  it("tests/dev keep Tesseract's own defaults (no /ocr in dev)", () => {
    expect(selfHostedEngine()).toEqual({});
  });
  it("both OCR readers consult the helper and the build runs the copy step", () => {
    expect(readFileSync(root("src/workspaces/doc-review/lib/ocr.js"), "utf8")).toMatch(/selfHostedEngineWithLang/);
    expect(readFileSync(root("src/shared/files/deedOcr.js"), "utf8")).toMatch(/selfHostedEngine/);
    expect(JSON.parse(readFileSync(root("package.json"), "utf8")).scripts.build).toMatch(/build-ocr-assets/);
  });
});
