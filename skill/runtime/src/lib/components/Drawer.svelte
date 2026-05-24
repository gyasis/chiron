<!-- Side drawer for secondary controls — opened by hamburger trigger.
     Slides in from the right; click backdrop or Esc to close. -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    open: boolean;
    title?: string;
    onclose: () => void;
    children: Snippet;
  }

  let { open = $bindable(), title = 'Settings', onclose, children }: Props = $props();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) onclose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <!-- backdrop -->
  <button
    type="button"
    class="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
    onclick={onclose}
    aria-label="Close drawer"
  ></button>

  <!-- drawer panel -->
  <div
    class="fixed right-0 top-0 z-50 h-full w-full max-w-md overflow-y-auto border-l border-border bg-surface shadow-2xl"
    role="dialog"
    aria-modal="true"
    aria-label={title}
  >
    <header class="sticky top-0 flex items-center justify-between gap-4 border-b border-border bg-surface px-6 py-4">
      <h2 class="text-sm font-semibold uppercase tracking-widest text-muted">{title}</h2>
      <button
        type="button"
        onclick={onclose}
        class="rounded p-1.5 text-muted hover:bg-elevated hover:text-fg transition-colors"
        aria-label="Close"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </header>
    <div class="px-6 py-6">
      {@render children()}
    </div>
  </div>
{/if}
