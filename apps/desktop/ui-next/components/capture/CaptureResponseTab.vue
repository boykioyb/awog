<template>
  <div class="cap-tab cap-sec">
    <CaptureBodyView
      :body="entry.responseBody"
      :mime-type="entry.mimeType"
      :evicted="entry.bodyEvicted && !entry.responseBody"
      :empty-label="emptyLabel"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CaptureEntry } from '~/types/network-capture'
import CaptureBodyView from './CaptureBodyView.vue'

const props = defineProps<{ entry: CaptureEntry }>()
const { t } = useI18n()

// Body vắng có nhiều lý do khác nhau — nói đúng lý do thay vì một câu chung.
const emptyLabel = computed(() => {
  const e = props.entry
  if (e.state === 'pending') return t('capture.response.pending')
  if (e.state === 'failed') return t('capture.response.failed')
  if (e.resourceType === 'WebSocket') return t('capture.response.ws')
  return t('capture.response.none')
})
</script>
