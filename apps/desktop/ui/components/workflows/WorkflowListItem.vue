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
    class="w-full text-left px-2 py-1.5 rounded transition cursor-pointer"
    :style="{
      background: selected ? t.bgActive : 'transparent',
      borderLeft: `2px solid ${selected ? t.accent : 'transparent'}`,
    }"
    @click="emit('select')"
    @contextmenu="onContextMenu"
    @mouseenter="onHoverEnter"
    @mouseleave="onHoverLeave"
  >
    <div class="flex items-center gap-1.5">
      <Workflow :size="11" :style="{ color: t.textDim }" />
      <input
        v-if="renaming"
        :ref="setInputRef"
        :value="renameValue"
        class="text-[12px] flex-1 rounded px-1 py-0.5"
        :style="{
          background: t.bgInput,
          border: `1px solid ${t.borderStrong}`,
          color: t.text,
          outline: 'none',
        }"
        @click.stop
        @input="(e) => emit('update:renameValue', (e.target as HTMLInputElement).value)"
        @keydown.enter="emit('commit-rename')"
        @keydown.escape="emit('cancel-rename')"
        @blur="emit('commit-rename')"
      />
      <div
        v-else
        class="text-[12px] truncate flex-1"
        :style="{ color: t.text }"
        @dblclick.stop="emit('start-rename')"
      >
        {{ workflow.name }}
      </div>
      <button
        class="p-1 rounded flex-shrink-0 transition opacity-60 hover:opacity-100"
        :style="{ color: t.textMuted }"
        title="Actions"
        @click.stop="onMenuButton"
      >
        <MoreHorizontal :size="13" />
      </button>
    </div>
    <div class="text-[10px] mt-0.5 ml-5" :style="{ color: t.textDim }">
      {{ workflow.nodes.length }} steps · {{ workflow.edges.length }} edges
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

const setInputRef = (el: unknown) => {
  if (el instanceof HTMLInputElement) {
    nextTick(() => {
      el.focus()
      el.select()
    })
  }
}

const onContextMenu = (e: MouseEvent) => {
  e.preventDefault()
  emit('context-menu', e)
}

const onMenuButton = (e: MouseEvent) => {
  emit('context-menu', e)
}

const onHoverEnter = (e: MouseEvent) => {
  if (props.selected) return
  ;(e.currentTarget as HTMLElement).style.background = t.value.bgHover
}

const onHoverLeave = (e: MouseEvent) => {
  if (props.selected) return
  ;(e.currentTarget as HTMLElement).style.background = 'transparent'
}
</script>
