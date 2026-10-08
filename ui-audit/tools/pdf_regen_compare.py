"""Regeneration check for Planyr's native PDF markup annotations (B2127664 amendment).

An editor (Bluebeam / Acrobat) REBUILDS an annotation's appearance from its dictionary the moment a recipient edits
its text or properties. The as-written appearance stream is only what is shown until then. This renders the page
as written, asks MuPDF to regenerate every annotation (`annot.update()`), renders again, and compares per
annotation. usage: pdf_regen_compare.py in.pdf out-prefix  → prints a table, exit 1 if any annotation drifts.
"""
import sys
import numpy as np
import pymupdf

DPI = 60
# fraction of an annotation's own box allowed to differ (> 40/255 on any channel) after regeneration
DEFAULT_LIMIT = 0.10
LIMITS = {
    "planyr-markup-C1": 0.25,    # a regenerated cloud's scallops sit at their own phase — size is matched, phase is not
    "planyr-callout-K2": 0.15,   # MuPDF rebuilds a text box top-left, regular weight, square-cornered; Acrobat honours the /DA face
    "planyr-measure-M2": 0.20,   # a Polygon has no native caption: its number lives in the appearance only (named in the PR)
    "planyr-measure-M3": 0.20,   # same for a multi-vertex PolyLine
}
OVERALL_MEAN_LIMIT = 1.0         # mean abs channel diff over the whole page (before the fix: 5.27)

src, prefix = sys.argv[1], sys.argv[2]
doc = pymupdf.open(src)
page = doc[0]


def render(name):
    pix = page.get_pixmap(dpi=DPI, annots=True)
    pix.save(name)
    return np.frombuffer(pix.samples, np.uint8).reshape(pix.h, pix.w, pix.n).astype(int)


a = render(f"{prefix}_written.png")
annots = list(page.annots())
if not annots:
    print("VOID: the file carries no annotations — nothing to regenerate"); sys.exit(2)
for an in annots:
    an.update()
b = render(f"{prefix}_regen.png")
d = np.abs(a - b).max(axis=2)
mean = np.abs(a - b).mean()
bad = []
print(f"regeneration drift at {DPI} dpi — {len(annots)} annotations")
for an in annots:
    r = an.rect
    x0, y0, x1, y1 = [int(round(v * DPI / 72)) for v in (r.x0, r.y0, r.x1, r.y1)]
    reg = d[max(0, y0 - 1):y1 + 2, max(0, x0 - 1):x1 + 2]
    frac = float((reg > 40).sum()) / max(1, reg.size)
    nm = doc.xref_get_key(an.xref, "NM")[1]
    limit = LIMITS.get(nm, DEFAULT_LIMIT)
    ok = frac <= limit
    if not ok:
        bad.append(nm)
    print(f"  {'ok ' if ok else 'BAD'} {nm:<22} {an.type[1]:<9} differing {frac * 100:5.1f}% (limit {limit * 100:.0f}%)")
print(f"page mean abs diff {mean:.3f} (limit {OVERALL_MEAN_LIMIT})")
if mean > OVERALL_MEAN_LIMIT:
    bad.append("<page mean>")
sys.exit(1 if bad else 0)
