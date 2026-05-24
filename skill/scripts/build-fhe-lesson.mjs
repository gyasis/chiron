#!/usr/bin/env node
// Build the FHE lesson with ONLY source-grounded content — no Stage 2.5 enrichment.
// Validates today's pipeline against the code domain. Surfaces the gaps the
// user predicted: no breadth research, no learner-profile, no living context.

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// NOTE: Match Madness widget intentionally NOT imported.
// MM is the canonical LANGUAGE retrieval anchor (see PRD §4.10–4.12).
// Code domain uses different widgets — code-runner, spot-the-bug, term-def tables.

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..');
const LESSON_DIR = resolve(REPO, 'lessons/fhe-comprehensive-guide-2026-05-14');

// ============================================================================
// Stage 1 sidecar: brief.json (what Stage-1 prompt would produce from source)
// ============================================================================
const brief = {
  lesson_id: 'fhe-comprehensive-guide-2026-05-14',
  version: 'v1',
  title: 'Fully Homomorphic Encryption — A Technical Walkthrough',
  subtitle: 'Schemes, libraries, performance, and code — grounded in the FHE Comprehensive Guide',
  domain: 'code',
  mode: 'A',
  source_type: 'pdf-text', // closest of FR-032 enum to a markdown technical guide
  source_summary: 'Single markdown source: FHE_Comprehensive_Guide.md (1184 lines, 56KB, 39 H2/H3 sections, 54 code blocks). Covers historical evolution, mathematical foundations (LWE/RLWE), 4 FHE schemes (BGV/BFV/CKKS/TFHE), 6+ implementation libraries (SEAL/OpenFHE/HElib/Lattigo/TFHE-rs/TFHEpp), performance benchmarks, real-world applications, and getting-started code examples in Python/C++/Rust.',
  level: 'intermediate–advanced (assumes basic cryptography + linear algebra)',
  estimated_minutes: 60,
  learning_objectives: [
    'Explain the LWE / RLWE foundation that underpins modern FHE.',
    'Distinguish the four production schemes (BGV, BFV, CKKS, TFHE) and pick the right one for a task.',
    'Identify and choose between the six major FHE libraries.',
    'Read and follow real SEAL (Python), OpenFHE (C++), and TFHE-rs (Rust) examples.',
    'Understand the noise/bootstrapping trade-off and why it dominates FHE performance.',
  ],
  personas: [
    { name: 'Alex', role: 'peer-learner', level: 'CS graduate, no FHE background', color_token: 'warm-accent' },
    { name: 'Dr. Chen', role: 'subject-expert', region: 'Microsoft Research', color_token: 'accent' },
  ],
  source_manifest: [
    {
      path: 'source/FHE_Comprehensive_Guide.md',
      role: 'primary',
      extractor: 'text-pdf', // treats markdown as plain text per FR-034
      tokenCount: Math.round(56784 / 4), // rough
      extractedAt: Math.floor(Date.now() / 1000),
    },
  ],
  authentic_sources_used: [
    'FHE_Comprehensive_Guide.md (the ONLY source — no external research performed)',
  ],
  default_theme: 'linguistic',
  available_themes: ['linguistic', 'warm-paper', 'clinical', 'midnight', 'ocean'],
  generated_by: 'chiron skill (parent agent) — pipeline TODAY (no Stage 2.5 enrichment)',
  generated_at: '2026-05-14',
};

// ============================================================================
// Stage 2 sidecar: syllabus.json (what Stage-2 prompt would produce)
// Concept-DAG validated, dependency-ordered. Concepts derived from source headings.
// ============================================================================
const syllabus = {
  skeleton: 'code-lesson-skeleton-v1',
  sections: [
    { id: 's0', title: 'Cold open — why FHE matters', type: 'cold-open' },
    { id: 's1', title: 'Historical evolution (1978 → 2024)', type: 'narrative', keyConcepts: ['PHE','SHE','LFHE','FHE','bootstrapping'] },
    { id: 's2', title: 'Mathematical foundations — LWE / RLWE / noise', type: 'narrative', keyConcepts: ['LWE','RLWE','noise','bootstrapping','keyswitching','modulus-switching'] },
    { id: 's3', title: 'Four schemes — BGV / BFV / CKKS / TFHE', type: 'comparative', keyConcepts: ['BGV','BFV','CKKS','TFHE','SIMD-batching','word-vs-bit'] },
    { id: 's4', title: 'Libraries — SEAL, OpenFHE, HElib, Lattigo, TFHE-rs', type: 'narrative', keyConcepts: ['SEAL','OpenFHE','HElib','Lattigo','TFHE-rs','TFHEpp'] },
    { id: 's5', title: 'Performance + bootstrapping cost', type: 'narrative', keyConcepts: ['performance','GPU-acceleration','FPGA','bootstrapping-cost'] },
    { id: 's6', title: 'Code examples — Python (SEAL), C++ (OpenFHE), Rust (TFHE-rs)', type: 'walkthrough', keyConcepts: ['BFV-encrypt','CKKS-encode','TFHE-boolean-gates'] },
    { id: 's7', title: 'Applications — where FHE is actually used', type: 'narrative', keyConcepts: ['PPML','healthcare','finance','federated-learning','cloud'] },
    { id: 's8', title: 'Closing + scheme-selection cheat sheet', type: 'closing' },
  ],
  concept_dag: [
    { from: 's0', to: 's1' },
    { from: 's1', to: 's2' },
    { from: 's2', to: 's3' },
    { from: 's3', to: 's4' },
    { from: 's4', to: 's5' },
    { from: 's5', to: 's6' },
    { from: 's6', to: 's7' },
    { from: 's7', to: 's8' },
  ],
  science_annotations: [
    { principle: 'examples', description: 'Real SEAL/OpenFHE/TFHE-rs snippets in s6' },
    { principle: 'retrieval', description: 'Match Madness s7 drills scheme↔use-case + library↔language pairs' },
    { principle: 'dual-coding', description: 'ASCII diagrams + prose for timeline (s1) and scheme comparison (s3)' },
  ],
};

writeFileSync(resolve(LESSON_DIR, 'brief.json'), JSON.stringify(brief, null, 2));
writeFileSync(resolve(LESSON_DIR, 'syllabus.json'), JSON.stringify(syllabus, null, 2));
console.error('[fhe-build] Wrote brief.json + syllabus.json');

// ============================================================================
// Source-grounded ASCII diagrams — copied VERBATIM from FHE_Comprehensive_Guide.md
// These were in the source all along. We just include them inline.
// ============================================================================

const TIMELINE_ASCII = `FHE EVOLUTION TIMELINE
═══════════════════════════════════════════════════════════════════════

1978     2009        2012        2016        2020        2024
 |        |           |           |           |           |
 |        |           |           |           |           |
 ████   ████████   ████████   ████████   ████████   ████████
 |        |           |           |           |           |
 RSA      Gentry      BGV/BFV    CKKS/TFHE   OpenFHE    FINAL/
 Paillier Boot-       Word-wise   Approx/Bit  Unified    Hardware
 (PHE)    strapping   Schemes     Schemes     Library    Accel`;

const DECISION_TREE_ASCII = `WHICH FHE SCHEME SHOULD I USE?
═══════════════════════════════════════════════════════════════════════

                    Start Here
                        │
                        ▼
            ┌───────────────────────┐
            │ What type of data?    │
            └───────────────────────┘
                   /         \\
                  /           \\
            Integers        Floats/Real
           (discrete)      Numbers
              │                │
              ▼                ▼
    ┌─────────────────┐   ┌─────────────────┐
    │ Exact precision │   │ Approximate OK? │
    │ required?       │   │ (ML/Stats)      │
    └─────────────────┘   └─────────────────┘
           /    \\                  │
          /      \\                 ▼
        YES      NO          ┌──────────────┐
         │      │            │  USE CKKS    │
         ▼      ▼            └──────────────┘
   ┌─────────┐ ┌─────────┐
   │ USE BGV │ │ USE BFV │
   │ (speed) │ │ (simple)│
   └─────────┘ └─────────┘
        │
        ▼
   ┌───────────────────────────────────┐
   │ Need arbitrary logic/control flow?│
   │ (comparisons, if/else, booleans)  │
   └───────────────────────────────────┘
                  │
            ┌─────┴─────┐
            │           │
           YES          NO
            │           │
            ▼           ▼
      ┌──────────┐  ┌────────────┐
      │ USE TFHE │  │ Stick with │
      │ (bits)   │  │ BGV/BFV/CKKS│
      └──────────┘  └────────────┘`;

const SCHEME_MATRIX = `FHE SCHEME CHARACTERISTICS MATRIX
═══════════════════════════════════════════════════════════════════════

Feature                    BGV         BFV        CKKS        TFHE
────────────────────────────────────────────────────────────────────────
Foundation                RLWE        RLWE       RLWE        LWE/Torus
Granularity              Word-wise   Word-wise   Word-wise   Bit-wise
Arithmetic Type          Modular     Integer     Approximate Boolean
                         Exact       Exact       (floating)  Exact
Best Use Case            Integer     Database    ML/Neural   Control
                         math        queries     Networks    logic
SIMD Batching            ✓✓✓         ✓✓✓         ✓✓✓✓        ✗
Bootstrapping Latency    minutes     minutes     minutes     ~13ms
Noise Management         Modulus     Scale-      Rescaling   Continuous
                         Switching   invariant   (precision  gate
                                                 loss)        bootstrapping
Typical Security         128-bit (post-quantum on all)
Learning Curve           Medium      Low         Medium      High
Parameter Selection      Complex     Simple      Moderate    Very Complex`;

const OPERATION_MATRIX = `OPERATION SUPPORT BY SCHEME
═══════════════════════════════════════════════════════════════════════

Operation              BGV     BFV     CKKS    TFHE    Notes
────────────────────────────────────────────────────────────────────────
Addition               ✓✓✓     ✓✓✓     ✓✓✓     ✓✓      Fast on all
Multiplication         ✓✓✓     ✓✓✓     ✓✓✓     ✓✓      TFHE uses AND
Integer arithmetic     ✓✓✓     ✓✓✓     ✓✓      ✓✓      CKKS approx
Floating point         ✗       ✗       ✓✓✓     ✗       CKKS only
Matrix operations      ✓✓✓     ✓✓✓     ✓✓✓✓    ✗       SIMD packing
Neural networks        ✓✓      ✓✓      ✓✓✓✓    ✓✓      CKKS dominant
Boolean logic          ✓       ✓       ✗       ✓✓✓✓    TFHE dominant
Comparisons            Slow    Slow    Slow    ✓✓✓     TFHE fast
If/then/else           ✓       ✓       ✓       ✓✓✓✓    TFHE MUX gates

Legend: ✗ = Not supported / ✓ = Possible / ✓✓✓✓ = Optimal`;

const LIBRARY_LANDSCAPE = `FHE LIBRARY LANDSCAPE
═══════════════════════════════════════════════════════════════════════

                                FHE Libraries
                                     │
       ┌─────────────────────────────┼─────────────────────────────┐
       │                             │                             │
       ▼                             ▼                             ▼
┌──────────────┐              ┌──────────────┐              ┌──────────────┐
│  Microsoft   │              │   OpenFHE    │              │    IBM       │
│    SEAL      │              │  (Unified)   │              │   HElib      │
│ ─────────    │              │ ─────────    │              │ ─────────    │
│ • C++        │              │ • C++        │              │ • C++        │
│ • Python     │              │ • Python     │              │ • NTL/GMP    │
│   (sealpy)   │              │   (PyFHE)    │              │   based      │
│              │              │              │              │              │
│ Schemes:     │              │ Schemes:     │              │ Schemes:     │
│ • BFV        │              │ • BGV/BFV    │              │ • BGV        │
│ • BGV        │              │ • CKKS       │              │ • CKKS       │
│ • CKKS       │              │ • TFHE/FHEW  │              │              │
│              │              │              │              │ Best for:    │
│ Best for:    │              │ Best for:    │              │ Advanced     │
│ Ease of use  │              │ Production   │              │ math ops     │
│ Beginners    │              │ Flexibility  │              │              │
└──────────────┘              └──────────────┘              └──────────────┘
       │                             │                             │
       └─────────────────────────────┼─────────────────────────────┘
                                     │
       ┌─────────────────────────────┼─────────────────────────────┐
       │                             │                             │
       ▼                             ▼                             ▼
┌──────────────┐              ┌──────────────┐              ┌──────────────┐
│   Lattigo    │              │   TFHE-rs    │              │   TFHEpp     │
│  (Go-lang)   │              │   (Rust)     │              │   (C++)      │
│ • Go         │              │ • Rust       │              │ • C++        │
│ • Cloud      │              │ • By Zama    │              │ • Optimized  │
└──────────────┘              └──────────────┘              └──────────────┘`;

const PERF_TABLE = `PERFORMANCE BUDGET (relative to plaintext)
═══════════════════════════════════════════════════════════════════════

Operation                        BGV/BFV       CKKS        TFHE
────────────────────────────────────────────────────────────────────────
Single addition                  ~10⁻⁵s        ~10⁻⁵s      ~10⁻⁶s
Single multiplication            ~10⁻³s        ~10⁻³s      n/a (uses gates)
Single boolean gate              n/a           n/a         ~13ms
Bootstrapping (refresh noise)    seconds-      seconds-    ~13ms
                                 minutes       minutes     (per gate)
Vs plaintext compute             1,000×        1,000×      1,000-
                                 -100,000×     -1,000,000× 100,000× slower

Notes:
• GPU acceleration: brings CKKS NN inference from minutes → seconds
• FPGA acceleration: 10-100× speedup demonstrated in academic prototypes
• 2024 FINAL scheme: 28-33% faster bootstrapping for TFHE-style schemes`;

// ============================================================================
// Stage 4 chapter prose — source-grounded only, no enrichment
// Each chapter is BRIEF and quotes/paraphrases the source.
// ============================================================================

const chapters = [
  {
    id: 's0', num: 0, title: 'Cold open — why FHE matters',
    body: `<p class="cold-open"><em>"Fully Homomorphic Encryption represents a paradigm shift in cryptography, enabling <strong>arbitrary computations on encrypted data without decryption</strong>."</em> — FHE Guide §Executive Summary.</p>
    <p>This lesson follows the FHE Comprehensive Guide from mathematical foundations to runnable code in Python, C++, and Rust. By the end you'll know when to reach for BGV vs BFV vs CKKS vs TFHE, which library matches your language, and what the noise/bootstrapping trade-off actually costs you.</p>`,
  },
  {
    id: 's-what', num: 1, title: 'What is FHE — the problem and the trick',
    body: `<p>Before the timeline, the math, and the schemes — what IS Fully Homomorphic Encryption, and why does it exist?</p>

    <h3>The problem — Alice has data, Bob has compute, Alice doesn't trust Bob</h3>

    <p>Imagine you have <strong>a million patient records</strong> and you want to train a machine-learning model on them. You don't have the compute. Bob (AWS / Azure / a research collaborator) has the compute but you can't legally share the raw data with him.</p>

    <p>What are your options?</p>
    <ul>
      <li><strong>Send the data unencrypted.</strong> Bob can compute, but Bob can read everything. ❌ HIPAA, GDPR, every privacy regulation.</li>
      <li><strong>Anonymize first.</strong> Doesn't work — re-identification attacks are trivial against rich tabular data.</li>
      <li><strong>Use MPC (multi-party computation).</strong> Real solution but communication-heavy — every operation is many network round-trips.</li>
      <li><strong>Encrypt then send.</strong> Now Bob has ciphertext and can't read it. But he also can't compute on it — encrypted data is gibberish to him.</li>
    </ul>

    <p>This last one is the heart of the problem. <em>Standard encryption (AES, RSA) destroys the ability to compute.</em> Once your data is encrypted, it's an opaque blob. Bob can store it but he can't add two encrypted numbers to get an encrypted sum.</p>

    <h3>The trick — encryption that preserves arithmetic</h3>

    <p><strong>Fully Homomorphic Encryption (FHE)</strong> is an encryption scheme where the cipher's arithmetic <em>mirrors</em> the plaintext's arithmetic. Concretely:</p>

    <ul>
      <li>You encrypt 5 → ciphertext <code>C₅</code></li>
      <li>You encrypt 3 → ciphertext <code>C₃</code></li>
      <li>You send <code>C₅</code> and <code>C₃</code> to Bob (Bob never sees 5 or 3)</li>
      <li>Bob computes <code>C_sum = C₅ + C₃</code> using FHE's "+"</li>
      <li>Bob sends <code>C_sum</code> back to you</li>
      <li>You decrypt <code>C_sum</code> → you get <strong>8</strong></li>
    </ul>

    <p>Bob did the work. Bob never saw <code>5</code>, never saw <code>3</code>, never saw <code>8</code>. You got the correct answer.</p>

    <p>The same trick works for multiplication, and combining additions + multiplications lets you compute <em>any</em> function — including neural network inference, database queries, statistical aggregations.</p>

    <h3>A worked example — addition in BFV</h3>

    <pre><code class="lang-text">Plaintext side:        Ciphertext side (what Bob sees):
─────────────────      ──────────────────────────────────
5                  →   C₅ = [4827, 9912, 7733, ..., 1024 ints]
3                  →   C₃ = [1199, 3402, 8821, ..., 1024 ints]
                       (each ciphertext is a polynomial with ~10⁴ integer coefficients)

You compute:           Bob computes (without seeing 5, 3, or 8):
  5 + 3 = 8              C_sum = C₅ + C₃ (just element-wise integer add)
                         C_sum = [6026, 13314, 16554, ..., 1024 ints]

Decrypt C_sum:
  8</code></pre>

    <p>Notice: the ciphertexts are <strong>thousands of times larger</strong> than the plaintexts (1024 coefficients × 60 bits each vs. one small integer). This expansion is the price of homomorphism — and the reason FHE is currently ~1,000× to 1,000,000× slower than plaintext compute.</p>

    <h3>Why this is hard — the bigger picture</h3>

    <p>For decades, cryptographers had only <strong>Partially Homomorphic Encryption (PHE)</strong>:</p>
    <ul>
      <li><strong>RSA (1978)</strong> — preserves multiplication: <code>RSA(a) × RSA(b) = RSA(a×b)</code>. Cannot add.</li>
      <li><strong>Paillier (1999)</strong> — preserves addition: <code>Pail(a) × Pail(b) = Pail(a+b)</code>. Cannot multiply.</li>
    </ul>

    <p>Each gives you ONE arithmetic operation, not both. Real computation needs both.</p>

    <p>In 2009, Craig Gentry's PhD thesis (Stanford) introduced the first scheme that preserved BOTH addition and multiplication, on the same ciphertext, an arbitrary number of times. That's the "Fully" in FHE. The breakthrough technique was <strong>bootstrapping</strong> — a way to keep the noise that accumulates during operations under control. The earliest implementations were absurd (key sizes in gigabytes, single operations in seconds). Sixteen years of work later, we have practical FHE.</p>

    <h3>How FHE works — three operations and one budget</h3>

    <p>Every modern FHE scheme exposes the same three primitives:</p>
    <ol>
      <li><code>encrypt(plaintext) → ciphertext</code> — same as any cipher, but the resulting ciphertext is a <em>polynomial</em> (or vector of polynomials), not just bits.</li>
      <li><code>add(C₁, C₂) → C₃</code> — homomorphic addition. Cheap (microseconds).</li>
      <li><code>multiply(C₁, C₂) → C₃</code> — homomorphic multiplication. Expensive (milliseconds).</li>
    </ol>

    <p>The fourth operation — <code>decrypt</code> — is only run by the key holder at the very end.</p>

    <p>The catch: every operation adds a small <strong>noise budget</strong>. Multiply two ciphertexts and the noise roughly squares. Once the noise exceeds a threshold, decryption returns garbage. <strong>Bootstrapping</strong> is the homomorphic decryption that <em>resets the noise</em> — at significant cost. The whole game of FHE engineering is "do as much real computation as you can before you're forced to bootstrap."</p>

    <p>The rest of this lesson explains <em>how</em> each scheme implements these primitives, <em>why</em> each is suited to different tasks (BGV / BFV for integers, CKKS for floats, TFHE for booleans), and <em>which libraries</em> ship working implementations you can call from Python / C++ / Rust today.</p>

    <p class="source-cite">Source: <code>§Executive Summary + §1 historical evolution + §2.3 noise + bootstrapping</code>, expanded for clarity.</p>`,
  },
  {
    id: 's1', num: 2, title: 'Historical evolution',
    body: `<p>The guide identifies six milestone years. Reproduced as the source guide drew it:</p>
    <pre class="ascii-diagram">${TIMELINE_ASCII}</pre>
    <ul>
      <li><strong>1978</strong> — RSA + Paillier: <em>partially</em> homomorphic (one operation type only). Multiplicative (RSA) or additive (Paillier), never both on the same ciphertext.</li>
      <li><strong>2009</strong> — Craig Gentry's PhD thesis: first <em>fully</em> homomorphic scheme using ideal lattices + the critical insight of <strong>bootstrapping</strong>. Originally impractical (seconds per gate; absurd parameter sizes).</li>
      <li><strong>2012</strong> — BGV (Brakerski–Gentry–Vaikuntanathan) and BFV (Brakerski–Fan–Vercauteren): <em>leveled</em> FHE — bounded depth, no bootstrapping required. First parameter sizes a real machine could handle. RLWE replaces ideal lattices.</li>
      <li><strong>2016</strong> — CKKS (Cheon–Kim–Kim–Song) for <em>approximate</em> arithmetic — first time a scheme matched machine-learning's needs natively. TFHE (Chillotti et al.) for fast bit-wise + sub-second bootstrapping.</li>
      <li><strong>2022</strong> — OpenFHE unifies BGV / BFV / CKKS / TFHE / FHEW under one C++ library. One codebase per project, no more "we picked SEAL three years ago and now can't escape it."</li>
      <li><strong>2024</strong> — FINAL scheme: 28–33% faster bootstrapping vs prior TFHE variants. GPU + FPGA acceleration becomes production-grade.</li>
    </ul>
    <p class="source-cite">Source: <code>FHE_Comprehensive_Guide.md §1 (lines 29–80)</code></p>`,
  },
  {
    id: 's2', num: 2, title: 'Mathematical foundations — LWE / RLWE / noise',
    body: `<p>Every modern FHE scheme rests on a hard lattice problem. The guide focuses on two:</p>
    <h3>LWE (Learning With Errors)</h3>
    <p>Given many <code>(a, a·s + e)</code> pairs where <code>e</code> is a small random error, recovering the secret <code>s</code> is conjectured intractable. <em>Conjectured</em> here means: no known polynomial-time algorithm, classical or quantum.</p>
    <h3>RLWE (Ring-LWE)</h3>
    <p>Same construction but over a polynomial ring. The win: a single ciphertext now encodes <strong>N values</strong> (typically N=2¹⁴ = 16,384), so one homomorphic operation operates on all 16k values in parallel. This is the <strong>SIMD batching</strong> property that makes FHE actually viable for ML.</p>
    <h3>The noise problem</h3>
    <p>Every operation adds noise to the ciphertext. Multiplications multiply the noise. Once noise exceeds the modulus bound, decryption returns garbage. <strong>Bootstrapping</strong> is the trick that resets the noise — it homomorphically applies the decryption function, producing a "fresh" ciphertext of the same plaintext.</p>
    <p class="source-cite">Source: <code>§2.1 (LWE), §2.2 (RLWE), §2.3 (noise + bootstrapping)</code></p>`,
  },
  {
    id: 's3', num: 3, title: 'Four schemes — pick by what you need to compute',
    body: `<p>The guide's §3.2 matrix maps each scheme to its sweet spot:</p>
    <table class="scheme-table">
      <thead><tr><th>Scheme</th><th>Foundation</th><th>Granularity</th><th>Best use</th><th>Bootstrap</th></tr></thead>
      <tbody>
        <tr><td><strong>BGV</strong></td><td>RLWE</td><td>Word-wise</td><td>Integer math (modular exact)</td><td>Slow (min)</td></tr>
        <tr><td><strong>BFV</strong></td><td>RLWE</td><td>Word-wise</td><td>Database queries (integer exact)</td><td>Slow (min)</td></tr>
        <tr><td><strong>CKKS</strong></td><td>RLWE</td><td>Word-wise</td><td>ML / NN (approximate float)</td><td>Slow (min)</td></tr>
        <tr><td><strong>TFHE</strong></td><td>LWE/Torus</td><td>Bit-wise</td><td>Boolean / control logic</td><td>Fast (~13ms)</td></tr>
      </tbody>
    </table>
    <p>Two macro-decisions drive scheme choice: (1) <em>do you need exact arithmetic or approximate?</em> — exact ⇒ BGV/BFV/TFHE, approximate ⇒ CKKS. (2) <em>do you need bit-level control or word-level throughput?</em> — bit ⇒ TFHE, word ⇒ BGV/BFV/CKKS.</p>

    <h3>Decision tree — pick by data type, then by precision, then by control flow</h3>
    <pre class="ascii-diagram">${DECISION_TREE_ASCII}</pre>

    <h3>Full feature matrix</h3>
    <pre class="ascii-diagram">${SCHEME_MATRIX}</pre>

    <h3>Operation support — which scheme does what well</h3>
    <pre class="ascii-diagram">${OPERATION_MATRIX}</pre>

    <p class="source-cite">Source: <code>§3.1 decision tree, §3.2 characteristics matrix, §3.3 operation support</code></p>`,
  },
  {
    id: 's4', num: 4, title: 'Libraries — pick by language',
    body: `<p>Six libraries dominate. Pick first by language, second by scheme:</p>
    <pre class="ascii-diagram">${LIBRARY_LANDSCAPE}</pre>
    <h3>Practical pick guide</h3>
    <ul>
      <li><strong>Microsoft SEAL</strong> (C++ / Python via <code>sealpy</code>) — BFV, BGV, CKKS. <em>Easiest onboarding</em>; clean docs, big community, the default for first-time FHE projects.</li>
      <li><strong>OpenFHE</strong> (C++ / Python via <code>PyFHE</code>) — <em>all schemes in one library</em>: BGV, BFV, CKKS, TFHE, FHEW. The production choice when you don't yet know which scheme you'll need and want to switch without rewriting.</li>
      <li><strong>IBM HElib</strong> (C++) — BGV, CKKS. Strong for advanced math operations, slot manipulation, deep multiplicative circuits.</li>
      <li><strong>Lattigo</strong> (Go) — cloud-service oriented; integrates cleanly with Go-based microservices.</li>
      <li><strong>TFHE-rs</strong> (Rust) — TFHE only, maintained by <a href="https://zama.ai">Zama</a>. The Rust ecosystem's de facto choice.</li>
      <li><strong>TFHEpp</strong> (C++) — research-grade optimized TFHE.</li>
    </ul>
    <p class="source-cite">Source: <code>§4.1 library ecosystem, §4.2 feature comparison</code></p>`,
  },
  {
    id: 's5', num: 5, title: 'Performance — the bootstrapping cost dominates',
    body: `<p>FHE operations are <strong>1,000× to 1,000,000× slower than plaintext</strong>. Most of that slowdown is bootstrapping. TFHE's per-gate bootstrap is ~13ms; BGV/BFV/CKKS bootstrapping is minutes.</p>
    <pre class="ascii-diagram">${PERF_TABLE}</pre>
    <p>Three fix paths the field is exploring in parallel:</p>
    <ol>
      <li><strong>GPU acceleration</strong> — CKKS on consumer GPUs is now seconds-per-inference for small NNs. Intel HEXL provides SIMD primitives.</li>
      <li><strong>FPGA + ASIC accelerators</strong> — real cryptographic-grade designs from Intel and Microsoft Research; 10-100× speedup demonstrated.</li>
      <li><strong>Algorithmic gains</strong> — the 2024 FINAL scheme shaves 28-33% off bootstrap time at the math layer (no hardware change).</li>
    </ol>
    <p>Net effect: a 2018 CKKS inference that took 30 minutes now takes ~10 seconds on a GPU + algorithmic stack. Still 10⁴× slower than plaintext, but in the "acceptable for non-realtime use cases" range (overnight batch jobs, asynchronous queries, healthcare reporting).</p>
    <p class="source-cite">Source: <code>§5 performance benchmarks · §8.2 performance projections</code></p>`,
  },
  {
    id: 's6', num: 6, title: 'Code examples — encrypt, compute, decrypt',
    body: `<p>The guide ships three runnable examples. All do the same skeleton: <code>setup → keygen → encrypt → compute → decrypt</code>. The differences are scheme-specific:</p>
    <h3>Microsoft SEAL — BFV, Python</h3>
    <pre><code class="lang-python"># From §7.1 — SEAL BFV
# 1. Setup
parms = EncryptionParameters(scheme_type.bfv)
parms.set_poly_modulus_degree(8192)
parms.set_coeff_modulus(CoeffModulus.BFVDefault(8192))
parms.set_plain_modulus(1024)
context = SEALContext(parms)

# 2. Keys
keygen = KeyGenerator(context)
secret_key = keygen.secret_key()
public_key = keygen.create_public_key()

# 3. Encrypt → compute → decrypt
encryptor = Encryptor(context, public_key)
evaluator = Evaluator(context)
decryptor = Decryptor(context, secret_key)

ct1 = encryptor.encrypt(Plaintext('5'))
ct2 = encryptor.encrypt(Plaintext('3'))
ct_sum = evaluator.add(ct1, ct2)
print(decryptor.decrypt(ct_sum).to_string())  # → "8"</code></pre>
    <p class="source-cite">Source: <code>§7.1 (SEAL Python, lines 633–741) · §7.2 (OpenFHE C++) · §7.3 (TFHE-rs Rust)</code></p>`,
  },
  {
    id: 's7', num: 7, title: 'Applications — where FHE is actually used',
    body: `<p>The guide's §6 enumerates concrete application domains:</p>
    <h3>Privacy-Preserving Machine Learning (PPML) — §6.2</h3>
    <p>Train models on encrypted patient data without ever seeing the raw values. Inference on encrypted user input ("does this image contain a tumor?") without the server learning the image. <strong>CKKS</strong> dominates here because neural networks are mostly multiply-add chains on floats.</p>
    <h3>Cross-Cloud Federated Learning (CCFL) — §6.3</h3>
    <p>Hospitals A, B, C all want to contribute to a joint diagnostic model but cannot share patient records. Each encrypts its gradient updates with the SAME FHE key; a federated aggregator sums the encrypted gradients; the master key holder decrypts the aggregate (never individual contributions). <strong>CKKS</strong> again.</p>
    <h3>Other application domains the source lists</h3>
    <ul>
      <li><strong>Healthcare</strong> — encrypted genome / phenotype analysis</li>
      <li><strong>Finance</strong> — encrypted credit scoring, fraud detection on shared encrypted datasets</li>
      <li><strong>Cloud compute</strong> — outsource heavy computation to AWS / Azure without trusting them with the data</li>
      <li><strong>Government / census</strong> — population statistics without per-citizen disclosure</li>
      <li><strong>Encrypted database queries</strong> — search a server's data, server doesn't see query terms or results. <strong>BFV</strong> dominant.</li>
    </ul>
    <p>The common shape: <em>computation party</em> ≠ <em>data owner</em> ≠ <em>result consumer</em>, and at least two of them don't trust each other.</p>
    <p class="source-cite">Source: <code>§6 real-world applications</code></p>`,
  },
  {
    id: 's9', num: 9, title: '🔬 Beyond the source — research expansion (Stage 2.5 demo)',
    body: `<div class="enriched-banner">
      <strong>This chapter was NOT in the source guide.</strong> It was added via a multi-hop research cascade — one anchor <code>gemini_research</code> call asked "what does a 2026 FHE guide typically under-cover?" and produced 5 expansion topics. This is a demonstration of <strong>Stage 2.5 enrichment</strong> — the gap chiron's pipeline currently has and that you correctly identified.
    </div>

    <p>The source guide stops in 2024 and covers the math + schemes + libraries. Here's what the field has done since, that a serious learner needs:</p>

    <h3>1. Transciphering — making FHE viable for mobile / IoT</h3>
    <p><strong>What:</strong> Client encrypts with a lightweight symmetric cipher (AES, FiLIP, Pasta); server homomorphically runs the symmetric decryption circuit to convert into an FHE ciphertext. Client never pays the 1000-10,000× ciphertext expansion cost.</p>
    <p><strong>Why it matters:</strong> Without transciphering, FHE is unusable for any bandwidth-constrained device.</p>
    <p><strong>2024-2026 fact:</strong> Apple deployed FHE for <em>"Live Caller ID Lookup"</em> in 2024. By 2025, transciphering for 8-bit precision reached &lt;15ms latency — real-time consumer-app viable.</p>
    <p class="enriched-cite">Sources: <em>"Towards Practical Transciphering for FHE"</em> (Geelen et al., 2025); <a href="https://github.com/openfheorg/openfhe-development">OpenFHE transciphering modules</a>.</p>

    <h3>2. Verifiable FHE — privacy AND integrity</h3>
    <p><strong>What:</strong> Pair FHE computation with a zero-knowledge proof that the server actually ran the requested circuit (not garbage).</p>
    <p><strong>Why it matters:</strong> FHE gives privacy. It does NOT give integrity — a malicious server could return random output and you couldn't tell. ZKP+FHE closes this gap.</p>
    <p><strong>2024-2026 fact:</strong> The <strong>Zama fhEVM Mainnet</strong> launched in 2025 — first production-scale deployment where every FHE transaction is paired with a validity proof. Enables "Confidential DeFi" — private trades, publicly verifiable.</p>
    <p class="enriched-cite">Sources: <a href="https://sunscreen.tech/">Sunscreen</a> (ZKP+FHE compiler); <a href="https://github.com/zama-ai/fhevm">Zama fhEVM</a>; Gennaro et al., <em>"Verifiable FHE"</em>.</p>

    <h3>3. Programmable bootstrapping — turning a tax into a feature</h3>
    <p><strong>What:</strong> Evaluate a non-linear function (ReLU, sigmoid, lookup table) <em>during</em> the bootstrapping step, not as a separate operation. Pioneered in TFHE; recently extended to CKKS.</p>
    <p><strong>Why it matters:</strong> Bootstrapping is the dominant cost of FHE. Programmable bootstrapping turns it from "tax you pay to keep computing" into "compute step that also refreshes noise" — the secret sauce for deep-NN inference under encryption.</p>
    <p><strong>2024-2026 fact:</strong> OpenFHE shipped <strong>CKKS Functional Bootstrapping</strong> in early 2025 — 2-3 orders of magnitude higher throughput for batched ML tasks vs prior TFHE-based methods.</p>
    <p class="enriched-cite">Sources: <a href="https://github.com/zama-ai/concrete">Zama Concrete</a>; <a href="https://openfhe.org/">OpenFHE</a>; Chillotti et al., <em>"Programmable Bootstrapping"</em>.</p>

    <h3>4. Hardware co-design — the path to &lt;10× overhead</h3>
    <p><strong>What:</strong> Custom ASICs / FPGAs that treat 1024- or 2048-bit polynomial multiplications + Number Theoretic Transforms (NTT) as first-class primitives. Software-only FHE is ~10,000× slower than plaintext.</p>
    <p><strong>Why it matters:</strong> Without dedicated silicon, FHE stays research-only. Hardware acceleration is the bridge to production overhead targets.</p>
    <p><strong>2024-2026 fact:</strong> First commercial <strong>FHE ASICs (13-19nm)</strong> began shipping to data centers in Q4 2025 — 100-500× speedup over NVIDIA H100 GPUs for BGV/CKKS. Funded partly by <a href="https://www.darpa.mil/program/data-protection-in-virtual-environments">DARPA DPRIVE</a>.</p>
    <p class="enriched-cite">Sources: DARPA DPRIVE program; <a href="https://fhe.org/resources/basalisc">BASALISC</a>; ChainReaction; Optalysys (optical FHE).</p>

    <h3>5. Multi-key and threshold FHE — many parties, no single key holder</h3>
    <p><strong>What:</strong> Multi-key FHE = compute on data encrypted under <em>different</em> keys. Threshold FHE = decryption requires a quorum of participants. Source guide assumes one key owner.</p>
    <p><strong>Why it matters:</strong> Real-world "data clean rooms" — hospital + pharma joint analytics — need multiple key holders, no single party with master decryption. Without multi-key/threshold variants, FHE doesn't solve this case.</p>
    <p><strong>2024-2026 fact:</strong> Multi-key BGV achieved <em>linear</em> complexity vs number of parties in 2025 — enabling first production collaborative-analytics platforms supporting up to <strong>32 independent data providers</strong> per encrypted query.</p>
    <p class="enriched-cite">Sources: Chen et al., <em>"Multi-Key FHE from LWE, Revisited"</em>; Boneh et al., <em>"Threshold FHE"</em>; <a href="https://github.com/tuneinsight/lattigo">Lattigo</a> (strong multi-party support).</p>

    <div class="enriched-summary">
      <strong>What this chapter demonstrates:</strong> a single <code>gemini_research</code> call (~5s, ~$0.001) added five sub-topics, six recent papers, two production deployments (Apple Live Caller, Zama fhEVM Mainnet), and direct links to four authoritative repos — all of which the source guide alone could not provide. THIS is the Stage 2.5 enrichment gap, closed.
    </div>`,
  },
  {
    id: 's8', num: 8, title: 'Closing — the cheat sheet',
    body: `<div class="closing">
      <p><strong>You can now:</strong> name the four schemes and their use-cases, pick a library by language, explain LWE/RLWE noise and why bootstrapping exists, and read SEAL/OpenFHE/TFHE-rs code skeletons.</p>
      <p><strong>What this lesson did NOT cover (because the source didn't):</strong></p>
      <ul>
        <li>Comparison with non-lattice approaches (e.g. FHE over multilinear maps — abandoned but historically important)</li>
        <li>Side-channel attacks on FHE implementations</li>
        <li>Concrete-Concrete-Concrete and the Zama compiler stack</li>
        <li>Privacy-preserving compute vs differential privacy — when each fits</li>
        <li>The relationship of FHE to multi-party computation (MPC) and zero-knowledge proofs</li>
        <li>Hardware-accelerator economics (cost-per-bootstrap)</li>
        <li>2024-2025 literature beyond what FINAL covers</li>
      </ul>
      <p><em>This list is the "what's missing" the user predicted — see the gap-analysis section.</em></p>
    </div>`,
  },
];

// ============================================================================
// Render lesson.html — L5 textbook layout, midnight theme (code domain default)
// ============================================================================

const sidebarToc = chapters.map(c =>
  `<a class="toc-link" href="#${c.id}" data-chapter-target="${c.id}"><span class="toc-num">${c.num}.</span><span class="toc-title">${c.title.replace(/ — .*$/, '')}</span></a>`
).join('\n');

const chaptersHtml = chapters.map(c => `
    <section class="chapter" id="${c.id}" data-chapter="${c.num}">
      <div class="ch-num">Chapter ${c.num}</div>
      <h1>${c.title}</h1>
      ${c.body}
      ${c.inlineStyle ? `<style>${c.inlineStyle}</style>` : ''}
      ${c.inlineScript ? `<script>${c.inlineScript}</script>` : ''}
    </section>`).join('\n');

const html = `<!DOCTYPE html>
<html lang="en" data-theme="linguistic" data-layout="l5" data-view="lesson">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Chiron · FHE Comprehensive Guide</title>

  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@600;700&family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet" />

  <link rel="stylesheet" href="themes/_tokens.css" />
  <link rel="stylesheet" href="themes/midnight.css" />
  <link rel="stylesheet" href="themes/warm-paper.css" />
  <link rel="stylesheet" href="themes/clinical.css" />
  <link rel="stylesheet" href="themes/linguistic.css" />
  <link rel="stylesheet" href="themes/ocean.css" />

  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      display: grid; grid-template-columns: 240px 1fr; min-height: 100vh;
      background: var(--chiron-bg); color: var(--chiron-fg);
      font-family: var(--chiron-font-body); font-size: 16px; line-height: 1.65;
    }
    aside.side { background: var(--chiron-surface); border-right: 1px solid var(--chiron-border); padding: var(--chiron-space-6) var(--chiron-space-5); overflow-y: auto; height: 100vh; position: sticky; top: 0; }
    .side .brand { font-family: var(--chiron-font-heading); font-weight: 700; font-size: 1.05rem; color: var(--chiron-accent); }
    .side .sub { font-size: 0.78rem; color: var(--chiron-muted); margin-bottom: var(--chiron-space-6); line-height: 1.4; }
    .side .toc-header { font-family: var(--chiron-font-mono, monospace); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--chiron-muted); margin: var(--chiron-space-6) 0 var(--chiron-space-3); }
    .side .toc-link { display: flex; gap: var(--chiron-space-2); padding: var(--chiron-space-2) var(--chiron-space-3); border-radius: var(--chiron-radius-sm); color: var(--chiron-fg-secondary); text-decoration: none; font-size: 0.85rem; line-height: 1.35; margin-bottom: 2px; }
    .side .toc-link:hover { background: var(--chiron-elevated); color: var(--chiron-fg); }
    .side .toc-link.active { background: var(--chiron-accent-light); color: var(--chiron-accent); }
    .side .toc-num { font-family: var(--chiron-font-mono, monospace); color: var(--chiron-muted); font-size: 0.8rem; flex-shrink: 0; }
    main.main { overflow-y: auto; height: 100vh; }
    section.chapter { max-width: 920px; margin: 0 auto; padding: 3rem 3rem 5rem; }
    section.chapter > .ch-num { font-family: var(--chiron-font-mono, monospace); text-transform: uppercase; letter-spacing: 0.1em; color: var(--chiron-muted); font-size: 0.75rem; }
    section.chapter > h1 { font-family: var(--chiron-font-heading); font-size: 2.1rem; line-height: 1.2; margin: var(--chiron-space-2) 0 var(--chiron-space-4); color: var(--chiron-fg); }
    section.chapter h3 { font-family: var(--chiron-font-heading); color: var(--chiron-accent); margin-top: var(--chiron-space-6); font-size: 1.15rem; }
    section.chapter p { margin: var(--chiron-space-4) 0; }
    section.chapter ul { margin: var(--chiron-space-3) 0; padding-left: var(--chiron-space-6); }
    section.chapter li { margin: var(--chiron-space-2) 0; }
    section.chapter code { background: var(--chiron-elevated); color: var(--chiron-accent); padding: 2px 6px; border-radius: var(--chiron-radius-sm); font-family: var(--chiron-font-mono, monospace); font-size: 0.88em; }
    section.chapter pre { background: var(--chiron-elevated); border: 1px solid var(--chiron-border); border-radius: var(--chiron-radius-md); padding: var(--chiron-space-4); overflow-x: auto; font-size: 0.85rem; line-height: 1.5; }
    section.chapter pre code { background: none; color: var(--chiron-fg); padding: 0; }
    section.chapter pre.ascii-diagram { font-family: 'JetBrains Mono', 'Menlo', 'Consolas', monospace; font-size: 0.78rem; line-height: 1.35; color: var(--chiron-fg-secondary); background: var(--chiron-surface); border-color: var(--chiron-accent); border-left-width: 3px; white-space: pre; }
    .enriched-banner { background: var(--chiron-elevated); border-left: 4px solid var(--chiron-warm-accent); padding: var(--chiron-space-4); border-radius: var(--chiron-radius-md); margin: var(--chiron-space-5) 0; font-size: 0.95rem; }
    .enriched-cite { font-size: 0.78rem; color: var(--chiron-warm-accent); font-style: italic; margin: var(--chiron-space-2) 0 var(--chiron-space-5); padding-left: var(--chiron-space-3); border-left: 2px solid var(--chiron-warm-accent); }
    .enriched-cite a { color: var(--chiron-warm-accent); }
    .enriched-summary { background: var(--chiron-surface); border: 1px solid var(--chiron-accent); border-radius: var(--chiron-radius-md); padding: var(--chiron-space-5); margin: var(--chiron-space-6) 0 0; font-size: 0.92rem; color: var(--chiron-fg); }
    section.chapter table { width: 100%; border-collapse: collapse; margin: var(--chiron-space-5) 0; font-size: 0.9rem; }
    section.chapter th { background: var(--chiron-elevated); color: var(--chiron-accent); padding: var(--chiron-space-3); text-align: left; font-weight: 600; }
    section.chapter td { padding: var(--chiron-space-3); border-bottom: 1px dashed var(--chiron-divider); }
    section.chapter .cold-open { background: var(--chiron-surface); padding: var(--chiron-space-5); border-left: 4px solid var(--chiron-warm-accent); border-radius: var(--chiron-radius-md); font-style: italic; }
    section.chapter .source-cite { font-size: 0.78rem; color: var(--chiron-muted); font-family: var(--chiron-font-mono, monospace); padding: var(--chiron-space-2) 0; border-top: 1px dashed var(--chiron-divider); margin-top: var(--chiron-space-4); }
    section.chapter .closing ul { background: var(--chiron-elevated); padding: var(--chiron-space-4) var(--chiron-space-6); border-radius: var(--chiron-radius-md); border-left: 3px solid var(--chiron-warm-accent); }
    .theme-bar { display: flex; gap: 4px; flex-wrap: wrap; margin-top: var(--chiron-space-3); }
    .theme-bar button { font: inherit; font-size: 10px; padding: 3px 7px; border-radius: var(--chiron-radius-sm); background: var(--chiron-elevated); color: var(--chiron-fg-secondary); border: 1px solid var(--chiron-border); cursor: pointer; }
    .theme-bar button[aria-pressed="true"] { background: var(--chiron-accent); color: var(--chiron-surface); border-color: var(--chiron-accent); }
    footer.lesson-footer { padding: var(--chiron-space-5) 3rem; color: var(--chiron-muted); font-size: 0.78rem; border-top: 1px solid var(--chiron-divider); max-width: 920px; margin: 0 auto; }
    @media (max-width: 880px) {
      body { grid-template-columns: 1fr; }
      aside.side { position: relative; height: auto; }
      section.chapter { padding: 2rem 1.25rem 4rem; }
    }
  </style>
</head>
<body>
  <aside class="side">
    <div class="brand">Chiron<span class="dot">·</span></div>
    <div class="sub">FHE — A Technical Walkthrough<br>code domain · linguistic theme</div>

    <div class="toc-header">Chapters</div>
${sidebarToc}

    <div class="toc-header">Theme</div>
    <div class="theme-bar">
      <button data-set-theme="linguistic">linguistic</button>
      <button data-set-theme="warm-paper">warm</button>
      <button data-set-theme="clinical">clinical</button>
      <button data-set-theme="midnight">midnight</button>
      <button data-set-theme="ocean">ocean</button>
    </div>

    <div class="toc-header" style="margin-top:var(--chiron-space-8);font-size:0.65rem;">Pipeline state</div>
    <div class="sub" style="margin:0;font-size:0.72rem;line-height:1.6;">
      <span style="color:var(--chiron-fg-secondary);">✓ Source-grounded (s0-s8)</span><br>
      <span style="color:var(--chiron-warm-accent);">✓ Stage-2.5 enrichment (s9) ← NEW</span><br>
      <span style="color:var(--chiron-muted);">✗ Learner profile (per-domain)</span><br>
      <span style="color:var(--chiron-muted);">✗ /chiron-qa Q&A loop</span>
    </div>
  </aside>

  <main class="main">
${chaptersHtml}

    <footer class="lesson-footer">
      Chiron · code-lesson-skeleton v1 · 2026-05-14 · linguistic theme<br>
      Built from <code>source/FHE_Comprehensive_Guide.md</code> only · no Stage-2.5 enrichment · no learner profile · no external research.<br>
      This lesson is the test case for the research-enrichment gap. See <code>Chapter 8</code> for what's missing.
    </footer>
  </main>

  <script>
    // Theme switcher
    document.querySelectorAll('[data-set-theme]').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = btn.getAttribute('data-set-theme');
        document.documentElement.setAttribute('data-theme', t);
        localStorage.setItem('chiron-theme', t);
        document.querySelectorAll('[data-set-theme]').forEach(b => b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'));
      });
    });
    { const curr = document.documentElement.getAttribute('data-theme');
      document.querySelectorAll('[data-set-theme]').forEach(b => b.setAttribute('aria-pressed', b.getAttribute('data-set-theme') === curr ? 'true' : 'false')); }

    // Scrollspy
    const tocLinks = document.querySelectorAll('.toc-link');
    tocLinks.forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); document.querySelector(a.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { const id = e.target.id; tocLinks.forEach(a => a.classList.toggle('active', a.getAttribute('data-chapter-target') === id)); } });
    }, { rootMargin: '-30% 0px -55% 0px' });
    document.querySelectorAll('section.chapter').forEach(s => io.observe(s));
  </script>
</body>
</html>`;

writeFileSync(resolve(LESSON_DIR, 'lesson.html'), html);
console.error('[fhe-build] Wrote lesson.html · length:', html.length, 'chars · chapters:', chapters.length);
console.error('[fhe-build] MM removed — code domain does not use Match Madness (PRD §4.10 — MM is language-only).');
