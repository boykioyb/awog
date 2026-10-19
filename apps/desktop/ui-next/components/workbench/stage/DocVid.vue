<template>
  <!-- Doc 'vid' — video workspace phát qua scheme `media://` của Electron main
       (stream + Range, không đọc base64). Browser-dev → thông báo không dùng được. -->
  <div class="flex min-h-0 flex-1 flex-col">
    <div
      class="flex h-8 flex-none items-center gap-2 px-3 text-xs text-dim shadow-[inset_0_-1px_0_var(--border)] bg-card"
    >
      <span class="truncate font-mono">{{ rel }}</span>
      <span v-if="st.byteSize > 0" class="flex-none text-faint">
        · {{ formatBytes(st.byteSize) }}
      </span>
      <DocReloadButton class="ml-auto" :doc="props.doc" @reloaded="version++" />
    </div>
    <div
      v-if="!src"
      class="grid min-h-0 flex-1 place-items-center text-sm text-faint bg-background"
    >
      {{
        st.status === 'loading' || st.status === 'idle'
          ? t('workbench.file.loading')
          : t('workbench.unavailable')
      }}
    </div>
    <!-- Khung letterbox: canvas, tối hơn nền app một bậc. -->
    <div v-else class="flex min-h-0 flex-1 items-center justify-center bg-background">
      <video :src="src" controls class="max-h-full max-w-full" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { WorkbenchDoc } from '~/types/workbench'
import { useWorkbenchDocs } from '~/composables/useWorkbenchDocs'
import { mediaFileUrl } from '~/composables/usePreview'
import { formatBytes } from '~/utils/format-bytes'
import DocReloadButton from '~/components/workbench/stage/DocReloadButton.vue'

const props = defineProps<{ doc: WorkbenchDoc }>()

const { t } = useI18n()
const wbDocs = useWorkbenchDocs()
const st = wbDocs.fileStateOf(props.doc)
const rel = computed(() => wbDocs.relPathOf(props.doc))

// Video KHÔNG đọc base64: cap 25MB + không seek được. media:// stream thẳng từ
// đĩa qua main (validate workspace giống fs.*) — chỉ cần root thật. `version` là
// cache-buster: nạp lại từ đĩa ⇒ URL mới ⇒ <video> tải lại file.
const version = ref(0)
const src = computed(() => {
  const r = st.root || wbDocs.rootFor(props.doc)
  if (!r) return ''
  return mediaFileUrl(r, wbDocs.relPathOf(props.doc), version.value)
})

onMounted(() => {
  // vẫn gọi để có byteSize/metadata cho vbar; lỗi thì src vẫn render được.
  void wbDocs.ensureFile(props.doc).catch(() => {})
})
</script>
