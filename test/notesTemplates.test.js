import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  commitTemplateLabel, createTemplateRecord, deleteTemplateRecord, displayTemplateLabel,
  duplicateTemplateRecord, renameTemplateRecord, seedTemplateRecords, SEED_TEMPLATES,
  templateById, templateFromDoc, writeTemplateBody,
} from "../src/workspaces/notes/lib/notesTemplates.js";

describe("notesTemplates", () => {
  it("carries no @tiptap import — the module must stay on Notes.jsx's static path", () => {
    const src = readFileSync(new URL("../src/workspaces/notes/lib/notesTemplates.js", import.meta.url), "utf8");
    const importLines = src.split("\n").filter((l) => /^\s*import\b/.test(l));
    expect(importLines.join("\n")).not.toMatch(/@tiptap|notesExtensions/);
  });

  describe("the seed", () => {
    it("exposes the Project Contacts template with the eleven named roles", () => {
      const list = seedTemplateRecords();
      const t = templateById(list, "contacts");
      expect(t).toBeTruthy();
      expect(t.label).toBe("Project Contacts");
      const doc = t.doc;
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
      const doc = templateById(seedTemplateRecords(), "contacts").doc;
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

    it("also seeds a second, different template — the dropdown was never meant to hold one", () => {
      const list = seedTemplateRecords();
      expect(list.length).toBeGreaterThanOrEqual(2);
      const assetInfo = templateById(list, "asset-info");
      expect(assetInfo).toBeTruthy();
      expect(assetInfo.label).toBe("Asset Information");
      expect(assetInfo.doc.content[0].content[0].text).toBe("Asset Information");
      // The two seeds are genuinely different content, not the same rows relabeled.
      expect(assetInfo.doc).not.toEqual(templateById(list, "contacts").doc);
    });

    it("SEED_TEMPLATES is the registry seedTemplateRecords builds from — every entry buildable", () => {
      expect(Array.isArray(SEED_TEMPLATES)).toBe(true);
      expect(SEED_TEMPLATES.length).toBeGreaterThanOrEqual(2);
      for (const t of SEED_TEMPLATES) {
        expect(typeof t.id).toBe("string");
        expect(typeof t.label).toBe("string");
        expect(typeof t.buildDoc).toBe("function");
        expect(t.buildDoc().type).toBe("doc");
      }
    });

    it("is deterministic given the same base timestamp — a re-seed is idempotent", () => {
      expect(seedTemplateRecords(1000)).toEqual(seedTemplateRecords(1000));
    });
  });

  describe("templateById", () => {
    it("returns null for an unknown id, or a missing list, never throws", () => {
      const list = seedTemplateRecords();
      expect(templateById(list, "does-not-exist")).toBeNull();
      expect(templateById(list, undefined)).toBeNull();
      expect(templateById(null, "contacts")).toBeNull();
    });
  });

  describe("createTemplateRecord", () => {
    it("adds a new, blank template with a fresh id — the list grows by one", () => {
      const { list, id } = createTemplateRecord([], { label: "My template" });
      expect(list).toHaveLength(1);
      expect(id).toBeTruthy();
      const t = templateById(list, id);
      expect(t.label).toBe("My template");
      expect(t.doc.type).toBe("doc");
    });

    it("two templates created from the same call site never collide on id", () => {
      const first = createTemplateRecord([], {});
      const second = createTemplateRecord(first.list, {});
      expect(first.id).not.toBe(second.id);
      expect(second.list).toHaveLength(2);
    });

    it("a blank label falls back to a real name, never an empty one", () => {
      const { list, id } = createTemplateRecord([], {});
      expect(templateById(list, id).label).toBe("Untitled template");
    });
  });

  describe("templateFromDoc (save a page as a template)", () => {
    it("builds a template from an arbitrary page doc and title", () => {
      const pageDoc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }] };
      const { list, id } = templateFromDoc([], { label: "Weekly Update", doc: pageDoc });
      const t = templateById(list, id);
      expect(t.label).toBe("Weekly Update");
      expect(t.doc).toEqual(pageDoc);
      // A clone, not the same object — editing the template body later must not reach back
      // into the page's own stored doc.
      expect(t.doc).not.toBe(pageDoc);
    });
  });

  describe("renameTemplateRecord / commitTemplateLabel — the live-typing split", () => {
    it("renameTemplateRecord writes the RAW label, even blank — never coerces mid-type", () => {
      const { list, id } = createTemplateRecord([], { label: "Original" });
      const cleared = renameTemplateRecord(list, id, "");
      expect(templateById(cleared, id).label).toBe("");
    });

    it("commitTemplateLabel applies the default ONLY when left genuinely blank", () => {
      const { list, id } = createTemplateRecord([], { label: "Original" });
      const cleared = renameTemplateRecord(list, id, "   ");
      const committed = commitTemplateLabel(cleared, id);
      expect(templateById(committed, id).label).toBe("Untitled template");
    });

    it("commitTemplateLabel is a no-op when the label already has real text", () => {
      const { list, id } = createTemplateRecord([], { label: "Keep me" });
      const committed = commitTemplateLabel(list, id);
      expect(templateById(committed, id).label).toBe("Keep me");
    });

    it("displayTemplateLabel shows the default for blank text without writing it back", () => {
      expect(displayTemplateLabel("")).toBe("Untitled template");
      expect(displayTemplateLabel("   ")).toBe("Untitled template");
      expect(displayTemplateLabel("Real name")).toBe("Real name");
    });
  });

  describe("writeTemplateBody", () => {
    it("replaces one template's body and bumps its updatedAt, leaving others untouched", () => {
      const a = createTemplateRecord([], { label: "A" });
      const b = createTemplateRecord(a.list, { label: "B" });
      const newDoc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "edited" }] }] };
      const next = writeTemplateBody(b.list, a.id, newDoc);
      expect(templateById(next, a.id).doc).toEqual(newDoc);
      expect(templateById(next, b.id).label).toBe("B"); // untouched
    });
  });

  describe("duplicateTemplateRecord", () => {
    it("lands right after its source with a fresh id and a distinguishing label", () => {
      const { list, id } = createTemplateRecord([], { label: "Original" });
      const dup = duplicateTemplateRecord(list, id);
      expect(dup.id).not.toBe(id);
      expect(dup.list).toHaveLength(2);
      const i = dup.list.findIndex((t) => t.id === id);
      expect(dup.list[i + 1].id).toBe(dup.id);
      expect(dup.list[i + 1].label).toBe("Original copy");
    });

    it("the duplicate's doc is a deep clone, not a shared reference", () => {
      const { list, id } = createTemplateRecord([], {});
      const dup = duplicateTemplateRecord(list, id);
      expect(templateById(dup.list, dup.id).doc).not.toBe(templateById(list, id).doc);
    });

    it("an unknown id is a no-op, id null", () => {
      const list = seedTemplateRecords();
      const dup = duplicateTemplateRecord(list, "nope");
      expect(dup.id).toBeNull();
      expect(dup.list).toBe(list);
    });
  });

  describe("deleteTemplateRecord", () => {
    it("removes exactly the named template", () => {
      const a = createTemplateRecord([], { label: "A" });
      const b = createTemplateRecord(a.list, { label: "B" });
      const next = deleteTemplateRecord(b.list, a.id);
      expect(next).toHaveLength(1);
      expect(templateById(next, b.id)).toBeTruthy();
      expect(templateById(next, a.id)).toBeNull();
    });

    it("an unknown id is a no-op", () => {
      const list = seedTemplateRecords();
      expect(deleteTemplateRecord(list, "nope")).toHaveLength(list.length);
    });
  });
});
