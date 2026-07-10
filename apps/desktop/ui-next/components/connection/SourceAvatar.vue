<template>
  <span class="savatar" :class="`savatar--${size}`">
    <span v-if="isTextIcon" class="savatar-emoji" :style="{ fontSize: `${glyphSize}px` }">
      {{ source.icon }}
    </span>
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
// Source icon (ADR 0060 P5 — Craft's source-avatar, adapted to ui-next). An
// emoji `config.icon` renders as text; anything else (a URL or `./icon.svg`
// path) falls back to a lucide glyph chosen by provider/type — URL-icon
// download/caching is a sidecar concern DEFERRED past P5, so a remote icon is
// NOT fetched (Electron CSP + offline). An optional status-dot overlay uses the
// shared derived status + palette.
import { computed } from 'vue'
import { Globe, HardDrive, Mail, Plug, Server, type LucideIcon } from 'lucide-vue-next'
import { deriveStatus, SOURCE_STATUS_COLORS, type Source } from '~/stores/connections'

const props = withDefaults(
  defineProps<{
    source: Source
    size?: 'sm' | 'md' | 'lg'
    showStatus?: boolean
  }>(),
  { size: 'md', showStatus: false },
)

const { t } = useI18n()

const GLYPH_PX = { sm: 13, md: 16, lg: 22 } as const
const glyphSize = computed(() => GLYPH_PX[props.size])

// An emoji icon is any non-empty value that is not a URL / path / data-uri.
const isTextIcon = computed(() => {
  const icon = props.source.icon?.trim()
  return !!icon && !/^(https?:|\/|\.|data:)/i.test(icon)
})

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
