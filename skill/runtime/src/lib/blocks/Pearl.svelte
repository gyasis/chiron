<script lang="ts">
  let { text }: { text: string } = $props();
</script>

<div class="my-4 rounded border-l-[3px] border-success bg-surface px-4 py-3 text-sm">
  <div class="mb-2 text-[0.72rem] font-bold uppercase tracking-widest text-success">💎 Clinical Pearl</div>
  <div class="text-fg">{@html text}</div>
</div>
