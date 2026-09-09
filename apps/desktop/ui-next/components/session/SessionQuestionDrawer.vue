<template>
  <!-- Ngăn kéo trượt lên TỪ composer, không phải modal giữa màn hình: câu hỏi nằm
       đúng chỗ mắt đang nhìn khi trả lời, transcript phía trên vẫn đọc được. -->
  <Collapse :open="open" class="qdrw">
    <div v-if="shown" class="qdrw-in">
      <div class="qdrw-head">
        <span class="qdrw-title">{{ t('sessions.gate.modalTitle') }}</span>
        <span class="qdrw-hint">{{ t('sessions.gate.modalHint') }}</span>
        <button
          class="p-1.5 rounded transition qdrw-x"
          :title="t('sessions.gate.modalDismiss')"
          @click="onDismiss"
        >
          <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
      </div>
      <!-- Chính thẻ câu hỏi của transcript, không phải bản sao: tab, auto-advance,
           "Other" và submit đều là của SessionGateCard, nên đóng ngăn kéo rồi trả lời
           trong transcript vẫn y hệt. -->
      <SessionGateCard :block="shown" class="qdrw-body" />
    </div>
  </Collapse>
</template>

<script setup lang="ts">
// Ngăn kéo trả lời AskUserQuestion, dựng ngay trên composer.
//
// Lượt vẫn park ở sidecar (loop chờ đáp án) nhưng đó là việc của engine — người dùng
// KHÔNG phải ngồi canh: byline của lượt đổi sang "chờ bạn trả lời" (tĩnh, hết shimmer
// "Đang chờ…"), trả lời lúc nào thì lượt chạy tiếp lúc đó.
//
// `shown` giữ lại câu hỏi vừa đóng thêm một nhịp để <Collapse> còn nội dung mà thu
// chiều cao — bỏ nó đi thì ngăn kéo biến mất cụp thay vì trượt xuống.
import { computed, ref, watch } from 'vue'
import { questionAnswered } from '~/composables/useSessionsData'
import type { AssistantBlock, Session } from '~/composables/useSessionsData'

const props = defineProps<{ session: Session }>()
const { t } = useI18n()
const { dismiss, isDismissed } = useSessionQuestionModal()

// Câu hỏi đang chờ: quét từ cuối lên (một thời điểm chỉ một câu được park) và bỏ qua
// câu người dùng đã đóng — thẻ trong transcript vẫn trả lời được.
const block = computed<AssistantBlock | null>(() => {
  const msgs = props.session.msgs
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    if (!m || m.role !== 'assistant') continue
    for (const b of m.blocks) {
      if (b.kind !== 'question' || questionAnswered(b) || b.cancelled) continue
      return isDismissed(b.eid) ? null : b
    }
  }
  return null
})

const open = computed(() => !!block.value)
const shown = ref<AssistantBlock | null>(block.value)
watch(block, (b) => {
  if (b) shown.value = b
  // Giữ nội dung cũ tới hết transition của <Collapse> (0.18s) rồi mới gỡ.
  else setTimeout(() => (shown.value = block.value), 220)
})

const onDismiss = (): void => {
  const b = block.value
  if (b && b.kind === 'question') dismiss(b.eid)
}
</script>

<style scoped>
/* Ngăn kéo là một hàng trong cột chat (ngay trên composer), KHÔNG phải overlay:
   không có scrim, không khoá thao tác — người dùng vẫn cuộn transcript, vẫn gõ. */
.qdrw {
  flex: none;
}
.qdrw-in {
  max-height: 52vh;
  overflow: auto;
  margin: 0 0 8px;
  padding: 10px 12px 12px;
  background: var(--bgCard, var(--bg));
  border: 1px solid var(--accentBorder, var(--border));
  border-radius: var(--r-card);
  box-shadow: 0 -6px 24px rgba(0, 0, 0, 0.18);
  /* Trượt lên: <Collapse> lo chiều cao, dòng này lo cảm giác "đẩy từ composer lên". */
  animation: qdrw-rise 0.22s ease both;
}
@keyframes qdrw-rise {
  from {
    transform: translateY(8px);
    opacity: 0;
  }
  to {
    transform: none;
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .qdrw-in {
    animation: none;
  }
}
.qdrw-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.qdrw-title {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
  color: var(--text);
}
.qdrw-hint {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.qdrw-x {
  color: var(--textDim);
}
.qdrw-x:hover {
  background: var(--bgHover);
  color: var(--text);
}
/* Thẻ trong ngăn kéo đã có khung riêng của ngăn kéo → bỏ viền/nền lặp của .gcard. */
.qdrw-body :deep(.gcard) {
  margin: 0;
  border: none;
  background: transparent;
  padding: 0;
}
</style>
