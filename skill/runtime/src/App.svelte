<script lang="ts">
  import Card from './lib/components/Card.svelte';
  import Badge from './lib/components/Badge.svelte';
  import Drawer from './lib/components/Drawer.svelte';

  // ----------------------------------------------------------------
  // LESSON CATALOG — fed by the chiron skill at build time.
  // ----------------------------------------------------------------
  type Lesson = {
    id: string;
    title: string;
    domain: 'medicine' | 'language' | 'code';
    subMode?: string;
    chapters: number;
    mcqs: number;
    cards: number;
    blurb: string;
  };

  const lessons: Lesson[] = [
    {
      id: 'klinefelter-syndrome-2026-05-03',
      title: 'Klinefelter Syndrome',
      domain: 'medicine',
      subMode: 'AMBOSS',
      chapters: 7,
      mcqs: 17,
      cards: 22,
      blurb: '47,XXY chromosomal disorder — genetics, presentation, diagnosis, management, USMLE vignette.',
    },
  ];

  const layouts = [
    { id: 'l5', name: 'Textbook', sub: '3-col with margin rail' },
    { id: 'l1', name: 'LMS',      sub: 'Coursera-style, narrow center' },
    { id: 'l2', name: 'Editorial',sub: 'Long-form, top-bar TOC' },
  ];
  const themes = ['clinical', 'midnight', 'warm-paper', 'linguistic', 'ocean'];

  // ----------------------------------------------------------------
  // SUB-NAV (ClassBuild-style horizontal pill strip — primary nav)
  // ----------------------------------------------------------------
  type View = { id: string; name: string; icon: string };
  const views: View[] = [
    { id: 'lesson',     name: 'Lesson',    icon: '📖' },
    { id: 'quizzes',    name: 'Quizzes',   icon: '✓' },
    { id: 'flashcards', name: 'Flashcards',icon: '🃏' },
    { id: 'vignette',   name: 'Vignette',  icon: '⚡' },
    { id: 'forum',      name: 'Forum',     icon: '💬' },
  ];

  let activeTheme = $state('clinical');
  let activeLayout = $state('l5');
  let activeView = $state('lesson');
  let mobileNavOpen = $state(false);

  function setTheme(t: string) {
    activeTheme = t;
    document.documentElement.setAttribute('data-theme', t);
  }

  function lessonHref(viewId = activeView): string {
    return `lesson.html?view=${viewId}&layout=${activeLayout}&theme=${activeTheme}`;
  }
</script>

<div class="min-h-screen bg-bg text-fg">

  <!-- Hero -->
  <header class="border-b border-border bg-surface">
    <div class="mx-auto max-w-6xl px-6 py-10">
      <p class="text-xs font-semibold uppercase tracking-widest text-accent mb-3">Chiron · lesson library</p>
      <h1 class="text-3xl font-bold text-fg mb-2">Your generated lessons</h1>
      <p class="text-fg-secondary max-w-2xl">
        Self-contained interactive lessons. Pick a view mode below to focus your study, then click a lesson to open.
      </p>
    </div>
  </header>

  <!-- Sub-nav (ClassBuild-style horizontal pills, full width)
       Primary navigation for view modes. Stays visible at ≥880px.
       Below 880px collapses into the hamburger drawer. -->
  <nav class="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur-sm">
    <div class="mx-auto max-w-6xl px-6">
      <div class="flex items-center justify-between gap-4 py-2">

        <!-- Pills (desktop) -->
        <div class="hidden md:flex items-center gap-1 overflow-x-auto">
          {#each views as v (v.id)}
            <button
              type="button"
              onclick={() => (activeView = v.id)}
              class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap
                     {activeView === v.id
                       ? 'bg-accent text-bg'
                       : 'text-fg-secondary hover:bg-elevated hover:text-fg'}"
              aria-pressed={activeView === v.id}
            >
              <span>{v.icon}</span>
              <span>{v.name}</span>
            </button>
          {/each}
        </div>

        <!-- Hamburger (mobile only) -->
        <button
          type="button"
          onclick={() => (mobileNavOpen = true)}
          class="md:hidden flex items-center gap-2 rounded-md border border-border bg-elevated px-3 py-1.5 text-sm text-fg-secondary"
          aria-label="Open navigation"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
          <span class="capitalize">{activeView}</span>
        </button>

        <!-- Floater: theme + layout quick controls (desktop) -->
        <div class="hidden md:flex items-center gap-2 ml-auto">
          <!-- Theme picker (compact) -->
          <div class="flex items-center gap-0.5 rounded-md border border-border bg-elevated p-0.5">
            {#each themes as t (t)}
              <button
                type="button"
                onclick={() => setTheme(t)}
                title={t}
                class="h-6 w-6 rounded transition-transform {activeTheme === t ? 'ring-2 ring-accent scale-110' : 'hover:scale-105'}"
                style="background: {{
                  clinical: '#1e6fbf',
                  midnight: '#8b5cf6',
                  'warm-paper': '#c2410c',
                  linguistic: '#b3522e',
                  ocean: '#06b6d4',
                }[t]};"
                aria-label="Theme: {t}"
                aria-pressed={activeTheme === t}
              ></button>
            {/each}
          </div>
          <!-- Layout picker (compact) -->
          <div class="flex items-center rounded-md border border-border bg-elevated">
            {#each layouts as l (l.id)}
              <button
                type="button"
                onclick={() => (activeLayout = l.id)}
                title="{l.name} — {l.sub}"
                class="px-2.5 py-1 text-xs font-mono uppercase transition-colors first:rounded-l-md last:rounded-r-md
                       {activeLayout === l.id ? 'bg-accent text-bg font-bold' : 'text-muted hover:text-fg'}"
                aria-pressed={activeLayout === l.id}
              >
                {l.id}
              </button>
            {/each}
          </div>
        </div>
      </div>
    </div>
  </nav>

  <main class="mx-auto max-w-6xl px-6 py-10">

    <!-- Lesson cards -->
    <section>
      <div class="flex items-baseline justify-between mb-4">
        <h2 class="text-xs font-semibold uppercase tracking-widest text-muted">Available lessons</h2>
        <p class="text-xs text-muted">
          Opens in <span class="font-mono uppercase text-fg-secondary">{activeView}</span> ·
          <span class="font-mono uppercase text-fg-secondary">{activeLayout}</span> ·
          <span class="font-mono text-fg-secondary">{activeTheme}</span>
        </p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {#each lessons as lesson (lesson.id)}
          <Card href={lessonHref()}>
            <div class="flex items-start justify-between gap-3 mb-3">
              <div class="flex flex-wrap gap-1.5">
                <Badge variant="accent">{lesson.domain}</Badge>
                {#if lesson.subMode}
                  <Badge variant="outline">{lesson.subMode}</Badge>
                {/if}
              </div>
              <span class="text-muted group-hover:text-accent transition-colors text-lg">→</span>
            </div>
            <h3 class="text-lg font-semibold text-fg mb-2 group-hover:text-accent transition-colors">
              {lesson.title}
            </h3>
            <p class="text-sm text-fg-secondary leading-relaxed mb-4">
              {lesson.blurb}
            </p>
            <div class="flex gap-4 text-xs text-muted pt-3 border-t border-divider">
              <span><strong class="text-fg-secondary">{lesson.chapters}</strong> chapters</span>
              <span><strong class="text-fg-secondary">{lesson.mcqs}</strong> MCQs</span>
              <span><strong class="text-fg-secondary">{lesson.cards}</strong> cards</span>
            </div>
          </Card>
        {/each}
      </div>
    </section>

    <footer class="mt-16 pt-8 border-t border-border text-xs text-muted">
      <p>
        Chiron runtime · Svelte 5 + shadcn-svelte + Vite · single-file build
      </p>
    </footer>
  </main>

  <!-- Mobile drawer: sub-nav + theme + layout (replaces the desktop strip on small screens) -->
  <Drawer bind:open={mobileNavOpen} title="Navigation" onclose={() => (mobileNavOpen = false)}>
    <div class="space-y-8">

      <div>
        <h3 class="mb-3 text-xs font-semibold uppercase tracking-widest text-muted">View</h3>
        <div class="space-y-1">
          {#each views as v (v.id)}
            <button
              type="button"
              onclick={() => { activeView = v.id; mobileNavOpen = false; }}
              class="block w-full rounded-md border px-3 py-3 text-left transition-colors
                     {activeView === v.id
                       ? 'border-accent bg-elevated text-accent font-semibold'
                       : 'border-border bg-surface text-fg-secondary hover:border-accent'}"
              aria-pressed={activeView === v.id}
            >
              <span class="text-lg mr-2">{v.icon}</span>{v.name}
            </button>
          {/each}
        </div>
      </div>

      <div>
        <h3 class="mb-3 text-xs font-semibold uppercase tracking-widest text-muted">Theme</h3>
        <div class="grid grid-cols-2 gap-2">
          {#each themes as t (t)}
            <button
              type="button"
              onclick={() => setTheme(t)}
              class="rounded-md border px-3 py-2 text-left text-sm transition-colors
                     {activeTheme === t
                       ? 'border-accent bg-elevated text-accent font-semibold'
                       : 'border-border bg-surface text-fg-secondary hover:border-accent'}"
              aria-pressed={activeTheme === t}
            >
              {t}
            </button>
          {/each}
        </div>
      </div>

      <div>
        <h3 class="mb-3 text-xs font-semibold uppercase tracking-widest text-muted">Layout</h3>
        <div class="space-y-2">
          {#each layouts as layout (layout.id)}
            <button
              type="button"
              onclick={() => (activeLayout = layout.id)}
              class="block w-full rounded-md border px-3 py-3 text-left transition-colors
                     {activeLayout === layout.id
                       ? 'border-accent bg-elevated'
                       : 'border-border bg-surface hover:border-accent'}"
              aria-pressed={activeLayout === layout.id}
            >
              <div class="flex items-center justify-between mb-0.5">
                <span class="text-sm font-semibold {activeLayout === layout.id ? 'text-accent' : 'text-fg'}">{layout.name}</span>
                <span class="font-mono text-xs uppercase text-muted">{layout.id}</span>
              </div>
              <p class="text-xs text-muted">{layout.sub}</p>
            </button>
          {/each}
        </div>
      </div>

    </div>
  </Drawer>
</div>
