<script lang="ts">
  let { items }: { items: string[] } = $props();
</script>

<div class="my-4 rounded border-l-[3px] border-warm-accent bg-elevated px-4 py-3 text-sm">
  <div class="mb-2 text-[0.72rem] font-bold uppercase tracking-widest text-warning">⚡ High Yield</div>
  <ul class="ml-5 list-disc space-y-1.5 text-fg">
    {#each items as item, i (i)}
      <li>{@html item}</li>
    {/each}
  </ul>
</div>
