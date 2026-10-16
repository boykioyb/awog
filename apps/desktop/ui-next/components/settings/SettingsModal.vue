<template>
  <Teleport to="body">
    <div class="ovl" :class="{ on: open }" @click.self="closeSettings">
      <div class="setmodal setmodal-lg">
        <div class="setmodalhd">
          <span>{{ t('nav.settings') }}</span>
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
        <div class="settwo">
          <SettingsNav :groups="SETTINGS_GROUPS" :active="section" @select="section = $event" />
          <SettingsPane :active="section" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Settings as a modal overlay — ports the prototype `#setovl > .setmodal`
// (.setmodalhd + .settwo). The nav + pane are the same components the page used;
// open/section state lives in useSettingsModal so the NavRail trigger drives it.
// Accounts hydrate from the sidecar each time the modal opens.
import { watch } from 'vue'
import { SETTINGS_GROUPS } from '~/components/settings/sections'
import { useSettingsStore } from '~/stores/settings'

const { t } = useI18n()
const { open, section, focus, closeSettings } = useSettingsModal()
const settings = useSettingsStore()

watch(open, (isOpen) => {
  if (isOpen) settings.hydrateFromSidecar().catch(() => {})
})

// Mở từ ⌘K tới MỘT dòng cài đặt: tìm dòng theo tên hiển thị (`.fn` của SettingsField,
// tiêu đề nhóm `.sech`), cuộn tới giữa và nháy sáng. Mục có thể render trễ (dữ liệu
// nạp từ sidecar) — thử lại vài khung hình trước khi bỏ cuộc.
watch(
  () => [open.value, section.value, focus.value] as const,
  async ([isOpen, , label]) => {
    if (!isOpen || !label) return
    const want = label.trim().toLowerCase()
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => requestAnimationFrame(r))
      const hit = [...document.querySelectorAll<HTMLElement>('.setpane .fn, .setpane .sech')].find(
        (el) => (el.textContent ?? '').trim().toLowerCase().startsWith(want),
      )
      if (!hit) continue
      const row = hit.closest<HTMLElement>('.field') ?? hit
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

<style scoped>
/* Settings is a 2-pane modal (nav + content) — wider + taller than the default
   .setmodal (640px) so the content pane and Models forms have room. Scoped, so
   the shared What's New modal (plain .setmodal) keeps its narrower width. */
/* Dòng cài đặt vừa được ⌘K nhắm tới: nháy nền accent rồi tắt dần. :deep vì dòng
   nằm trong component con (SettingsField). */
.setmodal-lg :deep(.set-flash) {
  animation: set-flash 1.8s ease-out;
  border-radius: var(--r-sm);
}
@keyframes set-flash {
  0%,
  35% {
    background: var(--accentDim);
    box-shadow: 0 0 0 1px var(--accentBorder);
  }
  100% {
    background: transparent;
    box-shadow: none;
  }
}
.setmodal-lg {
  width: 960px;
  max-width: 94vw;
  height: 82vh;
  max-height: 860px;
}
</style>
