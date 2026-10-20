// A tiny XML → FakeNode parser for SVG strings captured from the real export clone (window.__plannerExportSvg), so a
// realistic drawing can be replayed through annotationExtract in node. Handles what serializeToString emits: elements,
// attributes ("…" or '…'), self-closing tags, text and the five XML entities.
import { FakeNode } from "./fakeSvgDom.js";

const ENT = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };
const unesc = (s) => s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) => (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e]));

export function svgToFake(xml) {
  const root = { kids: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[0].startsWith("<!--")) continue;
    const top = stack[stack.length - 1];
    if (m[5] != null) { if (m[5].trim()) top.kids.push({ text: unesc(m[5]) }); continue; }
    if (m[1]) { stack.pop(); continue; }
    const attrs = {};
    m[3].replace(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, (_, k, a, b) => { attrs[k] = unesc(a != null ? a : b); return ""; });
    const node = { tag: m[2], attrs, kids: [] };
    top.kids.push(node);
    if (!m[4]) stack.push(node);
  }
  const build = (n) => {
    const el = n.kids.filter((k) => !k.text);
    const text = n.kids.filter((k) => k.text).map((k) => k.text).join("");
    if (!el.length) return new FakeNode(n.tag, n.attrs, [], text || (n.tag === "text" || n.tag === "tspan" ? "" : null));
    return new FakeNode(n.tag, n.attrs, el.map(build));
  };
  return build(root.kids.find((k) => !k.text));
}
