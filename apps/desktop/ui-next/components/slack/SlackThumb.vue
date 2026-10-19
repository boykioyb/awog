<template>
  <img v-if="src" :src="src" :alt="alt" class="block size-full object-cover" draggable="false" />
  <div v-else class="grid size-full place-items-center bg-muted text-faint">
    <Icon :name="failed ? 'file' : 'clock'" class="size-5!" />
  </div>
</template>

<script setup lang="ts">
// Thumbnail file Slack — data URI lấy qua sidecar (`slack.file.thumb`), store cache theo
// file + cỡ nên cuộn qua lại không gọi lại.
import { ref, watch } from 'vue'
import { useSlackStore } from '~/stores/slack'

const props = defineProps<{ teamId: string; fileId: string; size: 360 | 720; alt: string }>()

const store = useSlackStore()
const src = ref<string | null>(null)
const failed = ref(false)

watch(
  () => `${props.teamId}:${props.fileId}:${props.size}`,
  async () => {
    src.value = null
    failed.value = false
    const url = await store.fileThumb(props.teamId, props.fileId, props.size)
    src.value = url
    failed.value = !url
  },
  { immediate: true },
)
</script>
