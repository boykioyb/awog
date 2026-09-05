<template>
  <div class="edalist">
    <div class="edalist-head">{{ t('editor.artifacts', { id: taskId }) }}</div>
    <div class="edalist-body">
      <button
        v-for="file in files"
        :key="file.path"
        class="edalist-row"
        :class="{ on: file.name === selectedName || file.path === selectedName }"
        @click="emit('select', file.name)"
      >
        <Icon :name="file.kind === 'diff' ? 'branch' : 'text'" class="edalist-icon" />
        <div class="edalist-meta">
          <div class="edalist-name">{{ file.name }}</div>
          <div v-if="file.phase" class="edalist-sub">
            {{ file.phase }}
            <span v-if="file.version">· v{{ file.version }}</span>
          </div>
        </div>
      </button>
      <div v-if="!files.length" class="edalist-empty">{{ t('editor.noArtifacts') }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Artifact file list for the Task Artifact Editor (prototype CSS). Lists the
// task's declared output files; clicking one emits its name so the page swaps the
// viewer/editor content.
import type { EditorTaskFile } from '~/components/editor/types'

defineProps<{
  files: EditorTaskFile[]
  taskId: string
  selectedName: string
}>()

const emit = defineEmits<{ select: [name: string] }>()

const { t } = useI18n()
</script>

<style scoped>
.edalist {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  flex: 0 0 240px;
  border-right: 1px solid var(--border);
  background: var(--bgPanel);
}
.edalist-head {
  padding: 9px 12px;
  font-size: 12px;
  color: var(--textDim);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.edalist-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 0 10px;
}
.edalist-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 12px;
  text-align: left;
  color: var(--text);
  background: transparent;
  border: none;
  border-left: 2px solid transparent;
  cursor: pointer;
}
.edalist-row:hover {
  background: var(--bgHover);
}
.edalist-row.on {
  background: var(--bgActive);
  border-left-color: var(--accent);
}
.edalist-icon {
  width: 13px;
  height: 13px;
  color: var(--textDim);
  flex-shrink: 0;
}
.edalist-meta {
  min-width: 0;
}
.edalist-name {
  font-family: var(--code);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.edalist-sub {
  font-size: 12px;
  color: var(--textFaint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.edalist-empty {
  padding: 18px 14px;
  color: var(--textFaint);
}
</style>
