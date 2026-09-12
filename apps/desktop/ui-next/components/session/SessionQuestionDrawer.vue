<template>
  <!-- Ngăn kéo trượt lên TỪ composer, không phải modal giữa màn hình: câu hỏi nằm
       đúng chỗ mắt đang nhìn khi trả lời, transcript phía trên vẫn đọc được. -->
  <Collapse :open="open" class="qdrw">
    <div v-if="shown" class="qdrw-in" :class="{ folded }">
      <!-- Cả hàng đầu là nút gập: vùng bấm to, và ở trạng thái gập nó là thứ duy
           nhất còn thấy nên phải bấm được ở bất cứ đâu trên đó. -->
      <div
        class="qdrw-head"
        :class="{ folded }"
        :title="folded ? t('sessions.gate.drawerUnfold') : t('sessions.gate.drawerFold')"
        @click="folded = !folded"
      >
        <Icon
          class="qdrw-chev"
          :class="{ up: folded }"
          name="chev"
          style="width: var(--icon-sm); height: var(--icon-sm)"
        />
        <span class="qdrw-title">{{ t('sessions.gate.modalTitle') }}</span>
        <!-- Gập rồi thì dòng này là thứ duy nhất nhắc đang hỏi gì → cho nó chính câu
             hỏi, không phải câu hướng dẫn chung. -->
        <span class="qdrw-hint">{{ folded ? summary : t('sessions.gate.modalHint') }}</span>
        <button
          class="p-1.5 rounded transition qdrw-x"
          :title="t('sessions.gate.modalDismiss')"
          @click.stop="onDismiss"
        >
          <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
      </div>
      <!-- Chính thẻ câu hỏi của transcript, không phải bản sao: tab, auto-advance,
           "Other" và submit đều là của SessionGateCard, nên đóng ngăn kéo rồi trả lời
           trong transcript vẫn y hệt. -->
      <Collapse :open="!folded" class="qdrw-fold">
        <SessionGateCard :block="shown" class="qdrw-body" />
      </Collapse>
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
//
// GẬP ≠ ĐÓNG. Nút X bỏ hẳn ngăn kéo (trả lời sau trong transcript, `useSessionQuestionModal`
// nhớ theo eid); nút gập chỉ thu nó về một hàng — câu hỏi vẫn ở đó, mà transcript phía
// trên đọc lại được. Hai việc khác nhau nên là hai nút khác nhau.
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
const folded = ref(false)
watch(block, (b) => {
  // Câu hỏi mới thì mở lại: trạng thái gập thuộc về CÂU vừa đọc, không phải về ngăn kéo.
  if (b) {
    shown.value = b
    folded.value = false
  }
  // Giữ nội dung cũ tới hết transition của <Collapse> (0.18s) rồi mới gỡ.
  else setTimeout(() => (shown.value = block.value), 220)
})

// Một dòng tóm tắt cho lúc gập: tiêu đề lời gọi, không có thì lấy câu hỏi đầu tiên.
const summary = computed<string>(() => {
  const b = shown.value
  if (!b || b.kind !== 'question') return ''
  return b.title || b.items[0]?.prompt || ''
})

const onDismiss = (): void => {
  const b = block.value
  if (b && b.kind === 'question') dismiss(b.eid)
}
</script>

<style scoped>
/* Ngăn kéo là một hàng trong cột chat (ngay trên composer), KHÔNG phải overlay:
   không có scrim, không khoá thao tác — người dùng vẫn cuộn transcript, vẫn gõ.

   `0 1 auto` chứ KHÔNG phải `none`: cột chat có thể ngắn (dock terminal dưới đáy
   chiếm nửa cửa sổ), và một ngăn kéo không co được sẽ đẩy composer ra khỏi
   `.chat{overflow:hidden}` — đúng lỗi "hiện câu hỏi là mất nút gửi". Vì `.msgs` có
   basis 0 (flex:1), toàn bộ phần co rơi vào ngăn kéo: nó lấy đúng chỗ còn lại trên
   composer rồi cuộn bên trong. Transcript bị nén hết cỡ trong tình huống đó — nút
   gập là lối ra để đọc lại nó. */
.qdrw {
  flex: 0 1 auto;
  min-height: 0;
}
/* Chuỗi min-height:0 qua từng lớp — thiếu một mắt là phần tử con lấy chiều cao
   content và cái cuộn không bao giờ xuất hiện. `> :deep()` để KHÔNG chạm vào
   <Collapse> lồng bên trong (.qdrw-fold), vốn có luật riêng bên dưới. */
.qdrw > :deep(.collapsible-in) {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.qdrw-in {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  /* Sàn = hàng đầu + hàng nút + một chút thân, tức cái ngưỡng dưới đó thì hàng nút
     bị `.collapsible-in{overflow:hidden}` cắt mất. Đơn vị `em` chứ không phải px:
     cả hai hàng đó cao theo cỡ chữ, mà cỡ chữ nền đổi được ở Settings → Appearance,
     nên một con số px đúng ở base 13 sẽ lại cắt ở base 18. Dưới sàn này thì gập
     ngăn kéo lại là lối ra — đó là việc của nút gập. */
  min-height: 7em;
  max-height: 52vh;
  margin: 0 0 8px;
  padding: 10px 12px 12px;
  background: var(--bgCard, var(--bg));
  border: 1px solid var(--accentBorder, var(--border));
  border-radius: var(--r-card);
  box-shadow: 0 -6px 24px rgba(0, 0, 0, 0.18);
  /* Trượt lên: <Collapse> lo chiều cao, dòng này lo cảm giác "đẩy từ composer lên". */
  animation: qdrw-rise 0.22s ease both;
}
/* Gập rồi thì chẳng còn hàng nút nào để chừa chỗ — sàn trên biến mất, ngăn kéo
   thu về đúng một hàng. */
.qdrw-in.folded {
  min-height: 0;
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
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  cursor: pointer;
  user-select: none;
}
/* Gập rồi thì hàng đầu LÀ ngăn kéo — bỏ khoảng cách thừa dưới nó. */
.qdrw-head.folded {
  margin-bottom: 0;
}
.qdrw-chev {
  flex: none;
  color: var(--textDim);
  transition: transform 0.18s ease;
}
.qdrw-chev.up {
  transform: rotate(-180deg);
}
.qdrw-head:hover .qdrw-chev {
  color: var(--text);
}
.qdrw-title {
  flex: none;
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
  flex: none;
  color: var(--textDim);
}
.qdrw-x:hover {
  background: var(--bgHover);
  color: var(--text);
}
/* <Collapse> của phần thân: nó vừa phải co theo cột, vừa phải gập được. */
.qdrw-fold {
  flex: 0 1 auto;
  min-height: 0;
}
.qdrw-fold > :deep(.collapsible-in) {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
/* Thẻ câu hỏi trong ngăn kéo là một cột: tiêu đề đứng yên, thân cuộn, hàng nút ở
   lại đáy. Hàng nút KHÔNG dùng position:sticky được — nó là phần tử cuối của thẻ
   nên containing block của nó kết thúc đúng chỗ nó kết thúc, sticky không có chỗ
   nào để bám. Cách duy nhất giữ nó luôn thấy là để nó NGOÀI vùng cuộn, và vùng
   cuộn là `.qbody` (SessionQuestionForm bọc sẵn). */
.qdrw-body {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  /* Ngăn kéo ĐÃ là một cái thẻ (viền accent, nền, bo góc) → thẻ bên trong bỏ hết
     khung của nó, nếu không là hai khung lồng nhau. Không chỉ cho đẹp: ở cột chat
     ngắn, 26px padding + hàng "Question" là đúng phần chỗ mà hàng nút cần để còn
     nằm trong khung. */
  margin: 0;
  border: none;
  padding: 0;
}
/* NỀN hổ phách của `.gate` thì GIỮ: nó là thứ nói "đang chờ bạn", và ở đây nó tô
   đúng vùng câu hỏi trong khung ngăn kéo. (Có thử bỏ: theme Cute khai
   `body[data-theme-family] .gcard.gate` = (0,3,1) và nạp cuối, nên muốn thắng phải
   `!important` — không đáng, mà bỏ nền cũng chẳng hơn.) */
.qdrw-body > :deep(*) {
  flex: none;
}
/* Hàng "⚠ Question" của thẻ lặp lại đúng điều tiêu đề ngăn kéo vừa nói. */
.qdrw-body > :deep(.gh) {
  display: none;
}
.qdrw-body > :deep(.qbody) {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  /* Chừa chỗ cho thanh cuộn khỏi dính sát chữ khi nội dung dài. */
  padding-right: 2px;
}
</style>
