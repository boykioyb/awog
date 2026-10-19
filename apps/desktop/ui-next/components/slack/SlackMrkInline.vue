<template>
  <template v-for="(n, i) in nodes" :key="i">
    <template v-if="n.t === 'text'">{{ n.v }}</template>
    <br v-else-if="n.t === 'br'" />
    <strong v-else-if="n.t === 'bold'"><SlackMrkInline :nodes="n.c" /></strong>
    <em v-else-if="n.t === 'italic'"><SlackMrkInline :nodes="n.c" /></em>
    <s v-else-if="n.t === 'strike'"><SlackMrkInline :nodes="n.c" /></s>
    <!-- mono-ok: inline code trong tin Slack — người đọc copy nguyên văn -->
    <code
      v-else-if="n.t === 'code'"
      class="rounded-sm border bg-accent px-1 py-px font-mono text-[0.9em]"
      v-text="n.v"
    />
    <!-- v-text thay vì {{ }} nhiều dòng: xuống dòng trong span thành khoảng trắng thừa
         quanh chip. -->
    <span
      v-else-if="n.t === 'user'"
      class="rounded-sm px-0.75 font-medium"
      :class="n.id === selfId ? MENTION_SELF : MENTION"
      v-text="`@${ctx.userName(n.id) ?? n.label ?? n.id}`"
    />
    <span
      v-else-if="n.t === 'channel'"
      :class="['rounded-sm px-0.75 font-medium', MENTION]"
      v-text="`#${ctx.channelName(n.id) ?? n.label ?? n.id}`"
    />
    <span
      v-else-if="n.t === 'broadcast'"
      class="rounded-sm px-0.75 font-medium"
      :class="MENTION_SELF"
    >
      @{{ n.name }}
    </span>
    <span v-else-if="n.t === 'group'" class="rounded-sm px-0.75 font-medium" :class="MENTION">
      {{ n.label }}
    </span>
    <a
      v-else-if="n.t === 'link'"
      :href="n.url"
      target="_blank"
      rel="noopener noreferrer"
      class="break-all text-info no-underline hover:underline"
      v-text="n.label ?? n.url"
    />
    <SlackEmoji
      v-else-if="n.t === 'emoji'"
      :name="n.name"
      :skin="n.skin"
      :custom-url="ctx.customEmojiUrl"
    />
  </template>
</template>

<script setup lang="ts">
// Render đệ quy danh sách inline token của mrkdwn (utils/slack-mrkdwn.ts). Không v-html:
// mọi text đi qua interpolation của Vue nên nội dung Slack không chèn được HTML.
// Link chỉ có http(s)/mailto (parser đã lọc); click đi qua LinkOpenHost như mọi <a>.
import { computed } from 'vue'
import type { MrkInline } from '~/utils/slack-mrkdwn'
import { useSlackCtx } from '~/composables/useSlackManager'

defineProps<{ nodes: MrkInline[] }>()

const ctx = useSlackCtx()
const selfId = computed(() => ctx.detail.value?.selfUserId ?? null)

// Chip mention: người khác = accent-tint; chính mình / @here… = tô vàng như Slack.
const MENTION = 'bg-selected text-primary'
const MENTION_SELF = 'bg-warning/22 text-foreground'
</script>
