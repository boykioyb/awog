<template>
  <div class="vpn-es">
    <span class="vpn-es-ic"><Icon :name="icon" style="width: 22px; height: 22px" /></span>
    <div class="vpn-es-title">{{ title }}</div>
    <div class="vpn-es-body">{{ body }}</div>
  </div>
</template>

<script setup lang="ts">
// Centered empty-state for the VPN section (mirror of SshEmptyState) — an icon + a
// short title + one line of dim copy. Nothing interactive.
defineProps<{ icon: string; title: string; body: string }>()
</script>

<style scoped>
.vpn-es {
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
.vpn-es-ic {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 14px;
  color: var(--textDim);
  background: var(--bgHover);
  border: 1px solid var(--border);
}
.vpn-es-title {
  font-size: 1.0769rem;
  font-weight: 650;
  color: var(--text);
}
.vpn-es-body {
  max-width: 320px;
  font-size: 0.9231rem;
  color: var(--textDim);
  line-height: 1.5;
}
</style>
