/* Reflow visually-wrapped lines back into one logical line per course — pure, Node-testable, no
 * dependencies. Split out of `pdfText.js` (B747) so `deedOcr.js` can reuse it without pulling in
 * pdf.js's text-extraction setup: both a text-layer PDF and an OCR'd scanned PDF wrap a single long
 * course ("…THENCE South 75 degrees 57 minutes 50 seconds East, passing at 200.00 feet…") across
 * several PRINTED lines, and deedParse.js's `coursesOf` treats every newline as a possible course
 * boundary — so a course that wrapped visually gets silently split into unparseable fragments unless
 * something re-joins it first. Word/.txt/paste already give one paragraph per course and never need
 * this. A visual line that legitimately STARTS a new course/tract (THENCE / COMMENCING / SAVE AND
 * EXCEPT / BEGINNING AT / a numbered sub-course) is kept as its own line; everything else is treated
 * as a soft wrap and appended to the previous line with a space. */

const COURSE_START = /^\s*(?:\d{1,2}\s*[.)]\s|THENCE\b|COMMENC\w*\b|SAVE\s+AND\s+EXCEPT\b|BEGINNING\s+AT\b)/i;

export function reflowLines(lines) {
  const out = [];
  for (const raw of lines) {
    const line = raw.replace(/[ \t]+/g, " ").trim();
    if (!line) continue;
    if (out.length && !COURSE_START.test(line)) out[out.length - 1] += " " + line;
    else out.push(line);
  }
  return out.join("\n");
}
