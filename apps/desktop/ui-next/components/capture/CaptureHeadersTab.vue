<template>
  <div class="cap-tab">
    <div class="cap-bar">
      <Button
        variant="ghost"
        size="xs"
        :class="raw && 'cap-on'"
        :aria-pressed="raw"
        :title="t('capture.headers.rawHint')"
        @click="raw = !raw"
      >
        {{ t('capture.headers.raw') }}
      </Button>
    </div>

    <section class="cap-sec">
      <h4>{{ t('capture.headers.general') }}</h4>
      <table class="cap-kv">
        <tbody>
          <tr v-for="row in general" :key="row[0]">
            <th>{{ row[0] }}</th>
            <td class="cap-code cap-wrap">{{ row[1] }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="cap-sec">
      <h4>
        {{ t('capture.headers.response', { n: entry.responseHeaders.length }) }}
        <Button
          variant="ghost"
          size="iconSm"
          :class="copiedKey === 'response' && 'text-success'"
          :title="labelFor('response', t('capture.headers.copy'))"
          :aria-label="labelFor('response', t('capture.headers.copy'))"
          @click="copy('response', responseText)"
        >
          <Icon :name="iconFor('response')" />
        </Button>
      </h4>
      <pre v-if="raw" class="cap-pre cap-code">{{ responseText }}</pre>
      <table v-else-if="entry.responseHeaders.length" class="cap-kv">
        <tbody>
          <tr v-for="(h, i) in entry.responseHeaders" :key="i">
            <th class="cap-code">{{ h[0] }}</th>
            <td class="cap-code cap-wrap">{{ h[1] }}</td>
          </tr>
        </tbody>
      </table>
      <div v-else class="cap-note">{{ t('capture.headers.none') }}</div>
    </section>

    <section class="cap-sec">
      <h4>
        {{ t('capture.headers.request', { n: entry.requestHeaders.length }) }}
        <Button
          variant="ghost"
          size="iconSm"
          :class="copiedKey === 'request' && 'text-success'"
          :title="labelFor('request', t('capture.headers.copy'))"
          :aria-label="labelFor('request', t('capture.headers.copy'))"
          @click="copy('request', requestText)"
        >
          <Icon :name="iconFor('request')" />
        </Button>
      </h4>
      <pre v-if="raw" class="cap-pre cap-code">{{ requestText }}</pre>
      <table v-else-if="entry.requestHeaders.length" class="cap-kv">
        <tbody>
          <tr v-for="(h, i) in entry.requestHeaders" :key="i">
            <th class="cap-code">{{ h[0] }}</th>
            <td class="cap-code cap-wrap">{{ h[1] }}</td>
          </tr>
        </tbody>
      </table>
      <div v-else class="cap-note">{{ t('capture.headers.none') }}</div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CaptureEntry, HeaderPair } from '~/types/network-capture'

const props = defineProps<{ entry: CaptureEntry }>()
const { t } = useI18n()
const raw = ref(false)
const { copy, iconFor, labelFor, copiedKey } = useCopyFeedback()

const lines = (hs: HeaderPair[]): string => hs.map(([k, v]) => `${k}: ${v}`).join('\n')

const requestText = computed(
  () => props.entry.requestHeadersText ?? lines(props.entry.requestHeaders),
)
const responseText = computed(
  () => props.entry.responseHeadersText ?? lines(props.entry.responseHeaders),
)

const general = computed<[string, string][]>(() => {
  const e = props.entry
  const rows: [string, string][] = [
    [t('capture.headers.url'), e.url],
    [t('capture.headers.method'), e.method],
    [
      t('capture.headers.status'),
      e.state === 'failed'
        ? (e.error ?? t('capture.status.failed'))
        : `${e.status ?? '…'} ${e.statusText}`.trim(),
    ],
  ]
  if (e.remoteIP)
    rows.push([
      t('capture.headers.remote'),
      `${e.remoteIP}${e.remotePort ? `:${e.remotePort}` : ''}`,
    ])
  if (e.httpVersion) rows.push([t('capture.headers.version'), e.httpVersion])
  if (e.blockedReason) rows.push([t('capture.headers.blocked'), e.blockedReason])
  if (e.redirectedTo) rows.push([t('capture.headers.redirectedTo'), e.redirectedTo])
  if (e.fromCache) rows.push([t('capture.headers.cache'), t('capture.headers.fromCache')])
  if (e.fromServiceWorker) rows.push([t('capture.headers.cache'), t('capture.headers.fromSw')])
  return rows
})
</script>
