<script lang="ts">
  let { text }: { text: string } = $props();
</script>

<div class="my-4 rounded border border-dashed border-accent bg-elevated px-4 py-3 italic text-fg">
  <span class="not-italic font-semibold text-accent">🧠 Mnemonic — </span>{@html text}
</div>
