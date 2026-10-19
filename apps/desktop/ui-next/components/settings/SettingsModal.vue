<template>
  <Teleport to="body">
    <!-- hook-ok: `.ovl.on` nằm trong OVERLAYS của composables/useEmbeddedBrowser.ts (trang
         web nhúng nhường chỗ khi Settings mở). Khung tự dựng chứ không dùng Dialog reka:
         Settings gọi confirm()/hộp nhập text dùng chung — các host đó vẫn là overlay z-100
         ngoài reka, nằm dưới Dialog z-170 và bị focus-trap của Dialog chặn click. -->
    <div
      v-show="open"
      :class="{ 'ovl on': open }"
      class="fixed inset-0 z-100 flex items-center justify-center bg-black/55 pt-0"
      @click.self="closeSettings"
    >
      <div
        role="dialog"
        aria-modal="true"
        :aria-label="t('nav.settings')"
        class="flex h-[82vh] max-h-215 w-240 max-w-[94vw] flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg"
      >
        <div class="flex shrink-0 items-center gap-2.5 px-4 py-3">
          <span class="flex-1 text-lg font-semibold">{{ t('nav.settings') }}</span>
          <Button
            variant="ghost"
            size="iconSm"
            :title="t('common.close')"
            :aria-label="t('common.close')"
            @click="closeSettings"
          >
            <Icon name="x" />
          </Button>
        </div>
        <Separator />
        <div class="flex min-h-0 flex-1 overflow-hidden">
          <aside class="w-46 shrink-0 overflow-y-auto border-r bg-sidebar px-2 py-2.5">
            <SettingsNav :groups="SETTINGS_GROUPS" :active="section" @select="section = $event" />
          </aside>
          <div class="min-w-0 flex-1 overflow-y-auto">
            <SettingsPane :active="section" />
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Settings dạng modal: header + nav trái (SettingsNav) + nội dung (SettingsPane).
// open/section sống trong useSettingsModal để NavRail điều khiển. Tài khoản nạp lại
// từ sidecar mỗi lần mở.
import { watch } from 'vue'
import { SETTINGS_GROUPS } from '~/components/settings/sections'
import { useSettingsStore } from '~/stores/settings'

const { t } = useI18n()
const { open, section, focus, closeSettings } = useSettingsModal()
const settings = useSettingsStore()

watch(open, (isOpen) => {
  if (isOpen) settings.hydrateFromSidecar().catch(() => {})
})

// Mở từ ⌘K tới MỘT dòng cài đặt: tìm dòng theo tên hiển thị (`[data-set-label]` — tên
// dòng của SettingsField và tiêu đề nhóm SettingsGroupLabel), cuộn tới giữa và nháy sáng. Mục có thể render trễ (dữ liệu
// nạp từ sidecar) — thử lại vài khung hình trước khi bỏ cuộc.
watch(
  () => [open.value, section.value, focus.value] as const,
  async ([isOpen, , label]) => {
    if (!isOpen || !label) return
    const want = label.trim().toLowerCase()
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => requestAnimationFrame(r))
      const hit = [
        ...document.querySelectorAll<HTMLElement>('[data-settings-pane] [data-set-label]'),
      ].find((el) => (el.textContent ?? '').trim().toLowerCase().startsWith(want))
      if (!hit) continue
      const row = hit.closest<HTMLElement>('[data-set-row]') ?? hit
      row.scrollIntoView({ block: 'center', behavior: 'smooth' })
      row.classList.add('set-flash')
      setTimeout(() => row.classList.remove('set-flash'), 1800)
      break
    }
    focus.value = null
  },
)

// Debounced "saved" toast: any persisted setting change bumps settings.savedTick.
// Show one toast after the change settles (so typing a textarea gives a single
// toast, not one per keystroke), and only while the modal is open — the edit came
// from the Settings UI, not a background persist (e.g. a workspace-dock drag).
let savedToastTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => settings.savedTick,
  () => {
    if (!open.value) return
    if (savedToastTimer) clearTimeout(savedToastTimer)
    savedToastTimer = setTimeout(
      () => useToast().add({ title: t('settings.saved'), color: 'success' }),
      500,
    )
  },
)

useEscToClose(() => open.value, closeSettings, { preventDefault: false })
</script>

<style>
/* style-ok: @keyframes nháy dòng cài đặt ⌘K vừa nhắm tới (không có trong tw-animate-css).
   Không scoped vì class `set-flash` do JS gắn lên phần tử của component con. */
[data-settings-pane] .set-flash {
  animation: set-flash 1.8s ease-out;
  border-radius: var(--radius-md);
}
@keyframes set-flash {
  0%,
  35% {
    background: var(--color-selected);
    box-shadow: 0 0 0 1px var(--color-selected-border);
  }
  100% {
    background: transparent;
    box-shadow: none;
  }
}
</style>
