<template>
  <span class="savatar" :class="[`savatar--${size}`, { 'savatar--img': !!imgSrc }]">
    <span v-if="showEmoji" class="savatar-emoji" :style="{ fontSize: `${glyphSize}px` }">
      {{ emojiValue }}
    </span>
    <img v-else-if="imgSrc" class="savatar-img" :src="imgSrc" :alt="alt" />
    <component :is="fallbackIcon" v-else :size="glyphSize" :stroke-width="1.75" />
    <span
      v-if="showStatus"
      class="savatar-dot"
      :style="{ background: dotColor }"
      :title="dotTooltip"
    />
  </span>
</template>

<script setup lang="ts">
// Source icon (ADR 0060 P5 + UI-parity area 1 — Craft's source-avatar, adapted to
// ui-next). Priority: emoji `config.icon` (fast client path, no RPC) > a resolved
// icon from the sidecar (`source.resolveIcon`: local file / downloaded config.icon
// URL / provider favicon, all returned as a base64 data URI — CSP-safe) > a lucide
// glyph chosen by provider/type. The resolve is lazy (on mount) and memoized in
// the store so a list of rows resolves each source once. An optional status-dot
// overlay uses the shared derived status + palette.
import { computed, onMounted, ref, watch } from 'vue'
import { Globe, HardDrive, Mail, Plug, Server, type LucideIcon } from 'lucide-vue-next'
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

<style scoped>
.savatar {
  position: relative;
  display: inline-grid;
  place-items: center;
  flex: 0 0 auto;
  border-radius: 8px;
  background: var(--bgActive);
  color: var(--textMuted);
  border: 1px solid var(--border);
}
.savatar--img {
  background: var(--bg);
}
.savatar--sm {
  width: 26px;
  height: 26px;
  border-radius: 7px;
}
.savatar--md {
  width: 34px;
  height: 34px;
}
.savatar--lg {
  width: 46px;
  height: 46px;
  border-radius: 10px;
}
.savatar-emoji {
  line-height: 1;
}
.savatar-img {
  width: 80%;
  height: 80%;
  object-fit: contain;
}
.savatar-dot {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 2px solid var(--bg);
}
</style>
