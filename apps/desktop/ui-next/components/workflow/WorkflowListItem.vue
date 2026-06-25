<template>
  <div class="libli wfli" :class="{ on: selected }" @click="emit('select')">
    <div class="lrow">
      <Icon name="workflows" class="wfli-icn" />
      <input
        v-if="renaming"
        ref="inputEl"
        class="wfli-rename mono"
        :value="renameValue"
        @click.stop
        @input="emit('update:renameValue', ($event.target as HTMLInputElement).value)"
        @keydown.enter="emit('commit-rename')"
        @keydown.escape="emit('cancel-rename')"
        @blur="emit('commit-rename')"
      />
      <span v-else class="ttl" @dblclick.stop="emit('start-rename')">{{ workflow.name }}</span>
      <button class="wfli-del" :title="t('common.delete')" @click.stop="emit('delete')">
        <Icon name="trash" style="width: 12px; height: 12px" />
      </button>
    </div>
    <div class="sub">
      <span>
        {{
          t('workflow.item.meta', { nodes: workflow.nodes.length, edges: workflow.edges.length })
        }}
      </span>
      <span class="tag" :class="{ acc: workflow.source === 'project' }">{{ scopeLabel }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
// One workflow row in the list sidebar — name + node/edge count + tier badge,
// with inline rename (double-click) and a hover delete button. The parent owns
// the rename + delete state (this row is pure markup + event bubbles).
import { computed, nextTick, ref, watch } from 'vue'
import type { Workflow } from '~/stores/workflows'

const props = defineProps<{
  workflow: Workflow
  selected: boolean
  renaming: boolean
  renameValue: string
  projects: { id: string; name: string }[]
}>()

const emit = defineEmits<{
  select: []
  delete: []
  'start-rename': []
  'commit-rename': []
  'cancel-rename': []
  'update:renameValue': [value: string]
}>()

const { t } = useI18n()

const scopeLabel = computed(() => {
  const wf = props.workflow
  if (wf.source === 'project' && wf.projectId) {
    return props.projects.find((p) => p.id === wf.projectId)?.name ?? t('workflow.scope.project')
  }
  return t('workflow.scope.global')
})

// Static ref + watch so focus+select-all runs ONCE when rename starts (a function
// ref would re-run on every controlled-input keystroke, re-selecting the text).
const inputEl = ref<HTMLInputElement | null>(null)
watch(
  () => props.renaming,
  (on) => {
    if (!on) return
    nextTick(() => {
      inputEl.value?.focus()
      inputEl.value?.select()
    })
  },
)
</script>

<style scoped>
.wfli .lrow {
  display: flex;
  align-items: center;
  gap: 8px;
}
.wfli-icn {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
  color: var(--textDim);
}
.wfli.on .wfli-icn {
  color: var(--accent);
}
.wfli-rename {
  flex: 1;
  min-width: 0;
  background: var(--bgInput);
  border: 1px solid var(--accentBorder);
  border-radius: 7px;
  padding: 2px 7px;
  color: var(--text);
  font-size: 0.9231rem;
  outline: none;
}
.wfli-del {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  border: 0;
  background: transparent;
  color: var(--textDim);
  display: grid;
  place-items: center;
  cursor: pointer;
  opacity: 0.55;
  flex: 0 0 auto;
}
.wfli:hover .wfli-del {
  opacity: 1;
}
.wfli-del:hover {
  background: var(--dangerDim);
  color: var(--danger);
}
.wfli .sub {
  justify-content: space-between;
}
</style>
