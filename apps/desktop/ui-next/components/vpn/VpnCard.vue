<template>
  <Card
    class="flex-row items-center gap-3 rounded-lg p-3 shadow-none"
    @contextmenu.prevent="emit('edit')"
  >
    <!-- Màu monogram sinh theo từng profile (HSL dữ liệu, không phải token theme). -->
    <span class="grid size-8 shrink-0 place-items-center rounded-md" :style="avatarStyle">
      <Icon name="globe" class="size-4" />
    </span>
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <div class="flex min-w-0 items-center gap-2.5">
        <span class="min-w-0 truncate text-base font-medium text-foreground">
          {{ profile.name }}
        </span>
        <Badge variant="outline" :class="statusBadge" :title="error || statusLabel">
          <span class="size-2 shrink-0 rounded-full bg-current" />
          {{ statusLabel }}
        </Badge>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span class="font-mono text-sm break-all text-muted-foreground">{{ configLabel }}</span>
        <Badge variant="secondary">{{ authLabel }}</Badge>
        <Badge
          v-if="credState === 'saved'"
          variant="outline"
          class="border-transparent bg-primary/15 text-primary"
          :title="t('vpn.card.credsSavedHint')"
        >
          <Icon name="check" />
          {{ t('vpn.card.credsSaved') }}
        </Badge>
        <!-- Chưa lưu credential cho VPN user/pass — báo trước là kết nối sẽ lỗi. -->
        <Badge
          v-else-if="credState === 'missing'"
          variant="warning"
          :title="t('vpn.card.credsMissingHint')"
        >
          <Icon name="alert" />
          {{ t('vpn.card.credsMissing') }}
        </Badge>
        <Badge
          v-for="tag in tags"
          :key="tag"
          variant="outline"
          class="font-normal text-muted-foreground"
        >
          {{ tag }}
        </Badge>
      </div>
    </div>
    <Button
      variant="ghost"
      size="iconSm"
      class="text-muted-foreground"
      :title="t('vpn.card.log')"
      :aria-label="t('vpn.card.log')"
      @click="emit('log')"
    >
      <Icon name="terminal" />
    </Button>
    <!-- Connect / Disconnect: play (connect) → primary, stop (đang up) → destructive,
         refresh (đang connecting) quay + disabled. -->
    <Button
      v-if="status === 'up'"
      variant="ghost"
      size="iconSm"
      class="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      :title="t('vpn.card.disconnect')"
      :aria-label="t('vpn.card.disconnect')"
      @click="emit('disconnect')"
    >
      <Icon name="stop" />
    </Button>
    <Button
      v-else
      variant="ghost"
      size="iconSm"
      class="text-muted-foreground hover:bg-primary/10 hover:text-primary disabled:pointer-events-auto disabled:cursor-default disabled:text-primary disabled:hover:bg-transparent"
      :disabled="status === 'connecting'"
      :title="status === 'connecting' ? t('vpn.card.connecting') : t('vpn.card.connect')"
      :aria-label="status === 'connecting' ? t('vpn.card.connecting') : t('vpn.card.connect')"
      @click="emit('connect')"
    >
      <Icon
        :name="status === 'connecting' ? 'refresh' : 'play'"
        :class="{ 'animate-spin motion-reduce:animate-none': status === 'connecting' }"
      />
    </Button>
    <Button
      variant="ghost"
      size="iconSm"
      class="text-muted-foreground"
      :title="t('vpn.card.edit')"
      :aria-label="t('vpn.card.edit')"
      @click="emit('edit')"
    >
      <Icon name="edit" />
    </Button>
    <Button
      variant="ghost"
      size="iconSm"
      class="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      :title="t('vpn.card.delete')"
      :aria-label="t('vpn.card.delete')"
      @click="emit('delete')"
    >
      <Icon name="trash" />
    </Button>
  </Card>
</template>

<script setup lang="ts">
// One VPN profile, rendered as a bordered card row (mirror of SshHostCard, styled
// like the keychain/snippet rows so the VPN section reads consistently). Monogram
// tile + name + last-known status badge on the top line; config file + auth-mode
// chip + credential-state chip (saved / missing) + tags beneath. Actions on the right.
// Presentational — mutations bubble to the section via events. Nothing reads a
// secret (only the has* booleans are shown).
import { computed } from 'vue'
import { vpnAccent, type VpnProfile, type VpnStatus } from '~/stores/vpn'
import { VPN_STATUS_BADGE } from '~/components/vpn/vpn-status'

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
const statusBadge = computed(() => VPN_STATUS_BADGE[props.status])
const statusLabel = computed(() => t(`vpn.status.${props.status}`))
const authLabel = computed(() =>
  props.profile.authMode === 'user-pass' ? t('vpn.auth.userPass') : t('vpn.auth.none'),
)
// Credential STATE — distinct from the auth-mode chip (which says HOW it authenticates,
// not whether the secret is stored). Avoids the confusing "user/pass" + "user/pass"
// duplication: this reports storage, not the auth type.
//   'saved'   → a username/password or key passphrase is in the keychain
//   'missing' → authenticates by user/pass but none is stored (connect will fail)
//   'none'    → cert/config auth with nothing to store → no chip
const credState = computed<'saved' | 'missing' | 'none'>(() => {
  const p = props.profile
  if (p.hasUserPass || p.hasKeyPassphrase) return 'saved'
  if (p.authMode === 'user-pass') return 'missing'
  return 'none'
})
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
