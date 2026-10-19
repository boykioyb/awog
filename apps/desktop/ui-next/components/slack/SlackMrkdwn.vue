<template>
  <div class="text-base leading-(--lh-prose) text-foreground wrap-anywhere [&>p+p]:mt-1">
    <template v-for="(b, i) in blocks" :key="i">
      <p v-if="b.t === 'para'" class="m-0 whitespace-pre-wrap"><SlackMrkInline :nodes="b.c" /></p>
      <blockquote
        v-else-if="b.t === 'quote'"
        class="mx-0 mb-0 mt-1 whitespace-pre-wrap border-l-3 border-input pl-2.5 text-dim"
      >
        <SlackMrkInline :nodes="b.c" />
      </blockquote>
      <!-- mono-ok: khối code ``` trong tin Slack -->
      <pre
        v-else
        class="mb-0 mt-1 overflow-x-auto whitespace-pre-wrap rounded-md border bg-muted px-2.5 py-2 font-mono text-sm"
        >{{ b.v }}</pre
      >
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
