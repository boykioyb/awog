<template>
  <LibraryEntityModal :open="open" :title="title" :width="760" @close="emit('close')">
    <template #header-extra>
      <Badge variant="outline" :class="statusBadge">
        <span class="size-2 shrink-0 rounded-full bg-current" />
        {{ statusLabel }}
      </Badge>
    </template>

    <div
      ref="scroller"
      class="h-[52vh] overflow-y-auto rounded-lg border bg-background px-3.5 py-3"
    >
      <div v-if="!lines.length" class="px-0.5 py-1.5 text-base text-muted-foreground">
        {{ emptyText }}
      </div>
      <pre v-else class="whitespace-pre-wrap font-mono text-sm wrap-anywhere text-foreground">{{
        lines.join('\n')
      }}</pre>
    </div>

    <template #footer>
      <Button :disabled="!lines.length" variant="outline" @click="onClear">
        {{ t('vpn.log.clear') }}
      </Button>
      <span class="flex-1" />
      <Button variant="outline" @click="emit('close')">{{ t('common.close') }}</Button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// Live openvpn log for one VPN profile (ADR 0065 P2) — the sanitized vpn:log lines
// the store buffers, so the user can see what "connecting…" is actually doing.
// Auto-scrolls to the tail as new lines arrive. Read-only; Clear drops the buffer.
import { computed, nextTick, useTemplateRef, watch } from 'vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import { useVpnStore, type VpnStatus } from '~/stores/vpn'
import { VPN_STATUS_BADGE } from '~/components/vpn/vpn-status'
import Button from '~/components/ui/button/Button.vue'

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
const statusBadge = computed(() => VPN_STATUS_BADGE[props.status])
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
