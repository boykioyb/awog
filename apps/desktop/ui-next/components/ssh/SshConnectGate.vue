<template>
  <div class="scg">
    <Icon name="conn" style="width: 15px; height: 15px; flex: 0 0 auto; color: var(--textDim)" />
    <span class="scg-msg">{{ t('ssh.conn.needConnect') }}</span>
    <button class="btn pri sm" @click="emit('connect')">
      <Icon name="play" style="width: 12px; height: 12px" />
      {{ t('ssh.detail.connect') }}
    </button>
    <button
      class="scg-x"
      :title="t('ssh.panel.close')"
      :aria-label="t('ssh.panel.close')"
      @click="emit('close')"
    >
      <Icon name="x" style="width: 13px; height: 13px" />
    </button>
  </div>
</template>

<script setup lang="ts">
// Shown in the detail body when SFTP / forward is opened for a host that isn't
// connected yet (ADR 0063) — SFTP + forwards run over a live connection, so this
// prompts Connect (opens the terminal → establishes the connId) or closes.
const emit = defineEmits<{ connect: []; close: [] }>()
const { t } = useI18n()
</script>

<style scoped>
.scg {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bgEl);
}
.scg-msg {
  flex: 1;
  min-width: 0;
  color: var(--textDim);
  font-size: 0.9231rem;
}
.scg-x {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  flex: 0 0 auto;
}
.scg-x:hover {
  background: var(--bgHover);
  color: var(--text);
}
</style>
