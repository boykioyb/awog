<template>
  <div
    class="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 py-12 text-center"
  >
    <span class="grid size-12 place-items-center rounded-xl border bg-muted text-muted-foreground">
      <Icon :name="icon" class="size-5" />
    </span>
    <div class="text-lg font-semibold text-foreground">{{ title }}</div>
    <div class="max-w-80 text-sm text-muted-foreground">{{ body }}</div>
  </div>
</template>

<script setup lang="ts">
// Centered empty-state used by the SSH workspace sections that have no live data
// yet (Known Hosts / Snippets / Logs) or nothing to show (no hosts, no tunnels).
// Icon + a short title + one line of dim copy — nothing interactive.
defineProps<{ icon: string; title: string; body: string }>()
</script>
