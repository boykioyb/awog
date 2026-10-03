<template>
  <Teleport to="body">
    <!-- Scrim chỉ là wrapper hình học — pointer-events:none để click XUYÊN QUA
         tới link/modal bên dưới. Vì sao: một cú bấm lên link khi card đang mở
         phải tới được interceptor của useLinkOpen (nó re-anchor card theo link
         mới), chứ không được "đóng như click-ra-ngoài" — nếu scrim hứng click,
         bấm link lần 2 sẽ đóng card (lỗi thật). Dismiss ngoài-card đã chuyển
         sang listener cấp document (onDocDismiss) bên dưới. -->
    <div v-if="pending" class="lop-scrim">
      <div class="lop" :style="style" role="dialog" aria-modal="true" @click.stop>
        <div class="lop-url" :title="pending.url">{{ pending.url }}</div>
        <button class="lop-row" @click="pick('app')">
          <Icon name="globe" style="width: var(--icon-sm); height: var(--icon-sm)" />
          <span>{{ t('link.openInApp') }}</span>
        </button>
        <button class="lop-row" @click="pick('external')">
          <Icon name="external" style="width: var(--icon-sm); height: var(--icon-sm)" />
          <span>{{ t('link.openExternal') }}</span>
        </button>
        <label class="lop-remember">
          <input v-model="remember" type="checkbox" />
          <span>{{ t('link.remember') }}</span>
        </label>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// "Open where?" chooser for a clicked web link (ADR 0086 phần C). Mounted once per
// renderer from AppGlobalHosts, which is also where the delegated click listener is
// installed — a surface that renders links but no hosts (the tray popover) keeps
// the old behaviour, straight to the OS browser via main's will-navigate backstop.
//
// Anchored at the click, not centered: this is a disambiguation, not an
// announcement, and it should not make the user's eyes travel.
import { useLinkOpen } from '~/composables/useLinkOpen'

const { t } = useI18n()
const { pending, resolvePending, cancelPending, installInterceptor } = useLinkOpen()

const remember = ref(false)

// Keep the card on screen when the link sits near the right/bottom edge.
const CARD_W = 268
const CARD_H = 148
const style = computed(() => {
  const p = pending.value
  if (!p) return {}
  const maxX = (typeof window !== 'undefined' ? window.innerWidth : 1280) - CARD_W - 12
  const maxY = (typeof window !== 'undefined' ? window.innerHeight : 800) - CARD_H - 12
  return {
    left: `${Math.max(12, Math.min(p.x, maxX))}px`,
    top: `${Math.max(12, Math.min(p.y, maxY))}px`,
  }
})

const pick = (kind: 'app' | 'external'): void => {
  void resolvePending(kind, remember.value)
  remember.value = false
}

const onKey = (e: KeyboardEvent): void => {
  if (e.key === 'Escape' && pending.value) cancelPending()
}

// Dismiss "bấm ra ngoài card" ở cấp document (scrim đã pointer-events:none nên
// không còn tự hứng click). Chạy ở bubble phase: cú bấm lên một <a> đã bị
// interceptor capture của useLinkOpen stopPropagation — nghĩa là "bấm link lần
// 2" re-anchor card chứ KHÔNG đóng, còn bấm chỗ trống mới đóng. Contextmenu cũ
// bấm lên scrim chỉ preventDefault — giờ xuyên qua, coi như một dismiss để không
// mở context menu dưới một câu hỏi đang chờ.
const onDocDismiss = (e: MouseEvent): void => {
  if (!pending.value) return
  if ((e.target as HTMLElement | null)?.closest?.('.lop')) return
  cancelPending()
}

let uninstall: (() => void) | null = null
onMounted(() => {
  uninstall = installInterceptor()
  window.addEventListener('keydown', onKey)
  document.addEventListener('click', onDocDismiss)
  document.addEventListener('contextmenu', onDocDismiss)
})
onUnmounted(() => {
  uninstall?.()
  window.removeEventListener('keydown', onKey)
  document.removeEventListener('click', onDocDismiss)
  document.removeEventListener('contextmenu', onDocDismiss)
})
</script>

<style scoped>
/* Scrim vô hình + không hứng click: chỉ là lớp ĐỊNH VỊ cho card. Dismiss đi qua
   listener document. z-index phải đứng ĐẦU thang overlay (ftovl 470 < pvovl 480
   < select 490 < lbox 540): câu hỏi "mở link ở đâu" được hỏi TỪ mọi mặt, kể cả
   bên trong PreviewModal — dưới nó thì user bấm link mà không thấy gì hỏi. */
.lop-scrim {
  position: fixed;
  inset: 0;
  z-index: 560;
  pointer-events: none;
}
.lop {
  position: fixed;
  pointer-events: auto;
  width: 268px;
  background: var(--bgEl);
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-btn);
  box-shadow: var(--shadow-md);
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.lop-url {
  padding: 5px 8px 7px;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  /* mono-ok: a URL is copy-pasteable text the user may compare character by character */
  font-family: var(--code);
}
.lop-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: var(--r-sm);
  background: transparent;
  border: none;
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  cursor: pointer;
  text-align: left;
}
.lop-row:hover {
  background: var(--bgHover);
}
.lop-remember {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 8px 4px;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  cursor: pointer;
  border-top: 1px solid var(--border);
  margin-top: 3px;
}
</style>
