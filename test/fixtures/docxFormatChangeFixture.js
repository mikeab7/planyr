/* A .docx whose every change is a FORMATTING change recorded by Word — one of each kind:
 *   run (rPrChange) · paragraph (pPrChange) · paragraph mark (rPrChange in pPr) · table (tblPrChange) ·
 *   column grid (tblGridChange) · row (trPrChange) · cell (tcPrChange) · section (sectPrChange).
 * Each holds the OLD properties inside it (a tblGridChange has no author or date: the schema gives it only an id). Built programmatically so the XML is reviewable. */
import { zipSync, strToU8 } from "fflate";

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const A = (id, who = "Erin Fmt", date = "2026-09-05T09:00:00Z") => `w:id="${id}" w:author="${who}" w:date="${date}"`;

export const FORMAT_CHANGE_BODY = `
<w:p><w:pPr><w:pStyle w:val="Heading2"/><w:pPrChange ${A(21)}><w:pPr><w:pStyle w:val="Heading1"/></w:pPr></w:pPrChange></w:pPr><w:r><w:t>Scope</w:t></w:r></w:p>
<w:p><w:pPr><w:jc w:val="center"/><w:ind w:left="720"/><w:pPrChange ${A(22)}><w:pPr><w:ind w:left="0"/></w:pPr></w:pPrChange></w:pPr><w:r><w:t>Centred and indented paragraph.</w:t></w:r></w:p>
<w:p><w:r><w:rPr><w:b/><w:rPrChange ${A(23)}><w:rPr/></w:rPrChange></w:rPr><w:t>Bold applied</w:t></w:r><w:r><w:t xml:space="preserve"> then plain, then </w:t></w:r><w:r><w:rPr><w:i/><w:rPrChange ${A(24, "Frank Fmt", "2026-09-06T10:30:00Z")}><w:rPr><w:b/></w:rPr></w:rPrChange></w:rPr><w:t>was bold, now italic</w:t></w:r></w:p>
<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblPrChange ${A(25)}><w:tblPr><w:tblW w:w="5000" w:type="dxa"/></w:tblPr></w:tblPrChange></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/><w:tblGridChange w:id="26"><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="4000"/></w:tblGrid></w:tblGridChange></w:tblGrid>
<w:tr><w:trPr><w:cantSplit/><w:trPrChange ${A(27)}><w:trPr/></w:trPrChange></w:trPr><w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="FFFF00"/><w:tcPrChange ${A(28)}><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr></w:tcPrChange></w:tcPr><w:p><w:r><w:t>Shaded</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>Plain</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:pPr><w:rPr><w:b/><w:rPrChange ${A(29)}><w:rPr/></w:rPrChange></w:rPr></w:pPr><w:r><w:t>Paragraph mark made bold.</w:t></w:r></w:p>`;

export const FORMAT_CHANGE_SECT = `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:sectPrChange ${A(30)}><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:sectPrChange></w:sectPr>`;

export function buildFormatChangeDocx(body = FORMAT_CHANGE_BODY, sect = FORMAT_CHANGE_SECT) {
  const doc = `${H}<w:document ${NS}><w:body>${body}${sect}</w:body></w:document>`;
  const styles = `${H}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>`;
  const ct = `${H}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
  const rels = `${H}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const root = `${H}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  return zipSync({ "[Content_Types].xml": strToU8(ct), "_rels/.rels": strToU8(root), "word/document.xml": strToU8(doc), "word/styles.xml": strToU8(styles), "word/_rels/document.xml.rels": strToU8(rels) });
}
