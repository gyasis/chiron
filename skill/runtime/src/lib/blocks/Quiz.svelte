<script lang="ts">
  import type { Quiz as QuizT } from '../schema';
  import { quizState } from '../stores/lessonState.svelte';

  let { quiz, deep = false }: { quiz: QuizT; deep?: boolean } = $props();

  const attempt = $derived(quizState.attempts[quiz.qid]);
  const answered = $derived(!!attempt);

  function pick(key: string) {
    if (answered) return;
    quizState.answer(quiz.qid, key, key === quiz.correct);
  }

  function optionClass(key: string): string {
    if (!answered) return 'border-transparent hover:border-accent';
    if (key === quiz.correct) return 'border-success bg-success/15';
    if (key === attempt.picked) return 'border-error bg-error/15';
    return 'border-transparent opacity-60';
  }

  function distractorClass(key: string): string {
    return key === quiz.correct
      ? 'border-success [&>strong]:text-success'
      : 'border-border [&>strong]:text-warning';
  }
</script>

<div class="my-6 rounded-lg border border-border bg-surface px-5 py-5 {deep ? 'border-2 border-accent bg-gradient-to-br from-surface to-elevated px-6 py-6' : ''}">
  <div class="mb-2 text-[0.78rem] uppercase tracking-widest text-muted">{quiz.qhead}</div>
  <div class="mb-4 font-medium text-fg">{@html quiz.qstem}</div>

  <ul class="m-0 list-none p-0">
    {#each quiz.options as opt (opt.key)}
      <button
        type="button"
        onclick={() => pick(opt.key)}
        disabled={answered}
        class="my-1.5 block w-full rounded border bg-elevated px-4 py-3 text-left transition-colors {optionClass(opt.key)}"
        aria-pressed={attempt?.picked === opt.key}
      >
        {opt.text}
      </button>
    {/each}
  </ul>

  {#if answered}
    <div class="mt-4 rounded border-l-[3px] border-accent bg-elevated px-4 py-3 text-[0.93rem]">
      <h4 class="mb-2 font-semibold text-warm-accent">{quiz.feedback.headline}</h4>
      <p class="text-fg">{@html quiz.feedback.body}</p>
      {#if quiz.feedback.distractors.length}
        <div class="mt-3 space-y-2">
          {#each quiz.feedback.distractors as d (d.key)}
            <div class="border-l-2 pl-3 text-fg-secondary {distractorClass(d.key)}">
              <strong>{d.key.toUpperCase()} —</strong> {@html d.body}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>
