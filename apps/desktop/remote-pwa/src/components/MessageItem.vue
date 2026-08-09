<script setup lang="ts">
import { computed } from 'vue'
import type { UiMessage } from '../store'
import StepRow from './StepRow.vue'
import PlanCard from './PlanCard.vue'
import QuestionCard from './QuestionCard.vue'
import MarkdownBody from './MarkdownBody.vue'

const props = defineProps<{ message: UiMessage }>()

const isUser = computed(() => props.message.role === 'user')
const isSystem = computed(() => props.message.role === 'system')

// A streaming agent turn with no content yet → show a working indicator.
const empty = computed(
  () => props.message.role === 'agent' && props.message.blocks.length === 0,
)

const imageAttachments = computed(
  () => props.message.attachments?.filter((a) => a.type === 'image' && !!a.url) ?? [],
)
const fileAttachments = computed(
  () => props.message.attachments?.filter((a) => a.type !== 'image' || !a.url) ?? [],
)
const hasAttachments = computed(
  () => imageAttachments.value.length > 0 || fileAttachments.value.length > 0,
)
</script>

<template>
  <div class="msg" :class="{ user: isUser, system: isSystem }">
    <div v-if="isUser || isSystem" class="stack">
      <div v-if="hasAttachments" class="atts">
        <img v-for="a in imageAttachments" :key="a.id" :src="a.url" :alt="a.name" />
        <span v-for="a in fileAttachments" :key="a.id" class="doc">{{ a.name }}</span>
      </div>
      <div class="bubble">
        {{ message.blocks[0] && message.blocks[0].kind === 'text' ? message.blocks[0].text : '' }}
      </div>
    </div>

    <div v-else class="agent">
      <template v-for="(b, i) in message.blocks" :key="i">
        <MarkdownBody v-if="b.kind === 'text'" class="text" :src="b.text" />
        <PlanCard v-else-if="b.step.kind === 'plan'" :step="b.step" />
        <QuestionCard v-else-if="b.step.kind === 'question'" :step="b.step" />
        <StepRow v-else :step="b.step" />
      </template>

      <div v-if="empty && message.streaming" class="working">
        <span class="spin" /> Đang xử lý…
      </div>
      <div v-else-if="message.streaming" class="cursor">▍</div>

      <div v-if="message.error" class="err">{{ message.error }}</div>
    </div>
  </div>
</template>

<style scoped>
.msg {
  margin-bottom: 14px;
}
.msg.user {
  display: flex;
  justify-content: flex-end;
}
.stack {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  max-width: 85%;
}
.msg.system .stack {
  align-items: stretch;
  max-width: 100%;
}
.atts {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}
.atts img {
  width: 92px;
  height: 92px;
  object-fit: cover;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  display: block;
}
.doc {
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  font-family: var(--mono);
  font-size: 12px;
  color: var(--text-dim);
}
.bubble {
  background: var(--accent-dim);
  color: var(--text);
  border-radius: 14px 14px 4px 14px;
  padding: 10px 13px;
  max-width: 100%;
  white-space: pre-wrap;
  word-break: break-word;
}
.msg.system .bubble {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  max-width: 100%;
  color: var(--text-dim);
  font-size: 13px;
}
.agent .text {
  margin: 2px 0 8px;
}
.working {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-dim);
  font-size: 13px;
  padding: 4px 0;
}
.cursor {
  color: var(--accent);
  animation: blink 1s steps(2) infinite;
}
@keyframes blink {
  50% {
    opacity: 0;
  }
}
.err {
  margin-top: 6px;
  padding: 8px 10px;
  border: 1px solid var(--danger);
  border-radius: var(--radius-sm);
  color: var(--danger);
  font-size: 13px;
  background: color-mix(in srgb, var(--danger) 10%, transparent);
}
</style>
