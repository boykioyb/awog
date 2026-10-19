<template>
  <div :class="CAP_TAB">
    <div v-if="!frames.length" :class="CAP_NOTE">{{ t('capture.ws.none') }}</div>
    <template v-else>
      <div class="flex max-h-[40%] flex-col overflow-auto" role="list">
        <!-- Cả dòng là một vùng bấm; đang chọn = accent-tint + thanh accent 2px. -->
        <Button
          v-for="(f, i) in frames"
          :key="i"
          variant="ghost"
          class="grid h-auto grid-cols-[1.125rem_1fr_3.5rem_5.25rem] justify-normal gap-2 rounded-none px-2 py-0.5 text-left font-normal text-foreground"
          :class="i === selected && CAP_ROW_SEL"
          role="listitem"
          @click="selected = i"
        >
          <span :class="f.dir === 'sent' ? 'text-success' : 'text-info'" aria-hidden="true">
            {{ f.dir === 'sent' ? '↑' : '↓' }}
          </span>
          <span class="truncate font-mono">{{ preview(f) }}</span>
          <span class="tnum text-dim">{{ f.payload.length }}</span>
          <span class="tnum text-dim">{{ clock(f.ts) }}</span>
        </Button>
      </div>
      <div v-if="current" class="px-2 py-1">
        <div :class="CAP_BAR">
          <span class="text-dim">
            {{ current.dir === 'sent' ? t('capture.ws.sent') : t('capture.ws.received') }} ·
            {{ t('capture.ws.opcode', { n: current.opcode }) }}
          </span>
          <Badge v-if="current.truncated" variant="warning">{{ t('capture.ws.truncated') }}</Badge>
          <span class="flex-auto" />
          <Button
            variant="ghost"
            size="iconSm"
            :title="copy.labelFor('ws-payload', t('capture.body.copy'))"
            :aria-label="copy.labelFor('ws-payload', t('capture.body.copy'))"
            @click="copy.copy('ws-payload', current.payload)"
          >
            <Icon
              :name="copy.iconFor('ws-payload')"
              :class="copy.copiedKey.value === 'ws-payload' && 'text-success'"
            />
          </Button>
          <span class="sr-only" aria-live="polite">
            {{ copy.copiedKey.value === 'ws-payload' ? t('capture.toast.copied') : '' }}
          </span>
        </div>
        <pre :class="CAP_PRE">{{ pretty(current) }}</pre>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Badge from '~/components/ui/badge/Badge.vue'
import Button from '~/components/ui/button/Button.vue'
import type { CaptureEntry, WsFrame } from '~/types/network-capture'
import { CAP_BAR, CAP_NOTE, CAP_PRE, CAP_ROW_SEL, CAP_TAB } from './capture-ui'

const props = defineProps<{ entry: CaptureEntry }>()
const { t } = useI18n()
const copy = useCopyFeedback()

const frames = computed(() => props.entry.wsFrames ?? [])
const selected = ref(0)
watch(
  () => props.entry.id,
  () => {
    selected.value = 0
  },
)
const current = computed(() => frames.value[selected.value] ?? null)

// Opcode 2 = frame nhị phân, main gửi payload dạng base64 — hiện nguyên base64 kèm số byte.
function preview(f: WsFrame): string {
  return f.opcode === 2
    ? `[binary] ${f.payload}`.slice(0, 160)
    : f.payload.replace(/\s+/g, ' ').slice(0, 160)
}
function pretty(f: WsFrame): string {
  if (f.opcode === 2) {
    const bytes = Math.floor((f.payload.replace(/=+$/, '').length * 3) / 4)
    return `[binary · ${bytes} bytes · base64]\n${f.payload}`
  }
  try {
    return JSON.stringify(JSON.parse(f.payload), null, 2)
  } catch {
    return f.payload
  }
}
const clock = (ms: number): string =>
  new Date(ms < 1e12 ? ms * 1000 : ms).toLocaleTimeString([], { hour12: false })
</script>
