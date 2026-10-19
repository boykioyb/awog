<template>
  <div>
    <SettingsPaneHeader
      :title="t('settings.keymap.heading')"
      :subtitle="t('settings.keymap.sub')"
    />

    <template v-for="g in KEYMAP_GROUPS" :key="g">
      <div class="mt-4 mb-1 text-sm text-dim first:mt-1">
        {{ t(`settingsKeymap.group.${g}`) }}
      </div>
      <SettingsField v-for="a in actionsOf(g)" :key="a.id" :name="t(a.labelKey)">
        <div class="flex flex-col items-end gap-1.5">
          <div class="flex items-center gap-2">
            <template v-if="recording === a.id">
              <Kbd
                class="h-6.5 min-w-10 animate-pulse border border-dashed border-primary bg-card px-2 text-sm text-primary"
              >
                {{ t('settings.keymap.recording') }}
              </Kbd>
              <Button variant="outline" size="sm" @click="cancelRecord">
                {{ t('common.cancel') }}
              </Button>
            </template>
            <template v-else>
              <Kbd class="h-6.5 min-w-10 border bg-card px-2 text-sm text-foreground">
                {{ formatCombo(bindings[a.id]) }}
              </Kbd>
              <Button variant="outline" size="sm" @click="startRecord(a.id)">
                <Icon name="edit" />
                {{ t('settings.keymap.rebind') }}
              </Button>
              <Button
                v-if="!isDefault(a.id)"
                :title="t('settings.keymap.reset')"
                :aria-label="t('settings.keymap.reset')"
                variant="outline"
                size="iconSm"
                @click="resetBinding(a.id)"
              >
                <Icon name="refresh" />
              </Button>
            </template>
          </div>
          <div
            v-if="recording === a.id && error"
            class="max-w-80 text-right text-sm text-destructive"
          >
            {{ error }}
          </div>
        </div>
      </SettingsField>
    </template>

    <Separator class="mt-3.5" />
    <div class="flex justify-end pt-3">
      <Button variant="outline" size="sm" @click="resetAll">
        <Icon name="refresh" />
        {{ t('settings.keymap.resetAll') }}
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Keymap editor — lists the rebindable global shortcuts (useKeymap) and lets the
// user record a new combo per action. Recording captures the next keydown at the
// window CAPTURE phase with stopPropagation, so the combo being recorded never
// triggers the app action itself (or the SettingsModal's Esc-to-close). Bindings
// persist via useKeymap into the settings store (~/.awog/settings.json, issue
// #43); the live global handler reacts immediately.
import { onBeforeUnmount, ref, watch } from 'vue'
import {
  KEYMAP_ACTIONS,
  KEYMAP_GROUPS,
  isModifierKey,
  useKeymap,
  type KeymapActionId,
  type KeymapGroup,
} from '~/composables/useKeymap'

const { t } = useI18n()
const actionsOf = (g: KeymapGroup) => KEYMAP_ACTIONS.filter((a) => a.group === g)
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
