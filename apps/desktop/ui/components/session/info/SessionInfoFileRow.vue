<template>
  <!-- Attachment: in-memory data → opens in the lightbox (no OS reveal). -->
  <button
    v-if="file.kind === 'attachment'"
    type="button"
    class="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-left transition group"
    :style="{ background: t.bgSubtle, border: `1px solid ${t.border}` }"
    :title="`${file.name}${file.size ? ` · ${file.size}` : ''}`"
    @click="emit('open', file.attachment)"
  >
    <component :is="icon.icon" :size="16" class="flex-shrink-0" :style="{ color: icon.color }" />
    <div class="flex-1 min-w-0">
      <div class="font-mono text-[1em] truncate" :style="{ color: t.text }">{{ file.name }}</div>
      <div class="text-[1em] truncate" :style="{ color: t.textFaint }">
        {{ icon.label }}
        <span v-if="file.size">· {{ file.size }}</span>
      </div>
    </div>
    <Maximize2 :size="13" class="flex-shrink-0" :style="{ color: t.textDim }" />
  </button>

  <!-- @file mention: a real workspace path → reveal / open with the OS. -->
  <div
    v-else
    class="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md transition"
    :style="{ background: t.bgSubtle, border: `1px solid ${t.border}` }"
  >
    <component :is="icon.icon" :size="16" class="flex-shrink-0" :style="{ color: icon.color }" />
    <div class="flex-1 min-w-0">
      <div class="font-mono text-[1em] truncate" :style="{ color: t.text }">{{ file.name }}</div>
      <div class="text-[1em] truncate" :style="{ color: t.textFaint }" :title="file.path">
        {{ file.path }}
      </div>
    </div>
    <button
      type="button"
      class="p-1 rounded transition flex-shrink-0 disabled:opacity-40"
      :style="{ color: t.textDim }"
      :disabled="!canReveal"
      :title="tr('sessionInfo.files.reveal')"
      @click="emit('reveal', file.path)"
    >
      <FolderOpen :size="13" />
    </button>
    <button
      type="button"
      class="p-1 rounded transition flex-shrink-0 disabled:opacity-40"
      :style="{ color: t.textDim }"
      :disabled="!canReveal"
      :title="tr('sessionInfo.files.open')"
      @click="emit('open-file', file.path)"
    >
      <ExternalLink :size="13" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { ExternalLink, FolderOpen, Maximize2 } from 'lucide-vue-next'
import { computed } from 'vue'
import type { SessionAttachment, SessionContextFile } from '~/types'
import { fileIconFor } from '~/utils/file-icon'

const props = defineProps<{
  file: SessionContextFile
  // False when the session has no bound project — reveal/open have no root.
  canReveal: boolean
}>()

const emit = defineEmits<{
  open: [attachment: SessionAttachment]
  reveal: [path: string]
  'open-file': [path: string]
}>()

const { t } = useTheme()
const { t: tr } = useI18n()

const icon = computed(() => fileIconFor(props.file.name))
</script>
