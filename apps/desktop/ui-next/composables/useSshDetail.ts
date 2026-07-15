import { computed } from 'vue'
import { useI18n } from '~/composables/useI18n'
import {
  SSH_STATUS_COLORS,
  useSshStore,
  type PortForward,
  type SshConnectionStatus,
  type SshHost,
  type SshIdentity,
} from '~/stores/ssh'

// Detail-pane controller for SshDetail.vue (ADR 0063 P1) — owns the derived
// display state: the resolved linked identity + jump host, the status color/label,
// a relative "last connected" time, and the (already secret-free) port-forward and
// tag lists. Keeps the SFC a thin template. Connect/SFTP/Forward/Test/Edit/Delete
// stay in the component (they emit to the page); this composable is pure reads.

export function useSshDetail(getHost: () => SshHost) {
  const store = useSshStore()
  const { t } = useI18n()

  const host = computed(() => getHost())

  const status = computed<SshConnectionStatus>(() => host.value.connectionStatus ?? 'unknown')
  const statusColor = computed(() => SSH_STATUS_COLORS[status.value])
  const statusLabel = computed(() => t(`ssh.status.${status.value}`))

  const endpoint = computed(() => `${host.value.user}@${host.value.host}:${host.value.port}`)
  const authMethodLabel = computed(() => t(`ssh.auth.${host.value.authMethod}`))

  // Linked identity (authMethod === 'key'); null when unset or dangling.
  const identity = computed<SshIdentity | null>(() =>
    host.value.identityId ? (store.identityById(host.value.identityId) ?? null) : null,
  )
  const identityName = computed(() => identity.value?.name ?? host.value.identityId ?? '')

  // Jump host (bastion) — resolved to its display name for the info card.
  const jumpHostName = computed(() => {
    if (!host.value.jumpHostId) return ''
    return store.hostById(host.value.jumpHostId)?.name ?? host.value.jumpHostId
  })

  const portForwards = computed<PortForward[]>(() => host.value.portForwards ?? [])
  const tags = computed<string[]>(() => host.value.tags ?? [])
  const folder = computed(() => host.value.folder ?? '')
  const connectionError = computed(() => host.value.connectionError ?? '')
  const lastConnectedRelative = computed(() => formatRelative(host.value.lastConnectedAt, t))

  return {
    host,
    status,
    statusColor,
    statusLabel,
    endpoint,
    authMethodLabel,
    identity,
    identityName,
    jumpHostName,
    portForwards,
    tags,
    folder,
    connectionError,
    lastConnectedRelative,
  }
}

// Format an ISO timestamp as a coarse relative time using the ssh namespace.
function formatRelative(
  iso: string | undefined,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (!iso) return t('ssh.time.never')
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return t('ssh.time.never')
  const diff = Date.now() - ts
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (minutes < 1) return t('ssh.time.justNow')
  if (minutes < 60) return t('ssh.time.minutesAgo', { n: minutes })
  if (hours < 24) return t('ssh.time.hoursAgo', { n: hours })
  return t('ssh.time.daysAgo', { n: days })
}
