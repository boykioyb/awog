<template>
  <img
    v-if="url"
    :src="url"
    :alt="`:${name}:`"
    :title="`:${name}:`"
    class="inline-block size-[1.3em] object-contain align-[-0.3em]"
    draggable="false"
  />
  <span v-else-if="char" class="text-[1.15em]" :title="`:${name}:`">{{ char }}</span>
  <span v-else class="rounded-sm bg-accent px-1 text-[0.9em] text-dim">:{{ name }}:</span>
</template>

<script setup lang="ts">
// Một emoji Slack: tuỳ chỉnh → ảnh (data URI do sidecar cấp), chuẩn → unicode, không
// biết → giữ `:name:` dạng chip chữ để người đọc vẫn thấy ý định của người gửi.
import { computed } from 'vue'
import { splitSkin, standardEmoji } from '~/utils/slack-emoji'

const props = withDefaults(
  defineProps<{
    name: string
    skin?: number | null
    customUrl?: (name: string) => string | null
  }>(),
  { skin: null, customUrl: undefined },
)

const url = computed(() => props.customUrl?.(splitSkin(props.name).base) ?? null)
const char = computed(() => (url.value ? null : standardEmoji(props.name, props.skin)))
</script>
