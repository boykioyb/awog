<template>
  <div :class="CAP_TAB">
    <div v-if="!segments.length && !total" :class="CAP_NOTE">{{ t('capture.timing.none') }}</div>
    <template v-else>
      <section :class="CAP_SEC">
        <h4 :class="CAP_SEC_TITLE">{{ t('capture.timing.waterfall') }}</h4>
        <div
          class="flex h-3 gap-px overflow-hidden rounded-sm bg-muted ring-1 ring-border ring-inset"
          role="img"
          :aria-label="t('capture.timing.waterfall')"
        >
          <span
            v-for="s in segments"
            :key="s.key"
            class="min-w-0.5"
            :class="SEG_CLASS[s.key]"
            :style="{ width: `${s.pct}%` }"
            :title="`${t(`capture.timing.${s.key}`)}: ${fmt(s.ms)}`"
          />
        </div>
      </section>
      <section :class="CAP_SEC">
        <Table :class="CAP_KV">
          <TableBody>
            <TableRow v-for="s in segments" :key="s.key">
              <TableHead>
                <span
                  class="mr-1.5 inline-block size-2.5 rounded-xs align-middle"
                  :class="SEG_CLASS[s.key]"
                  aria-hidden="true"
                />
                {{ t(`capture.timing.${s.key}`) }}
              </TableHead>
              <TableCell class="tnum">{{ fmt(s.ms) }}</TableCell>
              <TableCell class="w-2/5" aria-hidden="true">
                <span
                  class="block h-1.5 rounded-xs"
                  :class="SEG_CLASS[s.key]"
                  :style="{ width: `${s.pct}%` }"
                />
              </TableCell>
            </TableRow>
            <TableRow>
              <TableHead>{{ t('capture.timing.total') }}</TableHead>
              <TableCell class="tnum font-semibold">{{ fmt(total) }}</TableCell>
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CaptureEntry, CaptureTiming } from '~/types/network-capture'
import { CAP_KV, CAP_NOTE, CAP_SEC, CAP_SEC_TITLE, CAP_TAB } from './capture-ui'

const props = defineProps<{ entry: CaptureEntry }>()
const { t } = useI18n()

const ORDER = ['blocked', 'dns', 'connect', 'ssl', 'send', 'wait', 'receive'] as const

// Màu từng pha của waterfall (swatch + thanh dùng chung).
const SEG_CLASS: Record<(typeof ORDER)[number], string> = {
  blocked: 'bg-dim',
  dns: 'bg-lavender',
  connect: 'bg-warning',
  ssl: 'bg-primary',
  send: 'bg-info',
  wait: 'bg-success',
  receive: 'bg-info/60',
}

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
