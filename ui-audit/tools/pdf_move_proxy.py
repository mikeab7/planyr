"""Selectability proxy for the editable-PDF export (NEW-1/NEW-2, 2026-10-20). There is no Bluebeam in the sandbox, so
this does what a recipient's drag does with a second engine (MuPDF): for EVERY annotation it translates the geometry
(/Vertices, /L or /Rect), calls update(), renders, and checks (a) the annotation moved and still paints ink at its new
place, (b) NOTHING was left behind at the old place — the old place renders exactly as the page does with that
annotation deleted — and (c) the dictionary is editable: no Hidden / NoView / ReadOnly / Locked / LockedContents flag,
and it carries /Subj, /NM, /AP /N and a valid /Rect. Measurements must also carry /IT + /Measure (NEW-2).

usage: python3 -I pdf_move_proxy.py editable.pdf  → prints one JSON object; exit 0 always (the caller judges).
"""
import json, sys
import pymupdf
import numpy as np

DX, DY = 36.0, -24.0  # half an inch right, a third down (PDF space), far enough to clear most shapes' own footprint
BAD_FLAGS = 1 | 2 | 32 | 64 | 128 | 512

def render(doc, clip=None, annots=True):
    pix = doc[0].get_pixmap(dpi=72, clip=clip, annots=annots, alpha=False)
    return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n).astype(np.int16)

def main(path):
    src = pymupdf.open(path)
    page = src[0]
    H = page.rect.height
    out = {"count": 0, "rows": []}
    xrefs = [a.xref for a in page.annots()]
    out["count"] = len(xrefs)
    for i, xr in enumerate(xrefs):
        row = {"i": i}
        doc = pymupdf.open(path)
        p = doc[0]
        # ISOLATE it: with its neighbours deleted, "moved", "paints" and "left behind" are about THIS annotation alone
        for other in [x for x in p.annots() if x.xref != xr]:
            p.delete_annot(other)
        a = [x for x in p.annots() if x.xref == xr][0]
        get = lambda k: doc.xref_get_key(xr, k)
        row["subtype"] = a.type[1]
        row["subj"] = a.info.get("subject", "")
        row["nm"] = get("NM")[1]
        row["flags"] = a.flags
        row["it"] = get("IT")[1]
        row["measure"] = get("Measure")[0] != "null"
        ap = get("AP")
        row["ap"] = ap[0] != "null" and "/N" in ap[1]
        r0 = pymupdf.Rect(a.rect)
        row["rect_ok"] = r0.width > 0 and r0.height > 0
        row["editable"] = (a.flags & BAD_FLAGS) == 0
        page_only = render(doc, annots=False)
        # move it by rewriting its own geometry keys in PDF space (+DX right, +DY up), then let MuPDF rebuild it
        nums = lambda k: [float(v) for v in get(k)[1].strip("[]").split()]
        shift = lambda vs: "[" + " ".join(f"{v + (DX if j % 2 == 0 else DY):.3f}" for j, v in enumerate(vs)) + "]"
        try:
            for k in ("Vertices", "L", "CL"):
                if get(k)[0] == "array":
                    doc.xref_set_key(xr, k, shift(nums(k)))
            rr = nums("Rect")
            doc.xref_set_key(xr, "Rect", shift(rr))
            a = [x for x in p.annots() if x.xref == xr][0]
            a.update()
            row["moved_err"] = None
        except Exception as e:  # noqa
            row["moved_err"] = str(e)
        a = [x for x in p.annots() if x.xref == xr][0]
        r1 = pymupdf.Rect(a.rect)
        # moved: what MuPDF rebuilt is CENTRED where the translated original would be. A rebuild may draw less (a
        # building's label) or more (a length's caption) than the as-written appearance, so its /Rect may change size —
        # never place.
        c0 = ((r0.x0 + r0.x1) / 2 + DX, (r0.y0 + r0.y1) / 2 - DY)
        c1 = ((r1.x0 + r1.x1) / 2, (r1.y0 + r1.y1) / 2)
        tol = max(6.0, 0.25 * max(r0.width, r0.height))
        row["moved"] = (not r1.is_empty) and abs(c1[0] - c0[0]) <= tol and abs(c1[1] - c0[1]) <= tol
        img = render(doc)
        h, w = img.shape[:2]
        diff = np.abs(img - page_only).max(axis=2) > 8  # low: a translucent area measurement is faint by design
        x0, y0, x1, y1 = [int(round(v)) for v in (r0.x0, r0.y0, r0.x1, r0.y1)]
        nx0, ny0, nx1, ny1 = [int(round(v)) for v in (r1.x0, r1.y0, r1.x1, r1.y1)]
        old = np.zeros((h, w), bool); old[max(0, y0):min(h, y1), max(0, x0):min(w, x1)] = True
        new = np.zeros((h, w), bool); new[max(0, ny0 - 2):min(h, ny1 + 2), max(0, nx0 - 2):min(w, nx1 + 2)] = True
        row["left_px"] = int((diff & old & ~new).sum())
        row["old_px"] = int((old & ~new).sum())
        row["ink_at_new"] = int((diff & new).sum())
        out["rows"].append(row)
    print(json.dumps(out))

if __name__ == "__main__":
    main(sys.argv[1])
