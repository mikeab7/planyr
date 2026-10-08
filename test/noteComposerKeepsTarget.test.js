/* NEW-1 (2026-10-08) — "Adding a note to a site on the map: the site you clicked disappears and you can't
 * tell where the note is going." The WIRING that cannot be seen from the pure modules.
 *
 * RED ON THE PRE-FIX MAIN: the note verb called finishGroundAction() / clearDecidePin() the instant the
 * composer opened, which emptied the selection (the highlight) and removed the decide bar — the reported
 * "what I just clicked on disappeared". Each case below pins one half of the contract. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const finder = readFileSync(new URL("../src/workspaces/site-planner/MapFinder.jsx", import.meta.url), "utf8");
const editor = readFileSync(new URL("../src/shared/mapNotes/components/MapNoteEditor.jsx", import.meta.url), "utf8");
const noteVerb = () => finder.slice(finder.indexOf('key: "note"'), finder.indexOf('key: "note"') + 2000);
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const noteRun = () => { const v = noteVerb(); return stripComments(v.slice(v.indexOf("run: (target)"), v.indexOf("\n  ];"))); };

describe("the target stays selected for as long as the composer is open", () => {
  it("opening the composer does NOT clear the parcel selection or the dropped pin (the reported defect)", () => {
    const run = noteRun();
    expect(run).not.toMatch(/finishGroundAction\(/);
    expect(run).not.toMatch(/clearDecidePin\(/);
    expect(run).not.toMatch(/\bclearSel\(/);
    expect(run).not.toMatch(/setSelected\(\[\]\)|setDroppedPin\(null\)/);
  });

  it("only a successful Save of a NEW note releases the ground, and Cancel does not", () => {
    const save = finder.slice(finder.indexOf("const saveMapNote ="), finder.indexOf("const removeMapNote ="));
    expect(save).toMatch(/if \(res\.error\) return res;[\s\S]*finishGroundAction\(\)[\s\S]*clearDecidePin\(\)/);
    expect(save).toMatch(/setNotePulseId\(res\.data\.id\)/);       // lands on the new note, ringed
    expect(finder).toMatch(/onClose=\{\(\) => setEditingNote\(null\)\}/);   // Cancel just closes
  });

  it("the anchor carries a name so the composer can say what it is attached to", () => {
    expect(noteRun()).toMatch(/selectionLabel\(selected\)/);
    expect(finder).toMatch(/targetLabel=\{noteTarget\}/);
    expect(editor).toMatch(/On \$\{targetLabel\.text\}/);
    expect(finder).toMatch(/noteTargetLabel\(editingNote\.anchor, sites\)/);
  });

  it("the target is outlined / ringed in the notes colour while the composer is open", () => {
    expect(finder).toMatch(/map-note-target-outline/);
    expect(finder).toMatch(/data-testid="map-note-target-pin"/);
  });

  it("the map pans the target into the part the card is not covering, and follows the keyboard", () => {
    expect(finder).toMatch(/panToFitRect\(/);
    expect(finder).toMatch(/visualViewport/);
    expect(finder).toMatch(/composerBox\(/);
    expect(finder).toMatch(/maxHeight=\{noteBox\.maxHeight\}/);
  });
});

describe("a stray tap cannot retarget or discard the note", () => {
  it("the map click handler yields to an open composer BEFORE any select / pin logic", () => {
    const at = finder.indexOf("const onClick = (e) => {");
    const body = stripComments(finder.slice(at, at + 2400));
    const guard = body.indexOf("if (editingNoteRef.current) return;");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(body.indexOf("placingCompPinRef.current"));
    expect(guard).toBeLessThan(body.indexOf("selectModeRef.current"));
  });

  it("site, comp and note markers, identify popups, the pin drop and parcel picks all yield too", () => {
    expect(finder).toMatch(/const openSiteNow = \(\) => \{ if \(editingNoteRef\.current\) return;/);
    expect(finder).toMatch(/marker\.on\("click", \(\) => \{ if \(editingNoteRef\.current\) return;/);
    expect(finder.match(/identifyOk: \(\) => !selectModeRef\.current && !editingNoteRef\.current/g)).toHaveLength(2);
    expect(finder).toMatch(/const markDecidePin = \(latlng\) => \{\s*\n\s*if \(editingNoteRef\.current\) return;/);
    expect(finder).toMatch(/const addParcelHit = \(hit, at\) => \{\s*\n\s*if \(editingNoteRef\.current\) return null;/);
  });

  it("Enter and the decide / selecting bars step aside while the composer is open", () => {
    expect(finder).toMatch(/if \(editingNoteRef\.current\) return; \/\/ the note composer is open/);
    expect(finder).toMatch(/\{decideTarget && !editingNote && \(/);
    // the at-rest row is already gated on `!decideTarget`, and the held ground keeps decideTarget set
    expect(finder).toMatch(/!selectMode && !placingCompPin && !decideTarget && \(/);
  });
});
