<template>
  <div class="cap-tab">
    <section class="cap-sec">
      <h4>{{ t('capture.payload.query', { n: params.length }) }}</h4>
      <table v-if="params.length" class="cap-kv">
        <tbody>
          <tr v-for="(p, i) in params" :key="i">
            <th class="cap-code">{{ p[0] }}</th>
            <td class="cap-code cap-wrap">{{ p[1] }}</td>
          </tr>
        </tbody>
      </table>
      <div v-else class="cap-note">{{ t('capture.payload.noQuery') }}</div>
    </section>

    <section class="cap-sec">
      <h4>{{ t('capture.payload.body') }}</h4>
      <CaptureBodyView
        :body="entry.requestBody"
        :mime-type="requestMime"
        :empty-label="t('capture.payload.noBody')"
      />
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CaptureEntry } from '~/types/network-capture'
import { queryParams } from '~/utils/capture-export'
import CaptureBodyView from './CaptureBodyView.vue'

const props = defineProps<{ entry: CaptureEntry }>()
const { t } = useI18n()

const params = computed(() => queryParams(props.entry.url))
const requestMime = computed(
  () => props.entry.requestHeaders.find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '',
)
</script>
