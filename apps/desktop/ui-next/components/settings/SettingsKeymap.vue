<template>
  <div>
    <SettingsPaneHeader
      :title="t('settings.keymap.heading')"
      :subtitle="t('settings.keymap.sub')"
    />

    <SettingsField v-for="a in KEYMAP_ACTIONS" :key="a.id" :name="t(a.labelKey)">
      <div class="km-ctrl">
        <div class="km-row">
          <template v-if="recording === a.id">
            <span class="km-cap on">{{ t('settings.keymap.recording') }}</span>
            <button class="btn sm" @click="cancelRecord">{{ t('common.cancel') }}</button>
          </template>
          <template v-else>
            <kbd class="km-cap">{{ formatCombo(bindings[a.id]) }}</kbd>
            <button class="btn sm" @click="startRecord(a.id)">
              <Icon name="edit" />
              {{ t('settings.keymap.rebind') }}
            </button>
            <button
              v-if="!isDefault(a.id)"
              class="iconbtn"
              style="width: 28px; height: 28px"
              :title="t('settings.keymap.reset')"
              @click="resetBinding(a.id)"
            >
              <Icon name="refresh" />
            </button>
          </template>
        </div>
        <div v-if="recording === a.id && error" class="km-err">{{ error }}</div>
      </div>
    </SettingsField>

    <div class="km-foot">
      <button class="btn sm" @click="resetAll">
        <Icon name="refresh" />
        {{ t('settings.keymap.resetAll') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Keymap editor — lists the rebindable global shortcuts (useKeymap) and lets the
// user record a new combo per action. Recording captures the next keydown at the
// window CAPTURE phase with stopPropagation, so the combo being recorded never
// triggers the app action itself (or the SettingsModal's Esc-to-close). Bindings
// persist via useKeymap (localStorage); the live global handler reacts immediately.
import { onBeforeUnmount, ref, watch } from 'vue'
import {
  KEYMAP_ACTIONS,
  isModifierKey,
  useKeymap,
  type KeymapActionId,
} from '~/composables/useKeymap'

const { t } = useI18n()
const {
  bindings,
  formatCombo,
  isDefault,
  resetBinding,
  resetAll,
  conflictOf,
  setBinding,
  isValidCombo,
  isReserved,
  comboFromEvent,
} = useKeymap()

const recording = ref<KeymapActionId | null>(null)
const error = ref('')

function startRecord(id: KeymapActionId) {
  error.value = ''
  recording.value = id
}
function cancelRecord() {
  recording.value = null
  error.value = ''
}

function onRecordKey(e: KeyboardEvent) {
  const id = recording.value
  if (!id) return
  // Swallow the event so recording a combo can't fire an app action / close the modal.
  e.preventDefault()
  e.stopPropagation()

  if (e.key === 'Escape') {
    cancelRecord()
    return
  }
  if (isModifierKey(e.key)) return // still waiting for the non-modifier key

  const combo = comboFromEvent(e)
  if (!isValidCombo(combo)) {
    error.value = t('settings.keymap.err.needMod')
    return
  }
  if (isReserved(combo)) {
    error.value = t('settings.keymap.err.reserved')
    return
  }
  const clash = conflictOf(combo, id)
  if (clash) {
    const other = KEYMAP_ACTIONS.find((a) => a.id === clash)
    error.value = t('settings.keymap.err.conflict', { action: other ? t(other.labelKey) : clash })
    return
  }
  setBinding(id, combo)
  cancelRecord()
}

// Bind the capture listener only while recording. Remove-then-add so switching
// directly from one recording action to another never stacks two listeners.
watch(recording, (val) => {
  window.removeEventListener('keydown', onRecordKey, true)
  if (val) window.addEventListener('keydown', onRecordKey, true)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onRecordKey, true))
</script>

<style scoped>
.km-ctrl {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 5px;
}
.km-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.km-cap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 42px;
  height: 26px;
  padding: 0 9px;
  border-radius: var(--r-xs);
  border: 1px solid var(--border);
  background: var(--bgEl);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: 1;
}
.km-cap.on {
  border-color: var(--accent);
  color: var(--accent);
  border-style: dashed;
  animation: km-pulse 1.1s ease-in-out infinite;
}
@keyframes km-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}
.km-err {
  color: var(--danger);
  font-size: var(--fs-sm);
  text-align: right;
  max-width: 320px;
}
.km-foot {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
</style>
