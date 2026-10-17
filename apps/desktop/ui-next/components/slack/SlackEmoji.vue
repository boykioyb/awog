<template>
  <img
    v-if="url"
    :src="url"
    :alt="`:${name}:`"
    :title="`:${name}:`"
    class="slk-emoji-img"
    draggable="false"
  />
  <span v-else-if="char" class="slk-emoji" :title="`:${name}:`">{{ char }}</span>
  <span v-else class="slk-emoji-unknown">:{{ name }}:</span>
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

<style scoped>
.slk-emoji {
  font-size: 1.15em;
}
.slk-emoji-img {
  display: inline-block;
  width: 1.3em;
  height: 1.3em;
  object-fit: contain;
  vertical-align: -0.3em;
}
.slk-emoji-unknown {
  padding: 0 4px;
  border-radius: var(--r-xs);
  background: var(--bgHover);
  color: var(--textDim);
  font-size: 0.9em;
}
</style>
