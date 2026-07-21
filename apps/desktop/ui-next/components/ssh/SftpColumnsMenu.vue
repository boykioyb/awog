<template>
  <div ref="rootEl" class="sfcol">
    <button
      class="ssh-sf-tool"
      :class="{ on: open }"
      :title="t('ssh.sftp.columns')"
      :aria-label="t('ssh.sftp.columns')"
      :aria-expanded="open"
      @click.stop="open = !open"
    >
      <Icon name="settings" style="width: 13px; height: 13px" />
    </button>
    <div v-if="open" class="sfcol-pop" role="menu">
      <div class="sfcol-head">{{ t('ssh.sftp.columns') }}</div>
      <label v-for="c in ALL_SFTP_COLUMNS" :key="c" class="sfcol-row">
        <input type="checkbox" :checked="columns.includes(c)" @change="emit('toggle', c)" />
        <span>{{ t(`ssh.sftp.col.${c}`) }}</span>
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
// Column-visibility dropdown for the SFTP table. Multi-toggle (stays open while
// checking boxes); the parent owns the persisted `columns` list + toggle handler.
import { onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import { ALL_SFTP_COLUMNS, type SftpColumn } from '~/composables/useSftpBrowser'

defineProps<{ columns: SftpColumn[] }>()
const emit = defineEmits<{ toggle: [col: SftpColumn] }>()

const { t } = useI18n()
const open = ref(false)
const rootEl = useTemplateRef<HTMLElement>('rootEl')

const onDocClick = (e: MouseEvent): void => {
  if (open.value && rootEl.value && !rootEl.value.contains(e.target as Node)) open.value = false
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<style scoped>
.sfcol {
  position: relative;
  display: inline-flex;
}
.ssh-sf-tool {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  flex: 0 0 auto;
}
.ssh-sf-tool:hover,
.ssh-sf-tool.on {
  background: var(--bgHover);
  color: var(--text);
}
.sfcol-pop {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 120;
  min-width: 170px;
  padding: 6px;
  background: var(--bgEl);
  border: 1px solid var(--borderStrong);
  border-radius: 10px;
  box-shadow: var(--shadow-lg);
}
.sfcol-head {
  padding: 4px 8px 6px;
  font-size: 0.8462rem;
  font-weight: 600;
  color: var(--textDim);
}
.sfcol-row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 0.9231rem;
  color: var(--text);
  cursor: pointer;
}
.sfcol-row:hover {
  background: var(--bgHover);
}
.sfcol-row input {
  accent-color: var(--accent);
  cursor: pointer;
}
</style>
