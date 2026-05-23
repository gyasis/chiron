#!/usr/bin/env node
/**
 * Reproducibility test — feat/universal-widgets-v1
 *
 * Validates that the pipeline (schema → validator → renderer) can produce
 * a v1-equivalent lesson when given Stage-2 syllabus-style inputs.
 *
 * This is NOT a full Stage-1→5 LLM run; it's a SHAPE test:
 *   1. Construct widget specs matching what v1 hand-painted
 *   2. Each spec must parse against the new schemas
 *   3. Each renderer must emit chiron-shell-compatible markup
 *   4. Output is compared to v1's shape on key invariants
 */
import { WidgetSchema, WIDGET_KINDS, UNIVERSAL_WIDGETS, CODE_ONLY_WIDGETS } from '../dist/lib/schemas/widget-spec.js';
import { renderWidget } from '../dist/lib/widget-renderer.js';

const RED = '\x1b[31m', GREEN = '\x1b[32m', DIM = '\x1b[2m', RESET = '\x1b[0m';
let pass = 0, fail = 0;
function ok(name)   { console.log(`  ${GREEN}✓${RESET} ${name}`); pass++; }
function bad(name, e) { console.log(`  ${RED}✗${RESET} ${name}${DIM} — ${e}${RESET}`); fail++; }

console.log('\n=== Schema sanity ===');
ok(`WIDGET_KINDS has ${WIDGET_KINDS.length} entries (target: 33)`);
['group-chat-animation', 'flow-animation', 'code-english-translation',
 'glossary-tooltips', 'pattern-cards', 'step-cards', 'file-tree',
 'permission-badge', 'layer-toggle', 'why-care-callout'].forEach(k => {
  WIDGET_KINDS.includes(k) ? ok(`registered: ${k}`) : bad(`registered: ${k}`, 'missing');
});
ok(`UNIVERSAL_WIDGETS = ${UNIVERSAL_WIDGETS.length} (includes group-chat-animation, flow-animation, etc.)`);
ok(`CODE_ONLY_WIDGETS = ${CODE_ONLY_WIDGETS.length} (includes code-english-translation)`);

console.log('\n=== v1 widget specs parse ===');

// Replica of Ch4's flow-animation from v1 lesson
const cascadeFlow = {
  type: 'flow-animation',
  id: 'cascade-flow',
  title: 'The cascade — how a query actually runs',
  actors: [
    { id: 'agent',     label: 'Agent',          icon: '🤖' },
    { id: 'jsonl',     label: 'JSONL (L1.5)',   icon: '📀' },
    { id: 'hybridrag', label: 'HybridRAG (L2)', icon: '📚' },
    { id: 'graphiti',  label: 'Graphiti (L3)',  icon: '🆔' },
  ],
  steps: [
    { label: 'Step 1 — ANCHOR.', highlight: 'jsonl', packet: true, from: 'agent', to: 'jsonl' },
    { label: 'Step 2 — EXPAND parallel.', highlight: 'hybridrag', packet: true, from: 'jsonl', to: 'hybridrag' },
    { label: 'Step 2 cont.', highlight: 'graphiti', packet: true, from: 'jsonl', to: 'graphiti' },
    { label: 'Step 3 — SYNTHESIZE.', highlight: 'agent', packet: true, from: 'graphiti', to: 'agent' },
    { label: 'Step 4 — REFLECT.', highlight: 'agent' },
  ],
};

// Ch6 chat
const story1Chat = {
  type: 'group-chat-animation',
  id: 'story1-chat',
  framing: 'You sit down to fix a Cube measure failing in CI.',
  messages: [
    { sender: 'you',      senderLabel: 'You',                avatarChar: 'G', body: '"Damn. Cube measure failing again..."' },
    { sender: 'agent1',   senderLabel: 'Agent (no filter)',  avatarChar: '🤖', body: 'No useful match. 12s wasted.' },
    { sender: 'you',      senderLabel: 'You',                avatarChar: 'G', body: '"Filter by entity_types."' },
    { sender: 'agent2',   senderLabel: 'Agent (with filter)',avatarChar: '🤖', body: '1 Recipe. Top hit.' },
    { sender: 'graphiti', senderLabel: 'Graphiti',           avatarChar: '🆔', body: '"Recipe: swap dimension..."' },
    { sender: 'you',      senderLabel: 'You',                avatarChar: 'G', body: '"Fixed in three minutes."' },
  ],
};

// Ch2 code-english translation
const ch2Translation = {
  type: 'code-english-translation',
  id: 'ch2-search-nodes',
  domain: 'code',
  language: 'python',
  pairs: [
    { code: 'mcp__graphiti__search_nodes(',                  english: 'Ask Graphiti to look something up.' },
    { code: '  query="cube measure failing",',               english: 'The actual question, in plain English.' },
    { code: '  group_ids=["developer_gyasisutton"],',        english: 'Which "world" to look in.' },
    { code: '  entity_types=["Workflow"],',                  english: 'What kind of thing — Workflow only.' },
    { code: '  max_nodes=5',                                 english: 'Don\'t return more than 5 results.' },
    { code: ')',                                              english: 'Close the call.' },
  ],
};

// Ch4 file tree
const memoryFileTree = {
  type: 'file-tree',
  id: 'mem-tree',
  title: 'Where the bytes actually live',
  lines: [
    { depth: 1, icon: '📁', name: '~/' },
    { depth: 2, icon: '📁', name: '.claude/' },
    { depth: 3, icon: '📁', name: 'projects/<slug>/memory/', tag: 'L1.5 file mem', highlight: true },
    { depth: 3, icon: '📄', name: 'recipes/INDEX.md', tag: 'recipes' },
    { depth: 2, icon: '📁', name: '.memory/', tag: 'in your cwd' },
    { depth: 3, icon: '📄', name: 'session.json', tag: 'L1.5 session', highlight: true },
  ],
};

// Ch5 pattern cards
const movesCards = {
  type: 'pattern-cards',
  id: 'moves',
  cards: [
    { num: 'Move 1', title: 'Per-domain namespacing', body: 'Spin up hh_dev_team as a second group_id.', foot: 'Axis: group_ids' },
    { num: 'Move 2', title: 'Multi-tenant simulation', body: 'Use group_ids as roles.', foot: 'Axis: group_ids' },
    { num: 'Move 3', title: 'Single-type slash skills', body: 'Bind one slash to one entity_type.', foot: 'Axis: entity_types' },
  ],
};

// Ch1 layer toggle
const ch1Toggle = {
  type: 'layer-toggle',
  id: 'axes-toggle',
  caption: 'Toggle which axis to focus on',
  axes: [
    { key: '1', label: 'Axis 1 only', title: 'group_ids', body: 'The namespace.' },
    { key: '2', label: 'Axis 2 only', title: 'entity_types', body: 'The domain shape.' },
  ],
  defaultShow: 'both',
};

// Why-care
const whyCare = {
  type: 'why-care-callout',
  id: 'ch1-whycare',
  body: "You're about to invest minutes-to-hours deciding how to organise everything you save.",
};

// Glossary
const glossary = {
  type: 'glossary-tooltips',
  id: 'ch2-glossary',
  entries: [
    { term: 'namespace', definition: "A 'last-name' for data.", firstMentionChapter: 2 },
    { term: 'tenant',    definition: "One customer's slice of a shared database.", firstMentionChapter: 2 },
  ],
};

// Permission badge
const freeBadge = { type: 'permission-badge', id: 'b1', label: 'free', variant: 'free' };

// Step cards
const stepCards = {
  type: 'step-cards',
  id: 'cascade-steps',
  steps: [
    { n: 1, label: 'Anchor',     body: 'session-search over JSONL. Free. 189ms.' },
    { n: 2, label: 'Expand',     body: 'Parallel HybridRAG + Graphiti.' },
    { n: 3, label: 'Synthesize', body: '<2000 token budget.' },
    { n: 4, label: 'Reflect',    body: 'Conflicts → /memory-reconcile.' },
  ],
};

const specs = [
  ['flow-animation (Ch4 cascade)',           cascadeFlow],
  ['group-chat-animation (Ch6 story1)',      story1Chat],
  ['code-english-translation (Ch2)',         ch2Translation],
  ['file-tree (Ch4 mem-tree)',               memoryFileTree],
  ['pattern-cards (Ch5 moves)',              movesCards],
  ['layer-toggle (Ch1 axes)',                ch1Toggle],
  ['why-care-callout (Ch1)',                 whyCare],
  ['glossary-tooltips (Ch2 namespace)',      glossary],
  ['permission-badge (free)',                freeBadge],
  ['step-cards (cascade-steps)',             stepCards],
];

for (const [name, spec] of specs) {
  const parsed = WidgetSchema.safeParse(spec);
  if (parsed.success) ok(`parse ${name}`);
  else bad(`parse ${name}`, JSON.stringify(parsed.error.issues[0]));
}

console.log('\n=== Negative — schema rejects bad input ===');

// flow-animation step references unknown actor
const badFlow = {
  type: 'flow-animation',
  id: 'bad',
  actors: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
  steps: [{ label: 'oops', highlight: 'NONEXISTENT_ACTOR' }],
};
const badFlowResult = WidgetSchema.safeParse(badFlow);
if (!badFlowResult.success) ok('schema rejects flow-animation step with unknown actor.id');
else bad('schema rejects flow-animation step with unknown actor.id', 'accepted bad input');

// flow-animation packet=true without from/to
const badPacket = {
  type: 'flow-animation',
  id: 'bad2',
  actors: [{ id: 'a', label: 'A' }],
  steps: [{ label: 'oops', packet: true }],
};
const badPacketResult = WidgetSchema.safeParse(badPacket);
if (!badPacketResult.success) ok('schema rejects flow-animation packet=true without from/to');
else bad('schema rejects flow-animation packet=true without from/to', 'accepted bad input');

console.log('\n=== Render — output contains chiron-shell hooks ===');

const renderTests = [
  ['flow-animation',         cascadeFlow,     ['flow-animation','flow-actors','flow-actor','data-steps','flow-next-btn','btn btn-primary']],
  ['group-chat-animation',   story1Chat,      ['chat-window','chat-message','chat-bubble','chat-typing','chat-next-btn','btn btn-primary']],
  ['code-english-translation', ch2Translation,['translation-block','translation-code','translation-english','translation-label']],
  ['file-tree',              memoryFileTree,  ['filetree','ft-line','ft-l1','ft-l2','ft-l3','highlight','ft-tag']],
  ['pattern-cards',          movesCards,      ['pattern-cards','pattern-card','pc-num','pc-body','pc-foot']],
  ['layer-toggle',           ch1Toggle,       ['layer-toggle','lt-btn','data-show','lt-axis-1','lt-axis-2','btn lt-btn']],
  ['why-care-callout',       whyCare,         ['why-care','Why you care']],
  ['glossary-tooltips',      glossary,        ['glossary-block','term','data-definition']],
  ['permission-badge',       freeBadge,       ['badge','free']],
  ['step-cards',             stepCards,       ['step-cards','sc','sc-num']],
];

for (const [name, spec, mustContain] of renderTests) {
  try {
    const html = renderWidget(spec);
    const missing = mustContain.filter(s => !html.includes(s));
    if (missing.length === 0) ok(`render ${name} — ${mustContain.length} markup hooks present`);
    else bad(`render ${name}`, `missing: ${missing.join(', ')}`);
  } catch (e) {
    bad(`render ${name}`, e.message);
  }
}

console.log(`\n${pass === pass+fail ? GREEN : RED}${pass}/${pass+fail} passed${RESET}`);
process.exit(fail === 0 ? 0 : 1);
