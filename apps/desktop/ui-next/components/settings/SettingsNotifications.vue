<template>
  <div>
    <SettingsPaneHeader :title="t('settings.notifications.heading')" />

    <!-- Delivery channel, shared by every notification source. Picking a mode that
         needs the OS asks for permission and fires a sample right away — a denied
         permission is otherwise indistinguishable from "nothing happened yet". -->
    <SettingsField :name="t('settings.notifications.delivery.name')" :desc="deliveryDesc">
      <SettingsSeg v-model="delivery" :options="deliveryOptions" />
    </SettingsField>

    <SettingsField
      v-if="delivery !== 'native'"
      :name="t('settings.notifications.position.name')"
      :desc="t('settings.notifications.position.desc')"
    >
      <div style="display: flex; align-items: center; gap: 8px">
        <AppSelect v-model="toastPosition" :options="positionOptions" width="170px" />
        <button class="btn sm" type="button" @click="previewToast">
          {{ t('settings.notifications.position.try') }}
        </button>
      </div>
    </SettingsField>

    <div class="sech">{{ t('settings.notifications.sources.heading') }}</div>

    <SettingsField
      :name="t('settings.notifications.sessionEvents.name')"
      :desc="t('settings.notifications.sessionEvents.desc')"
    >
      <SettingsTog v-model="sessionEvents" />
    </SettingsField>

    <SettingsField
      :name="t('settings.notifications.github.name')"
      :desc="t('settings.notifications.github.desc')"
    >
      <SettingsTog v-model="githubEnabled" />
    </SettingsField>
  </div>
</template>

<script setup lang="ts">
// Notifications panel — the single home for HOW notifications reach the user
// (channel + toast placement) plus the on/off switch of each source. What each
// source actually watches stays in its own panel: GitHub polling (account,
// interval, projects, connection check) lives in Settings → Git.
import { computed, ref } from 'vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import { pushActionToast } from '~/composables/useActionToasts'
import { previewNativeNotification, type GhNativeProbe } from '~/composables/useGhNotifications'
import { useSettingsStore } from '~/stores/settings'
import type { NotifyDelivery, ToastPosition } from '~/stores/settings'

const { t } = useI18n()
const store = useSettingsStore()

const deliveryOptions = computed(() => [
  { label: t('settings.notifications.delivery.toast'), value: 'toast' },
  { label: t('settings.notifications.delivery.native'), value: 'native' },
  { label: t('settings.notifications.delivery.both'), value: 'both' },
])
// Probe result of the last OS-mode pick — reported in the field description.
const nativeProbe = ref<GhNativeProbe | null>(null)
const deliveryDesc = computed<string>(() => {
  if (nativeProbe.value === 'denied') return t('settings.notifications.delivery.denied')
  if (nativeProbe.value === 'unsupported') return t('settings.notifications.delivery.unsupported')
  if (nativeProbe.value === 'ok') return t('settings.notifications.delivery.granted')
  return t('settings.notifications.delivery.desc')
})
const delivery = computed<string>({
  get: () => store.notifications.delivery,
  set: (value) => {
    const next = value as NotifyDelivery
    store.notifications.delivery = next
    nativeProbe.value = null
    if (next !== 'toast') void previewNativeNotification().then((r) => (nativeProbe.value = r))
  },
})

const POSITIONS: ToastPosition[] = [
  'top-left',
  'top-center',
  'top-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
]
const positionOptions = computed<AppSelectOption[]>(() =>
  POSITIONS.map((value) => ({ value, label: t(`settings.notifications.position.${value}`) })),
)
// The sample carries an action so the clickable variant (accent hover + chevron)
// is what the user sees — the shape most real toasts take.
function previewToast(): void {
  pushActionToast(t('settings.notifications.position.preview'), 'info', { action: () => {} })
}
const toastPosition = computed<string>({
  get: () => store.notifications.toastPosition,
  set: (value) => {
    store.notifications.toastPosition = value as ToastPosition
    previewToast()
  },
})

const sessionEvents = computed<boolean>({
  get: () => store.notifications.sessionEvents,
  set: (value) => (store.notifications.sessionEvents = value),
})
const githubEnabled = computed<boolean>({
  get: () => store.githubNotify.enabled,
  set: (value) => (store.githubNotify.enabled = value),
})
</script>
