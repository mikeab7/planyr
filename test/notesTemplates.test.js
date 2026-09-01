import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { NOTE_TEMPLATES, templateById } from "../src/workspaces/notes/lib/notesTemplates.js";

describe("notesTemplates", () => {
  it("carries no @tiptap import — the module must stay on Notes.jsx's static path", () => {
    const src = readFileSync(new URL("../src/workspaces/notes/lib/notesTemplates.js", import.meta.url), "utf8");
    const importLines = src.split("\n").filter((l) => /^\s*import\b/.test(l));
    expect(importLines.join("\n")).not.toMatch(/@tiptap|notesExtensions/);
  });

  it("exposes the Project Contacts template with the eleven named roles", () => {
    const t = templateById("contacts");
    expect(t).toBeTruthy();
    expect(t.label).toBe("Project Contacts");
    const doc = t.buildDoc();
    expect(doc.type).toBe("doc");
    const heading = doc.content[0];
    expect(heading.type).toBe("heading");
    expect(heading.content[0].text).toBe("Project Contacts");

    const rows = doc.content.slice(1);
    expect(rows).toHaveLength(11);
    const roles = rows.map((p) => p.content[0].text.replace(/:$/, ""));
    expect(roles).toEqual([
      "Owner", "Seller", "Broker",
      "Architect", "Civil Engineer", "Structural Engineer", "Geotechnical Engineer", "Surveyor",
      "General Contractor", "Lender", "Title Company",
    ]);
  });

  it("every row is a bold label run followed by a plain, unmarked space to type after", () => {
    const doc = templateById("contacts").buildDoc();
    for (const row of doc.content.slice(1)) {
      expect(row.type).toBe("paragraph");
      expect(row.content).toHaveLength(2);
      const [label, rest] = row.content;
      expect(label.marks).toEqual([{ type: "bold" }]);
      expect(label.text.endsWith(":")).toBe(true);
      expect(rest.marks || []).toEqual([]);
      expect(rest.text).toBe(" ");
    }
  });

  it("templateById returns null for an unknown id, never throws", () => {
    expect(templateById("does-not-exist")).toBeNull();
    expect(templateById(undefined)).toBeNull();
  });

  it("NOTE_TEMPLATES is the single registry — a second template needs no other file", () => {
    expect(Array.isArray(NOTE_TEMPLATES)).toBe(true);
    expect(NOTE_TEMPLATES.every((t) => typeof t.id === "string" && typeof t.buildDoc === "function")).toBe(true);
  });
});
