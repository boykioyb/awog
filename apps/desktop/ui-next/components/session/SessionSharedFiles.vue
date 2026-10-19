<template>
  <div class="my-0.5 flex flex-col gap-1.5">
    <div v-if="block.caption" class="text-xs text-muted-foreground">{{ block.caption }}</div>
    <div v-if="block.files.length" class="flex flex-col gap-1.5">
      <!-- Thẻ file — khung card, wash khi hover. -->
      <Button
        v-for="f in block.files"
        :key="f.path"
        variant="outline"
        class="h-auto w-full justify-start gap-2.5 rounded-lg bg-card px-2.5 py-1.5 text-left font-normal shadow-none hover:border-input [&_svg]:size-3.5"
        :title="t('sessionsSurfaces.files.open', { path: f.path })"
        @click="openFile(f)"
      >
        <FileText class="size-3.5 shrink-0 text-primary" />
        <span class="min-w-0 flex-1">
          <span class="block truncate text-base font-medium text-foreground">{{ f.name }}</span>
          <span class="block truncate font-mono text-xs text-muted-foreground">{{ f.path }}</span>
        </span>
        <span v-if="fmtSize(f.size)" class="shrink-0 text-xs tabular-nums text-faint">
          {{ fmtSize(f.size) }}
        </span>
      </Button>
    </div>
    <div v-else-if="block.status === 'running'" class="text-xs text-muted-foreground">
      {{ t('sessionsSurfaces.files.preparing') }}
    </div>
  </div>
</template>

<script setup lang="ts">
// Files the model handed to the user (#26, send_user_file) as openable cards.
//
// Clicking goes through the SHARED file-preview infrastructure (useFilePreview →
// usePreview → PreviewModal, the repo's "every file read opens the one preview
// modal" rule) — no viewer of its own. The path is workspace-relative and was
// already validated inside the tool (assertInsideWorkspace); the read it triggers
// is gated by the same check again in the sidecar.
import { FileText } from 'lucide-vue-next'
import type { FilesBlock, SharedFile } from '~/composables/useSessionsData'
import { formatBytes } from '~/utils/format-bytes'

defineProps<{ block: FilesBlock }>()
const { t } = useI18n()
const filePreview = useFilePreview()

function openFile(f: SharedFile): void {
  filePreview.open(f.path)
}

// Unknown / zero size → no label at all (a "0 B" chip says nothing useful here).
const fmtSize = (n?: number): string => (n == null || n <= 0 ? '' : formatBytes(n))
</script>
