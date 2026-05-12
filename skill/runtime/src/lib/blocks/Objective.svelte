<script lang="ts">
  let { text }: { text: string } = $props();
</script>

<div class="my-4 rounded border-l-[3px] border-accent bg-surface px-4 py-3 text-[0.95rem] text-muted">
  <strong class="text-fg">Objective:</strong> {text}
</div>
