<template>
  <div class="cap-tab cap-ws">
    <div v-if="!frames.length" class="cap-note">{{ t('capture.ws.none') }}</div>
    <template v-else>
      <div class="ws-list" role="list">
        <button
          v-for="(f, i) in frames"
          :key="i"
          type="button"
          class="ws-row"
          :class="[f.dir, { sel: i === selected }]"
          role="listitem"
          @click="selected = i"
        >
          <span class="ws-dir" aria-hidden="true">{{ f.dir === 'sent' ? '↑' : '↓' }}</span>
          <span class="ws-pl cap-code">{{ preview(f) }}</span>
          <span class="cap-dim tnum">{{ f.payload.length }}</span>
          <span class="cap-dim tnum">{{ clock(f.ts) }}</span>
        </button>
      </div>
      <div v-if="current" class="ws-detail">
        <div class="cap-bar">
          <span class="cap-dim">
            {{ current.dir === 'sent' ? t('capture.ws.sent') : t('capture.ws.received') }} ·
            {{ t('capture.ws.opcode', { n: current.opcode }) }}
          </span>
          <Badge v-if="current.truncated" variant="warning">{{ t('capture.ws.truncated') }}</Badge>
          <span class="cap-grow" />
          <Button
            variant="ghost"
            size="iconSm"
            :title="copy.labelFor('ws-payload', t('capture.body.copy'))"
            :aria-label="copy.labelFor('ws-payload', t('capture.body.copy'))"
            @click="copy.copy('ws-payload', current.payload)"
          >
            <Icon
              :name="copy.iconFor('ws-payload')"
              :style="copy.copiedKey.value === 'ws-payload' ? { color: 'var(--green)' } : undefined"
            />
          </Button>
          <span class="ws-live" aria-live="polite">
            {{ copy.copiedKey.value === 'ws-payload' ? t('capture.toast.copied') : '' }}
          </span>
        </div>
        <pre class="cap-pre cap-code">{{ pretty(current) }}</pre>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Badge from '~/components/ui/badge/Badge.vue'
import Button from '~/components/ui/button/Button.vue'
import type { CaptureEntry, WsFrame } from '~/types/network-capture'

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

<style scoped>
.ws-list {
  display: flex;
  flex-direction: column;
  max-height: 40%;
  overflow: auto;
}
.ws-row {
  display: grid;
  grid-template-columns: 18px 1fr 56px 84px;
  align-items: center;
  gap: 8px;
  padding: 3px 8px;
  text-align: left;
  background: transparent;
  border: 0;
  cursor: pointer;
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.ws-row:hover {
  background: var(--bgHover);
}
.ws-row.sel {
  background: var(--accentDim);
  box-shadow: inset 2px 0 0 var(--accent);
}
.ws-row.sent .ws-dir {
  color: var(--green);
}
.ws-row.received .ws-dir {
  color: var(--blue);
}
.ws-pl {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ws-detail {
  padding: 4px 8px;
}
.ws-live {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
}
</style>
