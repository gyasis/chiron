<!-- shadcn-svelte Card primitive — ported to Svelte 5 runes/snippets -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    href?: string;
    class?: string;
    children: Snippet;
  }

  let { href, class: className = '', children }: Props = $props();
</script>

{#if href}
  <a
    {href}
    class="group block rounded-lg border border-border bg-surface p-6 shadow-sm transition-all hover:shadow-md hover:border-accent {className}"
  >
    {@render children()}
  </a>
{:else}
  <div class="rounded-lg border border-border bg-surface p-6 shadow-sm {className}">
    {@render children()}
  </div>
{/if}
