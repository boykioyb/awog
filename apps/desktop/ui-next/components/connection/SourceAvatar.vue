<template>
  <span
    class="relative inline-grid flex-none place-items-center border text-muted-foreground"
    :class="[SIZE_CLASS[size], imgSrc ? 'bg-background' : 'bg-muted']"
  >
    <span v-if="showEmoji" class="leading-none" :style="{ fontSize: `${glyphSize}px` }">
      {{ emojiValue }}
    </span>
    <img v-else-if="imgSrc" class="size-4/5 object-contain" :src="imgSrc" :alt="alt" />
    <BrandIcon v-else-if="brand" :provider="source.provider" :size="glyphSize" />
    <component :is="fallbackIcon" v-else :size="glyphSize" :stroke-width="1.75" />
    <span
      v-if="showStatus"
      class="absolute -right-0.5 -bottom-0.5 size-2 rounded-full border-2 border-background"
      :style="{ background: dotColor }"
      :title="dotTooltip"
    />
  </span>
</template>

<script setup lang="ts">
// Source icon (ADR 0060 P5 + UI-parity area 1 — Craft's source-avatar, adapted to
// ui-next). Priority: emoji `config.icon` (fast client path, no RPC) > a resolved
// icon from the sidecar (`source.resolveIcon`: local file / downloaded config.icon
// URL / provider favicon, all returned as a base64 data URI — CSP-safe) > a bundled
// brand mark for a known provider (utils/brand-icons — real logo, offline) > a
// lucide glyph chosen by provider/type. The resolve is lazy (on mount) and
// memoized in the store so a list of rows resolves each source once. An optional
// status-dot overlay uses the shared derived status + palette.
import { computed, onMounted, ref, watch } from 'vue'
import { Globe, HardDrive, Mail, Plug, Server, type LucideIcon } from 'lucide-vue-next'
import BrandIcon from '~/components/connection/BrandIcon.vue'
import { brandIcon } from '~/utils/brand-icons'
import {
  deriveStatus,
  SOURCE_STATUS_COLORS,
  useConnectionsStore,
  type ResolvedSourceIcon,
  type Source,
} from '~/stores/connections'

const props = withDefaults(
  defineProps<{
    source: Source
    size?: 'sm' | 'md' | 'lg'
    showStatus?: boolean
  }>(),
  { size: 'md', showStatus: false },
)

const { t } = useI18n()
const store = useConnectionsStore()

const GLYPH_PX = { sm: 13, md: 16, lg: 22 } as const
// Khung 26 / 34 / 46px theo thang spacing (0.25 = 1px); bo góc lớn dần theo cỡ.
const SIZE_CLASS = {
  sm: 'size-6.5 rounded-sm',
  md: 'size-8.5 rounded-md',
  lg: 'size-11.5 rounded-lg',
} as const
const glyphSize = computed(() => GLYPH_PX[props.size])

const alt = computed(() => props.source.name || props.source.slug)

// An emoji icon is any non-empty value that is not a URL / path / data-uri —
// rendered as text without touching the sidecar.
const emojiFast = computed(() => {
  const icon = props.source.icon?.trim()
  return !!icon && !/^(https?:|\/|\.|data:)/i.test(icon)
})

// The sidecar-resolved icon (null until fetched or when the emoji fast path wins).
const resolved = ref<ResolvedSourceIcon | null>(null)

const showEmoji = computed(() => emojiFast.value || resolved.value?.kind === 'emoji')
const emojiValue = computed(() =>
  emojiFast.value
    ? props.source.icon?.trim()
    : resolved.value?.kind === 'emoji'
      ? resolved.value.value
      : '',
)
const imgSrc = computed(() =>
  !emojiFast.value && resolved.value?.kind === 'dataUri' ? resolved.value.value : null,
)

// Bundled brand mark — shown when the sidecar resolved nothing (offline, unknown
// favicon) or hasn't answered yet; a resolved dataUri still wins over it.
const brand = computed(() =>
  emojiFast.value || imgSrc.value ? undefined : brandIcon(props.source.provider),
)

// lucide fallback by provider (gmail/google → Mail) then source kind.
const fallbackIcon = computed<LucideIcon>(() => {
  const provider = props.source.provider?.toLowerCase() ?? ''
  if (provider.includes('gmail') || provider.includes('google')) return Mail
  if (props.source.type === 'api') return Globe
  if (props.source.type === 'local') return HardDrive
  if (props.source.type === 'mcp') return props.source.mcp.transport === 'stdio' ? Server : Plug
  return Plug
})

const dotColor = computed(() => SOURCE_STATUS_COLORS[deriveStatus(props.source)])
const dotTooltip = computed(() => t('connections.status.' + deriveStatus(props.source)))

// Resolve the icon lazily via the store (skipped for an emoji config.icon).
async function loadIcon(): Promise<void> {
  if (emojiFast.value) {
    resolved.value = null
    return
  }
  resolved.value = await store.fetchIcon(props.source.slug)
}

onMounted(loadIcon)
watch(() => [props.source.slug, props.source.icon], loadIcon)
</script>
