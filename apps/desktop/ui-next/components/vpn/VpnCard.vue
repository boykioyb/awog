<template>
  <div class="vpn-card" @contextmenu.prevent="emit('edit')">
    <span class="vpn-av" :style="avatarStyle">
      <Icon name="globe" style="width: 16px; height: 16px" />
    </span>
    <div class="vpn-main">
      <div class="vpn-name-row">
        <span class="vpn-name">{{ profile.name }}</span>
        <span class="vpn-status" :style="{ color: statusColor }" :title="error || statusLabel">
          <span class="vpn-dot" :style="{ background: statusColor }" />
          {{ statusLabel }}
        </span>
      </div>
      <div class="vpn-meta">
        <span class="vpn-path mono">{{ configLabel }}</span>
        <span class="vpn-chip">{{ authLabel }}</span>
        <span v-if="profile.hasUserPass" class="vpn-cred">
          <Icon name="shield" style="width: 10px; height: 10px" />
          {{ t('vpn.card.credsUserPass') }}
        </span>
        <span v-if="profile.hasKeyPassphrase" class="vpn-cred">
          <Icon name="shield" style="width: 10px; height: 10px" />
          {{ t('vpn.card.credsPassphrase') }}
        </span>
        <span v-for="tag in tags" :key="tag" class="vpn-tag">{{ tag }}</span>
      </div>
    </div>
    <button
      class="vpn-act"
      :title="t('vpn.card.log')"
      :aria-label="t('vpn.card.log')"
      @click="emit('log')"
    >
      <Icon name="terminal" style="width: 13px; height: 13px" />
    </button>
    <button
      v-if="status === 'up'"
      class="vpn-act vpn-conn on"
      :title="t('vpn.card.disconnect')"
      :aria-label="t('vpn.card.disconnect')"
      @click="emit('disconnect')"
    >
      <Icon name="stop" style="width: 13px; height: 13px" />
    </button>
    <button
      v-else
      class="vpn-act vpn-conn"
      :disabled="status === 'connecting'"
      :title="status === 'connecting' ? t('vpn.card.connecting') : t('vpn.card.connect')"
      :aria-label="status === 'connecting' ? t('vpn.card.connecting') : t('vpn.card.connect')"
      @click="emit('connect')"
    >
      <Icon
        :name="status === 'connecting' ? 'refresh' : 'play'"
        :class="{ 'vpn-spin': status === 'connecting' }"
        style="width: 13px; height: 13px"
      />
    </button>
    <button
      class="vpn-act"
      :title="t('vpn.card.edit')"
      :aria-label="t('vpn.card.edit')"
      @click="emit('edit')"
    >
      <Icon name="edit" style="width: 13px; height: 13px" />
    </button>
    <button
      class="vpn-act vpn-del"
      :title="t('vpn.card.delete')"
      :aria-label="t('vpn.card.delete')"
      @click="emit('delete')"
    >
      <Icon name="trash" style="width: 13px; height: 13px" />
    </button>
  </div>
</template>

<script setup lang="ts">
// One VPN profile, rendered as a bordered card row (mirror of SshHostCard, styled
// like the keychain/snippet rows so the VPN section reads consistently). Monogram
// tile + name + last-known status badge on the top line; config file + auth-mode
// chip + credential-set chips + tags beneath. Edit / Delete actions on the right.
// Presentational — mutations bubble to the section via events. Nothing reads a
// secret (only the has* booleans are shown).
import { computed } from 'vue'
import { vpnAccent, VPN_STATUS_COLORS, type VpnProfile, type VpnStatus } from '~/stores/vpn'

const props = withDefaults(
  defineProps<{
    profile: VpnProfile
    // Effective (live) status + error, resolved by the section from the store. The
    // card is presentational — it renders what it's handed.
    status?: VpnStatus
    error?: string
  }>(),
  { status: 'down', error: '' },
)

const emit = defineEmits<{
  edit: []
  delete: []
  connect: []
  disconnect: []
  log: []
}>()

const { t } = useI18n()

const tags = computed(() => props.profile.tags ?? [])
const statusColor = computed(() => VPN_STATUS_COLORS[props.status])
const statusLabel = computed(() => t(`vpn.status.${props.status}`))
const authLabel = computed(() =>
  props.profile.authMode === 'user-pass' ? t('vpn.auth.userPass') : t('vpn.auth.none'),
)
// Show just the .ovpn filename (the full path can be long); fall back to a dash.
const configLabel = computed(() => {
  const p = props.profile.configPath?.trim()
  if (!p) return t('vpn.card.noConfig')
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] || p
})

// Monogram tile colored by a stable per-profile hue (seed by folder so a group
// shares a color). Generated HSL, theme-safe.
const avatarStyle = computed(() => {
  const a = vpnAccent(props.profile.folder || props.profile.name || props.profile.id)
  return { background: a.bg, color: a.fg, border: `1px solid ${a.border}` }
})
</script>

<style scoped>
.vpn-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bgEl);
}
.vpn-card + .vpn-card {
  margin-top: 8px;
}
.vpn-av {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  flex: 0 0 auto;
}
.vpn-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.vpn-name-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.vpn-name {
  min-width: 0;
  font-size: 1rem;
  font-weight: 550;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.vpn-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: 0 0 auto;
  font-size: 12px;
  line-height: 1;
}
.vpn-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: 0 0 auto;
}
.vpn-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.vpn-path {
  font-size: 12px;
  color: var(--textDim);
  word-break: break-all;
}
.vpn-chip {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  line-height: 1;
  padding: 3px 8px;
  border-radius: 99px;
  color: var(--textDim);
  background: var(--bgHover);
}
.vpn-cred {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  line-height: 1;
  padding: 3px 8px;
  border-radius: 99px;
  color: var(--accent);
  background: var(--accentDim);
}
.vpn-tag {
  padding: 1px 7px;
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 12px;
  color: var(--textDim);
  white-space: nowrap;
}
.vpn-act {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  flex: 0 0 auto;
  transition:
    background 0.12s,
    color 0.12s;
}
.vpn-act:hover {
  background: var(--bgHover);
  color: var(--text);
}
.vpn-act:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.vpn-del:hover {
  background: var(--dangerDim);
  color: var(--danger);
}
/* Connect / Disconnect toggle: play (connect) → accent, stop (disconnect, on) →
   danger tint, refresh (connecting) spins + disabled. */
.vpn-conn:hover {
  background: var(--accentDim);
  color: var(--accent);
}
.vpn-conn.on:hover {
  background: var(--dangerDim);
  color: var(--danger);
}
.vpn-conn:disabled {
  cursor: default;
  color: var(--accent);
}
.vpn-conn:disabled:hover {
  background: transparent;
}
.vpn-spin {
  animation: vpn-spin 0.9s linear infinite;
}
@keyframes vpn-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .vpn-spin {
    animation: none;
  }
}
</style>
