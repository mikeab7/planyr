"""Is the sheet furniture (Buildings table, scale bar, north arrow) painted UNDER the site, or above it? (NEW-1, 2026-10-27)

In the editable PDF every site element is an annotation and annotations paint in /Annots order, above the page picture. This
renders the file three ways with MuPDF and answers with pixels, not with a reading of the order:
  · with every annotation                      (what a viewer shows)
  · with ONLY the three furniture Stamps       (what the table looks like when nothing can cover it)
  · with the furniture moved to the FRONT of /Annots (below the site) — the pre-fix stacking — as the known-good arm
`table_survives` = share of the table's own dark ink pixels (rendered alone) that look THE SAME in the full render (within 40 grey
levels — a dark teal pond over black text is dark too, so "still dark" would be fooled): 1.0 = nothing paints over it. `under_survives` is the same measure for the deliberately wrong order; where the site really overlaps the plates it drops,
which is what shows the probe can see a cover (`overlap` says whether the site overlaps a plate at all on this plan).

usage: python3 -I pdf_furniture_cover.py editable.pdf outprefix [--dpi N]   → one JSON object on stdout; exit 0 always.
"""
import json, sys
import pymupdf
import numpy as np

def render(path, keep=None, front=False, dpi=100):
    doc = pymupdf.open(path)
    p = doc[0]
    furn = [a.xref for a in p.annots() if "sheet-furniture" in (doc.xref_get_key(a.xref, "NM")[1] or "")]
    if keep == "furniture":
        for a in [x for x in p.annots() if x.xref not in furn]:
            p.delete_annot(a)
    if front:
        allx = [a.xref for a in p.annots()]
        order = furn + [x for x in allx if x not in furn]
        doc.xref_set_key(p.xref, "Annots", "[" + " ".join(f"{x} 0 R" for x in order) + "]")
        p = doc.reload_page(p)  # the page caches its annotation list; re-read it in the new order
    pix = p.get_pixmap(dpi=dpi, annots=True, alpha=False)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n).astype(np.int16)
    return doc, img, pix

def lum(img): return img[:, :, :3].mean(axis=2)

def main(path, prefix, dpi):
    doc0 = pymupdf.open(path); p0 = doc0[0]; H = p0.rect.height; k = dpi / 72.0
    furn = {}
    for a in p0.annots():
        nm = doc0.xref_get_key(a.xref, "NM")[1] or ""
        if "sheet-furniture" in nm: furn[nm.split("sheet-furniture-")[-1].strip(")")] = a.rect
    full = lum(render(path, dpi=dpi)[1])
    docO, imgO, pixO = render(path, keep="furniture", dpi=dpi); only = lum(imgO)
    under = lum(render(path, front=True, dpi=dpi)[1])
    pixO.save(prefix + "-only-furniture.png")
    def box(r): return int(max(0, r.x0 * k)), int(max(0, r.y0 * k)), int(r.x1 * k) + 1, int(r.y1 * k) + 1
    out = {"plates": list(furn)}
    t = furn.get("buildings-table")
    x0, y0, x1, y1 = box(t)
    mask = only[y0:y1, x0:x1] < 100
    out["table_ink"] = int(mask.sum())
    same = lambda img, sl, m: float((np.abs(img[sl] - only[sl])[m] < 40).mean())
    sl = (slice(y0, y1), slice(x0, x1))
    out["table_survives"] = same(full, sl, mask) if mask.sum() else 0.0
    out["under_survives"] = same(under, sl, mask) if mask.sum() else 0.0
    # does any site annotation overlap a plate at all (so the wrong order could cover it)?
    site = [a.rect for a in p0.annots() if "sheet-furniture" not in (doc0.xref_get_key(a.xref, "NM")[1] or "")]
    out["overlap"] = any(s.intersects(r) for s in site for r in furn.values())
    # all three plates: share of their dark ink surviving in the real order
    tot = surv = 0
    for r in furn.values():
        a0, b0, a1, b1 = box(r); m = only[b0:b1, a0:a1] < 100
        tot += int(m.sum()); surv += int((np.abs(full[b0:b1, a0:a1] - only[b0:b1, a0:a1])[m] < 40).sum())
    out["plates_ink"] = tot; out["plates_survive"] = (surv / tot) if tot else 0.0
    print(json.dumps(out))

if __name__ == "__main__":
    dpi = int(sys.argv[sys.argv.index("--dpi") + 1]) if "--dpi" in sys.argv else 100
    main(sys.argv[1], sys.argv[2], dpi)
