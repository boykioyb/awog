<template>
  <!-- Teleport ra body để thoát stacking context của trang. `.ovl.on` đã nằm trong
       OVERLAYS của useEmbeddedBrowser (trình duyệt nhúng nhường chỗ) và đã có
       `-webkit-app-region: no-drag` (assets/css/app-shell.css). SlackWorkspace chỉ mount
       khi mở ⇒ poll + listener chỉ sống trong lúc modal hiện. -->
  <Teleport to="body">
    <Transition name="slkfade">
      <div v-if="isOpen" class="ovl on slkovl" @click.self="close">
        <div class="slkmodal" role="dialog" aria-modal="true" :aria-label="t('slack.title')">
          <SlackWorkspace mode="modal" />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
// Modal Slack threads trong cửa sổ chính (docs/features/slack-threads.md). Mở từ NavRail,
// route `/slack` hay chip phiên qua useSlackModal().open(threadId?); mount một lần ở
// AppGlobalHosts. Nút "Mở cửa sổ riêng" nằm ở đầu SlackWorkspace.
import { onBeforeUnmount, onMounted } from 'vue'
import { useSlackModal } from '~/composables/useSlackModal'

const { t } = useI18n()
const { isOpen, close } = useSlackModal()

// Bề mặt nổi khác đang mở (popover emoji, menu ⋯, hộp xác nhận, xem trước file…) thì Esc
// là của nó — chỉ đóng modal khi Esc không có ai khác nhận.
const NESTED_OVERLAYS = [
  '[data-slack-overlay]',
  '[role="dialog"][data-state="open"]',
  '.ovl.on:not(.slkovl)',
  '.lop-scrim',
  '.tph-ovl',
  '.aselmenu',
].join(', ')

function onKeydown(e: KeyboardEvent): void {
  if (!isOpen.value || e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return
  if (document.querySelector(NESTED_OVERLAYS)) return
  e.preventDefault()
  close()
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
/* Modal lớn căn giữa (`.ovl` gốc ghim lên trên cho hộp nhỏ). z-index ở đáy band modal
   (100–300): hộp xác nhận, xem trước file, menu… mở TỪ trong modal phải nổi trên nó. */
.slkovl {
  align-items: center;
  padding: 0;
  z-index: 110;
}
.slkmodal {
  display: flex;
  flex-direction: column;
  width: 90vw;
  height: 88vh;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--r-panel);
  background: var(--bg);
  box-shadow: var(--shadow-lg);
}
/* Mở/đóng: nền mờ dần + hộp phóng nhẹ QUANH TÂM (scale, không translate) — hộp được
   căn giữa bằng flex của .slkovl nên transform-origin mặc định là tâm hộp. */
.slkfade-enter-active,
.slkfade-leave-active {
  transition: opacity 0.16s ease;
}
.slkfade-enter-active .slkmodal,
.slkfade-leave-active .slkmodal {
  transition: transform 0.16s ease;
}
.slkfade-enter-from,
.slkfade-leave-to {
  opacity: 0;
}
.slkfade-enter-from .slkmodal,
.slkfade-leave-to .slkmodal {
  transform: scale(0.97);
}
@media (prefers-reduced-motion: reduce) {
  .slkfade-enter-active,
  .slkfade-leave-active,
  .slkfade-enter-active .slkmodal,
  .slkfade-leave-active .slkmodal {
    transition: none;
  }
}
</style>
