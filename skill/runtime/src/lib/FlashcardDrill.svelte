<script lang="ts">
  let { cards }: { cards: { front: string; back: string; chapterId: string }[] } = $props();

  let queue = $state<typeof cards>([]);
  let repeatPile = $state<typeof cards>([]);
  $effect(() => { if (queue.length === 0 && repeatPile.length === 0 && cards.length > 0) queue = [...cards]; });
  let currentIdx = $state(0);
  let flipped = $state(false);
  let reviewed = $state(0);
  let hard = $state(0);
  let done = $derived(queue.length === 0);

  const current = $derived(queue[currentIdx] ?? null);

  function flip() { flipped = true; }

  function rate(quality: number) {
    reviewed++;
    if (quality === 0) repeatPile.push(current);
    else if (quality === 3) hard++;
    queue = queue.slice(1);
    currentIdx = 0;
    flipped = false;
    if (queue.length === 0 && repeatPile.length) {
      queue = [...repeatPile];
      repeatPile = [];
    }
  }

  function reset() {
    queue = [...cards];
    repeatPile = [];
    currentIdx = 0;
    flipped = false;
    reviewed = 0;
    hard = 0;
  }
</script>

<div class="flex min-h-screen flex-col items-center bg-bg px-4 py-8">
  <div class="mb-6 flex w-full max-w-[720px] items-center justify-between rounded-md border border-border bg-surface px-5 py-3 text-sm text-muted">
    <span>Card <strong class="text-accent">{cards.length - queue.length - repeatPile.length + 1}</strong> of <strong class="text-accent">{cards.length}</strong></span>
    <span>Reviewed: <strong class="text-accent">{reviewed}</strong> · Hard: <strong class="text-accent">{hard}</strong></span>
    <button type="button" onclick={reset} class="rounded border border-border bg-elevated px-3 py-1 text-xs text-fg hover:border-accent hover:text-accent">↻ Reset</button>
  </div>

  {#if done}
    <div class="mt-12 text-center text-muted">
      <h2 class="mb-2 text-2xl font-semibold text-accent">✓ Deck complete</h2>
      <p>Click ↻ Reset to start a new round, or switch views.</p>
    </div>
  {:else if current}
    <div class="flex w-full max-w-[720px] flex-col items-center justify-center rounded-lg border border-border bg-surface px-10 py-12 text-center shadow-md">
      <div class="mb-3 text-[0.7rem] uppercase tracking-widest text-muted">{current.chapterId}</div>
      <div class="mb-6 text-2xl font-semibold text-fg">{@html current.front}</div>
      {#if flipped}
        <div class="mt-3 w-full border-t border-border pt-4 text-lg leading-7 text-warm-accent">{@html current.back}</div>
      {/if}
    </div>

    {#if !flipped}
      <div class="mt-5 flex w-full max-w-[720px] justify-center">
        <button type="button" onclick={flip} class="flex-1 rounded-md border border-accent bg-accent px-5 py-3 text-base font-semibold text-bg transition-transform hover:-translate-y-px">
          Show Answer
        </button>
      </div>
    {:else}
      <div class="mt-5 flex w-full max-w-[720px] gap-2">
        <button type="button" onclick={() => rate(0)} class="flex-1 rounded-md border border-error px-4 py-3 text-base font-medium text-error transition-transform hover:-translate-y-px">Again</button>
        <button type="button" onclick={() => rate(3)} class="flex-1 rounded-md border border-warning px-4 py-3 text-base font-medium text-warning transition-transform hover:-translate-y-px">Hard</button>
        <button type="button" onclick={() => rate(4)} class="flex-1 rounded-md border border-accent px-4 py-3 text-base font-medium text-accent transition-transform hover:-translate-y-px">Good</button>
        <button type="button" onclick={() => rate(5)} class="flex-1 rounded-md border border-success px-4 py-3 text-base font-medium text-success transition-transform hover:-translate-y-px">Easy</button>
      </div>
    {/if}
  {/if}
</div>
