# Legacy `.doc` fixtures (NEW-2, B2022929)

Real binary Word 97–2003 files, made by LibreOffice's Word 97 export from small HTML sources (so every file here is a
genuine OLE compound file with piece table, FKPs and style sheet — not a hand-built imitation):

    soffice --headless --infilter="HTML (StarWriter)" --convert-to doc:"MS Word 97" X.html

| file | source HTML |
|---|---|
| `formatted.doc` | `<h1>Project Scope</h1>`, a paragraph with `<b>` `<i>` `<u>` runs and Unicode, a `<ul>` of two items, a 2×2 `<table>` |
| `plain.doc` | two plain `<p>` |
| `unicode.doc` | one `<p>` of accented, CJK, Greek, an emoji (outside the BMP), guillemets, curly quotes, ½ ± € |
| `picture.doc` | `<p>`, an inline base64 PNG `<img>` (40×40), `<p>` (the test also derives an EMF-typed variant by patching the blip header, to prove the not-carried path) |
| `merged.doc` | a table with `colspan="2"` and `rowspan="2"` cells |
| `nested.doc` | a two-level `<ol>`, a centred `<p>`, `<sup>` `<sub>` `<s>` red `<font>` and an `<a href>` |

The Word-authored `.doc` the tests also use is `../deeds/deed-poa-parcel3.doc`.
