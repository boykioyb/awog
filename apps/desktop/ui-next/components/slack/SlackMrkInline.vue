<template>
  <template v-for="(n, i) in nodes" :key="i">
    <template v-if="n.t === 'text'">{{ n.v }}</template>
    <br v-else-if="n.t === 'br'" />
    <strong v-else-if="n.t === 'bold'"><SlackMrkInline :nodes="n.c" /></strong>
    <em v-else-if="n.t === 'italic'"><SlackMrkInline :nodes="n.c" /></em>
    <s v-else-if="n.t === 'strike'"><SlackMrkInline :nodes="n.c" /></s>
    <code v-else-if="n.t === 'code'" class="slk-code">{{ n.v }}</code>
    <!-- v-text thay vì {{ }} nhiều dòng: xuống dòng trong span thành khoảng trắng thừa
         quanh chip. -->
    <span
      v-else-if="n.t === 'user'"
      class="slk-mention"
      :class="{ self: n.id === selfId }"
      v-text="`@${ctx.userName(n.id) ?? n.label ?? n.id}`"
    />
    <span
      v-else-if="n.t === 'channel'"
      class="slk-mention"
      v-text="`#${ctx.channelName(n.id) ?? n.label ?? n.id}`"
    />
    <span v-else-if="n.t === 'broadcast'" class="slk-mention self">@{{ n.name }}</span>
    <span v-else-if="n.t === 'group'" class="slk-mention">{{ n.label }}</span>
    <a
      v-else-if="n.t === 'link'"
      :href="n.url"
      target="_blank"
      rel="noopener noreferrer"
      class="slk-link"
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
</script>

<style scoped>
.slk-code {
  /* mono-ok: inline code trong tin Slack — người đọc copy nguyên văn */
  font-family: var(--code);
  font-size: 0.9em;
  padding: 1px 4px;
  border-radius: var(--r-xs);
  background: var(--bgHover);
  border: 1px solid var(--border);
}
.slk-mention {
  padding: 0 3px;
  border-radius: var(--r-xs);
  background: var(--accentDim);
  color: var(--accent);
  font-weight: 500;
}
.slk-mention.self {
  background: color-mix(in srgb, var(--amber) 22%, transparent);
  color: var(--text);
}
.slk-link {
  color: var(--blue);
  text-decoration: none;
  word-break: break-all;
}
.slk-link:hover {
  text-decoration: underline;
}
</style>
