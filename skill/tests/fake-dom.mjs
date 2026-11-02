// A tiny fake DOM for the Ask page tests. Its innerHTML setter THROWS, so any code path that puts text through
// innerHTML fails the test.
export class Node {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.className = ''; this._text = ''; this.dataset = {}; this.attrs = {}; this.l = {}; this.style = {}; this.parent = null; this.value = ''; this.hidden = false; this.disabled = false; }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this.writes = (this.writes || 0) + 1; this.children = []; this._text = String(v); }
  set innerHTML(v) { throw new Error('innerHTML must never be used for model text: ' + v); }
  get classList() {
    const n = this;
    const set = () => new Set(n.className.split(/\s+/).filter(Boolean));
    const w = s => { n.className = [...s].join(' '); };
    return {
      add: c => { const s = set(); s.add(c); w(s); }, remove: c => { const s = set(); s.delete(c); w(s); },
      contains: c => set().has(c),
      toggle: (c, f) => { const s = set(); const on = f === undefined ? !s.has(c) : f; on ? s.add(c) : s.delete(c); w(s); return on; },
    };
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  insertBefore(c, ref) { c.parent = this; const i = this.children.indexOf(ref); this.children.splice(i < 0 ? this.children.length : i, 0, c); return c; }
  get firstChild() { return this.children[0] || null; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null; }
  addEventListener(t, f) { (this.l[t] ||= []).push(f); }
  async fire(t) { for (const f of this.l[t] || []) await f({ target: this }); }
  click() { return this.fire('click'); }
  all(pred, out = []) { for (const c of this.children) { if (pred(c)) out.push(c); c.all(pred, out); } return out; }
  byClass(cls) { return this.all(c => c.className.split(/\s+/).includes(cls)); }
  querySelector(sel) { const cls = sel.replace(/^\./, ''); return this.byClass(cls)[0] || null; }
  get text() { return this.textContent; }
}
export const doc = { createElement: t => new Node(t), createTextNode: t => { const n = new Node('#text'); n._text = String(t); return n; } };
export const tick = () => new Promise(r => setTimeout(r, 0));
