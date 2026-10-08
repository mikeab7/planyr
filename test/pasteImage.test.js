import { describe, it, expect } from "vitest";
import { imageFileFromClipboard, pastedImageName } from "../src/workspaces/site-planner/lib/pasteImage.js";

const png = () => new File([new Uint8Array([137, 80, 78, 71])], "image.png", { type: "image/png" });

describe("imageFileFromClipboard", () => {
  it("finds an image in files", () => {
    const f = imageFileFromClipboard({ files: [png()], items: [] });
    expect(f.type).toBe("image/png");
    expect(f.name).toBe("pasted-image.png");
  });
  it("finds an image in items of kind file", () => {
    const f = imageFileFromClipboard({ files: [], items: [{ kind: "file", type: "image/jpeg", getAsFile: () => new File([1], "x", { type: "image/jpeg" }) }] });
    expect(f.name).toBe("pasted-image.jpg");
  });
  it("text-only / empty / null → null", () => {
    expect(imageFileFromClipboard({ files: [], items: [{ kind: "string", type: "text/plain" }] })).toBeNull();
    expect(imageFileFromClipboard({ files: [new File(["a"], "a.txt", { type: "text/plain" })], items: [] })).toBeNull();
    expect(imageFileFromClipboard(null)).toBeNull();
  });
});

describe("pastedImageName", () => {
  it("dedupes with a numeric suffix", () => {
    expect(pastedImageName([])).toBe("Pasted image");
    expect(pastedImageName(["Pasted image"])).toBe("Pasted image 2");
    expect(pastedImageName(["Pasted image", "pasted image 2"])).toBe("Pasted image 3");
    expect(pastedImageName(["Site.pdf"])).toBe("Pasted image");
  });
});
