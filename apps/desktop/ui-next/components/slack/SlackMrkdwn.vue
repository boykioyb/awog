<template>
  <div class="slk-mrk">
    <template v-for="(b, i) in blocks" :key="i">
      <p v-if="b.t === 'para'" class="slk-p"><SlackMrkInline :nodes="b.c" /></p>
      <blockquote v-else-if="b.t === 'quote'" class="slk-quote">
        <SlackMrkInline :nodes="b.c" />
      </blockquote>
      <pre v-else class="slk-pre">{{ b.v }}</pre>
    </template>
  </div>
</template>

<script setup lang="ts">
// Thân một tin Slack: parse mrkdwn → block (đoạn / trích dẫn / khối code) → render
// bằng component. Parse trong computed: chỉ chạy lại khi text đổi (dịch / sửa tin).
import { computed } from 'vue'
import { parseMrkdwn } from '~/utils/slack-mrkdwn'

const props = defineProps<{ text: string }>()

const blocks = computed(() => parseMrkdwn(props.text))
</script>

<style scoped>
.slk-mrk {
  font-size: var(--fs-md);
  line-height: var(--lh-prose);
  color: var(--text);
  overflow-wrap: anywhere;
}
.slk-p {
  margin: 0;
  white-space: pre-wrap;
}
.slk-p + .slk-p,
.slk-quote,
.slk-pre {
  margin-top: 4px;
}
.slk-quote {
  margin: 4px 0 0;
  padding-left: 10px;
  border-left: 3px solid var(--borderStrong);
  color: var(--textDim);
  white-space: pre-wrap;
}
.slk-pre {
  /* mono-ok: khối code ``` trong tin Slack */
  font-family: var(--code);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  margin-bottom: 0;
  padding: 8px 10px;
  border-radius: var(--r-sm);
  border: 1px solid var(--border);
  background: var(--bgSubtle);
  white-space: pre-wrap;
  overflow-x: auto;
}
</style>
