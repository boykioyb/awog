<!--
  WorkflowListItem.vue — Row trong list workflow trái của /workflows. Hiển thị name +
  số nodes/edges, hỗ trợ rename inline (double-click), context menu (right-click + nút
  hamburger), highlight khi selected.

  Props:
    - workflow    Workflow data.
    - selected    Có phải item đang chọn.
    - renaming    Có đang ở mode rename inline không.
    - renameValue v-model giá trị input rename (parent giữ state để commit/cancel).

  Emits:
    - select          Click vào row → parent set selectedWorkflowId.
    - context-menu    Right-click hoặc click nút "MoreHorizontal" → parent mở context menu.
    - start-rename    Double-click → parent vào mode rename.
    - commit-rename   ENTER / blur input → parent commit.
    - cancel-rename   ESC trong input → parent cancel.
    - update:renameValue  v-model rename input.
-->
<template>
  <div
    class="w-full text-left px-2.5 py-2 rounded-lg transition cursor-pointer"
    :style="{
      background: pill(selected).background,
      border: `1px solid ${selected ? t.accent : 'transparent'}`,
    }"
    @click="emit('select')"
    @contextmenu="onContextMenu"
    @mouseenter="onHoverEnter"
    @mouseleave="onHoverLeave"
  >
    <div class="flex items-center gap-2">
      <Workflow :size="13" :style="{ color: selected ? t.accent : t.textDim }" />
      <input
        v-if="renaming"
        ref="inputEl"
        :value="renameValue"
        class="text-[1em] flex-1 rounded-lg px-1.5 py-0.5 outline-none"
        :style="{
          background: t.bgInput,
          border: `1px solid ${t.borderFocus}`,
          color: t.text,
        }"
        @click.stop
        @input="(e) => emit('update:renameValue', (e.target as HTMLInputElement).value)"
        @keydown.enter="emit('commit-rename')"
        @keydown.escape="emit('cancel-rename')"
        @blur="emit('commit-rename')"
      />
      <div
        v-else
        class="text-[1em] truncate flex-1 font-medium"
        :style="{ color: t.text }"
        @dblclick.stop="emit('start-rename')"
      >
        {{ workflow.name }}
      </div>
      <button
        class="p-1.5 rounded-lg flex-shrink-0 transition opacity-60 hover:opacity-100"
        :style="{ color: t.textDim }"
        title="Actions"
        @click.stop="onMenuButton"
      >
        <MoreHorizontal :size="13" />
      </button>
    </div>
    <div class="flex items-center gap-2 mt-1 ml-[21px]">
      <span class="text-[1em]" :style="{ color: t.textDim }">
        {{
          tr('workflows.item.meta', { steps: workflow.nodes.length, edges: workflow.edges.length })
        }}
      </span>
      <span
        class="text-[12px] font-mono leading-none px-1.5 py-0.5 rounded-full flex-shrink-0"
        :style="{ color: t.textFaint, background: t.bgInput, border: `1px solid ${t.border}` }"
        :title="scopeLabel"
      >
        {{ scopeLabel }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { MoreHorizontal, Workflow } from 'lucide-vue-next'
import type { Workflow as WorkflowEntity } from '~/types'

type Props = {
  workflow: WorkflowEntity
  selected: boolean
  renaming: boolean
  renameValue: string
}

type Emits = {
  select: []
  'context-menu': [event: MouseEvent]
  'start-rename': []
  'commit-rename': []
  'cancel-rename': []
  'update:renameValue': [value: string]
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const { t } = useTheme()
const { pill } = useGlass()
const { t: tr } = useI18n()
const ws = useWorkspaceStore()

// Tier badge: 'Global' for shared workflows, else the owning project's name.
const scopeLabel = computed(() => {
  if (props.workflow.source === 'project' && props.workflow.projectId) {
    return ws.projectById(props.workflow.projectId)?.name ?? 'Project'
  }
  return tr('workflows.scope.global_badge')
})

// Static ref + watch so focus+select-all runs ONCE when rename starts. A
// function ref here would be re-invoked on every keystroke (controlled :value
// re-renders), re-selecting the text so each new char overwrote the previous.
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

const onContextMenu = (e: MouseEvent) => {
  e.preventDefault()
  emit('context-menu', e)
}

const onMenuButton = (e: MouseEvent) => {
  emit('context-menu', e)
}

const onHoverEnter = (e: MouseEvent) => {
  if (props.selected) return
  ;(e.currentTarget as HTMLElement).style.background = pill(false, true).background
}

const onHoverLeave = (e: MouseEvent) => {
  if (props.selected) return
  ;(e.currentTarget as HTMLElement).style.background = 'transparent'
}
</script>
