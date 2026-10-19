<template>
  <div class="flex h-full min-h-0 w-60 flex-none flex-col border-r bg-sidebar">
    <div class="shrink-0 border-b px-3 py-2 text-sm text-dim">
      {{ t('editor.artifacts', { id: taskId }) }}
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto pt-1 pb-2.5">
      <!-- raw-ok: hàng danh sách artifact — cả dòng là vùng bấm -->
      <button
        v-for="file in files"
        :key="file.path"
        type="button"
        class="flex w-full cursor-pointer items-center gap-2 border-l-2 px-3 py-1.5 text-left text-foreground hover:bg-accent"
        :class="
          file.name === selectedName || file.path === selectedName
            ? 'border-l-primary bg-selected'
            : 'border-l-transparent'
        "
        @click="emit('select', file.name)"
      >
        <Icon :name="file.kind === 'diff' ? 'branch' : 'text'" class="size-3.5 shrink-0 text-dim" />
        <div class="min-w-0">
          <!-- mono: tên file artifact -->
          <div class="truncate font-mono">{{ file.name }}</div>
          <div v-if="file.phase" class="truncate text-sm text-faint">
            {{ file.phase }}
            <span v-if="file.version">· v{{ file.version }}</span>
          </div>
        </div>
      </button>
      <div v-if="!files.length" class="px-3.5 py-4.5 text-faint">{{ t('editor.noArtifacts') }}</div>
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
