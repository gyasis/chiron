<script lang="ts">
  type Turn = { persona: 'alice' | 'bob' | 'tutor'; speaker: string; body: string };
  let { turns }: { turns: Turn[] } = $props();

  const avatarStyles: Record<string, string> = {
    alice: 'bg-accent text-bg',
    bob:   'bg-warning text-bg',
    tutor: 'bg-success text-bg text-[0.7rem]',
  };
  const avatarLabel: Record<string, string> = { alice: 'A', bob: 'B', tutor: 'Dr' };
</script>

<div class="my-4 rounded bg-surface px-5 py-4">
  {#each turns as turn, i (i)}
    <div class="relative mb-3 pl-12 last:mb-0">
      <span class="absolute left-0 top-0 inline-flex h-10 w-10 items-center justify-center rounded-full font-semibold {avatarStyles[turn.persona]}">
        {avatarLabel[turn.persona]}
      </span>
      <div class="text-[0.85rem] font-semibold text-muted">{turn.speaker}</div>
      <div class="text-fg">{@html turn.body}</div>
    </div>
  {/each}
</div>
