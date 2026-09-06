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

    <!-- Tailnet status + pair CTA -->
    <div class="dev-status">
      <span class="dev-badge" :style="badgeStyle">
        <span class="dev-dot" :style="{ background: dotColor }" />
        {{ statusLabel }}
      </span>
      <code v-if="enabled && connected && host" class="dev-host">{{ host }}</code>
      <span style="flex: 1" />
      <button
        class="btn pri sm"
        :disabled="!enabled || !connected || pairingBusy"
        :title="t('settings.devices.pairNew')"
        @click="createPairing"
      >
        <Icon name="plus" style="width: var(--icon-sm); height: var(--icon-sm)" />
        {{ t('settings.devices.pairNew') }}
      </button>
    </div>

    <!-- Off banner — informational, not a problem to fix. -->
    <div v-if="!enabled" class="dev-banner off">
      <Icon
        name="alert"
        style="width: var(--icon-md); height: var(--icon-md)"
        class="dev-banner-icon"
      />
      <div>
        <div class="dev-banner-title">{{ t('settings.devices.offTitle') }}</div>
        <div class="dev-banner-hint">{{ t('settings.devices.offHint') }}</div>
      </div>
    </div>

    <!-- Disconnected banner -->
    <div v-else-if="!connected" class="dev-banner">
      <Icon
        name="alert"
        style="width: var(--icon-md); height: var(--icon-md)"
        class="dev-banner-icon"
      />
      <div>
        <div class="dev-banner-title">{{ t('settings.devices.tailnetDisconnected') }}</div>
        <div class="dev-banner-hint">{{ t('settings.devices.installHint') }}</div>
      </div>
    </div>

    <!-- Tailscale setup guide: expanded while disconnected, collapsible for reference once connected. -->
    <details class="dev-guide" :open="enabled && !connected">
      <summary class="dev-guide-sum">{{ t('settings.devices.guide.title') }}</summary>
      <ol class="dev-guide-steps">
        <li>
          {{ t('settings.devices.guide.step1') }}
          <button type="button" class="dev-guide-link" @click="openTailscale">
            tailscale.com/download
          </button>
        </li>
        <li>{{ t('settings.devices.guide.step2') }}</li>
        <li>{{ t('settings.devices.guide.step3') }}</li>
        <li>{{ t('settings.devices.guide.step4') }}</li>
      </ol>
      <div class="dev-guide-tip">{{ t('settings.devices.guide.tip') }}</div>
    </details>

    <!-- How an already-paired device gets back in (URL + QR, no pairing code). -->
    <SettingsDeviceAccess v-if="enabled && connected && host" :host="host" :port="port" />

    <!-- Empty state -->
    <div v-if="!devices.length" class="dev-empty">
      <Icon name="smartphone" style="width: 28px; height: 28px" class="dev-empty-icon" />
      <div class="dev-empty-title">{{ t('settings.devices.empty.title') }}</div>
      <div class="dev-empty-body">{{ t('settings.devices.empty.body') }}</div>
      <button
        class="btn pri sm"
        :disabled="!enabled || !connected || pairingBusy"
        :title="t('settings.devices.pairNew')"
        @click="createPairing"
      >
        {{ t('settings.devices.pairNew') }}
      </button>
    </div>

    <!-- Device list -->
    <ul v-else class="dev-list">
      <li v-for="d in devices" :key="d.id" class="dev-row">
        <div class="dev-row-main">
          <span class="dev-row-label">{{ d.label }}</span>
          <div class="dev-row-meta">
            <span class="dev-chip">{{ platformLabel(d.platform) }}</span>
            <span class="dev-meta">
              {{ t('settings.devices.pairedAt', { when: formatRelativeAgo(d.pairedAt, t, now) }) }}
            </span>
            <span v-if="d.lastSeenAt" class="dev-meta">
              {{
                t('settings.devices.lastSeen', { when: formatRelativeAgo(d.lastSeenAt, t, now) })
              }}
            </span>
          </div>
        </div>
        <button
          class="dev-revoke p-1.5 rounded transition"
          :title="t('settings.devices.revoke')"
          @click="revokeDevice(d)"
        >
          <Icon name="trash" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
      </li>
    </ul>

    <SettingsDevicePairModal :pairing="pairing" @regenerate="createPairing" @close="closePairing" />
  </div>
</template>

<script setup lang="ts">
// Settings → Devices (Mobile Remote Control, Wave 2). Manages device pairing +
// revoke for the Tailscale-bound gateway. All gateway I/O and lifecycle lives in
// useRemoteGateway; this component is the thin view (status badge, banner, list,
// empty state) plus a per-platform label + status colors. Browser-dev (no bridge)
// simply shows the disconnected state — every action is a no-op.
import { computed } from 'vue'
import SettingsDeviceAccess from '~/components/settings/SettingsDeviceAccess.vue'
import SettingsDevicePairModal from '~/components/settings/SettingsDevicePairModal.vue'
import { useRemoteGateway } from '~/composables/useRemoteGateway'
import { formatRelativeAgo } from '~/utils/relative-time'

const { t } = useI18n()
const now = useNow()
const sc = useSidecar()

// Open the Tailscale download page in the OS browser (setup guide, step 1).
function openTailscale(): void {
  if (sc.available) void sc.openExternal('https://tailscale.com/download')
  else window.open('https://tailscale.com/download', '_blank')
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
// no tailnet (needs Tailscale) → live.
const isLive = computed(() => enabled.value && connected.value)
const statusLabel = computed(() => {
  if (!enabled.value) return t('settings.devices.off')
  return connected.value
    ? t('settings.devices.tailnetConnected')
    : t('settings.devices.disconnected')
})
const dotColor = computed(() => (isLive.value ? 'var(--green)' : 'var(--textFaint)'))
const badgeStyle = computed(() =>
  isLive.value
    ? { color: 'var(--green)', background: 'var(--addBg)', borderColor: 'var(--addBg)' }
    : { color: 'var(--textDim)', background: 'var(--bgHover)', borderColor: 'var(--border)' },
)

// Known platform ids get a friendly label; anything else shows raw (fail-soft).
function platformLabel(platform: string): string {
  const key = `settings.devices.platform.${platform.toLowerCase()}`
  const label = t(key)
  return label === key ? platform : label
}
</script>

<style scoped>
.dev-status {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 0 12px;
}
.dev-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  line-height: 12px;
  padding: 5px 10px;
  border-radius: var(--r-pill);
  border: 1px solid transparent;
  font-weight: 550;
}
.dev-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: 0 0 auto;
}
.dev-host {
  /* mono-ok: tailnet hostname */
  font-family: var(--code);
  font-size: 12px;
  line-height: 18px;
  color: var(--textDim);
}
.dev-banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border-radius: var(--r-btn);
  border: 1px solid var(--amberBorder);
  background: var(--amberDim);
  margin-bottom: 14px;
}
/* Remote control switched off is a state, not a fault — neutral, not amber. */
.dev-banner.off {
  border-color: var(--border);
  background: var(--bgSubtle);
}
.dev-banner-icon {
  color: var(--amber);
  flex: 0 0 auto;
  margin-top: 1px;
}
.dev-banner.off .dev-banner-icon {
  color: var(--textFaint);
}
.dev-banner-title {
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-weight: 600;
  color: var(--text);
}
.dev-banner-hint {
  margin-top: 3px;
  font-size: var(--fs-md);
  color: var(--textMuted);
  line-height: var(--lh-md);
}
.dev-guide {
  margin-bottom: 14px;
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  background: var(--bgSubtle);
  padding: 10px 14px;
}
.dev-guide-sum {
  cursor: pointer;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-weight: 600;
  color: var(--text);
}
.dev-guide-steps {
  margin: 10px 0 0;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.dev-guide-steps li {
  font-size: var(--fs-md);
  color: var(--textMuted);
  line-height: var(--lh-md);
}
.dev-guide-link {
  border: none;
  background: transparent;
  padding: 0;
  color: var(--accent);
  cursor: pointer;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  text-decoration: underline;
}
.dev-guide-tip {
  margin-top: 10px;
  font-size: 12px;
  color: var(--textFaint);
  line-height: 18px;
}
.dev-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 36px 20px;
  border-radius: var(--r-btn);
  border: 1px dashed var(--border);
  text-align: center;
}
.dev-empty-icon {
  color: var(--textFaint);
  margin-bottom: 4px;
}
.dev-empty-title {
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  font-weight: 600;
  color: var(--text);
}
.dev-empty-body {
  font-size: var(--fs-md);
  color: var(--textMuted);
  line-height: var(--lh-md);
  max-width: 320px;
  margin-bottom: 6px;
}
.dev-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dev-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--r-btn);
  border: 1px solid var(--border);
  background: var(--bgSubtle);
}
.dev-row-main {
  flex: 1;
  min-width: 0;
}
.dev-row-label {
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-weight: 600;
  color: var(--text);
}
.dev-row-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}
.dev-chip {
  font-size: 12px;
  line-height: 12px;
  padding: 3px 8px;
  border-radius: var(--r-xs);
  border: 1px solid var(--border);
  color: var(--textDim);
}
.dev-meta {
  font-size: 12px;
  line-height: 18px;
  color: var(--textFaint);
}
.dev-revoke {
  flex: 0 0 auto;
  color: var(--textDim);
  border: none;
  background: transparent;
  cursor: pointer;
}
.dev-revoke:hover {
  color: var(--danger);
  background: var(--dangerBg);
}
</style>
