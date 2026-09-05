<template>
  <div class="ssh-es">
    <span class="ssh-es-ic"><Icon :name="icon" style="width: 22px; height: 22px" /></span>
    <div class="ssh-es-title">{{ title }}</div>
    <div class="ssh-es-body">{{ body }}</div>
  </div>
</template>

<script setup lang="ts">
// Centered empty-state used by the SSH workspace sections that have no live data
// yet (Known Hosts / Snippets / Logs) or nothing to show (no hosts, no tunnels).
// Icon + a short title + one line of dim copy — nothing interactive.
defineProps<{ icon: string; title: string; body: string }>()
</script>

<style scoped>
.ssh-es {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px 24px;
  text-align: center;
}
.ssh-es-ic {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: var(--r-card);
  color: var(--textDim);
  background: var(--bgHover);
  border: 1px solid var(--border);
}
.ssh-es-title {
  font-size: var(--fs-lg);
  font-weight: 650;
  color: var(--text);
}
.ssh-es-body {
  max-width: 320px;
  font-size: var(--fs-sm);
  color: var(--textDim);
  line-height: 1.5;
}
</style>
