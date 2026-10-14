<template>
  <div class="cap-body-view">
    <div v-if="evicted" class="cap-note warn">{{ t('capture.body.evicted') }}</div>
    <div v-else-if="!body" class="cap-note">{{ emptyLabel ?? t('capture.body.none') }}</div>
    <template v-else>
      <div class="cap-bar">
        <Button
          v-for="m in modes"
          :key="m"
          variant="ghost"
          size="xs"
          :class="mode === m && 'cap-on'"
          :aria-pressed="mode === m"
          @click="mode = m"
        >
          {{ t(`capture.body.mode.${m}`) }}
        </Button>
        <span class="cap-grow" />
        <span class="cap-dim tnum">
          {{ formatBytes(body.size) }}
          <template v-if="pretty && mode === 'pretty'">· {{ pretty.kind }}</template>
        </span>
        <Button
          variant="ghost"
          size="iconSm"
          :class="copiedKey === 'body' && 'text-success'"
          :title="labelFor('body', t('capture.body.copy'))"
          :aria-label="labelFor('body', t('capture.body.copy'))"
          @click="copy('body', shownText)"
        >
          <Icon :name="iconFor('body')" />
        </Button>
      </div>
      <div v-if="body.truncated" class="cap-note warn">{{ t('capture.body.truncated') }}</div>

      <img
        v-if="mode === 'pretty' && imageSrc"
        :src="imageSrc"
        class="cap-img"
        :alt="t('capture.body.imageAlt')"
      />
      <pre v-else class="cap-pre cap-code">{{ visibleText }}</pre>
      <Button
        v-if="!showAll && shownText.length > DISPLAY_CAP"
        variant="outline"
        size="xs"
        class="self-start"
        @click="showAll = true"
      >
        {{ t('capture.body.showAll', { n: formatBytes(shownText.length) }) }}
      </Button>
    </template>
  </div>
</template>

<script setup lang="ts">
// Hiển thị body dưới dạng TEXT thuần: HTML hiện là mã nguồn đã escape (Vue interpolation),
// không bao giờ `v-html`. Ảnh chỉ qua `data:` URL cho raster png/jpeg/gif/webp/bmp/ico —
// SVG cố ý bị loại (có thể chứa script).
import { computed, ref, watch } from 'vue'
import type { CaptureBody } from '~/types/network-capture'
import { prettyBody } from '~/utils/capture-export'
import { formatBytes } from '~/utils/format-bytes'

const DISPLAY_CAP = 200_000
const HEX_CAP = 64 * 1024
const RASTER: Record<string, true> = {
  'image/png': true,
  'image/jpeg': true,
  'image/jpg': true,
  'image/gif': true,
  'image/webp': true,
  'image/bmp': true,
  'image/x-icon': true,
  'image/vnd.microsoft.icon': true,
}

type Mode = 'pretty' | 'raw' | 'hex'

const props = defineProps<{
  body: CaptureBody | undefined
  mimeType: string
  evicted?: boolean
  emptyLabel?: string
}>()

const { t } = useI18n()
const { copy, iconFor, labelFor, copiedKey } = useCopyFeedback()

const pretty = computed(() => (props.body ? prettyBody(props.body, props.mimeType) : null))
const mime = computed(() => (props.mimeType.split(';')[0] ?? '').trim().toLowerCase())

const imageSrc = computed(() => {
  const b = props.body
  if (!b || !b.base64 || !RASTER[mime.value]) return ''
  return `data:${mime.value};base64,${b.text}`
})

const modes = computed<Mode[]>(() =>
  props.body?.base64 ? ['pretty', 'hex', 'raw'] : ['pretty', 'raw', 'hex'],
)
const mode = ref<Mode>('pretty')
const showAll = ref(false)

watch(
  () => props.body,
  () => {
    showAll.value = false
    // Nhị phân không phải ảnh xem được → vào thẳng hex thay vì một khối ký tự rác.
    mode.value = pretty.value?.kind === 'binary' ? 'hex' : 'pretty'
  },
  { immediate: true },
)

function bytesOf(b: CaptureBody): Uint8Array {
  if (b.base64) {
    try {
      const bin = atob(b.text)
      const out = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
      return out
    } catch {
      return new Uint8Array()
    }
  }
  return new TextEncoder().encode(b.text)
}

function hexDump(bytes: Uint8Array): string {
  const lines: string[] = []
  const n = Math.min(bytes.length, HEX_CAP)
  for (let off = 0; off < n; off += 16) {
    const chunk = bytes.subarray(off, Math.min(off + 16, n))
    const hex = Array.from(chunk, (v) => v.toString(16).padStart(2, '0')).join(' ')
    const ascii = Array.from(chunk, (v) =>
      v >= 32 && v < 127 ? String.fromCharCode(v) : '.',
    ).join('')
    lines.push(`${off.toString(16).padStart(8, '0')}  ${hex.padEnd(47, ' ')}  ${ascii}`)
  }
  if (bytes.length > HEX_CAP) lines.push(`… ${bytes.length - HEX_CAP} bytes`)
  return lines.join('\n')
}

const shownText = computed(() => {
  const b = props.body
  if (!b) return ''
  if (mode.value === 'hex') return hexDump(bytesOf(b))
  if (mode.value === 'raw') {
    return b.base64 ? new TextDecoder().decode(bytesOf(b)) : b.text
  }
  return pretty.value?.text ?? ''
})

const visibleText = computed(() =>
  showAll.value || shownText.value.length <= DISPLAY_CAP
    ? shownText.value
    : shownText.value.slice(0, DISPLAY_CAP),
)
</script>
