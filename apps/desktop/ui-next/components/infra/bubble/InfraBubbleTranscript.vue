<template>
  <!-- Transcript của phiên thu nhỏ.
       Từ 2026-09-15 nó DÙNG LẠI các mảnh của màn phiên thật thay vì tự vẽ:
         · `SessionTextBlock` — markdown, khối mã, danh sách, mermaid, caret streaming;
         · `SessionStepItem`  — hàng bước, đóng sẵn, một dòng truncate;
         · `.mu`              — bong bóng tin của người dùng (class TOÀN CỤC của app);
         · `SessionMsgActions`— hàng hành động, cùng khuôn bấm và cùng phản hồi.

       Trước đó mọi thứ là `<p>` chữ trần với `white-space: pre-wrap`, nên một câu trả
       lời có bảng, danh sách hay khối mã hiện ra thành một mảng chữ dính liền — cùng
       một phiên, cùng một dữ liệu, hai cách trình bày khác hẳn nhau.

       CÁI CỐ Ý KHÔNG MANG SANG là `SessionMessageItem` (cả component): nó kéo theo neo
       bookmark, trích dẫn, fork/rewind/resend — những hành động CẮT hoặc RẼ NHÁNH
       transcript. Chúng cần hộp xác nhận nêu số message sẽ mất và cần chỗ để hiện hộp
       đó; một khung 360px ở góc màn hình không phải chỗ để bấm một nút phá huỷ. -->
  <div ref="scroller" class="ixbt">
    <p v-if="!messages.length" class="ixbt-empty">{{ t('infra.bubble.empty') }}</p>

    <div v-for="(m, i) in messages" :key="i" class="ixbt-msg" :class="`r-${m.role}`">
      <!-- Tin người dùng: dùng LẠI `.mu` toàn cục để bong bóng ở đây và bong bóng ở
           màn phiên là cùng một hình. `.ixbt-mu` chỉ gỡ trần 74% (khung này đã hẹp). -->
      <div v-if="m.role === 'user'" class="mu ixbt-mu">{{ m.text }}</div>

      <div v-else-if="m.role === 'system'" class="ixbt-sys">{{ m.text }}</div>

      <template v-else>
        <template v-for="(b, j) in m.blocks" :key="j">
          <!-- `streaming` + `caret` CHỈ cho khối cuối của lượt đang chạy: caret nhấp
               nháy ở giữa transcript là nói dối về chỗ chữ đang chảy tới. -->
          <SessionTextBlock
            v-if="b.kind === 'text'"
            :text="b.text"
            :streaming="m.streaming === true && j === m.blocks.length - 1"
            :caret="m.streaming === true && j === m.blocks.length - 1"
          />

          <SessionStepItem v-else-if="b.kind === 'step'" :block="b" />

          <p v-else-if="b.kind === 'thinking'" class="ixbt-think">
            <Icon name="brain" />
            {{ b.text }}
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
        </template>

        <!-- Chỉ báo "đang chạy" là thứ duy nhất khiến bong bóng trông còn sống;
             thiếu nó thì một lượt đang chạy trông y hệt một lượt đã dừng. -->
        <p v-if="m.streaming" class="ixbt-run">{{ t('infra.bubble.working') }}</p>

        <!-- Hàng hành động, chỉ khi lượt đã xong VÀ có chữ để chép. Đúng một hành động:
             xem phần "cố ý không mang sang" ở đầu file. -->
        <div v-if="!m.streaming && plainTextOf(m)" class="ixbt-acts">
          <SessionMsgActions :primary="actionsFor(m)" :overflow="[]" />
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import SessionMsgActions from '~/components/session/SessionMsgActions.vue'
import SessionStepItem from '~/components/session/SessionStepItem.vue'
import SessionTextBlock from '~/components/session/SessionTextBlock.vue'
import type { MsgAction } from '~/components/session/SessionMsgActions.vue'
import type { SessionMessage } from '~/composables/useSessionsData'

const props = defineProps<{ messages: readonly SessionMessage[] }>()

const { t } = useI18n()
const scroller = useTemplateRef<HTMLElement>('scroller')

/** Chữ thuần của một lượt trợ lý — thứ nút Chép bỏ vào clipboard. */
function plainTextOf(m: SessionMessage): string {
  if (m.role !== 'assistant') return ''
  return m.blocks
    .map((b) => (b.kind === 'text' ? b.text : ''))
    .filter((s) => s !== '')
    .join('\n\n')
}

/**
 * Phản hồi "đã chép" ngay trên nút, cùng luật với màn phiên thật (tick ~1.4s rồi trả
 * về): `navigator.clipboard.writeText` im lặng cả khi thành công lẫn khi bị chặn
 * quyền, nên không có phản hồi thì người dùng không biết cú bấm đã ăn chưa. Chỉ bật cờ
 * sau khi ghi THẬT xong — không tô tick giả.
 *
 * Khoá theo CHỈ SỐ tin: hai lượt trả lời cạnh nhau phải nhấp nháy riêng.
 */
const copiedAt = ref<number | null>(null)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

async function copyMessage(index: number, text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    copiedAt.value = index
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => (copiedAt.value = null), 1400)
  } catch {
    copiedAt.value = null
  }
}

function actionsFor(m: SessionMessage): MsgAction[] {
  const index = props.messages.indexOf(m)
  const text = plainTextOf(m)
  const done = copiedAt.value === index
  return [
    {
      icon: done ? 'check' : 'copy',
      title: t(done ? 'infra.bubble.copied' : 'infra.bubble.copy'),
      active: done,
      run: () => void copyMessage(index, text),
    },
  ]
}

onBeforeUnmount(() => {
  if (copiedTimer) clearTimeout(copiedTimer)
})

/** Số khối của tin cuối — `blocks` chỉ có ở biến thể `assistant` của union. */
function tailBlockCount(): number {
  const last = props.messages[props.messages.length - 1]
  return last && last.role === 'assistant' ? last.blocks.length : 0
}

/**
 * Bám đáy khi có nội dung mới. Bong bóng không có thanh cuộn dư: một lượt đang chạy mà
 * người dùng không thấy chữ nào mới là một lượt trông như đã đứng.
 *
 * Theo dõi CẢ số khối của tin cuối, không chỉ số tin: một lượt trả lời dài chỉ là MỘT
 * message mà lớn dần, nên đếm message thôi thì transcript đứng yên suốt lúc đang chảy.
 */
watch(
  () => [props.messages.length, tailBlockCount()],
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
  min-width: 0;
}

/* `.mu` toàn cục kẹp bề rộng ở 74% cho màn phiên rộng; trong khung 360px thì mức đó
   cắt chữ vô cớ, nên ở đây nới ra và chỉ giữ hình dáng bong bóng. */
.ixbt-mu {
  max-width: 88%;
  align-self: flex-end;
  white-space: pre-wrap;
  word-break: break-word;
}

.ixbt-sys {
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}

.ixbt-think,
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

.ixbt-think {
  color: var(--textFaint);
}

.ixbt-q {
  color: var(--amber);
}

/* `--danger`, KHÔNG phải `--red`: token đó không tồn tại trong bảng màu của app, nên
   dòng lỗi trước đây rơi về màu kế thừa và trông y hệt một dòng chữ thường. */
.ixbt-err {
  color: var(--danger);
}

.ixbt-run {
  color: var(--accent);
}

.ixbt-think,
.ixbt-q,
.ixbt-err {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Hàng hành động chỉ hiện khi rê vào tin — cùng luật với màn phiên: một hàng nút luôn
   sáng trên mọi tin là nhiễu trong một khung đã hẹp. */
.ixbt-acts {
  opacity: 0;
  transition: opacity 0.12s;
}

.ixbt-msg:hover .ixbt-acts,
.ixbt-acts:focus-within {
  opacity: 1;
}
</style>
