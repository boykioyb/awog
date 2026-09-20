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

    <!-- Kênh của TIẾN TRÌNH MAIN: sống độc lập với cửa sổ renderer, nên chỉ hiện
         khi có bridge Electron (browser dev không có gì để bật). -->
    <SettingsField
      v-if="hasMainNotify"
      :name="t('settingsNotify.whenClosed.name')"
      :desc="whenClosedDesc"
    >
      <SettingsTog v-model="notifyWhenClosed" />
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

    <SettingsField
      :name="t('settings.notifications.cicd.name')"
      :desc="t('settings.notifications.cicd.desc')"
    >
      <SettingsTog v-model="cicdEnabled" />
    </SettingsField>

    <SettingsField
      :name="t('settings.notifications.resources.name')"
      :desc="t('settings.notifications.resources.desc')"
    >
      <SettingsTog v-model="resourcesEnabled" />
    </SettingsField>

    <!-- Ngưỡng chỉ hiện khi nguồn đang bật: tắt rồi mà vẫn bày bốn ô số là mời
         người dùng chỉnh một thứ không chạy. -->
    <template v-if="resourcesEnabled">
      <SettingsField
        :name="t('settings.notifications.resources.orphans.name')"
        :desc="t('settings.notifications.resources.orphans.desc')"
      >
        <SettingsTog v-model="resOrphans" />
      </SettingsField>

      <SettingsField
        :name="t('settings.notifications.resources.cpu.name')"
        :desc="t('settings.notifications.resources.cpu.desc')"
      >
        <SettingsTog v-model="resHighCpu" />
      </SettingsField>

      <SettingsField
        v-if="resHighCpu"
        :name="t('settings.notifications.resources.cpuThreshold.name')"
        :desc="t('settings.notifications.resources.cpuThreshold.desc')"
      >
        <SettingsNumber v-model="resCpuPercent" :min="10" :max="1000" :step="10" />
      </SettingsField>

      <SettingsField
        v-if="resHighCpu"
        :name="t('settings.notifications.resources.cpuMinutes.name')"
        :desc="t('settings.notifications.resources.cpuMinutes.desc')"
      >
        <SettingsNumber v-model="resCpuMinutes" :min="1" :max="120" :step="1" />
      </SettingsField>

      <SettingsField
        :name="t('settings.notifications.resources.memory.name')"
        :desc="t('settings.notifications.resources.memory.desc')"
      >
        <SettingsTog v-model="resHighMemory" />
      </SettingsField>

      <SettingsField
        v-if="resHighMemory"
        :name="t('settings.notifications.resources.memoryThreshold.name')"
        :desc="t('settings.notifications.resources.memoryThreshold.desc')"
      >
        <SettingsNumber v-model="resMemoryGb" :min="1" :max="128" :step="1" />
      </SettingsField>
    </template>
  </div>
</template>

<script setup lang="ts">
// Notifications panel — the single home for HOW notifications reach the user
// (channel + toast placement) plus the on/off switch of each source. What each
// source actually watches stays in its own panel: GitHub polling (account,
// interval, projects, connection check) lives in Settings → Git.
import { computed, onMounted, ref } from 'vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
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
const resources = computed(() => store.notifications.resources)

const resourcesEnabled = computed<boolean>({
  get: () => resources.value.enabled,
  set: (v) => {
    resources.value.enabled = v
  },
})
const resOrphans = computed<boolean>({
  get: () => resources.value.orphans,
  set: (v) => {
    resources.value.orphans = v
  },
})
const resHighCpu = computed<boolean>({
  get: () => resources.value.highCpu,
  set: (v) => {
    resources.value.highCpu = v
  },
})
const resHighMemory = computed<boolean>({
  get: () => resources.value.highMemory,
  set: (v) => {
    resources.value.highMemory = v
  },
})
const resCpuPercent = computed<number>({
  get: () => resources.value.cpuPercent,
  set: (v) => {
    resources.value.cpuPercent = v
  },
})
const resCpuMinutes = computed<number>({
  get: () => resources.value.cpuMinutes,
  set: (v) => {
    resources.value.cpuMinutes = v
  },
})
const resMemoryGb = computed<number>({
  get: () => resources.value.memoryGb,
  set: (v) => {
    resources.value.memoryGb = v
  },
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
  useToast().add({
    title: t('settings.notifications.position.preview'),
    color: 'info',
    onClick: () => {},
  })
}
const toastPosition = computed<string>({
  get: () => store.notifications.toastPosition,
  set: (value) => {
    store.notifications.toastPosition = value as ToastPosition
    previewToast()
  },
})

// ── Thông báo phát từ tiến trình main (ADR 0084) ────────────────────────────
// Công tắc này KHÔNG nằm trong store settings: renderer chết theo cửa sổ, nên nó
// không thể tự báo lúc cửa sổ đã đóng — main giữ pref của riêng nó và trả lời qua
// bridge. Kiểu khai tại chỗ vì `types/awog-bridge.d.ts` do phần khác giữ (việc gộp
// vào đó là dọn dẹp sau, không đổi hành vi).
type MainNotifyPrefs = { whenClosed: boolean }
type MainNotifyBridge = {
  getNotifyPrefs?: () => Promise<MainNotifyPrefs>
  setNotifyPrefs?: (prefs: MainNotifyPrefs) => Promise<MainNotifyPrefs>
}
const notifyBridge = (typeof window !== 'undefined' ? window.awog : undefined) as
  | MainNotifyBridge
  | undefined
const hasMainNotify = !!notifyBridge?.getNotifyPrefs
const whenClosed = ref(true)
onMounted(async () => {
  if (!notifyBridge?.getNotifyPrefs) return
  try {
    whenClosed.value = (await notifyBridge.getNotifyPrefs()).whenClosed
  } catch {
    // Bridge cũ / main chưa đăng ký handler → giữ mặc định, không kêu.
  }
})
const whenClosedDesc = computed(
  () => `${t('settingsNotify.whenClosed.desc')} ${t('settingsNotify.whenClosed.reach')}`,
)
const notifyWhenClosed = computed<boolean>({
  get: () => whenClosed.value,
  set: (value) => {
    whenClosed.value = value
    void notifyBridge?.setNotifyPrefs?.({ whenClosed: value })
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
// Pipeline hỏng / chờ duyệt. Tắt là vòng poll dừng hẳn (useCicdNotify tự dọn
// danh sách) — không phải chỉ ẩn toast.
const cicdEnabled = computed<boolean>({
  get: () => store.notifications.cicdEvents,
  set: (value) => (store.notifications.cicdEvents = value),
})
</script>

<style scoped></style>
