<script lang="ts">
  import type { Quiz as QuizT } from '../schema';
  import Quiz from './Quiz.svelte';

  let { badge, quiz, vignette }: { badge: string; quiz: QuizT; vignette: string } = $props();
</script>

<div class="my-8 rounded-lg border-2 border-accent bg-gradient-to-br from-surface to-elevated px-6 py-6">
  <div class="mb-4 inline-block rounded bg-accent px-3 py-1 text-[0.72rem] font-bold uppercase tracking-widest text-bg">
    {badge}
  </div>
  <div class="mb-4 rounded border-l-[3px] border-muted bg-elevated p-4 text-fg">
    {@html vignette}
  </div>
  <Quiz {quiz} deep />
</div>
