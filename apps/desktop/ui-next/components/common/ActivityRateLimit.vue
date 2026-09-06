<template>
  <!-- Self-hides when settled with no rate-limit data (account has no usage
  surface) — see `hidden`. -->
  <div v-if="!hidden" class="arl">
    <div class="arlhd">
      <span class="arlnm">{{ account.label }}</span>
      <span class="tag">{{ account.provider }}</span>
      <span style="flex: 1" />
      <button
        class="arlref"
        :title="t('activity.rateLimit.refresh')"
        :disabled="loading"
        @click="refresh(true)"
      >
        <Icon name="refresh" :class="{ spin: loading }" style="width: 13px; height: 13px" />
      </button>
    </div>

    <div v-if="loading && !rows.length" class="arlhint">{{ t('activity.rateLimit.loading') }}</div>
    <template v-else>
      <!-- Keep the last-good bars visible even when a refresh failed; the error is
      a note beneath, so a transient 429 no longer blanks (and hides) the card. -->
      <div v-if="rows.length" class="arlbars">
        <div v-for="row in rows" :key="row.type" class="arlrow">
          <div class="arlmeta">
            <span class="arllbl">{{ row.label }}</span>
            <span class="arlpct tnum">{{ row.pct }}%</span>
          </div>
          <div class="arlbar">
            <i :style="{ width: row.pct + '%', background: row.color }" />
          </div>
          <div v-if="row.reset" class="arlreset">
            {{ t('activity.rateLimit.resets', { in: row.reset }) }}
          </div>
        </div>
      </div>
      <div v-if="error" class="arlhint err">{{ t('activity.rateLimit.error') }}</div>
    </template>
  </div>
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

function rlColor(u: number): string {
  if (u >= 1) return 'var(--danger)'
  if (u >= 0.9) return 'var(--amber)'
  return 'var(--accent)'
}

const rows = computed(() =>
  entries.value.map((e) => ({
    type: e.rateLimitType,
    label: t(`activity.rateLimit.type.${e.rateLimitType}`),
    pct: Math.round(Math.min(1, Math.max(0, e.utilization)) * 100),
    color: rlColor(e.utilization),
    reset: formatResetsIn(e.resetsAt),
  })),
)

// Hide the whole card once settled with no data (API-key accounts / providers
// without a usage surface) — only accounts that actually report a rate limit show.
const hidden = computed(() => !loading.value && !error.value && rows.value.length === 0)
</script>

<style scoped>
.arl {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 15px;
  background: var(--bgEl);
  border: 1px solid var(--border);
  border-radius: var(--r-card);
}
.arlhd {
  display: flex;
  align-items: center;
  gap: 8px;
}
.arlnm {
  font-size: 1em;
  font-weight: 550;
  color: var(--text);
}
.arlref {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
}
.arlref:hover:not(:disabled) {
  background: var(--bgHover);
  color: var(--text);
}
.arlref:disabled {
  opacity: 0.5;
  cursor: default;
}
.spin {
  animation: arlspin 0.9s linear infinite;
}
@keyframes arlspin {
  to {
    transform: rotate(360deg);
  }
}
.arlhint {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textFaint);
}
.arlhint.err {
  color: var(--amber);
}
.arlbars {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.arlrow {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.arlmeta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.arllbl {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textMuted);
}
.arlpct {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.arlbar {
  height: 6px;
  border-radius: var(--r-pill);
  background: var(--bgInput);
  overflow: hidden;
}
.arlbar i {
  display: block;
  height: 100%;
  border-radius: var(--r-pill);
  transition: width 0.2s;
}
.arlreset {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}

@media (prefers-reduced-motion: reduce) {
  .spin {
    animation: none;
  }
  .arlbar i {
    transition: none;
  }
}
</style>
