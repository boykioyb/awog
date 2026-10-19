<template>
  <div>
    <SettingsPaneHeader
      :title="t('settings.devices.title')"
      :subtitle="t('settings.devices.subtitle')"
    />

    <!-- Master switch — nothing listens on the network until this is on. -->
    <SettingsField
      :name="t('settings.devices.enable.name')"
      :desc="t('settings.devices.enable.desc')"
    >
      <SettingsTog v-model="remoteEnabled" />
    </SettingsField>

    <!-- Mesh status + pair CTA -->
    <div class="flex items-center gap-2.5 pt-1 pb-3">
      <Badge
        :variant="isLive ? 'success' : 'outline'"
        class="rounded-md px-2.5 py-1 text-sm"
        :class="{ 'bg-accent text-dim': !isLive }"
      >
        <span class="size-2 shrink-0 rounded-full" :class="isLive ? 'bg-success' : 'bg-faint'" />
        {{ statusLabel }}
      </Badge>
      <!-- mono-ok: IP mesh -->
      <code v-if="enabled && connected && host" class="font-mono text-sm text-dim">{{ host }}</code>
      <span class="flex-1" />
      <Button
        :disabled="!enabled || !connected || pairingBusy"
        :title="t('settings.devices.pairNew')"
        variant="default"
        size="sm"
        @click="createPairing"
      >
        <Icon name="plus" class="size-3.5" />
        {{ t('settings.devices.pairNew') }}
      </Button>
    </div>

    <!-- Off banner — informational, not a problem to fix (neutral, không màu cảnh báo). -->
    <Alert v-if="!enabled" class="mb-3.5 bg-muted">
      <Icon name="alert" class="text-faint" />
      <AlertTitle class="line-clamp-none text-base font-semibold text-foreground">
        {{ t('settings.devices.offTitle') }}
      </AlertTitle>
      <AlertDescription class="text-base">{{ t('settings.devices.offHint') }}</AlertDescription>
    </Alert>

    <!-- Disconnected banner -->
    <Alert v-else-if="!connected" class="mb-3.5 border-warning/40 bg-warning/10">
      <Icon name="alert" class="text-warning" />
      <AlertTitle class="line-clamp-none text-base font-semibold text-foreground">
        {{ t('settings.devices.meshDisconnected') }}
      </AlertTitle>
      <AlertDescription class="text-base">
        {{ t('settings.devices.installHint') }}
      </AlertDescription>
    </Alert>

    <!-- NetBird setup guide: expanded while disconnected, collapsible for reference once connected. -->
    <Collapsible v-model:open="guideOpen" class="mb-3.5 rounded-lg border bg-muted px-3.5 py-2.5">
      <CollapsibleTrigger
        class="flex w-full cursor-pointer items-center gap-1.5 text-left text-base font-semibold text-foreground"
      >
        <Icon
          name="chev"
          class="size-3 shrink-0 transition-transform"
          :class="{ 'rotate-90': guideOpen }"
        />
        {{ t('settings.devices.guide.title') }}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol class="mt-2.5 mb-0 flex list-decimal flex-col gap-2 pl-5">
          <li class="text-base text-muted-foreground">
            {{ t('settings.devices.guide.step1') }}
            <Button variant="link" class="h-auto p-0 text-base underline" @click="openNetbird">
              netbird.io
            </Button>
          </li>
          <li class="text-base text-muted-foreground">{{ t('settings.devices.guide.step2') }}</li>
          <li class="text-base text-muted-foreground">{{ t('settings.devices.guide.step3') }}</li>
          <li class="text-base text-muted-foreground">{{ t('settings.devices.guide.step4') }}</li>
        </ol>
        <div class="mt-2.5 text-sm text-faint">{{ t('settings.devices.guide.tip') }}</div>
      </CollapsibleContent>
    </Collapsible>

    <!-- How an already-paired device gets back in (URL + QR, no pairing code). -->
    <SettingsDeviceAccess v-if="enabled && connected && host" :host="host" :port="port" />

    <!-- Empty state -->
    <div
      v-if="!devices.length"
      class="flex flex-col items-center gap-2 rounded-lg border border-dashed px-5 py-9 text-center"
    >
      <Icon name="smartphone" class="mb-1 size-7 text-faint" />
      <div class="text-lg font-semibold text-foreground">
        {{ t('settings.devices.empty.title') }}
      </div>
      <div class="mb-1.5 max-w-80 text-base text-muted-foreground">
        {{ t('settings.devices.empty.body') }}
      </div>
      <Button
        :disabled="!enabled || !connected || pairingBusy"
        :title="t('settings.devices.pairNew')"
        variant="default"
        size="sm"
        @click="createPairing"
      >
        {{ t('settings.devices.pairNew') }}
      </Button>
    </div>

    <!-- Device list -->
    <ul v-else class="m-0 flex list-none flex-col gap-2 p-0">
      <li
        v-for="d in devices"
        :key="d.id"
        class="flex items-center gap-3 rounded-lg border bg-muted px-3 py-2.5"
      >
        <div class="min-w-0 flex-1">
          <span class="text-base font-semibold text-foreground">{{ d.label }}</span>
          <div class="mt-1 flex flex-wrap items-center gap-2">
            <Badge variant="outline" class="rounded-sm text-dim">
              {{ platformLabel(d.platform) }}
            </Badge>
            <span class="text-sm text-faint">
              {{ t('settings.devices.pairedAt', { when: formatRelativeAgo(d.pairedAt, t, now) }) }}
            </span>
            <span v-if="d.lastSeenAt" class="text-sm text-faint">
              {{
                t('settings.devices.lastSeen', { when: formatRelativeAgo(d.lastSeenAt, t, now) })
              }}
            </span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="iconMd"
          class="shrink-0 text-dim hover:bg-destructive/10 hover:text-destructive"
          :title="t('settings.devices.revoke')"
          :aria-label="t('settings.devices.revoke')"
          @click="revokeDevice(d)"
        >
          <Icon name="trash" class="size-3.5" />
        </Button>
      </li>
    </ul>

    <SettingsDevicePairModal :pairing="pairing" @regenerate="createPairing" @close="closePairing" />
  </div>
</template>

<script setup lang="ts">
// Settings → Devices (Mobile Remote Control, Wave 2). Manages device pairing +
// revoke for the mesh-VPN-bound gateway. All gateway I/O and lifecycle lives in
// useRemoteGateway; this component is the thin view (status badge, banner, list,
// empty state) plus a per-platform label + status colors. Browser-dev (no bridge)
// simply shows the disconnected state — every action is a no-op.
import { computed, ref, watch } from 'vue'
import SettingsDeviceAccess from '~/components/settings/SettingsDeviceAccess.vue'
import SettingsDevicePairModal from '~/components/settings/SettingsDevicePairModal.vue'
import { useRemoteGateway } from '~/composables/useRemoteGateway'
import { formatRelativeAgo } from '~/utils/relative-time'

const { t } = useI18n()
const now = useNow()
const sc = useSidecar()

// Open the NetBird download page in the OS browser (setup guide, step 1).
// NOT through useLinkOpen: the point of this link is to DOWNLOAD an installer, and
// downloads are blocked in the agent's browser partition (will-download →
// preventDefault), so offering "open in the app" would offer a dead end.
function openNetbird(): void {
  if (sc.available) void sc.openExternal('https://netbird.io')
  else window.open('https://netbird.io', '_blank')
}

const {
  devices,
  pairing,
  pairingBusy,
  connected,
  host,
  port,
  enabled,
  setEnabled,
  createPairing,
  closePairing,
  revokeDevice,
} = useRemoteGateway()

// Truth lives in main (persisted + drives the listener), so the switch writes
// through IPC and re-reads the returned status rather than holding local state.
const remoteEnabled = computed<boolean>({
  get: () => enabled.value,
  set: (on) => void setEnabled(on),
})

// Three states, in order of what the user must act on: off (their choice) →
// no mesh (needs NetBird) → live.
const isLive = computed(() => enabled.value && connected.value)
const statusLabel = computed(() => {
  if (!enabled.value) return t('settings.devices.off')
  return connected.value ? t('settings.devices.meshConnected') : t('settings.devices.disconnected')
})

// Hướng dẫn NetBird mở sẵn khi đã bật mà chưa có mesh; người dùng vẫn tự mở/đóng được.
// Đồng bộ lại mỗi khi trạng thái đó đổi (như `:open` của <details> trước đây).
const guideOpen = ref(enabled.value && !connected.value)
watch(
  () => enabled.value && !connected.value,
  (v) => {
    guideOpen.value = v
  },
)

// Known platform ids get a friendly label; anything else shows raw (fail-soft).
function platformLabel(platform: string): string {
  const key = `settings.devices.platform.${platform.toLowerCase()}`
  const label = t(key)
  return label === key ? platform : label
}
</script>
