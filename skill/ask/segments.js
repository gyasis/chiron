/*
 * Chiron · Ask — the segmented reply on a phone: Answer / Use it / Context.
 *
 *   sectionOf(label)       which segment a bold section heading of a coach reply belongs to
 *   segmentReply(doc, msg) tags the reply's blocks with data-seg and puts a segmented control above the text
 *
 * Nothing is moved or hidden here. Each block of the reply gets a data-seg tag, the control writes the chosen segment
 * to msg.dataset.segOn, and skin.css hides the other segments only at phone width. On a wide screen the control is not
 * shown and the reply reads top to bottom as before. A reply whose blocks all fall in one segment gets no control.
 */

export const SEGMENTS = [['answer', 'Answer'], ['use', 'Use it'], ['context', 'Context']];

/** The coach's bold section headings that belong under "Use it"; every other block stays on the Answer. */
const USE = [/^how it'?s built/i, /^your turn/i];

export function sectionOf(label) {
  const t = String(label || '').trim();
  return USE.some(re => re.test(t)) ? 'use' : 'answer';
}

/** The text of a block's leading <strong>, when the block opens with one: the coach writes its headings as **Heading**. */
function headingOf(node) {
  if (!node || String(node.tagName).toUpperCase() !== 'P') return null;
  const first = (node.children || [])[0];
  if (!first || String(first.tagName).toUpperCase() !== 'STRONG') return null;
  const lead = node.firstChild;
  if (lead && lead !== first && String(lead.textContent || '').trim()) return null;   // text before the bold: not a heading
  return first.textContent;
}

const hasClass = (n, c) => String(n && n.className || '').split(/\s+/).includes(c);

/** The segment of a block the page or acolyte adds next to the reply text. */
function extraSegment(n) {
  if (hasClass(n, 'bk-add') || hasClass(n, 'ask-dg') || hasClass(n, 'px-action')) return 'use';
  if (hasClass(n, 'ask-rel') || hasClass(n, 'acolyte-sources')) return 'context';
  return null;
}

/**
 * Tag the reply's blocks and add the control. Safe to call again on the same reply: it rebuilds from scratch.
 * Returns the segment keys the reply has, in order ([] when it gets no control).
 */
export function segmentReply(doc, msg) {
  const kids = () => [...(msg.children || [])];
  for (const c of kids()) if (hasClass(c, 'ask-seg')) c.remove();
  const prev = msg.dataset.segOn;
  delete msg.dataset.segOn;
  const body = kids().find(c => hasClass(c, 'acolyte-msg-body'));
  if (!body) return [];

  const found = new Set();
  const tag = (n, seg) => { n.dataset.seg = seg; found.add(seg); };

  let cur = 'answer';
  // a recovered answer is rendered into an .ask-md wrapper: its blocks are walked inside it, and its note stays untagged
  const root = [...(body.children || [])].flatMap(c => hasClass(c, 'ask-md') ? [...(c.children || [])] : [c]);
  for (const n of root) {
    if (n.hidden || hasClass(n, 'ask-recovered-note') || String(n.tagName).toUpperCase() === 'PRE') continue;
    const h = headingOf(n);
    if (h != null) cur = sectionOf(h);
    tag(n, cur);
  }

  for (const c of kids()) {
    if (c === body) continue;
    if (hasClass(c, 'ask-coach-extras')) {
      for (const e of c.children || []) { const s = extraSegment(e); if (s) tag(e, s); }
      continue;
    }
    const s = extraSegment(c);
    if (s) tag(c, s);
  }

  const segs = SEGMENTS.filter(([k]) => found.has(k));
  if (segs.length < 2) {
    for (const n of [...root, ...kids(), ...kids().flatMap(c => [...(c.children || [])])]) if (n.dataset) delete n.dataset.seg;
    return [];
  }

  const bar = doc.createElement('div');
  bar.className = 'ask-seg';
  bar.setAttribute('role', 'tablist');
  bar.setAttribute('aria-label', 'Parts of this reply');
  const btns = [];
  const pick = key => {
    msg.dataset.segOn = key;
    for (const [b, k] of btns) { b.setAttribute('aria-selected', String(k === key)); b.classList.toggle('on', k === key); }
  };
  for (const [key, label] of segs) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.textContent = label;
    b.addEventListener('click', () => pick(key));
    bar.appendChild(b);
    btns.push([b, key]);
  }
  msg.insertBefore(bar, body);
  pick(segs.some(([k]) => k === prev) ? prev : segs[0][0]);
  return segs.map(([k]) => k);
}
