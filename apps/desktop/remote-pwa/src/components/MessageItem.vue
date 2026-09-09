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
      <span v-else-if="message.streaming" class="cursor" />

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
  border-radius: var(--r-sm);
  border: 1px solid var(--border);
  display: block;
}
.doc {
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--surface-2);
  /* mono-ok: a file name. */
  font-family: var(--mono);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text-dim);
}
.bubble {
  background: var(--accent-dim);
  color: var(--text);
  /* design-token-ok: the 4px corner is the bubble's tail — that px IS the shape. */
  border-radius: var(--r-card) var(--r-card) 4px var(--r-card);
  padding: 10px 13px;
  max-width: 100%;
  white-space: pre-wrap;
  word-break: break-word;
}
.msg.system .bubble {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  max-width: 100%;
  color: var(--text-dim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.agent .text {
  margin: 2px 0 8px;
}
.working {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-dim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  padding: 4px 0;
}
.cursor {
  display: inline-block;
  /* design-token-ok: a typing caret — 2 × 18px IS the shape, and drawing it as a
     box instead of the old U+258E glyph takes the system font's baseline and
     weight out of the picture. */
  width: 2px;
  height: 18px;
  vertical-align: -3px;
  background: var(--accent);
  animation: blink 1s steps(2) infinite;
}
@keyframes blink {
  50% {
    opacity: 0;
  }
}
/* A blinking caret is the textbook reduced-motion offender; the steady bar still
   says "more is coming". */
@media (prefers-reduced-motion: reduce) {
  .cursor {
    animation: none;
  }
}
.err {
  margin-top: 6px;
  padding: 8px 10px;
  border: 1px solid var(--danger);
  border-radius: var(--r-sm);
  color: var(--danger);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
}
</style>
