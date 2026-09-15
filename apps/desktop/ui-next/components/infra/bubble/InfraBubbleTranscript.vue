<template>
  <!-- Transcript THU NHỎ. Cố ý không dùng `SessionMessageItem`: component đó mang
       theo toàn bộ craft của màn phiên (markdown render, highlight, mermaid, hành
       động trên từng tin, neo bookmark). Trong một khung 340px ở góc màn hình,
       những thứ đó vừa không đọc được vừa kéo cả cây component vào mỗi trang.
       Ở đây chỉ giữ thứ trả lời được "phiên này đang làm gì": chữ, suy nghĩ, bước,
       câu hỏi đang chờ, và lỗi. -->
  <div ref="scroller" class="ixbt">
    <p v-if="!messages.length" class="ixbt-empty">{{ t('infra.bubble.empty') }}</p>
    <div v-for="(m, i) in messages" :key="i" class="ixbt-msg" :class="`r-${m.role}`">
      <template v-if="m.role === 'user'">
        <div class="ixbt-user">{{ m.text }}</div>
      </template>
      <template v-else-if="m.role === 'system'">
        <div class="ixbt-sys">{{ m.text }}</div>
      </template>
      <template v-else>
        <div v-for="(b, j) in m.blocks" :key="j" class="ixbt-block">
          <p v-if="b.kind === 'text'" class="ixbt-text">{{ b.text }}</p>
          <p v-else-if="b.kind === 'thinking'" class="ixbt-think">
            <Icon name="brain" />
            {{ b.text }}
          </p>
          <p v-else-if="b.kind === 'step'" class="ixbt-step">
            <Icon name="zap" />
            {{ b.tool }}{{ b.target ? ` ${b.target}` : '' }}
          </p>
          <p v-else-if="b.kind === 'question'" class="ixbt-q">
            <Icon name="help" />
            {{ b.items[0]?.prompt ?? b.title ?? '' }}
          </p>
          <p v-else-if="b.kind === 'perm'" class="ixbt-q">
            <Icon name="shield" />
            {{ b.tool }}{{ b.target ? ` ${b.target}` : '' }}
          </p>
          <p v-else-if="b.kind === 'error'" class="ixbt-err">
            <Icon name="alert" />
            {{ b.text }}
          </p>
        </div>
        <!-- Chỉ báo "đang chạy" là thứ duy nhất khiến bong bóng trông còn sống;
             thiếu nó thì một lượt đang chạy trông y hệt một lượt đã dừng. -->
        <p v-if="m.streaming" class="ixbt-run">{{ t('infra.bubble.working') }}</p>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, useTemplateRef, watch } from 'vue'
import type { SessionMessage } from '~/composables/useSessionsData'

const props = defineProps<{ messages: readonly SessionMessage[] }>()

const { t } = useI18n()
const scroller = useTemplateRef<HTMLElement>('scroller')

/**
 * Bám đáy khi có nội dung mới. Bong bóng không có thanh cuộn dư: một lượt đang
 * chạy mà người dùng không thấy chữ nào mới là một lượt trông như đã đứng.
 */
watch(
  () => props.messages.length,
  () =>
    void nextTick(() => {
      const el = scroller.value
      if (el) el.scrollTop = el.scrollHeight
    }),
)
</script>

<style scoped>
.ixbt {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ixbt-empty {
  margin: auto;
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  text-align: center;
}

.ixbt-msg {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.ixbt-user {
  padding: 6px 9px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgInput);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  white-space: pre-wrap;
  word-break: break-word;
}

.ixbt-sys {
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}

.ixbt-text {
  margin: 0;
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  white-space: pre-wrap;
  word-break: break-word;
}

.ixbt-think,
.ixbt-step,
.ixbt-q,
.ixbt-err,
.ixbt-run {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}

.ixbt-think,
.ixbt-step {
  color: var(--textFaint);
}

.ixbt-q {
  color: var(--amber);
}

.ixbt-err {
  color: var(--red);
}

.ixbt-run {
  color: var(--accent);
}

.ixbt-think,
.ixbt-step,
.ixbt-q,
.ixbt-err {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
