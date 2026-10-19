<template>
  <!-- Hairline là INSET SHADOW, không phải border: border 1px ăn một pixel của content
       box (44 − 1 = 43) đẩy mọi con căn giữa vào nửa pixel. Inset để nền của sibling kế
       tiếp không vẽ đè lên vạch. -->
  <div
    class="flex min-h-11 shrink-0 items-center gap-2 bg-sidebar px-3.5 py-2 shadow-[inset_0_-1px_0_var(--border)]"
  >
    <Button
      variant="ghost"
      size="sm"
      class="gap-1 px-2 text-base font-normal text-dim"
      :title="t('editor.back')"
      @click="emit('back')"
    >
      <Icon name="chev" class="size-3.5 rotate-90" />
      <span>{{ backLabel }}</span>
    </Button>

    <Separator orientation="vertical" class="h-4" />

    <Icon :name="titleIcon" class="size-3.5 shrink-0 text-dim" />
    <span class="font-semibold whitespace-nowrap text-foreground">{{ title }}</span>
    <!-- mono: subtitle mang đường dẫn project ở pages/code/[id].vue -->
    <span v-if="subtitle" class="min-w-0 truncate font-mono text-sm text-faint">
      {{ subtitle }}
    </span>

    <!-- Diff stats (Task Artifact Editor, .diff/.patch files). -->
    <div v-if="diffStats" class="ml-1.5 flex items-center gap-2 text-sm tabular-nums">
      <span class="text-dim">
        {{ t('editor.diffFiles', { n: diffStats.files }) }}
      </span>
      <span class="text-diff-add">+{{ diffStats.additions }}</span>
      <span class="text-destructive">−{{ diffStats.deletions }}</span>
    </div>

    <span class="flex-1" />

    <!-- View-mode segmented control (markdown/yaml; hidden for diff). -->
    <ToggleGroup
      v-if="viewModes"
      type="single"
      :spacing="1"
      class="shrink-0 rounded-lg bg-muted p-0.5"
      :model-value="activeView"
      @update:model-value="onView"
    >
      <ToggleGroupItem
        v-for="v in viewOptions"
        :key="v.id"
        :value="v.id"
        class="h-ctrl-xs px-3 text-sm text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
      >
        {{ t(v.labelKey) }}
      </ToggleGroupItem>
    </ToggleGroup>

    <slot name="actions" />
  </div>
</template>

<script setup lang="ts">
// Fullscreen editor top bar (prototype CSS). Used by both editor routes: a back
// button, a title + optional subtitle, optional diff stats, an optional view-mode
// segmented control, and an `actions` slot for page-specific buttons (save / copy
// / theme picker). Diff stats + view modes are only passed by the Task Artifact
// Editor; the Project Code Workspace omits both.
import type { EditorViewMode, EditorDiffStats } from '~/components/editor/types'

withDefaults(
  defineProps<{
    backLabel: string
    title: string
    subtitle?: string
    titleIcon?: string
    diffStats?: EditorDiffStats | null
    // When true, render the code/split/preview segmented control.
    viewModes?: boolean
    activeView?: EditorViewMode
  }>(),
  { subtitle: '', titleIcon: 'folder', diffStats: null, viewModes: false, activeView: 'split' },
)

const emit = defineEmits<{
  back: []
  'change-view': [view: EditorViewMode]
}>()

const { t } = useI18n()

// ToggleGroup single phát rỗng khi bấm lại mục đang bật — bỏ qua, chỉ phát khi đổi mục.
function onView(v: unknown) {
  if (typeof v === 'string' && v) emit('change-view', v as EditorViewMode)
}

const viewOptions = [
  { id: 'code' as const, labelKey: 'editor.view.code' },
  { id: 'split' as const, labelKey: 'editor.view.split' },
  { id: 'preview' as const, labelKey: 'editor.view.preview' },
]
</script>
