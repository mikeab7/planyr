/* Tiny dependency-free XML reader/writer for WordprocessingML (no DOMParser, so it runs
 * identically in the browser and under Node/vitest). Elements are
 * `{ name, attrs, children }` where children are nodes or strings. Whitespace text is kept
 * verbatim (it matters inside <w:t xml:space="preserve">). Namespace prefixes are NOT resolved —
 * names stay as written ("w:p"), which is exactly what a round-trip needs. */

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export const unesc = (s) => s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, e) => {
  if (e[0] === "#") { const cp = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(cp); } catch { return m; } }
  return ENT[e] != null ? ENT[e] : m;
});
export const escText = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const escAttr = (s) => escText(s).replace(/"/g, "&quot;");

export function parseXml(src) {
  const s = String(src).replace(/^﻿/, "");
  let i = 0;
  const root = { name: "#root", attrs: {}, children: [] };
  const stack = [root];
  const n = s.length;
  while (i < n) {
    const lt = s.indexOf("<", i);
    if (lt < 0) { const t = s.slice(i); if (t) stack[stack.length - 1].children.push(unesc(t)); break; }
    if (lt > i) stack[stack.length - 1].children.push(unesc(s.slice(i, lt)));
    if (s.startsWith("<!--", lt)) { const e = s.indexOf("-->", lt + 4); if (e < 0) throw new Error("Malformed XML (unterminated comment)."); i = e + 3; continue; }
    if (s.startsWith("<![CDATA[", lt)) { const e = s.indexOf("]]>", lt); if (e < 0) throw new Error("Malformed XML (unterminated CDATA)."); stack[stack.length - 1].children.push(s.slice(lt + 9, e)); i = e + 3; continue; }
    if (s.startsWith("<?", lt)) { const e = s.indexOf("?>", lt); if (e < 0) throw new Error("Malformed XML (unterminated declaration)."); i = e + 2; continue; }
    if (s.startsWith("<!", lt)) { const e = s.indexOf(">", lt); i = e < 0 ? n : e + 1; continue; }
    if (s[lt + 1] === "/") {
      const e = s.indexOf(">", lt); if (e < 0) throw new Error("Malformed XML (unterminated end tag).");
      const nm = s.slice(lt + 2, e).trim();
      const top = stack.pop();
      if (!top || top.name !== nm) throw new Error(`Malformed XML (</${nm}> does not close <${top ? top.name : "?"}>).`);
      i = e + 1; continue;
    }
    // start tag — find its end, honouring quoted attribute values (which may contain '>')
    let j = lt + 1, q = null;
    for (; j < n; j++) { const c = s[j]; if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === ">") break; }
    if (j >= n) throw new Error("Malformed XML (unterminated start tag).");
    let body = s.slice(lt + 1, j);
    const selfClose = body.endsWith("/");
    if (selfClose) body = body.slice(0, -1);
    const m = /^([^\s/>]+)/.exec(body);
    if (!m) throw new Error("Malformed XML (empty tag name).");
    const attrs = {};
    const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let a; const rest = body.slice(m[1].length);
    while ((a = re.exec(rest))) attrs[a[1]] = unesc(a[3] != null ? a[3] : a[4]);
    const node = { name: m[1], attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
    i = j + 1;
  }
  if (stack.length !== 1) throw new Error(`Malformed XML (<${stack[stack.length - 1].name}> never closed).`);
  const top = root.children.find((c) => typeof c !== "string");
  if (!top) throw new Error("Malformed XML (no root element).");
  return top;
}

export function serializeXml(node) {
  if (typeof node === "string") return escText(node);
  const at = Object.entries(node.attrs || {}).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join("");
  if (!node.children || !node.children.length) return `<${node.name}${at}/>`;
  return `<${node.name}${at}>${node.children.map(serializeXml).join("")}</${node.name}>`;
}

// Helpers used by the docx layers.
export const el = (name, attrs = {}, children = []) => ({ name, attrs, children });
export const kids = (node) => (node.children || []).filter((c) => typeof c !== "string");
export const find = (node, name) => kids(node).find((c) => c.name === name) || null;
export const textOf = (node) => (node.children || []).map((c) => (typeof c === "string" ? c : textOf(c))).join("");
export const attr = (node, name) => (node && node.attrs ? node.attrs[name] : undefined);
