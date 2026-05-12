<script lang="ts">
  let { cards }: { cards: { front: string; back: string }[] } = $props();
  let flipped = $state<Set<number>>(new Set());

  function toggle(i: number) {
    flipped.has(i) ? flipped.delete(i) : flipped.add(i);
    flipped = new Set(flipped);
  }
</script>

<div class="my-6 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
  {#each cards as card, i (i)}
    <button
      type="button"
      onclick={() => toggle(i)}
      class="min-h-[130px] rounded-md border border-border bg-surface p-4 text-center transition-colors hover:border-accent"
      aria-pressed={flipped.has(i)}
    >
      {#if flipped.has(i)}
        <span class="text-[0.88rem] text-warm-accent">{@html card.back}</span>
      {:else}
        <span class="font-medium text-fg">{@html card.front}</span>
      {/if}
    </button>
  {/each}
</div>
