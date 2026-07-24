<template>
  <Teleport to="body">
    <div class="ovl" :class="{ on: open }" @click.self="closeSettings">
      <div class="setmodal setmodal-lg">
        <div class="setmodalhd">
          <span>{{ t('nav.settings') }}</span>
          <button
            class="iconbtn"
            style="width: 28px; height: 28px"
            :title="t('common.close')"
            @click="closeSettings"
          >
            <Icon name="x" />
          </button>
        </div>
        <div class="settwo">
          <SettingsNav :sections="SETTINGS_SECTIONS" :active="section" @select="section = $event" />
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
import { SETTINGS_SECTIONS } from '~/components/settings/sections'
import { useSettingsStore } from '~/stores/settings'

const { t } = useI18n()
const { open, section, closeSettings } = useSettingsModal()
const settings = useSettingsStore()

watch(open, (isOpen) => {
  if (isOpen) settings.hydrateFromSidecar().catch(() => {})
})

useEscToClose(() => open.value, closeSettings, { preventDefault: false })
</script>

<style scoped>
/* Settings is a 2-pane modal (nav + content) — wider + taller than the default
   .setmodal (640px) so the content pane and Models forms have room. Scoped, so
   the shared What's New modal (plain .setmodal) keeps its narrower width. */
.setmodal-lg {
  width: 960px;
  max-width: 94vw;
  height: 82vh;
  max-height: 860px;
}
</style>
