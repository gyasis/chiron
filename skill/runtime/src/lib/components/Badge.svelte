<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    variant?: 'default' | 'accent' | 'success' | 'warning' | 'outline';
    children: Snippet;
  }

  let { variant = 'default', children }: Props = $props();

  const styles: Record<string, string> = {
    default: 'bg-elevated text-fg-secondary',
    accent: 'bg-accent text-bg',
    success: 'bg-success text-bg',
    warning: 'bg-warning text-bg',
    outline: 'border border-border text-muted',
  };
</script>

<span class="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold tracking-wide uppercase {styles[variant]}">
  {@render children()}
</span>
