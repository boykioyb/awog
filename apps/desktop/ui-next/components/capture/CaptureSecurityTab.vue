<template>
  <div class="cap-tab">
    <div v-if="!rows.length" class="cap-note">
      <Badge v-if="entry.scheme !== 'https'" variant="warning" class="mr-2">
        {{ entry.scheme }}
      </Badge>
      {{ entry.scheme === 'https' ? t('capture.security.none') : t('capture.security.plain') }}
    </div>
    <section v-else class="cap-sec">
      <table class="cap-kv">
        <tbody>
          <tr v-for="r in rows" :key="r[0]">
            <th>{{ r[0] }}</th>
            <td class="cap-code cap-wrap">
              <Badge v-if="r[2]" :variant="r[2]">{{ r[1] }}</Badge>
              <template v-else>{{ r[1] }}</template>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CaptureEntry } from '~/types/network-capture'

const props = defineProps<{ entry: CaptureEntry }>()
const { t } = useI18n()

// validFrom/validTo là epoch GIÂY (CDP TimeSinceEpoch) hoặc ms tuỳ nguồn — số < 1e12 là giây.
const date = (n: number): string => new Date(n < 1e12 ? n * 1000 : n).toISOString()

type Row = [string, string, ('success' | 'warning')?]

// SSL / TLS 1.0 / 1.1 đã bị deprecate → cảnh báo; còn lại coi là ổn.
const protocolVariant = (p?: string): 'success' | 'warning' | undefined =>
  p ? (/ssl|tls ?v?1\.[01]\b/i.test(p) ? 'warning' : 'success') : undefined

const rows = computed<Row[]>(() => {
  const s = props.entry.security
  if (!s) return []
  const out: [string, string | undefined, ('success' | 'warning')?][] = [
    [t('capture.security.protocol'), s.protocol, protocolVariant(s.protocol)],
    [t('capture.security.cipher'), s.cipher],
    [t('capture.security.keyExchange'), s.keyExchange],
    [t('capture.security.subject'), s.subjectName],
    [t('capture.security.issuer'), s.issuer],
    [t('capture.security.validFrom'), s.validFrom ? date(s.validFrom) : undefined],
    [t('capture.security.validTo'), s.validTo ? date(s.validTo) : undefined],
    [t('capture.security.san'), s.sanList?.join('\n')],
    [t('capture.security.ct'), s.certificateTransparency],
  ]
  return out.filter((r): r is Row => !!r[1])
})
</script>
