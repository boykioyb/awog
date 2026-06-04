<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex flex-col"
      :style="{ background: t.overlay }"
      @click.self="emit('close')"
    >
      <div
        class="flex items-center gap-2 px-4 py-2"
        :style="{
          background: t.bgPanel,
          borderBottom: `1px solid ${t.border}`,
        }"
      >
        <component :is="headerIcon" :size="13" :style="{ color: t.textMuted }" />
        <span class="text-[1em] font-mono truncate" :style="{ color: t.text }">
          {{ attachment.name }}
        </span>
        <span
          v-if="attachment.type === 'image' && attachment.width && attachment.height"
          class="text-[1em] font-mono"
          :style="{ color: t.textDim }"
        >
          {{ attachment.width }} × {{ attachment.height }}
        </span>
        <span v-if="attachment.size" class="text-[1em]" :style="{ color: t.textDim }">
          · {{ attachment.size }}
        </span>

        <div class="ml-auto flex items-center gap-1">
          <button
            v-if="textViewer"
            class="inline-flex items-center gap-1 px-2 py-1 rounded text-[1em] transition"
            :style="actionBtnStyle"
            title="Toggle raw / rendered"
            @click="textViewer = textViewer === 'rendered' ? 'raw' : 'rendered'"
          >
            <Eye :size="12" />
            {{ textViewer === 'rendered' ? 'Raw' : 'Rendered' }}
          </button>
          <button
            class="inline-flex items-center gap-1 px-2 py-1 rounded text-[1em] transition"
            :style="copyBtnStyle"
            :title="copyTitle"
            @click="onCopy"
          >
            <component :is="copyState === 'copied' ? CheckIcon : ClipboardIcon" :size="12" />
            {{ copyLabel }}
          </button>
          <button
            v-if="attachment.url"
            class="inline-flex items-center gap-1 px-2 py-1 rounded text-[1em] transition"
            :style="actionBtnStyle"
            title="Open in new tab"
            @click="openInNewTab"
          >
            <ExternalLink :size="12" />
            Open
          </button>
          <button
            v-if="attachment.url"
            class="inline-flex items-center gap-1 px-2 py-1 rounded text-[1em] transition"
            :style="actionBtnStyle"
            title="Download"
            @click="onDownload"
          >
            <Download :size="12" />
            Download
          </button>
          <button
            class="p-1.5 rounded transition"
            :style="actionBtnStyle"
            title="Close (Esc)"
            @click="emit('close')"
          >
            <X :size="14" />
          </button>
        </div>
      </div>

      <div
        class="flex-1 flex items-center justify-center overflow-auto"
        @click.self="emit('close')"
      >
        <img
          v-if="attachment.type === 'image' && attachment.url"
          :src="attachment.url"
          :alt="attachment.name"
          class="max-w-full max-h-full object-contain rounded shadow-2xl m-6"
          :style="{ background: t.bgCanvas }"
          @click.stop
        />

        <div
          v-else-if="attachment.preview"
          class="rounded shadow-2xl flex flex-col"
          :style="{
            background: t.bgPanel,
            border: `1px solid ${t.border}`,
            width: 'min(960px, 92vw)',
            height: 'min(720px, 80vh)',
            margin: '24px',
          }"
          @click.stop
        >
          <div class="flex-1 overflow-auto" :style="{ background: t.bg, minHeight: 0 }">
            <div v-if="isMarkdown && textViewer === 'rendered'" class="px-5 py-3">
              <MarkdownRenderer :content="attachment.preview" />
            </div>
            <pre
              v-else
              class="px-5 py-4 font-mono text-[1em] leading-[1.6] whitespace-pre-wrap"
              :style="{ color: t.text, margin: 0 }"
              >{{ attachment.preview }}</pre
            >
          </div>
          <div
            class="px-4 py-1.5 flex items-center justify-between text-[1em]"
            :style="{
              borderTop: `1px solid ${t.border}`,
              background: t.bgSubtle,
              color: t.textDim,
            }"
          >
            <span>{{ lineCount }} lines · {{ charCount }} chars</span>
            <span v-if="isMarkdown">
              {{ textViewer === 'rendered' ? 'Markdown rendered' : 'Markdown source' }}
            </span>
          </div>
        </div>

        <div v-else class="text-center text-[1em]" :style="{ color: t.textDim }">
          No preview available for this attachment.
        </div>
      </div>

      <div
        v-if="copyError"
        class="absolute bottom-6 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded text-[1em]"
        :style="{
          background: t.dangerBg,
          color: t.danger,
          border: `1px solid ${t.dangerBorder}`,
        }"
      >
        {{ copyError }}
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import {
  Check as CheckIcon,
  Clipboard as ClipboardIcon,
  Download,
  Eye,
  ExternalLink,
  Image as ImageIcon,
  X,
} from 'lucide-vue-next'
import type { SessionAttachment } from '~/types'
import { fileIconFor } from '~/utils/file-icon'

const props = defineProps<{
  attachment: SessionAttachment
}>()

const emit = defineEmits<{
  close: []
}>()

const { t } = useTheme()

const copyState = ref<'idle' | 'copied'>('idle')
const copyError = ref<string | null>(null)

const isMarkdown = computed(
  () =>
    props.attachment.mime === 'text/markdown' ||
    props.attachment.name.toLowerCase().endsWith('.md'),
)

const textViewer = ref<'rendered' | 'raw' | null>(null)

watchEffect(() => {
  if (props.attachment.type === 'file' && props.attachment.preview) {
    textViewer.value = isMarkdown.value ? 'rendered' : 'raw'
  } else {
    textViewer.value = null
  }
})

const headerIcon = computed(() => {
  if (props.attachment.type === 'image') return ImageIcon
  return fileIconFor(props.attachment.name).icon
})

const lineCount = computed(() => props.attachment.preview?.split('\n').length ?? 0)
const charCount = computed(() => props.attachment.preview?.length ?? 0)

const actionBtnStyle = computed(() => ({
  background: t.value.bgHover,
  color: t.value.text,
  border: `1px solid ${t.value.border}`,
}))

const copyBtnStyle = computed(() =>
  copyState.value === 'copied'
    ? {
        background: t.value.warningBg,
        color: t.value.statusOk,
        border: `1px solid ${t.value.warningBorder}`,
      }
    : actionBtnStyle.value,
)

const copyLabel = computed(() => {
  if (copyState.value === 'copied') return 'Copied'
  return props.attachment.type === 'image' ? 'Copy image' : 'Copy text'
})

const copyTitle = computed(() =>
  copyState.value === 'copied' ? 'Copied to clipboard' : 'Copy to clipboard',
)

const urlToBlob = async (url: string): Promise<Blob> => {
  const res = await fetch(url)
  return res.blob()
}

const convertToPng = (blob: Blob): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    const objectUrl = URL.createObjectURL(blob)
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        URL.revokeObjectURL(objectUrl)
        reject(new Error('Canvas 2D context unavailable'))
        return
      }
      ctx.drawImage(img, 0, 0)
      canvas.toBlob((out) => {
        URL.revokeObjectURL(objectUrl)
        if (!out) reject(new Error('Failed to encode PNG'))
        else resolve(out)
      }, 'image/png')
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Failed to load image for conversion'))
    }
    img.src = objectUrl
  })

const markCopied = () => {
  copyState.value = 'copied'
  setTimeout(() => {
    copyState.value = 'idle'
  }, 1600)
}

const flashError = (msg: string) => {
  copyError.value = msg
  setTimeout(() => {
    copyError.value = null
  }, 3000)
}

const onCopy = async () => {
  copyError.value = null
  try {
    if (props.attachment.type === 'image') {
      if (!props.attachment.url) throw new Error('No image data available')
      const supports = typeof window !== 'undefined' && 'ClipboardItem' in window
      if (!supports) throw new Error('Clipboard image API not supported in this browser')
      const blob = await urlToBlob(props.attachment.url)
      const target = blob.type === 'image/png' ? blob : await convertToPng(blob)
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': target })])
    } else {
      if (!props.attachment.preview) throw new Error('No text content available')
      await navigator.clipboard.writeText(props.attachment.preview)
    }
    markCopied()
  } catch (e) {
    flashError(e instanceof Error ? e.message : 'Copy failed')
  }
}

const onDownload = () => {
  if (!props.attachment.url) return
  const a = document.createElement('a')
  a.href = props.attachment.url
  a.download = props.attachment.name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

const openInNewTab = () => {
  if (!props.attachment.url) return
  window.open(props.attachment.url, '_blank', 'noopener,noreferrer')
}

// ESC qua composable (stack-aware, không double-bind với modal khác).
useEscape(() => emit('close'))
</script>
