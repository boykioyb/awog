<template>
  <!-- Teleport ra body để thoát stacking context của trang. `.ovl.on` đã nằm trong
       OVERLAYS của useEmbeddedBrowser (trình duyệt nhúng nhường chỗ) và đã có
       `-webkit-app-region: no-drag` (assets/css/app-shell.css). SlackWorkspace chỉ mount
       khi mở ⇒ poll + listener chỉ sống trong lúc modal hiện. -->
  <Teleport to="body">
    <!-- Mở/đóng: nền mờ dần + hộp phóng nhẹ QUANH TÂM (scale, không translate) — hộp căn
         giữa bằng flex của lớp nền nên transform-origin mặc định là tâm hộp. -->
    <Transition
      enter-active-class="transition-opacity duration-150 [&>div]:transition-transform [&>div]:duration-150 motion-reduce:transition-none motion-reduce:[&>div]:transition-none"
      leave-active-class="transition-opacity duration-150 [&>div]:transition-transform [&>div]:duration-150 motion-reduce:transition-none motion-reduce:[&>div]:transition-none"
      enter-from-class="opacity-0 [&>div]:scale-97"
      leave-to-class="opacity-0 [&>div]:scale-97"
    >
      <!-- hook-ok: `.ovl.on` nằm trong OVERLAYS (useEmbeddedBrowser), `.slkovl` bị NESTED_OVERLAYS bên dưới loại trừ.
           z-110: đáy band modal (100–300) — hộp xác nhận, xem trước file, menu… mở TỪ trong modal phải nổi trên nó. -->
      <div
        v-if="isOpen"
        class="ovl on slkovl fixed inset-0 z-110 flex items-center justify-center bg-black/55 p-0 [-webkit-app-region:no-drag]"
        @click.self="close"
      >
        <div
          class="flex h-[88vh] w-[90vw] flex-col overflow-hidden rounded-xl border bg-background shadow-lg"
          role="dialog"
          aria-modal="true"
          :aria-label="t('slack.title')"
        >
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
