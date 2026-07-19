<template>
  <LibraryEntityModal :open="open" :title="title" :width="760" @close="emit('close')">
    <template #header-extra>
      <span class="vlog-status" :style="{ color: statusColor }">
        <span class="vlog-dot" :style="{ background: statusColor }" />
        {{ statusLabel }}
      </span>
    </template>

    <div ref="scroller" class="vlog-body">
      <div v-if="!lines.length" class="vlog-empty">{{ emptyText }}</div>
      <pre v-else class="vlog-pre">{{ lines.join('\n') }}</pre>
    </div>

    <template #footer>
      <button class="btn" :disabled="!lines.length" @click="onClear">
        {{ t('vpn.log.clear') }}
      </button>
      <span style="flex: 1" />
      <button class="btn" @click="emit('close')">{{ t('common.close') }}</button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// Live openvpn log for one VPN profile (ADR 0065 P2) — the sanitized vpn:log lines
// the store buffers, so the user can see what "connecting…" is actually doing.
// Auto-scrolls to the tail as new lines arrive. Read-only; Clear drops the buffer.
import { computed, nextTick, useTemplateRef, watch } from 'vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import { useVpnStore, VPN_STATUS_COLORS, type VpnStatus } from '~/stores/vpn'

const props = defineProps<{
  open: boolean
  id: string | null
  name: string
  status: VpnStatus
}>()

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const store = useVpnStore()

const lines = computed(() => (props.id ? store.logsOf(props.id) : []))
const title = computed(() => t('vpn.log.title', { name: props.name }))
const statusColor = computed(() => VPN_STATUS_COLORS[props.status])
const statusLabel = computed(() => t(`vpn.status.${props.status}`))
// While connecting, openvpn output streams in shortly (it may still be authorizing /
// starting) — so don't tell the user to "click Connect" (they already did).
const emptyText = computed(() =>
  props.status === 'connecting' ? t('vpn.log.waiting') : t('vpn.log.empty'),
)

function onClear(): void {
  if (props.id) store.clearLog(props.id)
}

// Stick to the bottom as lines stream in (and when the modal (re)opens).
const scroller = useTemplateRef<HTMLElement>('scroller')
watch(
  [() => lines.value.length, () => props.open],
  () => {
    if (!props.open) return
    void nextTick(() => {
      const el = scroller.value
      if (el) el.scrollTop = el.scrollHeight
    })
  },
  { immediate: true },
)
</script>

<style scoped>
.vlog-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  line-height: 1;
}
.vlog-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: 0 0 auto;
}
.vlog-body {
  height: 52vh;
  overflow-y: auto;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg);
  padding: 12px 14px;
}
.vlog-empty {
  color: var(--textDim);
  font-size: 1rem;
  padding: 6px 2px;
}
.vlog-pre {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--code);
  font-size: 12px;
  line-height: 1.5;
  color: var(--text);
}
</style>
