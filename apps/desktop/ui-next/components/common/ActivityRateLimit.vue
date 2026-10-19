<template>
  <!-- Self-hides when settled with no rate-limit data (account has no usage
  surface) — see `hidden`. -->
  <Card v-if="!hidden" class="gap-2.5 p-4">
    <div class="flex items-center gap-2">
      <span class="font-medium text-foreground">{{ account.label }}</span>
      <Badge variant="secondary">{{ account.provider }}</Badge>
      <span class="flex-1" />
      <Button
        variant="ghost"
        size="iconSm"
        class="text-muted-foreground"
        :title="t('activity.rateLimit.refresh')"
        :disabled="loading"
        @click="refresh(true)"
      >
        <Icon name="refresh" :class="{ 'animate-spin motion-reduce:animate-none': loading }" />
      </Button>
    </div>

    <div v-if="loading && !rows.length" class="text-sm text-muted-foreground">
      {{ t('activity.rateLimit.loading') }}
    </div>
    <template v-else>
      <!-- Keep the last-good bars visible even when a refresh failed; the error is
      a note beneath, so a transient 429 no longer blanks (and hides) the card. -->
      <div v-if="rows.length" class="flex flex-col gap-2">
        <div v-for="row in rows" :key="row.type" class="flex flex-col gap-1">
          <div class="flex items-center justify-between gap-2">
            <span class="text-sm text-muted-foreground">{{ row.label }}</span>
            <span class="text-xs text-muted-foreground tabular-nums">{{ row.pct }}%</span>
          </div>
          <Progress
            :model-value="row.pct"
            class="h-1.5 bg-muted motion-reduce:*:transition-none"
            :class="row.barClass"
          />
          <div v-if="row.reset" class="text-xs text-muted-foreground">
            {{ t('activity.rateLimit.resets', { in: row.reset }) }}
          </div>
        </div>
      </div>
      <div v-if="error" class="text-sm text-warning">{{ t('activity.rateLimit.error') }}</div>
    </template>
  </Card>
</template>

<script setup lang="ts">
// One provider account's rate-limit utilization — reuses useAccountUsage
// (account.usage → claude.ai OAuth / captured Codex headers). Bars colour by
// severity (accent < 90% < amber < 100% danger). Refreshes once on mount; the
// sidecar caches 60s so the manual refresh is cheap. Labels go through i18n.
import { computed, onMounted } from 'vue'
import type { AccountOption } from '~/composables/useAccounts'
import { useAccountUsage } from '~/composables/useAccountUsage'

const props = defineProps<{ account: AccountOption }>()

const { t } = useI18n()

const { entries, loading, error, refresh } = useAccountUsage(() => ({
  provider: props.account.provider.toLowerCase(),
  accountId: props.account.id,
}))

onMounted(() => void refresh())

function formatResetsIn(ms?: number): string {
  if (!ms) return ''
  const diff = ms - Date.now()
  if (diff <= 0) return t('activity.rateLimit.now')
  const mins = Math.floor(diff / 60_000)
  const days = Math.floor(mins / 1440)
  const hours = Math.floor((mins % 1440) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins % 60}m`
  return `${mins % 60}m`
}

// Màu thanh theo mức: tô lên indicator (con trực tiếp `data-slot=progress-indicator`).
function rlBarClass(u: number): string {
  if (u >= 1) return '*:data-[slot=progress-indicator]:bg-destructive'
  if (u >= 0.9) return '*:data-[slot=progress-indicator]:bg-warning'
  return ''
}

const rows = computed(() =>
  entries.value.map((e) => ({
    type: e.rateLimitType,
    label: t(`activity.rateLimit.type.${e.rateLimitType}`),
    pct: Math.round(Math.min(1, Math.max(0, e.utilization)) * 100),
    barClass: rlBarClass(e.utilization),
    reset: formatResetsIn(e.resetsAt),
  })),
)

// Hide the whole card once settled with no data (API-key accounts / providers
// without a usage surface) — only accounts that actually report a rate limit show.
const hidden = computed(() => !loading.value && !error.value && rows.value.length === 0)
</script>
