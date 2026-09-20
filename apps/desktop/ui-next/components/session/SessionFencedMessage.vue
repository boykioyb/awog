<template>
  <div class="fmsg">
    <div class="fmh">
      <Icon :name="icon" class="fmi" />
      <span class="fmsrc" :title="label">{{ label }}</span>
      <span v-if="msg.injection" class="fmwarn" :title="t('sessions.fenced.injectionHint')">
        <Icon name="alert" class="fmwi" />
        {{ t('sessions.fenced.injection') }}
      </span>
    </div>
    <div class="fmb"><SessionLinkedText :text="msg.body" /></div>
  </div>
</template>

<script setup lang="ts">
// Một tin đến từ NGOÀI phiên (phiên khác gửi, người dùng chuyển tiếp, hoặc PR đang
// theo dõi) hiện thành một thẻ có nhãn nguồn, thay vì đổ nguyên khối hàng rào ra
// transcript (xem utils/fenced-message.ts).
//
// Lời dẫn trong khối là chỉ dẫn cho MODEL — người đọc không dùng được gì từ nó, và nó
// dài gấp mấy lần nội dung thật. Thứ DUY NHẤT trong lời dẫn mà người dùng cần biết là
// cảnh báo "thân tin có thứ giả dạng thẻ hàng rào" (một cú thử injection), nên đúng nó
// được nâng lên thành huy hiệu.
import type { FencedMessage } from '~/utils/fenced-message'

const props = defineProps<{ msg: FencedMessage }>()

const { t } = useI18n()

const icon = computed(() => {
  if (props.msg.kind === 'pr') return 'git'
  if (props.msg.kind === 'user-forward') return 'forward'
  return 'message'
})

// Nguồn đọc được thì nêu tên; không đọc được (lời dẫn đổi câu chữ ở một bản sidecar
// khác) thì vẫn phải có nhãn — một thẻ không tên còn khó hiểu hơn khối thô.
const label = computed(() => {
  const src = props.msg.source
  if (props.msg.kind === 'pr') return src ? `GitHub · ${src}` : t('sessions.fenced.fromPr')
  if (props.msg.kind === 'user-forward') return t('sessions.fenced.fromUser')
  return src ? t('sessions.fenced.fromSession', { title: src }) : t('sessions.fenced.fromUnknown')
})
</script>

<style scoped>
/* KHÔNG nền, KHÔNG viền, KHÔNG bo góc: thẻ này nằm TRONG bong bóng user (`.mu`, đã có
   sẵn nền + viền + bo góc của nó), nên thêm một lớp nữa là hai khung lồng nhau — user
   bác đúng ở chỗ đó. Cùng quy ước với card lồng trong panel infra: khối bọc giữ skin,
   card con khử khung. Dòng "Tin từ phiên «X»" ở trên đã đủ nói đây không phải chữ
   người dùng gõ; nó mới là thứ mang thông tin, cái khung thì không. */
.fmsg {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
/* Nhiều tin giao trong CÙNG một lượt: ngăn bằng một vạch mảnh + khoảng thở, vẫn không
   phải một cái khung. */
.fmsg + .fmsg {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
.fmh {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.fmi {
  width: var(--icon-xs);
  height: var(--icon-xs);
  flex: 0 0 auto;
}
.fmsrc {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fmwarn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  margin-left: auto;
  padding: 1px 6px;
  border-radius: var(--r-pill);
  background: var(--dangerBg);
  color: var(--danger);
}
.fmwi {
  width: var(--icon-xs);
  height: var(--icon-xs);
}
.fmb {
  color: var(--text);
  font-size: var(--fs-md);
  line-height: var(--lh-prose);
}
</style>
