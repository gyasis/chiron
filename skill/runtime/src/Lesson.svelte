<script lang="ts">
  import type { ChironLesson, Block } from './lib/schema';
  import { quizState, progressState } from './lib/stores/lessonState.svelte';
  import Objective from './lib/blocks/Objective.svelte';
  import HighYield from './lib/blocks/HighYield.svelte';
  import Mnemonic from './lib/blocks/Mnemonic.svelte';
  import Pearl from './lib/blocks/Pearl.svelte';
  import Dialogue from './lib/blocks/Dialogue.svelte';
  import Quiz from './lib/blocks/Quiz.svelte';
  import Deck from './lib/blocks/Deck.svelte';
  import DeepVignette from './lib/blocks/DeepVignette.svelte';
  import FlashcardDrill from './lib/FlashcardDrill.svelte';
  import { onMount } from 'svelte';

  let { lesson }: { lesson: ChironLesson } = $props();

  // ----------------------------------------------------------------
  // URL params + view detection (set by inline <script> in lesson.html
  // before this component mounts, so attribute is already on <html>)
  // ----------------------------------------------------------------
  const view = $state({
    current: typeof document !== 'undefined' ? document.documentElement.getAttribute('data-view') ?? 'lesson' : 'lesson',
  });

  function chapterMatchesView(cid: string): boolean {
    if (view.current === 'vignette') return cid === lesson.chapters[lesson.chapters.length - 1].id;
    return true;
  }

  function blockMatchesView(b: Block): boolean {
    if (view.current === 'lesson') return true;
    if (view.current === 'quizzes') return b.type === 'quiz' || b.type === 'deepVignette';
    if (view.current === 'vignette') return b.type === 'deepVignette' || b.type === 'heading' || b.type === 'paragraph' || b.type === 'objective';
    return true;
  }

  // ----------------------------------------------------------------
  // Progress tracking — IntersectionObserver on chapter sections.
  // Mark "viewed" after 3s at ≥50% visibility. Mark "answered" when
  // all quizzes in chapter resolved.
  // ----------------------------------------------------------------
  const VIEW_DWELL_MS = 3000;
  const VIEW_THRESHOLD = 0.5;
  const dwellTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  let activeChapterId = $state<string | null>(null);

  function checkChapterAnswered(cid: string) {
    const ch = lesson.chapters.find(c => c.id === cid);
    if (!ch) return;
    const quizzes = ch.blocks.filter(b => b.type === 'quiz' || b.type === 'deepVignette');
    if (!quizzes.length) return;
    const allAnswered = quizzes.every(b => {
      const qid = b.type === 'quiz' ? b.quiz.qid : b.quiz.qid;
      return !!quizState.attempts[qid];
    });
    if (allAnswered) progressState.markAnswered(cid);
  }

  // Recheck on every quiz attempt change (Svelte 5 effect)
  $effect(() => {
    Object.keys(quizState.attempts);   // dependency
    lesson.chapters.forEach(c => checkChapterAnswered(c.id));
  });

  let resumeAvailable = $state(false);
  onMount(() => {
    if (view.current !== 'lesson') return;

    if (progressState.lastChapter && lesson.chapters.find(c => c.id === progressState.lastChapter)) {
      resumeAvailable = window.scrollY < 100;
    }

    const observer = new IntersectionObserver(entries => {
      for (const e of entries) {
        const id = e.target.id;
        if (e.isIntersecting && e.intersectionRatio >= VIEW_THRESHOLD) {
          activeChapterId = id;
          progressState.setLast(id);
          if (!dwellTimers[id]) {
            dwellTimers[id] = setTimeout(() => progressState.markViewed(id), VIEW_DWELL_MS);
          }
        } else if (dwellTimers[id]) {
          clearTimeout(dwellTimers[id]);
          delete dwellTimers[id];
        }
      }
    }, { threshold: [0, VIEW_THRESHOLD, 1] });

    document.querySelectorAll('section.chapter').forEach(s => observer.observe(s));
    return () => observer.disconnect();
  });

  function dismissResume() { resumeAvailable = false; }

  // View switcher (top-right chip bar)
  function switchView(v: string) {
    view.current = v;
    document.documentElement.setAttribute('data-view', v);
    const url = new URL(location.href);
    url.searchParams.set('view', v);
    history.replaceState({}, '', url.toString());
  }

  // Computed lesson stats for sidebar footer
  const totalQuizzes = $derived(
    lesson.chapters.flatMap(c => c.blocks).filter(b => b.type === 'quiz' || b.type === 'deepVignette').length
  );
</script>

<!-- View switcher chip bar (always visible) -->
<div class="fixed right-3 top-3 z-50 flex gap-1 rounded-md border border-border bg-surface p-1 text-[0.75rem] shadow-md">
  {#each [
    { id: 'lesson', icon: '📖', label: 'Lesson' },
    { id: 'quizzes', icon: '✓', label: 'Quizzes' },
    { id: 'flashcards', icon: '🃏', label: 'Cards' },
    { id: 'vignette', icon: '⚡', label: 'Vignette' },
  ] as v (v.id)}
    <button
      type="button"
      onclick={() => switchView(v.id)}
      class="rounded px-2 py-1 transition-colors {view.current === v.id ? 'bg-accent text-bg' : 'text-muted hover:text-accent'}"
      aria-pressed={view.current === v.id}
    >
      <span>{v.icon}</span> {v.label}
    </button>
  {/each}
</div>

{#if view.current === 'flashcards'}
  <FlashcardDrill cards={lesson.cards} />
{:else}
  {#if view.current === 'quizzes'}
    <div class="bg-accent px-12 py-2.5 text-bg text-[0.85rem] font-semibold uppercase tracking-widest">
      Quizzes — review mode (all 17 MCQs)
    </div>
  {:else if view.current === 'vignette'}
    <div class="bg-accent px-12 py-2.5 text-bg text-[0.85rem] font-semibold uppercase tracking-widest">
      USMLE Vignette — focused mode
    </div>
  {/if}
  <div class="lesson-shell">
    <!-- TOC sidebar -->
    <nav class="toc">
      <h2 class="mb-3 text-[0.85rem] font-semibold uppercase tracking-widest text-muted">{lesson.meta.title}</h2>

      {#if resumeAvailable && progressState.lastChapter}
        <a href="#{progressState.lastChapter}" onclick={dismissResume}
           class="mb-3 block rounded border border-accent bg-accent/10 px-3 py-2 text-center text-[0.78rem] text-accent hover:bg-accent/20">
          ▶ Resume here
        </a>
      {/if}

      {#each lesson.chapters as ch (ch.id)}
        {@const status = progressState.chapterStatus(ch.id)}
        <a href="#{ch.id}"
           class="my-0.5 flex items-center justify-between gap-2 rounded px-2.5 py-2 text-[0.92rem] transition-colors
                  {activeChapterId === ch.id ? 'border-l-[3px] border-accent bg-elevated pl-[7px] text-accent' : 'text-fg hover:bg-elevated hover:text-accent'}">
          <span class="flex-1">{ch.number}. {ch.title}</span>
          <span class="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border text-[10px] leading-none transition-all
                       {status === 'answered' ? 'border-success bg-success text-bg' : ''}
                       {status === 'viewed' ? 'border-accent bg-accent opacity-40' : ''}
                       {status === 'unread' ? 'border-muted bg-transparent' : ''}">
            {#if status === 'answered'}✓{/if}
          </span>
        </a>
      {/each}

      <div class="mt-6 border-t border-border pt-4 text-[0.75rem] text-muted">
        Score: <span class="font-semibold text-fg">{quizState.score}</span> / <span>{totalQuizzes}</span><br />
        Viewed: <span class="font-semibold text-fg">{progressState.viewedCount}</span> / {lesson.chapters.length}<br />
        {#if lesson.meta.subMode}Mode: <strong class="text-fg">{lesson.meta.subMode}</strong><br />{/if}
        Source: {lesson.meta.sourceGrounding}
      </div>
    </nav>

    <!-- Chapters -->
    <main class="lesson-main">
      {#each lesson.chapters as ch (ch.id)}
        {#if chapterMatchesView(ch.id)}
          <section class="chapter" id={ch.id}>
            <div class="text-[0.85rem] uppercase tracking-widest text-muted">Chapter {ch.number}</div>
            <h1 class="mt-1 text-3xl font-semibold text-accent">{ch.title}</h1>

            {#each ch.blocks as block, i (i)}
              {#if blockMatchesView(block)}
                {#if block.type === 'objective'}
                  <Objective text={block.text} />
                {:else if block.type === 'paragraph'}
                  <p class="my-3 leading-7 text-fg">{@html block.html}</p>
                {:else if block.type === 'heading'}
                  {#if block.level === 2}
                    <h2 class="mt-8 mb-2 border-b border-border pb-2 text-xl font-semibold text-warm-accent">{block.text}</h2>
                  {:else}
                    <h3 class="mt-6 mb-2 text-base font-semibold text-fg">{block.text}</h3>
                  {/if}
                {:else if block.type === 'list'}
                  {#if block.ordered}
                    <ol class="my-3 ml-6 list-decimal space-y-1.5 text-fg">
                      {#each block.items as it, ii (ii)}<li>{@html it}</li>{/each}
                    </ol>
                  {:else}
                    <ul class="my-3 ml-6 list-disc space-y-1.5 text-fg">
                      {#each block.items as it, ii (ii)}<li>{@html it}</li>{/each}
                    </ul>
                  {/if}
                {:else if block.type === 'table'}
                  <div class="my-4 overflow-x-auto">
                    <table class="w-full border-collapse text-[0.93rem]">
                      <thead>
                        <tr>
                          {#each block.headers as h, hi (hi)}<th class="border border-border bg-elevated px-3 py-2 text-left font-semibold text-accent">{h}</th>{/each}
                        </tr>
                      </thead>
                      <tbody>
                        {#each block.rows as row, ri (ri)}
                          <tr class={ri % 2 === 1 ? 'bg-surface' : ''}>
                            {#each row as cell, ci (ci)}<td class="border border-border px-3 py-2 align-top text-fg">{@html cell}</td>{/each}
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </div>
                {:else if block.type === 'highYield'}
                  <HighYield items={block.items} />
                {:else if block.type === 'mnemonic'}
                  <Mnemonic text={block.text} />
                {:else if block.type === 'pearl'}
                  <Pearl text={block.text} />
                {:else if block.type === 'dialogue'}
                  <Dialogue turns={block.turns} />
                {:else if block.type === 'quiz'}
                  <Quiz quiz={block.quiz} />
                {:else if block.type === 'deck'}
                  <Deck cards={block.cards} />
                {:else if block.type === 'deepVignette'}
                  <DeepVignette badge={block.badge} quiz={block.quiz} vignette={block.vignette} />
                {/if}
              {/if}
            {/each}
          </section>
        {/if}
      {/each}

      <footer class="border-t border-border px-8 py-12 text-center text-[0.85rem] text-muted">
        <p>Chiron lesson — <code class="rounded bg-elevated px-1 py-0.5">{lesson.meta.id}</code> · {lesson.meta.domain}{lesson.meta.subMode ? ` · ${lesson.meta.subMode}` : ''}</p>
        <p class="mt-2">Generated {lesson.meta.generated} · Source: {lesson.meta.sourceGrounding}</p>
      </footer>
    </main>
  </div>
{/if}

<style>
  /* ====================================================================
     LAYOUT SYSTEM — CSS-only, swap via [data-layout] on <html>.
     Three layouts: l1 LMS · l2 Editorial · l5 Textbook (Tufte margin).
     Default desktop = l5 (medicine recommended).
     ==================================================================== */

  .lesson-shell {
    display: grid;
    grid-template-columns: 240px 1fr;
    min-height: 100vh;
  }
  .toc {
    position: sticky;
    top: 0;
    align-self: start;
    height: 100vh;
    overflow-y: auto;
    padding: 1.5rem 1rem;
    background: var(--chiron-surface);
    border-right: 1px solid var(--chiron-border);
  }
  .lesson-main {
    overflow-y: auto;
    height: 100vh;
  }

  :global([data-layout="l1"]) .lesson-main {
    scroll-snap-type: y mandatory;
  }
  :global([data-layout="l1"]) .chapter {
    scroll-snap-align: start;
    min-height: 100vh;
    max-width: 920px;
    margin: 0 auto;
    padding: 3rem 4rem 4rem 4rem;
  }

  /* L5 — Tufte textbook: float HighYield/Mnemonic/Pearl/Dialogue to right margin at ≥1200px */
  @media (min-width: 1200px) {
    :global([data-layout="l5"]) .chapter {
      max-width: 1500px;
      margin: 0 auto;
      padding: 3rem 3rem 5rem 3rem;
    }
    :global([data-layout="l5"]) .chapter > h1,
    :global([data-layout="l5"]) .chapter > h2,
    :global([data-layout="l5"]) .chapter > h3,
    :global([data-layout="l5"]) .chapter > p,
    :global([data-layout="l5"]) .chapter > ul,
    :global([data-layout="l5"]) .chapter > ol {
      max-width: 75ch;
    }
    :global([data-layout="l5"]) .chapter > :global(.float-rail) {
      float: right;
      clear: right;
      width: 280px;
      margin: 0 0 1.5rem 2rem;
    }
  }
  :global([data-layout="l5"]) .chapter {
    padding: 2.5rem 3rem 4rem 3rem;
    max-width: 920px;
    margin: 0 auto;
  }
  :global([data-layout="l5"]) .chapter::after {
    content: "";
    display: block;
    clear: both;
  }

  /* L2 editorial: single column, no sidebar */
  :global([data-layout="l2"]) .lesson-shell { grid-template-columns: 1fr; }
  :global([data-layout="l2"]) .toc {
    position: fixed;
    top: 0; left: 0; right: 0;
    height: auto; max-height: none; width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--chiron-border);
    padding: 0.6rem 1.5rem;
    z-index: 50;
    display: flex; align-items: center; gap: 0.5rem;
    overflow-x: auto;
  }
  :global([data-layout="l2"]) .lesson-main { padding-top: 60px; height: auto; }
  :global([data-layout="l2"]) .chapter {
    max-width: 72ch;
    margin: 0 auto;
    padding: 4rem 1.5rem 5rem;
    border-bottom: 1px solid var(--chiron-divider);
    min-height: auto;
  }

  /* Mobile collapse */
  @media (max-width: 880px) {
    .lesson-shell { grid-template-columns: 1fr; }
    .toc {
      position: relative;
      height: auto;
      max-height: none;
      border-right: none;
      border-bottom: 1px solid var(--chiron-border);
    }
    .lesson-main { height: auto; }
    .chapter { padding: 2rem 1.2rem !important; min-height: auto !important; }
  }
</style>
