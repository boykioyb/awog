<template>
  <div class="relative h-full w-full" :style="{ background: t.bg }">
    <div
      v-if="status === 'loading'"
      class="absolute inset-0 flex items-center justify-center gap-2 text-[1em]"
      :style="{ color: t.textDim }"
    >
      <Activity :size="13" class="animate-pulse" />
      {{ tr('common.loading') }}
    </div>
    <div
      v-else-if="status === 'too-large'"
      class="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-[1em]"
      :style="{ color: t.textDim }"
    >
      <FileWarning :size="28" :stroke-width="1.5" :style="{ color: t.textFaint }" />
      <span>{{ tr('workspace.files.preview_too_large') }}</span>
    </div>
    <div
      v-else-if="status === 'error'"
      class="absolute inset-0 flex items-center justify-center px-6 text-center text-[1em]"
      :style="{ color: t.danger }"
    >
      {{ tr('workspace.files.preview_failed') }}
    </div>

    <!-- HTML: sandboxed with scripts but NO allow-same-origin → the page runs in
         an opaque origin, so JS-rendered content shows, yet it can't reach the
         app:// context, cookies, or storage. (allow-scripts + allow-same-origin
         together would let it escape the sandbox — never combine them.)
         Relative assets still won't resolve; full fidelity is "Show in browser". -->
    <iframe
      v-else-if="kind === 'html'"
      :srcdoc="htmlSrc"
      sandbox="allow-scripts allow-popups allow-forms allow-modals"
      class="h-full w-full"
      :style="{ border: 0, background: '#fff' }"
    />
    <!-- PDF: blob rendered by Chromium's built-in viewer (inert binary). -->
    <iframe
      v-else-if="pdfUrl"
      :src="pdfUrl"
      class="h-full w-full"
      :style="{ border: 0, background: '#fff' }"
    />
  </div>
</template>

<script setup lang="ts">
import { Activity, FileWarning } from 'lucide-vue-next'
import { useFsApi } from '~/composables/useFsApi'

const props = defineProps<{
  workspaceRoot: string
  path: string
  kind: 'html' | 'pdf'
}>()

const { t } = useTheme()
const { t: tr } = useI18n()
const fs = useFsApi()

const HTML_MAX_BYTES = 4 * 1024 * 1024

type Status = 'loading' | 'ready' | 'too-large' | 'error'
const status = ref<Status>('loading')
const htmlSrc = ref('')
const pdfUrl = ref<string | null>(null)

const revokePdf = () => {
  if (pdfUrl.value) {
    URL.revokeObjectURL(pdfUrl.value)
    pdfUrl.value = null
  }
}

const base64ToBlob = (b64: string, type: string): Blob => {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type })
}

const load = async () => {
  status.value = 'loading'
  htmlSrc.value = ''
  revokePdf()
  try {
    if (props.kind === 'html') {
      const file = await fs.readFile(props.workspaceRoot, props.path, HTML_MAX_BYTES)
      htmlSrc.value = file.content
      status.value = 'ready'
    } else {
      const file = await fs.readFileBase64(props.workspaceRoot, props.path)
      if (file.truncated || !file.base64) {
        status.value = 'too-large'
        return
      }
      pdfUrl.value = URL.createObjectURL(
        base64ToBlob(file.base64, file.mimeType || 'application/pdf'),
      )
      status.value = 'ready'
    }
  } catch {
    status.value = 'error'
  }
}

watch(() => [props.workspaceRoot, props.path, props.kind], load, { immediate: true })
onUnmounted(revokePdf)
</script>
