<!--
  SettingsModal.vue — Settings overlaid as a modal (formerly the `/settings`
  route). Two-pane layout: left section nav + right scrollable detail, reusing
  the same Settings*Section components. Open/section state lives in
  `useSettingsModal` so HeaderTabBar can trigger it. Overlay/transition/escape/
  click-outside mirror BaseModal; built standalone so the body can host a
  fixed-height two-pane split instead of a single scroll region.
-->
<template>
  <Teleport to="body">
    <Transition name="settings-modal">
      <div
        v-if="open"
        class="fixed inset-0 backdrop-blur-sm flex items-center justify-center z-50 p-3"
        :style="{ background: t.overlay }"
      >
        <div
          ref="cardRef"
          class="w-full max-w-[920px] h-[85vh] rounded-lg overflow-hidden flex flex-col"
          :style="{
            background: overlay.background,
            border: `1px solid ${overlay.borderColor}`,
            backdropFilter: overlay.backdropFilter,
            boxShadow: overlay.boxShadow,
          }"
        >
          <!-- Header -->
          <div
            class="px-4 py-3 flex items-center gap-2 flex-shrink-0"
            :style="{ borderBottom: `1px solid ${t.border}` }"
          >
            <div class="text-[1em] font-medium" :style="{ color: t.text }">
              {{ tr('settings.title') }}
            </div>
            <button
              class="ml-auto"
              :style="{ color: t.textDim }"
              :aria-label="tr('settings.close')"
              @click="closeSettings"
            >
              <X :size="15" />
            </button>
          </div>

          <!-- Body: section nav (left) + detail (right) -->
          <div class="flex-1 flex min-h-0">
            <nav
              class="w-[13rem] flex-shrink-0 overflow-y-auto py-3 px-2 space-y-0.5"
              :style="{ borderRight: `1px solid ${t.border}`, background: parts.bg }"
            >
              <button
                v-for="s in sections"
                :key="s.id"
                class="w-full flex items-center gap-2.5 px-2 py-1.5 rounded text-[1em] transition"
                :style="{
                  background: pill(section === s.id).background,
                  color: section === s.id ? t.text : t.textDim,
                }"
                @click="section = s.id"
              >
                <component :is="s.icon" :size="13" />
                {{ tr(s.labelKey) }}
              </button>
            </nav>

            <div class="flex-1 overflow-y-auto p-4 md:p-6 min-w-0" :style="{ background: t.bg }">
              <SettingsAppearanceSection v-if="section === 'appearance'" />
              <SettingsWorkspaceSection v-else-if="section === 'workspace'" />
              <SettingsDefaultsSection v-else-if="section === 'defaults'" />
              <SettingsModelsSection v-else-if="section === 'models'" />
              <SettingsAboutSection v-else-if="section === 'about'" />
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { FolderGit2, Info, Key, Palette, Sliders, X } from 'lucide-vue-next'
import type { Component } from 'vue'
import type { SettingsSectionId } from '~/composables/useSettingsModal'

const { t } = useTheme()
const { overlay, parts, pill } = useGlass()
const { t: tr } = useI18n()
const { open, section, closeSettings } = useSettingsModal()
const settings = useSettingsStore()

const cardRef = useTemplateRef<HTMLElement>('cardRef')

const sections: { id: SettingsSectionId; labelKey: string; icon: Component }[] = [
  { id: 'appearance', labelKey: 'settings.section.appearance', icon: Palette },
  { id: 'workspace', labelKey: 'settings.section.workspace', icon: FolderGit2 },
  { id: 'defaults', labelKey: 'settings.section.defaults', icon: Sliders },
  { id: 'models', labelKey: 'settings.section.models', icon: Key },
  { id: 'about', labelKey: 'settings.section.about', icon: Info },
]

// Pull accounts truth from sidecar when opening; safe even when sidecar is
// unavailable. App-level hydration covers the cold path — this refreshes on
// each open so the Models section reflects external credential changes.
watch(open, (isOpen) => {
  if (isOpen) settings.hydrateFromSidecar().catch(() => {})
})

const escapeEnabled = computed(() => open.value)
useEscape(closeSettings, { enabled: escapeEnabled })
useClickOutside(cardRef, () => {
  if (open.value) closeSettings()
})

// Body scroll lock while open — restore on close/unmount so overflow never sticks.
let previousOverflow: string | null = null
watch(
  open,
  (next) => {
    if (typeof document === 'undefined') return
    if (next) {
      previousOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = previousOverflow ?? ''
      previousOverflow = null
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  if (typeof document !== 'undefined' && previousOverflow !== null) {
    document.body.style.overflow = previousOverflow
    previousOverflow = null
  }
})
</script>

<style scoped>
.settings-modal-enter-active,
.settings-modal-leave-active {
  transition: opacity 150ms ease;
}
.settings-modal-enter-from,
.settings-modal-leave-to {
  opacity: 0;
}
</style>
