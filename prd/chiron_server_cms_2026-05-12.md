# Chiron Server / CMS — Design PRD v1

**Date:** 2026-05-12
**Status:** DRAFT — design complete (deep research + paired debate done), P0.5 build pending
**Owner:** Gyasi Sutton (solo)
**Audience:** future-Gyasi + any AI agent doing the buildout
**Related:** [`chiron_design_v1_2026-04-28.md`](./chiron_design_v1_2026-04-28.md) (the parent skill design — this PRD layers ON TOP of it)

**Delete when:** P1 (Pi 4 on home LAN, phone reviews working end-to-end) ships and validates against all 7 success criteria (§9). Then graduate to `library/L00X_chiron_server.md`.

---

## 1. Executive Summary

**Chiron Server is a lightweight CMS that hosts, aggregates, and exposes the lessons that the Chiron skill (the generator) produces.** It runs as a single Docker image that lifts unchanged from laptop → Raspberry Pi 4 → AWS, with no Claude Code dependency on the CMS side. Stack: **Hono + Bun + bun:sqlite + Tailwind CDN**, ~500 LOC total for P0.5.

| Property | Value |
|---|---|
| **Stack** | Hono (TS framework) on Bun runtime, `bun:sqlite` for N-DB reads, Tailwind CDN for mobile UI |
| **Image size** | ~85MB (oven/bun:1-alpine), multi-arch ARM64+amd64 |
| **RAM footprint** | ~30-50MB idle |
| **Roles separated** | Generator (laptop/AWS, runs Claude Code) ≠ CMS (Pi 4/AWS, no Claude Code) |
| **Communication** | Generator POSTs `bundle.zip` to CMS `/api/upload` with bearer token |
| **Source of truth** | Per-lesson `.chiron-state.db` files remain canonical — the CMS is a pipe, not a master DB |
| **Phased rollout** | P0.5 Docker on laptop (LAN) → P1 Pi 4 (LAN) → P2 AWS Lightsail or Pi + Tailscale Funnel (anywhere-access) |
| **v1 sync layer** | None — single CMS instance is the source of truth, phone hits it over LAN / Tailscale |
| **Auth** | Single bearer token in env var; minimal for LAN, hardened for public exposure |

**Why this stack:** Hono+Bun is the only finalist that doesn't fight Chiron's "lesson-as-a-folder + per-lesson SQLite" data model. PocketBase forces single-master-DB; Payload v3 needs 1GB+ RAM. Full reasoning in §3.

---

## 2. Context & Motivation

The parent design PRD ([`chiron_design_v1_2026-04-28.md`](./chiron_design_v1_2026-04-28.md)) defined Chiron as a Claude Code skill that emits self-contained `lesson.html` + per-lesson SQLite into `lessons/<slug>/`. As of 2026-05-12, that skill is scaffolded and has generated at least one real lesson (`lessons/klinefelter-syndrome-2026-05-03/`).

**The gap:** Chiron today runs only on the dev laptop. The user wants to:

1. **Browse all lessons from a phone** (library view)
2. **Review SR cards on a phone** — aggregated across ALL generated lessons (not per-lesson)
3. **Trigger lesson generation remotely** (eventually — defer to P2/v2)
4. **Get reminders** when cards are due (Telegram / email / iOS Shortcuts — defer to P2)
5. **Lift the whole thing onto a Pi 4** at home to drop the AWS bill once stable

**The architectural decision that gates everything else:** generation (which needs Claude Code + minutes of compute) is *decoupled* from hosting/serving (which needs barely any compute). They run on different boxes communicating via uploaded bundles. This decoupling is what makes a Pi 4 (4GB) a viable CMS target.

---

## 3. Final Architecture — 7 Locked Decisions

Synthesized from a Gemini deep-research call (27 min, completed 2026-05-12) and a 3-round Claude × Gemini paired debate (same day).

| # | Axis | Locked Decision | Why |
|---|---|---|---|
| 1 | **CMS stack** | Hono + Bun + bun:sqlite + Tailwind CDN | Only finalist that respects N-per-lesson-SQLite as the data model. PocketBase forces single-master-DB and its JS hooks (Goja) can't open external SQLite files. Payload v3 needs 1GB+ RAM, OOMs on Pi 4 / t4g.nano. |
| 2 | **Generator ≠ CMS** | Two separate roles; CMS does NOT run Claude Code | Pi 4 (4GB) cannot run Claude Code + Chiron + node_modules + CMS together. Decoupling makes Pi 4 sufficient. |
| 3 | **Upload protocol** | Generator POSTs `bundle.zip` to CMS `/api/upload` with bearer auth | Simplest protocol that works the same way LAN or public. Bundle = `manifest.json` + `lesson.html` + `.chiron-state.db` + `assets/`. |
| 4 | **Source of truth** | Per-lesson `.chiron-state.db` files remain canonical on the CMS | Preserves the "self-contained portable artifact" property locked in `chiron_design_v1` §8. Lesson.html's in-page SR review reads from its own DB via CMS API. No schema drift between Chiron skill and CMS. |
| 5 | **N-DB aggregation** | CMS does `fs.readdir + bun:sqlite open` in a loop per request; no caching in P0.5 | Trivial ~30 LOC, single source of truth, schema-agnostic (`SELECT * FROM sr_cards` — whatever columns exist). Performance is fine at 10-200 lessons; add cache later if it bottlenecks. |
| 6 | **Sync layer** | None for v1 — "don't sync, just hit the server" via LAN or Tailscale Funnel | Single user, single CMS instance. Sync is a solved problem (Tailscale auth + a single endpoint). Turso embedded replicas / LiteFS are overkill until you actually need offline mobile reviews. |
| 7 | **Phased rollout** | P0.5 Docker on laptop (LAN) → P1 Pi 4 (LAN) → P2 anywhere-access via Tailscale Funnel | Same Docker image at every stage. Multi-arch build means one `docker push` covers laptop + Pi + AWS. Security cliff sits between P1 and P2. |

**Three generalizing lessons from the debate:**

1. **"Transport format ≠ storage format" is a tempting reframe that breaks Chiron's design.** The `.chiron-state.db` IS storage. Ingesting into a master DB would destroy the round-trippable artifact and introduce schema drift between Chiron's TypeScript and any CMS schema.
2. **Free admin UI is not free if it forces the wrong data model.** PocketBase's admin UI is genuinely nice — but it costs you Chiron's portability property. Hono+Bun loses the free admin UI but keeps the data model intact; the admin debugger is `bun:sqlite` REPL on the same machine.
3. **For a Pi 4 (4GB) target, every 100MB of CMS RAM costs you another lesson concurrency.** PocketBase (15MB) and Hono+Bun (30-50MB) both pass. Payload v3 (300MB+ idle, 1GB+ minimum) fails. The cheap-hardware constraint is what disqualified Payload, not its UX.

---

## 4. Phased Rollout

Same Docker image, three different hardware targets, increasing security posture.

### Phase 0 (today, no change)
- Chiron generator runs locally on dev laptop
- No server
- Lessons live in `~/dev/projects/chiron/lessons/`, opened directly in browser

### Phase 0.5 — Docker POC on laptop (the ~1 day build)

| Aspect | Detail |
|---|---|
| **Where the CMS runs** | Docker container on the dev laptop, port published to LAN |
| **Phone reaches it via** | `http://192.168.x.x:3000` on home WiFi |
| **Security posture** | Single bearer token in env var; HTTP fine on LAN |
| **Generator** | Still the laptop. Chiron skill gains an "upload to CMS after generation" step. |
| **Purpose** | Validate the whole architecture end-to-end before any hardware spend |
| **Exit criterion** | Phone can browse `/library`, open `/l/<slug>/lesson.html`, review SR cards at `/review`, ratings persist |

### Phase 0.5b — Multi-machine dev variant (parallel option to 0.5)

If you intend to dev Chiron from **more than one machine** (e.g. a second laptop, a desktop, a Pi 5 workstation) from day 1, start the CMS on a small AWS Lightsail instance ($5/mo, 512MB RAM) instead of (or in addition to) your laptop. The CMS is then reachable by every dev machine over the public internet, behind the bearer token. No machine needs to be online for any other to work.

| Aspect | Detail |
|---|---|
| **Where the CMS runs** | AWS Lightsail (cheapest 512MB tier, $5/mo with public IPv4) |
| **All dev machines reach it via** | `https://<your-domain>` or `https://chiron.<lightsail-default>.com` |
| **Security posture** | Bearer token + Caddy/Traefik TLS; consider IP allowlist or Tailscale tailnet if you want to skip public HTTPS hardening |
| **Generator** | Any laptop / desktop / Pi running Claude Code + Chiron skill, configured with `CHIRON_CMS_URL` env var |
| **Purpose** | Single source of truth for lessons across all your dev machines from day 1 |
| **Exit criterion** | Two dev machines, both can generate, both see the same `/library` |

This collapses cleanly back to P1 (move container to Pi 4 at home, Tailscale Funnel for outside-home access) — the AWS box is just a temporary dev hub. The decision is purely about whether you want a stable always-on endpoint *from the very first day of building the CMS*.

### Phase 1 — Pi 4 on home LAN

| Aspect | Detail |
|---|---|
| **Where the CMS runs** | Same Docker image on a Pi 4 (4GB), connected to home LAN |
| **Phone reaches it via** | `http://chiron.local:3000` (mDNS) or `http://192.168.x.x:3000` |
| **Security posture** | Same bearer token. Still HTTP-only inside the home. |
| **Generator** | Still the laptop. Pushes bundles to Pi over LAN. |
| **Purpose** | Move the always-on CMS off the laptop. Laptop becomes pure generator. |
| **Exit criterion** | Pi runs 24/7, phone hits it from anywhere on home WiFi, generator pushes from laptop |

### Phase 2 — Anywhere-access (Tailscale Funnel OR AWS)

Two sub-paths, pick one based on cost/control preference:

**Path 2a — Pi 4 + Tailscale Funnel**
- Same Pi 4 from P1, plus Tailscale + `tailscale funnel` to expose port 3000 as `https://chiron.your-domain.ts.net`
- Free. TLS terminated by Tailscale. Auth is Tailscale identity (you only).
- Risk: home internet outage = no access from phone outside home

**Path 2b — AWS Lightsail $5/mo or t4g.nano $3/mo**
- Same Docker image deployed to AWS Graviton
- TLS via Caddy/Traefik reverse proxy
- Bearer token + rate limiting
- Migration to AWS is `docker push` + `docker pull` on EC2 + `docker compose up`
- Lift to Pi later just reverses the move

### Phase 2.5 — Multi-machine generator workflow (orthogonal to security phases)

Independent of where the CMS lives, this phase formalizes **how multiple dev machines coexist as generators** without stepping on each other.

**The content/state split that makes this clean:**

| Artifact | Mutability | Where it lives |
|---|---|---|
| `lesson.html`, `manifest.json`, `assets/` | **Immutable** once generated (re-generation produces a new slug or explicit overwrite) | Canonical copy on CMS; generator copy is throwaway after upload |
| `.chiron-state.db` (sr_cards, quiz_attempts, mastery, bookmarks) | **Mutable** — updated on every review | **Only** on CMS. Generator ships an empty one with the initial bundle. From upload onward, the CMS owns it. |

**Concrete workflows:**

| Action | Steps |
|---|---|
| **Generate a new lesson on any machine** | Run Chiron skill locally → bundle is created in `./lessons/<slug>/` → skill auto-uploads to `CHIRON_CMS_URL` → optionally `rm -rf ./lessons/<slug>/` afterward |
| **View a lesson on a different machine** | Open `https://<cms>/l/<slug>/lesson.html` in browser. No local copy needed. |
| **Regenerate a lesson (different prompt)** | Two flavours: (a) generate with the same slug → CMS upload replaces (uses `status: 'updated'`); the `.chiron-state.db` is REPLACED, SR state lost — accept this for now; (b) generate with a new slug → both versions coexist on CMS |
| **Pull a lesson back to a dev machine for editing** | `curl -O https://<cms>/api/lesson/<slug>/bundle.zip` — CMS endpoint that re-zips the current state for download. **Defer to P2 — not in P0.5.** |
| **Two machines try to generate the same slug simultaneously** | Last upload wins. Surface a warning in the upload response. Acceptable for single user, not multi-user. |

**Key consequence:** dev machines do NOT need a local `lessons/` folder after upload. Treat the local `lessons/` as a scratch / staging area only. The CMS is the single source of truth for every machine including your phone.

### Phase 3 (deferred, design only) — full feature set

Not in v1 scope; listed so we don't accidentally architect them out:
- Remote lesson generation (phone-triggered): phone POSTs `{topic, source_url}` to `/api/generate-request`, CMS records a pending request, generator-side daemon polls and fulfills
- Push notifications / Telegram bot for reminders
- In-browser lesson editing
- Multi-user (not planned, but the bearer-token-per-user upgrade is trivial)

---

## 5. CMS Server File Layout

New top-level folder under the Chiron project. Does NOT live inside `skill/` — the skill is the generator, this is the consumer.

```
~/dev/projects/chiron/
└── server/
    ├── src/
    │   ├── index.ts          # Hono app entry, route mounting, port binding
    │   ├── auth.ts           # Bearer token middleware (single env var)
    │   ├── upload.ts         # POST /api/upload — zip unpack, manifest validation
    │   ├── library.ts        # GET /api/library — list all lessons with metadata
    │   ├── sr-queue.ts       # GET /api/queue — N-DB aggregation across lessons
    │   ├── review.ts         # POST /api/review — write SM-2 update back to per-lesson DB
    │   ├── static.ts         # GET /l/:slug/* — serve lesson.html + assets
    │   ├── ui-library.ts     # GET / — mobile-friendly library page (HTML string)
    │   ├── ui-review.ts      # GET /review — mobile-friendly review page (HTML string)
    │   ├── types.ts          # Shared TS interfaces: Manifest, SrCard, LessonMeta
    │   └── db.ts             # bun:sqlite helpers: open by slug, list DBs, safe-close
    ├── lessons/              # gitignored; volume-mounted in Docker
    │   └── <slug>/
    │       ├── manifest.json
    │       ├── lesson.html
    │       ├── .chiron-state.db
    │       └── assets/
    ├── tests/
    │   ├── fixtures/         # 2-3 tiny test bundles
    │   └── smoke.sh          # curl-based end-to-end test
    ├── Dockerfile            # multi-arch ARM64 + amd64
    ├── docker-compose.yml    # P0.5 laptop, P1 Pi (same file, different env)
    ├── .env.example          # CHIRON_TOKEN=...
    ├── .gitignore            # lessons/, .env, bun.lockb optional
    ├── package.json
    ├── tsconfig.json
    └── README.md             # quickstart: docker compose up
```

**Total file count for P0.5:** 13 source files + Docker bits + tests = ~17 files. Achievable in 1 focused day.

---

## 6. Dependencies (`package.json`)

```json
{
  "name": "chiron-server",
  "version": "0.1.0",
  "module": "src/index.ts",
  "type": "module",
  "scripts": {
    "dev": "bun --watch run src/index.ts",
    "start": "bun run src/index.ts",
    "test": "bash tests/smoke.sh"
  },
  "dependencies": {
    "hono": "^4.6.0",
    "adm-zip": "^0.5.16",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/adm-zip": "^0.5.5",
    "bun-types": "^1.1.0",
    "typescript": "^5.6.0"
  }
}
```

Five runtime dependencies total (`hono`, `adm-zip`, `zod` + Bun's bundled `bun:sqlite` + Bun's bundled cron). No ORM. No build toolchain.

---

## 7. REST API

All endpoints under bearer-token auth except `/health` and `/l/:slug/*` (static assets — auth-on-static deferred to P2 for easier mobile browser debugging).

| Method | Path | Auth | Description | Request shape | Response shape |
|---|---|---|---|---|---|
| `GET` | `/health` | No | Heartbeat | — | `{ ok: true, version, lessons_count }` |
| `GET` | `/` | Yes | UI: library page (HTML) | — | HTML |
| `GET` | `/review` | Yes | UI: SR review page (HTML) | — | HTML |
| `POST` | `/api/upload` | Yes | Upload a lesson bundle | `multipart/form-data` with `bundle` file (zip) | `{ slug, status: 'created' \| 'updated', warnings: string[] }` |
| `GET` | `/api/library` | Yes | List all lessons | — | `LessonMeta[]` |
| `GET` | `/api/lesson/:slug` | Yes | Get one lesson's metadata + state summary | — | `LessonMeta & { due_cards: number, mastery: number }` |
| `GET` | `/api/queue` | Yes | Cross-lesson SR queue, sorted by `next_due_at` | `?limit=50&offset=0` | `{ cards: SrCard[], total: number }` |
| `POST` | `/api/review/:slug/:card_id` | Yes | Submit SR review rating, writes SM-2 update back to per-lesson DB | `{ rating: 1\|2\|3\|4 }` | `{ next_due_at, new_interval_days, new_ease_factor }` |
| `GET` | `/l/:slug/*` | No (P0.5) | Static lesson assets | — | file bytes |
| `DELETE` | `/api/lesson/:slug` | Yes | Delete a lesson (rm -rf the folder) | — | `{ status: 'deleted' }` |

**TypeScript shapes** (`src/types.ts`):

```typescript
export interface Manifest {
  slug: string;
  title: string;
  domain: 'code' | 'medicine' | 'language-de' | 'language-it' | 'research-paper' | string;
  generated_at: string;          // ISO8601
  chiron_version: string;        // semver of the generator
  source_meta?: Record<string, unknown>;
}

export interface LessonMeta extends Manifest {
  uploaded_at: string;           // server-side
  size_bytes: number;
  due_cards: number;             // computed at request time
  chapters_completed: number;
  last_reviewed_at: string | null;
}

export interface SrCard {
  card_id: number;
  slug: string;                  // injected by aggregator
  chapter_id: string;
  concept_id: string | null;
  card_type: string;
  front: string;
  back: string;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  next_due_at: number;           // unix ms
  last_reviewed_at: number | null;
}
```

These align with the per-lesson SQLite schema locked in `chiron_design_v1_2026-04-28.md` §8 — the CMS reads them as-is, no translation.

---

## 8. The Three Most Important Code Sketches

### 8.1 N-DB SR queue aggregator (`src/sr-queue.ts`)

The heart of the CMS. Opens every lesson's SQLite, runs the same `WHERE next_due_at <= now` query, merges results.

```typescript
import { Database } from 'bun:sqlite';
import { readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import type { SrCard } from './types';

const LESSONS_DIR = process.env.CHIRON_LESSONS_DIR || './lessons';

export function getDueCards(limit = 50, offset = 0): { cards: SrCard[]; total: number } {
  const now = Date.now();
  const allDue: SrCard[] = [];

  for (const slug of readdirSync(LESSONS_DIR)) {
    const dbPath = join(LESSONS_DIR, slug, '.chiron-state.db');
    if (!existsSync(dbPath) || !statSync(dbPath).isFile()) continue;

    let db: Database | null = null;
    try {
      db = new Database(dbPath, { readonly: true });
      const rows = db.query(`
        SELECT id AS card_id, chapter_id, concept_id, card_type,
               front, back, ease_factor, interval_days, repetitions,
               next_due_at, last_reviewed_at
        FROM sr_cards
        WHERE suspended = 0 AND next_due_at <= ?
      `).all(now) as Omit<SrCard, 'slug'>[];
      for (const r of rows) allDue.push({ ...r, slug });
    } catch (err) {
      console.warn(`[sr-queue] skipping ${slug}: ${err}`);
    } finally {
      db?.close();
    }
  }

  allDue.sort((a, b) => a.next_due_at - b.next_due_at);
  return { cards: allDue.slice(offset, offset + limit), total: allDue.length };
}
```

~30 lines. Schema-agnostic on every column except the join key (`id`, `next_due_at`, `suspended`). If Chiron adds a column to `sr_cards`, the aggregator doesn't change.

### 8.2 Bundle upload + unpack (`src/upload.ts`)

```typescript
import { Hono } from 'hono';
import AdmZip from 'adm-zip';
import { z } from 'zod';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join } from 'path';

const ManifestSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  domain: z.string().min(1),
  generated_at: z.string(),
  chiron_version: z.string(),
}).passthrough();

const LESSONS_DIR = process.env.CHIRON_LESSONS_DIR || './lessons';

export const upload = new Hono().post('/upload', async (c) => {
  const form = await c.req.formData();
  const file = form.get('bundle');
  if (!(file instanceof File)) return c.json({ error: 'no bundle field' }, 400);

  const buf = Buffer.from(await file.arrayBuffer());
  const zip = new AdmZip(buf);
  const entries = zip.getEntries();

  const manifestEntry = entries.find(e => e.entryName === 'manifest.json');
  if (!manifestEntry) return c.json({ error: 'manifest.json missing' }, 400);
  const manifest = ManifestSchema.parse(JSON.parse(manifestEntry.getData().toString('utf-8')));

  const dest = join(LESSONS_DIR, manifest.slug);
  const isUpdate = existsSync(dest);
  if (isUpdate) rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  zip.extractAllTo(dest, /* overwrite */ true);

  return c.json({ slug: manifest.slug, status: isUpdate ? 'updated' : 'created', warnings: [] });
});
```

Zod validates manifest, AdmZip unpacks, replace-on-update semantics. ~30 lines.

### 8.3 SM-2 review write-back (`src/review.ts`)

```typescript
import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
import { join } from 'path';

const LESSONS_DIR = process.env.CHIRON_LESSONS_DIR || './lessons';

// Standard SM-2 — same algorithm Chiron's lib/sr-scheduler.ts uses
function sm2(rating: 1|2|3|4, ease: number, interval: number, reps: number) {
  if (rating === 1) return { ease: Math.max(1.3, ease - 0.2), interval: 1, reps: 0 };
  const newReps = reps + 1;
  const newInterval = newReps === 1 ? 1 : newReps === 2 ? 6 : Math.round(interval * ease);
  const newEase = Math.max(1.3, ease + (0.1 - (4 - rating) * (0.08 + (4 - rating) * 0.02)));
  return { ease: newEase, interval: newInterval, reps: newReps };
}

export const review = new Hono().post('/review/:slug/:card_id', async (c) => {
  const { slug, card_id } = c.req.param();
  const { rating } = await c.req.json();
  if (![1, 2, 3, 4].includes(rating)) return c.json({ error: 'rating must be 1-4' }, 400);

  const db = new Database(join(LESSONS_DIR, slug, '.chiron-state.db'));
  try {
    const card = db.query('SELECT ease_factor, interval_days, repetitions FROM sr_cards WHERE id = ?').get(card_id) as any;
    if (!card) return c.json({ error: 'card not found' }, 404);

    const { ease, interval, reps } = sm2(rating, card.ease_factor, card.interval_days, card.repetitions);
    const nextDueAt = Date.now() + interval * 86400000;
    const now = Date.now();

    db.run(`UPDATE sr_cards SET ease_factor = ?, interval_days = ?, repetitions = ?, next_due_at = ?, last_reviewed_at = ? WHERE id = ?`,
      [ease, interval, reps, nextDueAt, now, card_id]);
    db.run(`INSERT INTO sr_review_log (card_id, reviewed_at, rating, interval_days_after) VALUES (?, ?, ?, ?)`,
      [card_id, now, rating, interval]);

    return c.json({ next_due_at: nextDueAt, new_interval_days: interval, new_ease_factor: ease });
  } finally {
    db.close();
  }
});
```

Writes back to the per-lesson SQLite directly — single source of truth preserved. ~30 lines.

---

## 9. Dockerfile + Compose

### `Dockerfile`

```dockerfile
FROM oven/bun:1-alpine
WORKDIR /app

COPY package.json bun.lockb* ./
RUN bun install --production --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src

RUN mkdir -p lessons
ENV CHIRON_LESSONS_DIR=/app/lessons
ENV PORT=3000
EXPOSE 3000

CMD ["bun", "run", "src/index.ts"]
```

Build multi-arch with one command:

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t chiron-server:0.1.0 --push .
```

### `docker-compose.yml`

```yaml
services:
  chiron:
    image: chiron-server:0.1.0
    container_name: chiron-server
    ports:
      - "3000:3000"
    environment:
      - CHIRON_TOKEN=${CHIRON_TOKEN}
      - CHIRON_LESSONS_DIR=/app/lessons
    volumes:
      - ./lessons:/app/lessons
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
```

Same file works on laptop (P0.5), Pi 4 (P1), and AWS (P2) — only env file changes.

---

## 10. Mobile UI Design Notes

Two pages, both server-rendered HTML strings with Tailwind via CDN. No SPA, no build step, no React. Browser back-button works naturally.

### `/` (library)

```
┌───────────────────────────────┐
│ Chiron                     ⚙  │
├───────────────────────────────┤
│ 🔴 12 cards due today         │
│    [Start Review]             │
├───────────────────────────────┤
│ Lessons                       │
│                               │
│ 📘 Klinefelter Syndrome       │
│    medicine · 23 cards · 5🔴  │
│                               │
│ 📗 Dative Case (DE)           │
│    language-de · 41 cards     │
│                               │
│ 📙 Pneumonia AMBOSS           │
│    medicine · 18 cards · 7🔴  │
└───────────────────────────────┘
```

Tap a lesson → open `/l/<slug>/lesson.html` directly. Tap "Start Review" → `/review`.

### `/review`

```
┌───────────────────────────────┐
│ ← back            12 left     │
├───────────────────────────────┤
│                               │
│   What is the typical         │
│   karyotype in Klinefelter    │
│   syndrome?                   │
│                               │
│   [Show Answer]               │
│                               │
└───────────────────────────────┘

After tap:
┌───────────────────────────────┐
│ ← back            12 left     │
├───────────────────────────────┤
│   Question (above)            │
│   ───                         │
│   47,XXY                      │
│                               │
│ [Again] [Hard] [Good] [Easy]  │
└───────────────────────────────┘
```

The four rating buttons POST to `/api/review/:slug/:card_id` and advance to the next card. ~150 LOC total for both pages.

---

## 11. P0.5 Success Criteria

P0.5 ships when **all 7** are met:

1. ✅ `docker compose up` on laptop, container healthy
2. ✅ Generator's existing `lessons/klinefelter-syndrome-2026-05-03/` can be zipped (with a manifest.json added) and POSTed to `/api/upload`, returns `{ status: 'created' }`
3. ✅ Phone on home WiFi can browse `http://<laptop-ip>:3000/` (library page), see the uploaded lesson, tap to open `lesson.html`, lesson renders correctly
4. ✅ `/api/queue` aggregates SR cards across ≥2 uploaded lessons, sorted by `next_due_at`
5. ✅ Phone can review cards at `/review`, ratings POST successfully, next card appears
6. ✅ Re-opening the same lesson.html shows the updated SR state (in-lesson review surface reflects the phone reviews — proves single source of truth)
7. ✅ Multi-arch ARM64 image builds and runs at least on `qemu-user-static` emulation on the laptop (Pi 4 hardware test deferred to P1)

---

## 12. Buildout Plan — The Day-Long Sprint

Single focused day. Cut-scope plan baked in.

| Hour | Milestone | Cut-scope fallback |
|---|---|---|
| **H1** (09:00) | `bun init`, Hono scaffold, `/health` returns 200, Docker file builds locally | If Hono setup snags, fall back to `Bun.serve` directly — Hono adds ergonomics not capability |
| **H2** (10:00) | `/api/upload` works via curl; zip extracts to `lessons/<slug>/`; manifest.json validated by zod | If adm-zip fails on Bun, swap to `bun run unzip` shell-out — works fine |
| **H3** (11:00) | `/l/:slug/*` static file serving via `serveStatic`; can open `lesson.html` in browser through the server | Trivial; if slips, just chain `Bun.file()` reads |
| **H4** (12:00) | `/api/library` returns `LessonMeta[]` from filesystem walk + manifest reads | — |
| **LUNCH** | — | — |
| **H5** (14:00) | `/api/queue` N-DB aggregator works end-to-end with 2 real lessons | If `bun:sqlite` quirks, fall back to `better-sqlite3` (works on Bun) |
| **H6** (15:30) | `/api/review/:slug/:card_id` writes back SM-2 update; verify in-lesson review surface picks up the change next page load | — |
| **H7** (17:00) | `/` and `/review` HTML pages, mobile-tested on phone over LAN | If short on time, defer `/review` UI — phone can still use the in-lesson review per-lesson |
| **H8** (18:30) | `docker compose up` from laptop, phone hits `http://192.168.x.x:3000`, exit criterion #3 passes | — |

**At every milestone, commit with a checkpoint message** (`P0.5 milestone H<N>: ...`) so rollback is trivial.

---

## 13. The First Smoke Test (`tests/smoke.sh`)

```bash
#!/usr/bin/env bash
set -euo pipefail

TOKEN="${CHIRON_TOKEN:-test-token}"
HOST="${CHIRON_HOST:-http://localhost:3000}"

echo "=== 1. Health check"
curl -fsS "$HOST/health" | jq .

echo "=== 2. Build test bundle"
TMP=$(mktemp -d)
cp -r ../lessons/klinefelter-syndrome-2026-05-03/* "$TMP/"
cat > "$TMP/manifest.json" <<EOF
{
  "slug": "klinefelter-test",
  "title": "Klinefelter Syndrome (test)",
  "domain": "medicine",
  "generated_at": "$(date -Iseconds)",
  "chiron_version": "0.1.0"
}
EOF
(cd "$TMP" && zip -r /tmp/bundle.zip .)

echo "=== 3. Upload bundle"
curl -fsS -X POST -H "Authorization: Bearer $TOKEN" \
  -F "bundle=@/tmp/bundle.zip" \
  "$HOST/api/upload" | jq .

echo "=== 4. List library"
curl -fsS -H "Authorization: Bearer $TOKEN" "$HOST/api/library" | jq .

echo "=== 5. Get queue"
curl -fsS -H "Authorization: Bearer $TOKEN" "$HOST/api/queue?limit=5" | jq .

echo "=== 6. Submit a fake review (rating=3 = 'good')"
CARD_ID=$(curl -fsS -H "Authorization: Bearer $TOKEN" "$HOST/api/queue?limit=1" | jq -r '.cards[0].card_id // 1')
curl -fsS -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"rating":3}' \
  "$HOST/api/review/klinefelter-test/$CARD_ID" | jq .

echo "=== ALL PASSED ✓"
```

---

## 14. Generator-Side Change

The Chiron skill (the generator at `skill/SKILL.md`) needs a small addition for P0.5: an optional post-generation "push to CMS" step.

Minimal change — add to skill workflow after lesson assembly:

```bash
# If CHIRON_CMS_URL is set, push the bundle
if [ -n "${CHIRON_CMS_URL:-}" ]; then
  (cd "$lesson_dir" && zip -r /tmp/bundle.zip .)
  cat > /tmp/manifest.json <<EOF
{"slug":"$slug","title":"$title","domain":"$domain","generated_at":"$(date -Iseconds)","chiron_version":"$chiron_version"}
EOF
  zip /tmp/bundle.zip /tmp/manifest.json
  curl -fsS -X POST -H "Authorization: Bearer $CHIRON_CMS_TOKEN" \
    -F "bundle=@/tmp/bundle.zip" \
    "$CHIRON_CMS_URL/api/upload"
fi
```

Defer making this a first-class skill option until P0.5 validates end-to-end.

---

## 15. Intentionally Deferred (NOT in P0.5 or P1)

| Feature | Defer to | Why |
|---|---|---|
| Telegram bot / push notifications | P2 | Independent of CMS choice; `Bun.Cron` + node-telegram-bot-api is a 1-hour addition |
| Cross-device SQLite sync (Turso / LiteFS) | After P2 if ever | Single CMS instance is the source of truth; phone hits it via Tailscale |
| Phone-triggered remote lesson generation | P2 / v2 | Needs a generator-side daemon polling CMS for requests — designed but not built |
| In-browser lesson editing | v2 | Explicitly deferred in parent design PRD |
| Multi-user / sharing | Indefinitely | Not a goal |
| S3 / R2 backup of lessons | After P2 | `rsync` to a second box covers it for now |
| Observability (Prom / OpenTelemetry) | After P2 | `console.log` + `docker logs` for one user |
| Rate limiting / DDoS protection | P2 (when exposed publicly) | Tailscale Funnel handles auth; behind Cloudflare for public |
| Per-user bearer tokens | When multi-user comes (never?) | Single token is fine for one user |

---

## 16. Open Questions / Hypotheses (resolve during build)

| # | Question | How to resolve |
|---|---|---|
| 1 | Does `bun:sqlite` on Bun 1.x have any quirks reading 50-200 DBs in a loop? | Stress test in H5 with synthetic bundles |
| 2 | Is the in-lesson SR review surface reading via CMS API (cross-origin from `file://`?) — does it need CORS or does it work because everything is served from the same origin under `/l/:slug/`? | Same-origin under `/l/:slug/`, so no CORS — verify in H8 |
| 3 | Pi 4 (4GB) RAM headroom — how much do uploads spike? | Profile during P1 with a 20MB bundle |
| 4 | Does `docker buildx --platform linux/arm64` produce an image that actually runs on Pi 4 (Cortex-A72)? | Test before buying any Pi if you don't already have one |
| 5 | When Chiron's TS schema adds a column to `sr_cards`, does the CMS aggregator silently keep working? | Manual test by hand-adding a column to one fixture DB |
| 6 | Is `adm-zip` happy under Bun, or do we need to swap to `bun run unzip`? | H2 will reveal |
| 7 | Bundle size for a real lesson with chemistry molecules and TTS audio — could exceed 10MB upload limit? | Measure with the existing klinefelter lesson; raise limit if needed |

---

## 16.5 Functional Requirements (Speckit-ready)

Numbered for `/speckit-specify` ingestion. Each FR has an explicit acceptance criterion.

### Core CMS (P0.5)

- **FR-001 — Bundle upload accepts a valid Chiron-format zip.** A POST to `/api/upload` with a multipart `bundle` field containing `manifest.json` + `lesson.html` + `.chiron-state.db` + optional `assets/` MUST extract to `lessons/<slug>/` and return `{ slug, status: 'created'\|'updated', warnings: string[] }` within 5 seconds for bundles ≤20MB.
- **FR-002 — Manifest schema is validated and reject invalid bundles.** Missing `slug`, invalid `slug` regex (`^[a-z0-9-]+$`), or missing required manifest fields MUST cause a 400 response with a specific error message; no partial extraction is allowed.
- **FR-003 — Library endpoint lists all uploaded lessons.** GET `/api/library` MUST return `LessonMeta[]` for every lesson directory containing a valid `manifest.json`, including `due_cards` count computed from the per-lesson SQLite.
- **FR-004 — Static lesson serving works for the unmodified lesson.html.** GET `/l/:slug/*` MUST serve `lesson.html` and all `assets/` files with correct MIME types and without modification of the HTML.
- **FR-005 — Cross-lesson SR queue aggregates due cards from all lessons.** GET `/api/queue?limit=N&offset=M` MUST return cards from ALL `lessons/<slug>/.chiron-state.db` where `next_due_at <= now()` AND `suspended = 0`, sorted ascending by `next_due_at`, including the originating `slug` on each card.
- **FR-006 — SR review writes back to the originating per-lesson SQLite.** POST `/api/review/:slug/:card_id` with body `{ rating: 1\|2\|3\|4 }` MUST update `sr_cards` and append to `sr_review_log` in the correct per-lesson DB using standard SM-2, and return the new `next_due_at` / `interval_days` / `ease_factor`.
- **FR-007 — Single source of truth for SR state.** After a review via the CMS, re-opening that lesson's `lesson.html` and triggering its in-page review surface MUST reflect the updated state (NOT a stale copy).
- **FR-008 — Authentication via bearer token.** All write endpoints AND `/api/library`, `/api/queue`, `/api/lesson/:slug` MUST require a valid `Authorization: Bearer <token>` header where the token matches `process.env.CHIRON_TOKEN`. `/health` and `/l/:slug/*` are exempt in P0.5.
- **FR-009 — Lesson deletion.** DELETE `/api/lesson/:slug` MUST remove `lessons/<slug>/` recursively and return `{ status: 'deleted' }`.
- **FR-010 — Health endpoint.** GET `/health` MUST return 200 with `{ ok: true, version, lessons_count }` without authentication.

### Mobile UI (P0.5)

- **FR-011 — Mobile-friendly library page.** GET `/` MUST render a server-side HTML page that lists lessons with title, domain, due-card count, and a tap target opening `/l/<slug>/lesson.html`. MUST be readable and tappable on a 375px-wide screen (iPhone SE baseline).
- **FR-012 — Mobile-friendly review page.** GET `/review` MUST render a server-side HTML page that fetches one card at a time from `/api/queue`, shows the front, reveals the back on tap, and presents four rating buttons (Again/Hard/Good/Easy) that POST to `/api/review/:slug/:card_id`.

### Deployment (P0.5 → P2)

- **FR-013 — Multi-arch Docker image.** A single `docker buildx --platform linux/amd64,linux/arm64` build MUST produce an image that runs successfully on x86_64 Linux (laptop, AWS x86) and arm64 (Pi 4/5, AWS Graviton).
- **FR-014 — Stateless container, persistent volume.** All mutable state MUST live under `/app/lessons` (volume-mounted) so the container can be destroyed and recreated without data loss.
- **FR-015 — Same image runs P0.5 → P1 → P2 unchanged.** The image MUST NOT contain hardcoded URLs, hardcoded tokens, or environment-specific build steps; all config via env vars.

### Multi-machine dev (P0.5b / P2.5)

- **FR-016 — Generator-side upload step.** The Chiron skill MUST gain an optional post-generation step that, when `CHIRON_CMS_URL` and `CHIRON_CMS_TOKEN` are set, zips the just-generated `lessons/<slug>/` and POSTs it to `<CHIRON_CMS_URL>/api/upload`.
- **FR-017 — Re-upload semantics.** Re-uploading a bundle with an existing slug MUST replace the lesson content AND its `.chiron-state.db`. A non-fatal warning MUST be included in the response indicating prior SR state was discarded.
- **FR-018 — Two dev machines see the same library.** Given two dev machines A and B, both configured with the same `CHIRON_CMS_URL`, a lesson generated on A MUST appear in `/api/library` requests from B within 30 seconds of upload.

### Deferred (NOT in P0.5 — captured for future Speckit specs)

- **FR-019** (P2) — Bundle download endpoint: `GET /api/lesson/:slug/bundle.zip` re-zips current state for download.
- **FR-020** (P2) — Phone-triggered remote generation: `POST /api/generate-request` records a pending generation request; generator-side daemon polls.
- **FR-021** (P2) — Reminder scheduler: daily summary of due cards via Telegram or email.
- **FR-022** (v2) — In-browser lesson editing.

### Forward-compatible schema additions (data captured in v1, algorithms enabled in v2)

These columns are added to the per-lesson `.chiron-state.db` schema in P0.5 so the data is captured from day 1, even though the algorithms that consume them ship in v2. Derived from CureIQ prior-art synthesis (2026-05-12).

- **FR-023 — `quiz_attempts.response_ms` column.** Every quiz attempt MUST record time-to-answer in milliseconds (client-side measurement, sent in the review POST body). Enables future trend/calibration analysis.
- **FR-024 — `sr_cards.previous_times_correct` and `sr_cards.previous_response_ms` columns.** On every review write-back, the prior values of `repetitions`-weighted correctness and avg response time MUST be snapshotted to enable trend computation in v2 (delta-correctness, delta-response-time as a secondary surfacing signal alongside SM-2).
- **FR-025 — Trend factor AUGMENTS SM-2, does not replace it.** SM-2 remains the canonical `next_due_at` scheduler in v1 and v2. The trend factor (when implemented in v2) only adds a "trending worse" badge on the library page and optionally surfaces cards EARLIER than SM-2 would have, but does not override SM-2's scheduling.
- **FR-026 — `marked_cards` table per lesson.** Per-lesson DB MUST include `marked_cards(id, card_id, mark_type, notes, marked_at)` where `mark_type ∈ {'wrong', 'edit', 'regenerate', 'review'}`. POST `/api/mark/:slug/:card_id` with body `{ mark_type, notes? }` writes to it. Enables phone-side "this question is wrong" / "regenerate this" flagging. Lesson-expander reads `mark_type='regenerate'` to know what to refresh.
- **FR-027 — Manifest `sub_subject` field (optional).** Generator MAY include `sub_subject` in `manifest.json` (e.g., `domain: 'medicine'`, `sub_subject: 'cardiology'`). CMS MUST expose it for library filtering (`/api/library?subject=medicine&sub_subject=cardiology`).
- **FR-028 — Cross-lesson `study_sessions` DB at CMS root.** A separate SQLite (`<lessons_dir>/_chiron_sessions.db`) MUST record each phone-side review session with `start_time, end_time, total_questions, correct_answers, average_response_ms, total_pause_ms, mode (review|random|cram|recent)`. Wraps every `/review` flow. Enables session-level analytics in v2 ("how did Tuesday night's session go?"). Separate DB because sessions inherently span lessons.

---

## 16.6 Non-Functional Requirements

- **NFR-001 — Memory footprint.** Idle CMS process MUST consume ≤100MB RSS on the target hardware. Measured at hours 1, 6, and 24 of runtime.
- **NFR-002 — Cold start.** Container MUST be serving `/health` within 5 seconds of `docker compose up`.
- **NFR-003 — Queue aggregation latency.** `/api/queue?limit=50` MUST return in <500ms for up to 50 lessons and <2s for up to 200 lessons on Pi 4 (4GB) hardware. Above 200, a caching layer is acceptable to introduce.
- **NFR-004 — Upload size limit.** P0.5 accepts bundles ≤20MB. Configurable via env var. Reject larger with 413.
- **NFR-005 — No silent data loss.** Any failure during upload extraction MUST leave the previous lesson state intact (atomic replace, not in-place mutation).
- **NFR-006 — Logging.** Structured JSON logs to stdout (`docker logs` consumable), one line per request, with timestamp / method / path / status / duration_ms. No PII beyond the bearer token's existence (never log the token itself).
- **NFR-007 — Single-arch dependency parity.** Every NPM dependency MUST be ARM64-compatible. Verified during multi-arch buildx.
- **NFR-008 — No build step.** The container MUST run TypeScript via Bun directly. No transpilation step in the Dockerfile beyond `bun install`.
- **NFR-009 — Image size.** Final image ≤120MB compressed.
- **NFR-010 — Bus-factor.** Every runtime dependency MUST have a 2026-active GitHub repo with ≥1000 stars and a commit in the last 90 days. (Currently passes: hono, adm-zip, zod, oven/bun.)

---

## 16.7 User Stories (per phase, for Speckit)

### P0.5 stories (laptop, LAN-only)

- **US-101** — As a learner, when I generate a new lesson on my laptop, I want it to automatically appear in my home-WiFi-accessible library so I don't have to manually copy files.
- **US-102** — As a learner, when I'm on the couch with my phone, I want to open a library page on `http://<laptop-ip>:3000/`, tap any lesson, and have it open the full interactive lesson HTML.
- **US-103** — As a learner, I want a single review queue across ALL my lessons that surfaces "what's due today" without me having to pick a lesson first.
- **US-104** — As a learner, when I rate a card on my phone, I want the same review state to be reflected when I reopen that lesson's HTML on my laptop.
- **US-105** — As a developer, I want to validate the architecture before buying a Pi, so I want the whole stack runnable in Docker on my laptop in under a day.

### P1 stories (Pi 4, home LAN)

- **US-201** — As a developer, I want to lift the working Docker container from my laptop to a Pi 4 on my home network with a one-line `docker compose up`, so the CMS becomes always-on without keeping my laptop awake.
- **US-202** — As a learner, I want to access my library from any device on my home WiFi via `http://chiron.local:3000`, with no AWS bill.
- **US-203** — As a developer, I want the Pi to survive reboots and resume automatically, so I don't have to SSH in after a power blip.

### P2 stories (anywhere-access)

- **US-301** — As a learner, when I'm outside my home network (on the train, at a cafe), I want to review my cards via my phone with the same UX as at home, through a Tailscale Funnel URL.
- **US-302** — As a developer, I want optional AWS deployment via the same Docker image, so I can pick between $0/mo (Pi + Tailscale) and $5/mo (Lightsail) based on my reliability needs at any given time.

### P0.5b / P2.5 stories (multi-machine dev)

- **US-401** — As a developer with two laptops (laptop A at home, laptop B on the road), I want both machines to push generated lessons to the same CMS so I see a unified library regardless of where I generated them.
- **US-402** — As a developer, when I re-generate a lesson with the same slug on machine B that I previously generated on machine A, I want the CMS to clearly tell me prior SR state was discarded (no silent overwrite).
- **US-403** — As a developer, I want the option to skip a local `lessons/` folder entirely on a given machine, because the CMS is the source of truth.

---

## 16.8 Out of Scope (explicit)

For Speckit's benefit — these are NOT to be specified in the next round:

- Multi-user / shared lessons across people
- ACL / permissions beyond a single bearer token
- Real-time multi-device collaboration on a lesson
- Lesson editing UI (deferred to v2)
- WebRTC / WebSockets / SSE for any feature (defer until a concrete use case forces it)
- A native mobile app (web UI only)
- Offline phone reviews (defer — sync layer is non-goal for v1)
- Internationalization of the CMS UI itself (the lesson content is i18n, the CMS chrome is English-only)
- Backup / disaster recovery automation (manual `rsync` to a second box is fine for v1)
- Lesson search / full-text indexing
- A plugin system / extension API

---

## 17. Decisions Log

| Time | Decision | Rationale |
|---|---|---|
| 2026-05-12 | CMS stack = Hono + Bun + bun:sqlite | Only finalist that respects N-per-lesson-SQLite as the data model; 30-50MB RAM fits Pi 4 + AWS t4g.nano |
| 2026-05-12 | Generator and CMS are DECOUPLED — CMS does not run Claude Code | Pi 4 (4GB) cannot fit Claude Code + Chiron + CMS together; decoupling makes Pi 4 sufficient |
| 2026-05-12 | Per-lesson `.chiron-state.db` files remain the source of truth on the CMS (no master DB ingest) | Preserves the self-contained portable artifact property from `chiron_design_v1` §8; avoids schema drift between Chiron's TS and any CMS schema |
| 2026-05-12 | Sync layer = none (single CMS instance, phone hits it via LAN / Tailscale Funnel) | Single user; Turso / LiteFS are overkill |
| 2026-05-12 | Phased rollout: P0.5 Docker on laptop → P1 Pi 4 LAN → P2 AWS or Tailscale-exposed Pi | Same Docker image at every stage; multi-arch build covers ARM64 + amd64 |
| 2026-05-12 | Auth = single bearer token in env var for v1; harden to Tailscale-identity / Caddy + token in P2 | Single user, LAN-only in P0.5/P1 — minimal auth is fine |
| 2026-05-12 | Bundle format = zip with `manifest.json` + `lesson.html` + `.chiron-state.db` + `assets/` | Simplest portable format; zod validates manifest on upload |
| 2026-05-12 | Static lesson assets NOT auth-required in P0.5 | Easier mobile debugging; harden in P2 when exposed publicly |
| 2026-05-12 | PocketBase rejected | JS hooks (Goja) cannot open external SQLite — would force dropping to Go, defeating the "zero-ops binary" benefit; master-DB model fights the portable-artifact property |
| 2026-05-12 | Payload v3 rejected | 1GB+ RAM minimum disqualifies it from Pi 4 (4GB) and t4g.nano (512MB) cheap-hardware path |
| 2026-05-12 | Multi-machine dev = CMS is the single source of truth, dev machines are stateless generators | Eliminates a sync layer entirely; "machine A vs machine B" becomes identical to "laptop vs phone" — both just hit the CMS |
| 2026-05-12 | Lesson CONTENT is immutable post-generation; STATE lives only on CMS | Avoids the round-trip mutation problem; re-upload-same-slug discards prior SR state with a warning |
| 2026-05-12 | P0.5b AWS Lightsail variant added as a parallel option to laptop-Docker P0.5 | For users who want a stable always-on dev hub from day 1 without buying a Pi yet |

---

## 18. References

### Internal artifacts
- [`chiron_design_v1_2026-04-28.md`](./chiron_design_v1_2026-04-28.md) — parent design PRD (the skill / generator)
- [`universal_lesson_generator_2026-04-28.md`](./universal_lesson_generator_2026-04-28.md) — tracking PRD

### Sibling PRDs (added 2026-05-12)
This server PRD is a sibling of two generator-side PRDs. The lesson expander in particular adds **4 new endpoints to this server** (listed in its §8) — those endpoints are NOT in this PRD's P0.5 scope but MUST be added when the expander ships.

- [`chiron_generator_cureiq_synthesis_2026-05-12.md`](./chiron_generator_cureiq_synthesis_2026-05-12.md) — generator enhancements umbrella; image/RAG/multi-hop adapters that produce richer bundles this server consumes
- [`chiron_lesson_expander_2026-05-12.md`](./chiron_lesson_expander_2026-05-12.md) — first sub-feature of generator enhancements; **adds CMS endpoints** `GET /api/marked-cards`, `GET /api/lesson/:slug/bundle.zip`, `DELETE /api/mark/:slug/:card_id`, `POST /api/mark/:slug/:card_id` (the last is FR-026 already in this PRD; the other 3 are new)
- [`../memory-bank/systemPatterns.md`](../memory-bank/systemPatterns.md) — pedagogical architecture
- [`../memory-bank/techContext.md`](../memory-bank/techContext.md) — stack + SQLite schema
- [`../skill/SKILL.md`](../skill/SKILL.md) — current Chiron skill entry point (the generator)
- [`../lessons/klinefelter-syndrome-2026-05-03/`](../lessons/) — the first real generated lesson (P0.5 test fixture)

### Deep research
- Gemini deep-research-pro task `e8c3a5e8-e4b4-4b14-b62a-5b73be5cfbf1` (2026-05-12, 27 min) — full comparison of PocketBase / Hono+Bun / Payload v3 with 14 evaluation dimensions, sync layer evaluation, 2024-2026 Pi-hosted indie deployments

### Paired debate
- 3-round Claude × Gemini debate (2026-05-12) — Gemini steelmanned PocketBase, conceded on self-contained artifact + schema drift + JS-hook SQLite limitations; both sides converged on Hono+Bun

### External documentation
- [Hono](https://hono.dev) — TS web framework
- [Bun](https://bun.com) — JS runtime + `bun:sqlite` + `Bun.spawn` + `Bun.Cron`
- [Tailscale Funnel](https://tailscale.com/kb/1223/funnel) — anywhere-access exposure (P2)
- [oven/bun Docker images](https://hub.docker.com/r/oven/bun) — multi-arch ARM64 base image

### Patterns specifically NOT adopted
- PocketBase Unified Ingest pattern — would destroy the portable-artifact property
- Payload v3 master-DB / Drizzle ORM — wrong data shape, too heavy
- Turso embedded replicas / LiteFS — overkill for single-CMS-instance + single-user
- Litestream — backup, not real-time sync

---

## 19. Buildout signoff

**Design phase complete: 2026-05-12**
**Speckit handoff: blocked on TTS fix.** After TTS is fixed, this PRD will be ingested via `/speckit-specify` → `/speckit-clarify` → `/speckit-plan` → `/speckit-tasks` to turn §16.5 FRs into a tasks.md the build can execute against. The FR/NFR/user-story sections (§16.5-§16.8) are pre-structured for that handoff.

**P0.5 buildout starts: when user runs the day-long sprint**
**P1 deployment to Pi 4: when P0.5 ships green**
**Sessions to monitor: this PRD's Sessions section will auto-update as work progresses (when `prd diary <slug> append` is called).**

Next action (after TTS fix): run `/speckit-specify` against this PRD to formalize the P0.5 feature spec, then kick off the H1 milestone (scaffold `server/` folder, `bun init`, Hono `/health` endpoint).
