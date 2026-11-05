// A just-big-enough DOM for the SVG-clone code (vitest runs in node: no jsdom in this repo). Supports exactly what
// annotationExtract / domToTree read: attributes, children, parentNode, textContent, removeChild and
// querySelectorAll over comma lists of `tag` / `[attr]` selectors, in document order.
export class FakeNode {
  constructor(tag, attrs = {}, kids = [], text = null) {
    this.nodeType = 1; this.tagName = tag; this.attrs = { ...attrs }; this.childNodes = kids; this.parentNode = null; this.text = text;
    kids.forEach((k) => { k.parentNode = this; });
  }
  get attributes() { return Object.entries(this.attrs).map(([name, value]) => ({ name, value: String(value) })); }
  getAttribute(n) { return n in this.attrs ? String(this.attrs[n]) : null; }
  get textContent() { return this.text != null ? this.text : this.childNodes.map((c) => c.textContent).join(""); }
  removeChild(c) { const i = this.childNodes.indexOf(c); if (i >= 0) this.childNodes.splice(i, 1); c.parentNode = null; return c; }
  matches(sel) {
    return sel.split(",").map((s) => s.trim()).some((s) => {
      const m = /^\[([\w-]+)\]$/.exec(s);
      return m ? m[1] in this.attrs : s === this.tagName;
    });
  }
  querySelectorAll(sel) {
    const out = [];
    const walk = (n) => { for (const c of n.childNodes) { if (c.matches(sel)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
export const h = (tag, attrs, ...kids) => new FakeNode(tag, attrs, kids);
export const txt = (str, attrs = {}) => new FakeNode("text", attrs, [], str);
