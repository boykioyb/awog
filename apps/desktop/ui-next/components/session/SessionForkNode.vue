<template>
  <div class="fnode" :class="{ current: data.isCurrent }" :title="data.title">
    <Handle type="target" :position="Position.Left" :connectable="false" />
    <div class="fnode-title">{{ data.title }}</div>
    <div class="fnode-when">
      <Icon name="fork" style="width: 10px; height: 10px" />
      {{ data.when }}
      <span v-if="data.isCurrent" class="fnode-cur">{{ t('sessions.fork.current') }}</span>
    </div>
    <Handle type="source" :position="Position.Right" :connectable="false" />
  </div>
</template>

<script setup lang="ts">
// One node in the session fork-tree graph (SessionForkGraph). Read-only: handles
// are non-connectable (the graph is a viewer, not an editor). Click navigation is
// wired at the graph level via @node-click.
import { Handle, Position } from '@vue-flow/core'

defineProps<{
  data: { title: string; when: string; isCurrent: boolean; clientId: number }
}>()
const { t } = useI18n()
</script>

<style scoped>
.fnode {
  width: 188px;
  padding: 8px 10px;
  border-radius: var(--r-btn);
  background: var(--bgEl);
  border: 1px solid var(--border);
  cursor: pointer;
  transition:
    border-color 0.12s ease,
    background 0.12s ease;
}
.fnode:hover {
  border-color: var(--borderStrong);
  background: var(--bgHover);
}
.fnode.current {
  border-color: var(--accentBorder);
  background: var(--accentDim);
}
.fnode-title {
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fnode-when {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
  font-size: 12px;
  line-height: 18px;
  color: var(--textDim);
}
.fnode-cur {
  margin-left: auto;
  color: var(--accent);
}
</style>
