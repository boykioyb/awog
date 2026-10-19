<template>
  <div
    class="group mb-0.5 cursor-pointer rounded-md border px-3 py-2"
    :class="
      selected
        ? 'border-selected-border bg-selected shadow-[inset_2px_0_0_var(--color-primary)]'
        : 'border-transparent hover:bg-accent'
    "
    @click="emit('select')"
  >
    <div class="flex items-center gap-2">
      <Icon
        name="workflows"
        class="size-3.5 shrink-0"
        :class="selected ? 'text-primary' : 'text-dim'"
      />
      <Input
        v-if="renaming"
        ref="inputEl"
        :model-value="renameValue"
        class="h-ctrl-xs min-w-0 flex-1 border-selected-border px-2 font-mono text-sm font-medium"
        @click.stop
        @keydown.enter="emit('commit-rename')"
        @keydown.escape="emit('cancel-rename')"
        @blur="emit('commit-rename')"
        @update:model-value="emit('update:renameValue', $event)"
      />
      <span
        v-else
        class="min-w-0 flex-1 truncate text-base"
        :class="selected ? 'font-semibold text-foreground' : 'font-medium'"
        @dblclick.stop="emit('start-rename')"
      >
        {{ workflow.name }}
      </span>
      <Button
        variant="ghost"
        size="iconSm"
        class="shrink-0 text-dim opacity-55 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
        :title="t('common.delete')"
        @click.stop="emit('delete')"
      >
        <Icon name="trash" class="size-3" />
      </Button>
    </div>
    <div class="mt-1 flex items-center justify-between gap-1.5 text-sm text-muted-foreground">
      <span class="truncate">
        {{
          t('workflow.item.meta', { nodes: workflow.nodes.length, edges: workflow.edges.length })
        }}
      </span>
      <Badge
        variant="outline"
        class="rounded-sm"
        :class="
          workflow.source === 'project'
            ? 'border-primary/40 bg-primary/10 text-primary'
            : 'text-muted-foreground'
        "
      >
        {{ scopeLabel }}
      </Badge>
    </div>
  </div>
</template>

<script setup lang="ts">
// One workflow row in the list sidebar — name + node/edge count + tier badge,
// with inline rename (double-click) and a hover delete button. The parent owns
// the rename + delete state (this row is pure markup + event bubbles).
import { computed, nextTick, ref, watch } from 'vue'
import type { Workflow } from '~/stores/workflows'
import Input from '~/components/ui/input/Input.vue'
import Button from '~/components/ui/button/Button.vue'

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
