/* Verify NEW-3 (B2022929 amend, V1448016): a .docx SAVED BY PLANYR opens correctly OUTSIDE Planyr.
 *   Run:  node ui-audit/verify-docx-libreoffice.mjs            (add --keep to leave the work folder for inspection)
 *   Also runs as a vitest case (test/docxLibreOffice.test.js), which is SKIPPED with a clear message when LibreOffice
 *   is not installed — CI has none, a developer container can `apt-get install libreoffice-writer`.
 *
 * THIS IS LIBREOFFICE, NOT MICROSOFT WORD. It proves a second, independent word processor reads every tracked change and
 * comment in a Planyr-saved file with the right author, date and text; it does not prove Word does. Opening the same
 * file in Word itself stays on V1448016 for the owner.
 *
 * What it does:
 *   1. Builds a fixture the way a user would: opens a Word-authored .docx (heading, table, image, list, a Word insertion by
 *      Alice, a deletion by Bob, a comment by Carol, and a FORMATTING change by Erin), then in Planyr's own editor model adds
 *      a tracked insertion + a tracked deletion (Dana), a comment (Dana) and a REPLY to Carol's comment (Eli), and saves it
 *      with the real writer.
 *   2. Converts it with `soffice --headless` to flat ODT (.fodt) and asserts on LibreOffice's change-tracking and
 *      annotation elements — kind, author, date, changed text, comment text, and which comment a reply belongs to.
 *   3. Validates the package's XML parts against the ISO/IEC 29500 schemas with `xmllint` when both are available
 *      (OOXML_XSD_DIR, default /mnt/skills/public/docx/scripts/office/schemas), after stripping the markup-compatibility
 *      extension attributes (mc:Ignorable, w14:/w15:) the base schema does not describe — the same preprocessing Word applies.
 * Known-good arm: the Word-authored changes (Alice / Bob / Carol / Erin) must be read back BEFORE the Planyr-made ones count,
 * so a LibreOffice that reads nothing is VOID, not green. */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, strFromU8 } from "fflate";
import { getSchema } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { buildFixtureDocx } from "../test/fixtures/docxFixture.js";
import { readDocx } from "../src/shared/files/docx/docxRead.js";
import { writeDocx } from "../src/shared/files/docx/docxWrite.js";
import { parseXml, serializeXml, kids, textOf } from "../src/shared/files/docx/xml.js";
import { docExtensions } from "../src/workspaces/doc-review/docEditor/docExtensions.js";
import { fixupTracked } from "../src/workspaces/doc-review/docEditor/trackChanges.js";
import { buildFormatChangeDocx } from "../test/fixtures/docxFormatChangeFixture.js";
import { loadModel, buildSave } from "../src/workspaces/doc-review/docEditor/docModel.js";

export const SKIP_MESSAGE = "SKIPPED — LibreOffice (soffice) is not installed here, so no second word processor could read the file. Install it (apt-get install libreoffice-writer) and rerun: node ui-audit/verify-docx-libreoffice.mjs";
const XSD_DEFAULT = "/mnt/skills/public/docx/scripts/office/schemas";

export function findSoffice() {
  const cands = [process.env.SOFFICE, "soffice", "libreoffice"].filter(Boolean);
  for (const c of cands) { const r = spawnSync(c, ["--version"], { encoding: "utf8" }); if (!r.error && r.status === 0 && /LibreOffice/i.test(r.stdout)) return { bin: c, version: r.stdout.trim() }; }
  return null;
}

/* ---------- 1. the Planyr-saved fixture ---------- */
const schema = getSchema(docExtensions());
const textPos = (doc, needle) => { let at = -1; doc.descendants((n, pos) => { if (at < 0 && n.isText) { const i = n.text.indexOf(needle); if (i >= 0) at = pos + i; } }); return at; };

export const PLANYR_EDITS = {
  insertion: { author: "Dana Planyr", text: "about ", before: "200,000" },
  deletion: { author: "Dana Planyr", text: "Scope" },
  comment: { author: "Dana Planyr", text: "Planyr comment on the first cell.", on: "Item", id: "c-dana" },
  reply: { author: "Eli Reply", text: "Reply to Carol, written in Planyr.", to: "c0", id: "c-eli" },
};

export function buildPlanyrSavedFixture() {
  const r = readDocx(buildFixtureDocx({ withFormatChange: true }));
  let state = EditorState.create({ schema, doc: Node.fromJSON(schema, r.doc) });
  const E = PLANYR_EDITS;
  { const tr = state.tr.insertText(E.insertion.text, textPos(state.doc, E.insertion.before)); fixupTracked(tr, state, { author: E.insertion.author }); state = state.apply(tr); }
  { const at = textPos(state.doc, E.deletion.text); const tr = state.tr.delete(at, at + E.deletion.text.length); fixupTracked(tr, state, { author: E.deletion.author }); state = state.apply(tr); }
  { const at = textPos(state.doc, E.comment.on); state = state.apply(state.tr.addMark(at, at + E.comment.on.length, schema.marks.comment.create({ id: E.comment.id }))); }
  const date = "2026-10-01T12:00:00Z";
  const comments = [...r.comments,
    { id: E.comment.id, author: E.comment.author, initials: "DP", date, text: E.comment.text, parentId: null, resolved: false },
    { id: E.reply.id, author: E.reply.author, initials: "ER", date, text: E.reply.text, parentId: E.reply.to, resolved: false }];
  return writeDocx({ doc: state.doc.toJSON(), comments, meta: { ...r.meta, author: E.insertion.author }, files: r.files });
}

/* ---------- 2. what LibreOffice read ---------- */
const nameOf = (n) => n.name;
function walk(node, fn) { if (typeof node === "string") return; fn(node); for (const c of node.children || []) walk(c, fn); }

/** Parse LibreOffice's flat ODT into { changes: [{kind, author, date, text}], comments: [{name, parent, author, date, text}], headings, tables, images, lists }. */
export function readFodt(xml) {
  const root = parseXml(xml);
  const regions = new Map(); // id → { kind, author, date, text }
  walk(root, (n) => {
    if (nameOf(n) !== "text:changed-region") return;
    const id = n.attrs["text:id"] || n.attrs["xml:id"];
    const body = kids(n).find((c) => ["text:insertion", "text:deletion", "text:format-change"].includes(c.name));
    if (!body) return;
    const info = kids(body).find((c) => c.name === "office:change-info");
    const pick = (nm) => { const e = info && kids(info).find((c) => c.name === nm); return e ? textOf(e) : ""; };
    const own = kids(body).filter((c) => c.name !== "office:change-info").map(textOf).join(""); // a deletion keeps its text inside the region
    regions.set(id, { kind: body.name.replace("text:", ""), author: pick("dc:creator"), date: pick("dc:date"), text: own });
  });
  const open = new Set(); const inline = {};
  walk(root, (n) => {
    if (n.name === "text:change-start") open.add(n.attrs["text:change-id"]);
    else if (n.name === "text:change-end") open.delete(n.attrs["text:change-id"]);
  });
  // inline text between the markers (document order) — needs a text-aware walk
  const stack = new Set();
  (function go(node) {
    if (typeof node === "string") { for (const id of stack) inline[id] = (inline[id] || "") + node; return; }
    if (node.name === "text:changed-region") return;
    if (node.name === "text:change-start") { stack.add(node.attrs["text:change-id"]); return; }
    if (node.name === "text:change-end") { stack.delete(node.attrs["text:change-id"]); return; }
    for (const c of node.children || []) go(c);
  })(root);
  const changes = [...regions].map(([id, r]) => ({ ...r, text: (r.text + (inline[id] || "")).trim() }));
  const comments = [];
  walk(root, (n) => {
    if (n.name !== "office:annotation") return;
    const f = (nm) => { const e = kids(n).find((c) => c.name === nm); return e ? textOf(e) : ""; };
    comments.push({ name: n.attrs["office:name"] || "", parent: n.attrs["loext:parent-name"] || "", resolved: n.attrs["loext:resolved"], author: f("dc:creator"), date: f("dc:date"), text: kids(n).filter((c) => c.name === "text:p").map(textOf).join("\n").trim() });
  });
  let headings = [], tables = 0, images = 0, lists = 0, cells = [];
  walk(root, (n) => {
    if (n.name === "text:h" || (n.name === "text:p" && /^Heading_20_[1-9]$/.test(n.attrs["text:style-name"] || ""))) headings.push(textOf(n).trim()); // the fixture styles its heading by name; LibreOffice may read it as either
    else if (n.name === "table:table") tables++;
    else if (n.name === "table:table-cell") cells.push(textOf(n).trim());
    else if (n.name === "draw:image") images++;
    else if (n.name === "text:list") lists++;
  });
  return { changes, comments, headings, tables, cells, images, lists };
}

/* ---------- 3. schema validation ---------- */
const stripMce = (node) => {
  if (typeof node === "string") return node;
  const attrs = {};
  for (const [k, v] of Object.entries(node.attrs || {})) if (!/^(w14|w15|mc):/.test(k) && !/^xmlns:(w14|w15|mc)$/.test(k)) attrs[k] = v;
  return { ...node, attrs, children: (node.children || []).map(stripMce) };
};
export function validateAgainstSchemas(docxBytes, work) {
  const dir = process.env.OOXML_XSD_DIR || XSD_DEFAULT;
  const lint = spawnSync("xmllint", ["--version"], { encoding: "utf8" });
  const wml = join(dir, "ISO-IEC29500-4_2016", "wml.xsd");
  if (lint.error || !existsSync(wml)) return { skipped: `no schema validation: ${lint.error ? "xmllint not installed" : `OOXML schemas not found at ${dir} (set OOXML_XSD_DIR)`}`, results: [] };
  const parts = unzipSync(docxBytes);
  const targets = [["word/document.xml", wml], ["word/comments.xml", wml], ["word/styles.xml", wml], ["word/numbering.xml", wml], ["word/commentsExtended.xml", join(dir, "microsoft", "wml-2012.xsd")]];
  const results = [];
  for (const [part, xsd] of targets) {
    if (!parts[part]) continue;
    if (!existsSync(xsd)) { results.push({ part, ok: null, detail: `schema ${xsd} not available` }); continue; }
    const tree = parseXml(strFromU8(parts[part]));
    const src = serializeXml(xsd.endsWith("wml.xsd") ? stripMce(tree) : tree); // the Microsoft extension parts are validated as they are
    const file = join(work, part.replace(/\//g, "_"));
    writeFileSync(file, src);
    const r = spawnSync("xmllint", ["--noout", "--schema", xsd, file], { encoding: "utf8" });
    results.push({ part, ok: r.status === 0, detail: r.status === 0 ? "valid" : (r.stderr || "").split("\n").filter((l) => /error/i.test(l)).slice(0, 3).join(" | ") });
  }
  return { skipped: null, results };
}

/* ---------- run ---------- */
export async function runLibreOfficeCheck({ keep = false } = {}) {
  const so = findSoffice();
  if (!so) return { skipped: SKIP_MESSAGE, checks: [] };
  const work = mkdtempSync(join(tmpdir(), "planyr-lo-"));
  const checks = []; const ok = (name, pass, detail = "") => checks.push({ name, pass: !!pass, detail });
  try {
    const bytes = buildPlanyrSavedFixture();
    const docx = join(work, "planyr-saved.docx"); writeFileSync(docx, bytes);
    mkdirSync(join(work, "profile"));
    const conv = spawnSync(so.bin, ["--headless", `-env:UserInstallation=file://${join(work, "profile")}`, "--convert-to", "fodt", "--outdir", work, docx], { encoding: "utf8", timeout: 120000 });
    const fodtPath = join(work, "planyr-saved.fodt");
    ok("LibreOffice opens the Planyr-saved .docx and converts it", conv.status === 0 && existsSync(fodtPath), (conv.stderr || conv.stdout || "").trim().split("\n").pop());
    if (!existsSync(fodtPath)) return { skipped: null, checks, version: so.version, work };
    const r = readFodt(readFileSync(fodtPath, "utf8"));
    const E = PLANYR_EDITS;
    const has = (kind, author, textRe, dateRe) => r.changes.some((c) => c.kind === kind && c.author === author && (!textRe || textRe.test(c.text)) && (!dateRe || dateRe.test(c.date)));
    // known-good arm: the Word-authored changes
    ok("[known-good] Word insertion by Alice Reviewer, 2026-09-01, “approximately”", has("insertion", "Alice Reviewer", /approximately/, /^2026-09-01T10:00/));
    ok("[known-good] Word deletion by Bob Editor, 2026-09-02, “roughly”", has("deletion", "Bob Editor", /roughly/, /^2026-09-02T11:30/));
    ok("[known-good] Word formatting change by Erin Fmt, 2026-09-04", has("format-change", "Erin Fmt", null, /^2026-09-04T08:00/));
    ok("[known-good] Word comment by Carol Owner, “Confirm the final square footage.”", r.comments.some((c) => c.author === "Carol Owner" && /Confirm the final square footage/.test(c.text) && /^2026-09-03/.test(c.date)));
    const voided = checks.filter((c) => c.name.startsWith("[known-good]") && !c.pass).length;
    // Planyr-made
    ok(`Planyr tracked insertion by ${E.insertion.author}: “${E.insertion.text.trim()}”`, has("insertion", E.insertion.author, /about/));
    ok(`Planyr tracked deletion by ${E.deletion.author}: “${E.deletion.text}”`, has("deletion", E.deletion.author, new RegExp(E.deletion.text)));
    ok(`Planyr comment by ${E.comment.author}`, r.comments.some((c) => c.author === E.comment.author && c.text === E.comment.text && /^2026-10-01/.test(c.date)));
    const carol = r.comments.find((c) => c.author === "Carol Owner");
    const reply = r.comments.find((c) => c.author === E.reply.author);
    ok(`Planyr reply by ${E.reply.author}, attached to Carol’s comment`, !!reply && reply.text === E.reply.text && !!carol && reply.parent === carol.name, reply ? `parent=${reply.parent || "(none)"} carol=${carol && carol.name}` : "reply not found");
    ok("exactly 5 tracked changes and 3 annotations (Carol, Dana, Eli) — nothing extra, nothing missing", r.changes.length === 5 && r.comments.length === 3, `changes=${r.changes.length} annotations=${r.comments.length}`);
    ok("the heading, table (4 cells), image and list are all there", r.headings.some((h) => /Project/.test(h)) && r.tables === 1 && ["Item", "Value", "Clear height", "36 ft"].every((t) => r.cells.some((c) => c.includes(t))) && r.images === 1 && r.lists >= 1, JSON.stringify({ headings: r.headings, tables: r.tables, images: r.images, lists: r.lists }));
    // a legacy .doc converted by Planyr (NEW-2) is also a file other programs must read
    {
      const docBytes = readFileSync(new URL("../test/fixtures/doc/formatted.doc", import.meta.url));
      const f = { name: "formatted.doc", kind: "doc", blob: { arrayBuffer: async () => docBytes.buffer.slice(docBytes.byteOffset, docBytes.byteOffset + docBytes.byteLength) } };
      const m = await loadModel(f);
      const saved = buildSave({ model: m, file: f, json: m.doc }).bytes;
      const p2 = join(work, "from-doc.docx"); writeFileSync(p2, saved);
      const c2 = spawnSync(so.bin, ["--headless", `-env:UserInstallation=file://${join(work, "profile")}`, "--convert-to", "fodt", "--outdir", work, p2], { encoding: "utf8", timeout: 120000 });
      const r2 = existsSync(join(work, "from-doc.fodt")) ? readFodt(readFileSync(join(work, "from-doc.fodt"), "utf8")) : null;
      ok(".doc → Planyr .docx: LibreOffice reads the heading, the 2×2 table and the bullet list", !!r2 && c2.status === 0 && r2.headings.includes("Project Scope") && r2.tables === 1 && ["Item", "Value", "Clear height", "36 ft"].every((t) => r2.cells.some((c) => c.includes(t))) && r2.lists >= 1, r2 ? JSON.stringify({ headings: r2.headings, tables: r2.tables, lists: r2.lists }) : "no output");
      if (r2) ok(".doc → Planyr .docx validates against the OOXML schemas", validateAgainstSchemas(saved, work).results.every((q) => q.ok !== false), "document.xml/styles.xml");
      // …and a .doc with a PNG picture brings the picture itself
      const pb = readFileSync(new URL("../test/fixtures/doc/picture.doc", import.meta.url));
      const pf = { name: "picture.doc", kind: "doc", blob: { arrayBuffer: async () => pb.buffer.slice(pb.byteOffset, pb.byteOffset + pb.byteLength) } };
      const pm = await loadModel(pf);
      const psaved = buildSave({ model: pm, file: pf, json: pm.doc }).bytes;
      const p4 = join(work, "picture-from-doc.docx"); writeFileSync(p4, psaved);
      spawnSync(so.bin, ["--headless", `-env:UserInstallation=file://${join(work, "profile")}`, "--convert-to", "fodt", "--outdir", work, p4], { encoding: "utf8", timeout: 120000 });
      const r4 = existsSync(join(work, "picture-from-doc.fodt")) ? readFodt(readFileSync(join(work, "picture-from-doc.fodt"), "utf8")) : null;
      ok(".doc with a picture → Planyr .docx: LibreOffice shows the picture, and the package validates", !!r4 && r4.images === 1 && validateAgainstSchemas(psaved, work).results.every((q) => q.ok !== false), r4 ? `images=${r4.images}` : "no output");
    }
    // every kind of Word formatting change (NEW-1), saved untouched by Planyr: the records must sit where the schema wants them
    {
      const fr = readDocx(buildFormatChangeDocx());
      const saved = writeDocx({ doc: fr.doc, comments: [], meta: fr.meta, files: fr.files });
      const sv2 = validateAgainstSchemas(saved, work);
      ok("formatting-change fixture (run, paragraph, paragraph mark, table, grid, row, cell, section) saved by Planyr validates against the OOXML schemas", sv2.skipped ? true : sv2.results.every((q) => q.ok !== false), sv2.skipped || sv2.results.map((q) => `${q.part}: ${q.detail}`).join(" | "));
      const p3 = join(work, "format-changes.docx"); writeFileSync(p3, saved);
      spawnSync(so.bin, ["--headless", `-env:UserInstallation=file://${join(work, "profile")}`, "--convert-to", "fodt", "--outdir", work, p3], { encoding: "utf8", timeout: 120000 });
      const r3 = existsSync(join(work, "format-changes.fodt")) ? readFodt(readFileSync(join(work, "format-changes.fodt"), "utf8")) : null;
      const fmtBy = r3 ? r3.changes.filter((c) => c.kind === "format-change" || c.kind === "attribute-change") : [];
      ok("LibreOffice reads the saved formatting changes as tracked changes by Erin Fmt / Frank Fmt", fmtBy.some((c) => c.author === "Erin Fmt") && fmtBy.some((c) => c.author === "Frank Fmt"), JSON.stringify(r3 && r3.changes.map((c) => [c.kind, c.author])));
    }
    // schemas
    const sv = validateAgainstSchemas(bytes, work);
    if (sv.skipped) checks.push({ name: "package validates against the OOXML schemas", pass: true, skipped: true, detail: sv.skipped });
    for (const x of sv.results) checks.push({ name: `schema: ${x.part}`, pass: x.ok !== false, skipped: x.ok === null, detail: x.detail });
    return { skipped: null, checks, version: so.version, voided, work, fodt: fodtPath };
  } finally { if (!keep) rmSync(work, { recursive: true, force: true }); }
}

/* ---------- CLI ---------- */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const res = await runLibreOfficeCheck({ keep: process.argv.includes("--keep") });
  if (res.skipped) { console.log(res.skipped); process.exit(process.argv.includes("--require") ? 1 : 0); }
  console.log(`LibreOffice: ${res.version}  (this is LibreOffice, NOT Microsoft Word)\n`);
  for (const c of res.checks) console.log(`${c.skipped ? "–" : c.pass ? "✓" : "✗"} ${c.name}${c.detail && (!c.pass || c.skipped) ? `\n    ${c.detail}` : ""}`);
  const bad = res.checks.filter((c) => !c.pass);
  if (res.voided) console.log("\nVOID: the known-good arm (Word-authored changes) did not read back — LibreOffice read nothing it should, so a green score would mean nothing.");
  console.log(`\n${res.checks.length - bad.length}/${res.checks.length} passed${process.argv.includes("--keep") ? `  (kept: ${res.work})` : ""}`);
  process.exit(bad.length || res.voided ? 1 : 0);
}
