<template>
  <div class="cap-tab">
    <div v-if="!segments.length && !total" class="cap-note">{{ t('capture.timing.none') }}</div>
    <template v-else>
      <section class="cap-sec">
        <h4>{{ t('capture.timing.waterfall') }}</h4>
        <div class="cw-wf" role="img" :aria-label="t('capture.timing.waterfall')">
          <span
            v-for="s in segments"
            :key="s.key"
            class="cw-seg"
            :class="`seg-${s.key}`"
            :style="{ width: `${s.pct}%` }"
            :title="`${t(`capture.timing.${s.key}`)}: ${fmt(s.ms)}`"
          />
        </div>
      </section>
      <section class="cap-sec">
        <table class="cap-kv">
          <tbody>
            <tr v-for="s in segments" :key="s.key">
              <th>
                <span class="cw-swatch" :class="`seg-${s.key}`" aria-hidden="true" />
                {{ t(`capture.timing.${s.key}`) }}
              </th>
              <td class="tnum">{{ fmt(s.ms) }}</td>
              <td class="cw-cell" aria-hidden="true">
                <span class="cw-bar" :class="`seg-${s.key}`" :style="{ width: `${s.pct}%` }" />
              </td>
            </tr>
            <tr>
              <th>{{ t('capture.timing.total') }}</th>
              <td class="tnum font-semibold">{{ fmt(total) }}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CaptureEntry, CaptureTiming } from '~/types/network-capture'

const props = defineProps<{ entry: CaptureEntry }>()
const { t } = useI18n()

const ORDER = ['blocked', 'dns', 'connect', 'ssl', 'send', 'wait', 'receive'] as const

const parts = computed(() => {
  const tm: CaptureTiming = props.entry.timing ?? {}
  return ORDER.map((k) => ({ key: k, ms: tm[`${k}Ms` as keyof CaptureTiming] ?? 0 })).filter(
    (p) => p.ms > 0,
  )
})
const total = computed(
  () =>
    props.entry.timing?.totalMs ??
    props.entry.durationMs ??
    parts.value.reduce((a, p) => a + p.ms, 0),
)
const segments = computed(() => {
  const sum = parts.value.reduce((a, p) => a + p.ms, 0) || 1
  return parts.value.map((p) => ({ ...p, pct: Math.max(0.5, (p.ms / sum) * 100) }))
})

const fmt = (ms: number): string =>
  ms < 1000 ? `${ms.toFixed(ms < 10 ? 2 : 0)} ms` : `${(ms / 1000).toFixed(2)} s`
</script>

<style scoped>
.cw-wf {
  display: flex;
  height: 12px;
  gap: 1px;
  border-radius: var(--r-xs);
  overflow: hidden;
  background: var(--bgSubtle);
  box-shadow: inset 0 0 0 1px var(--border);
}
.cw-seg {
  min-width: 2px;
}
.cw-swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  margin-right: 6px;
  border-radius: 3px; /* design-token-ok: swatch shape */
  vertical-align: middle;
}
.cw-cell {
  width: 40%;
}
.cw-bar {
  display: block;
  height: 6px;
  border-radius: 3px; /* design-token-ok: bar shape */
}
.seg-blocked {
  background: var(--textDim);
}
.seg-dns {
  background: var(--violet);
}
.seg-connect {
  background: var(--amber);
}
.seg-ssl {
  background: var(--accent);
}
.seg-send {
  background: var(--blue);
}
.seg-wait {
  background: var(--green);
}
.seg-receive {
  background: var(--blue);
  opacity: 0.6;
}
</style>
