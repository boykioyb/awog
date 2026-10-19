<template>
  <div :class="CAP_TAB">
    <section :class="CAP_SEC">
      <h4 :class="CAP_SEC_TITLE">{{ t('capture.payload.query', { n: params.length }) }}</h4>
      <Table v-if="params.length" :class="CAP_KV">
        <TableBody>
          <TableRow v-for="(p, i) in params" :key="i">
            <TableHead class="font-mono">{{ p[0] }}</TableHead>
            <TableCell class="font-mono whitespace-pre-wrap wrap-anywhere">{{ p[1] }}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <div v-else :class="CAP_NOTE">{{ t('capture.payload.noQuery') }}</div>
    </section>

    <section :class="CAP_SEC">
      <h4 :class="CAP_SEC_TITLE">{{ t('capture.payload.body') }}</h4>
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
import { CAP_KV, CAP_NOTE, CAP_SEC, CAP_SEC_TITLE, CAP_TAB } from './capture-ui'

const props = defineProps<{ entry: CaptureEntry }>()
const { t } = useI18n()

const params = computed(() => queryParams(props.entry.url))
const requestMime = computed(
  () => props.entry.requestHeaders.find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '',
)
</script>
