<template>
  <!-- Ngăn kéo trượt lên TỪ composer, không phải modal giữa màn hình: câu hỏi nằm
       đúng chỗ mắt đang nhìn khi trả lời, transcript phía trên vẫn đọc được.

       Ngăn kéo là một hàng trong cột chat (ngay trên composer), KHÔNG phải overlay:
       không có scrim, không khoá thao tác — người dùng vẫn cuộn transcript, vẫn gõ.

       `0 1 auto` chứ KHÔNG phải `none`: cột chat có thể ngắn (dock terminal dưới đáy
       chiếm nửa cửa sổ), và một ngăn kéo không co được sẽ đẩy composer ra khỏi
       `.chat{overflow:hidden}` — đúng lỗi "hiện câu hỏi là mất nút gửi". Vì `.msgs` có
       basis 0 (flex:1), toàn bộ phần co rơi vào ngăn kéo: nó lấy đúng chỗ còn lại trên
       composer rồi cuộn bên trong.

       Chuỗi min-height:0 qua từng lớp (cả `.collapsible-in` bên trong <Collapse>) —
       thiếu một mắt là phần tử con lấy chiều cao content và cái cuộn không bao giờ
       xuất hiện. Lề hai bên = `--padX` như `.composer` và `.msgs` để ba khối chung
       một lề trái; lề là padding ở `.collapsible-in` chứ không phải margin trên thẻ:
       `overflow:hidden` cắt đến mép padding. -->
  <Collapse
    :open="open"
    class="min-h-0 flex-[0_1_auto] [&>.collapsible-in]:flex [&>.collapsible-in]:min-h-0 [&>.collapsible-in]:flex-col [&>.collapsible-in]:px-(--padX)"
  >
    <!-- Thẻ ngăn kéo: rộng bằng ô soạn (cap 860px căn giữa), sàn `7em` = hàng đầu +
         hàng nút + một chút thân (đơn vị em vì hai hàng đó cao theo cỡ chữ Appearance);
         gập rồi thì sàn biến mất. Bề mặt card + viền ring, KHÔNG bóng đổ (người dùng
         chốt 2026-10-16). Trồi lên từ đáy (phía ô soạn) với ease-out mạnh. -->
    <div
      v-if="shown"
      class="mx-auto mb-2 flex max-h-[52vh] w-full max-w-215 flex-auto origin-bottom flex-col rounded-xl border border-ring bg-card px-4 pt-3 pb-3.5 animate-in fade-in-0 slide-in-from-bottom-4 duration-260 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:animate-none"
      :class="folded ? 'min-h-0' : 'min-h-[7em]'"
    >
      <!-- Cả hàng đầu là nút gập: vùng bấm to, và ở trạng thái gập nó là thứ duy
           nhất còn thấy nên phải bấm được ở bất cứ đâu trên đó. -->
      <div
        class="group flex flex-none cursor-pointer items-center gap-2 select-none"
        :class="folded ? 'mb-0' : 'mb-2'"
        :title="folded ? t('sessions.gate.drawerUnfold') : t('sessions.gate.drawerFold')"
        @click="folded = !folded"
      >
        <Icon
          name="chev"
          class="size-3.5 flex-none text-muted-foreground transition-transform duration-180 group-hover:text-foreground"
          :class="{ '-rotate-180': folded }"
        />
        <span class="flex-none text-base font-semibold text-foreground">
          {{ t('sessions.gate.modalTitle') }}
        </span>
        <!-- Gập rồi thì dòng này là thứ duy nhất nhắc đang hỏi gì → cho nó chính câu
             hỏi, không phải câu hướng dẫn chung. -->
        <span class="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          {{ folded ? summary : t('sessions.gate.modalHint') }}
        </span>
        <Button
          variant="ghost"
          size="iconSm"
          class="flex-none text-muted-foreground hover:text-foreground"
          :title="t('sessions.gate.modalDismiss')"
          @click.stop="onDismiss"
        >
          <Icon name="x" />
        </Button>
      </div>
      <!-- Chính thẻ câu hỏi của transcript, không phải bản sao: tab, auto-advance,
           "Other" và submit đều là của SessionGateCard, nên đóng ngăn kéo rồi trả lời
           trong transcript vẫn y hệt.

           Thẻ trong ngăn kéo là một cột: tiêu đề đứng yên, thân (`data-qbody`) cuộn,
           hàng nút ở lại đáy — sticky không bám được vì hàng nút là phần tử cuối của
           thẻ, nên cách duy nhất là để nó NGOÀI vùng cuộn. Ngăn kéo ĐÃ là một cái thẻ
           nên thẻ bên trong bỏ hết khung (viền, nền hổ phách, đệm, bóng — `!` vì phải
           thắng class gốc của chính thẻ), và hàng "⚠ Question" (`data-qhead`) bị ẩn vì
           lặp lại đúng điều tiêu đề ngăn kéo vừa nói. -->
      <Collapse
        :open="!folded"
        class="min-h-0 flex-[0_1_auto] [&>.collapsible-in]:flex [&>.collapsible-in]:min-h-0 [&>.collapsible-in]:flex-col"
      >
        <SessionGateCard
          :block="shown"
          class="m-0! min-h-0 flex-auto border-0! bg-transparent! p-0! shadow-none! [&>*]:flex-none [&>[data-qbody]]:min-h-0 [&>[data-qbody]]:flex-auto [&>[data-qbody]]:overflow-y-auto [&>[data-qbody]]:pr-0.5 [&>[data-qhead]]:hidden"
        />
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
const { dismiss, isDismissed, openTick } = useSessionQuestionModal()

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

// "Trả lời" ở byline / dòng gọn trong transcript ⇒ bung ngăn kéo nếu đang gập.
watch(openTick, () => (folded.value = false))

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
