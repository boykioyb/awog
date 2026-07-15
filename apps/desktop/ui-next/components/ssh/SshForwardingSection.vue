<template>
  <div class="sshx-fw">
    <div class="sshx-fw-top">
      <span class="sshx-fw-title">{{ t('ssh.nav.forwarding') }}</span>
      <span class="sshx-fw-count">{{ forwards.length }}</span>
      <button
        class="btn pri sm sshx-fw-add"
        :disabled="!hasLiveConn"
        :title="hasLiveConn ? t('ssh.fwd.add') : t('ssh.fwd.noConnection')"
        @click="openAdd"
      >
        <Icon name="plus" style="width: 13px; height: 13px" />
        {{ t('ssh.fwd.add') }}
      </button>
      <button
        class="sshx-fw-refresh"
        :title="t('ssh.sftp.refresh')"
        :aria-label="t('ssh.sftp.refresh')"
        @click="refresh"
      >
        <Icon name="refresh" style="width: 14px; height: 14px" />
      </button>
    </div>

    <!-- Add-tunnel form (opens on the Add button): pick a live connection + the
         forward shape. Local/dynamic bind 127.0.0.1 (enforced sidecar-side). -->
    <div v-if="adding" class="sshx-fw-form">
      <div class="sshx-fw-frow">
        <AppSelect v-model="draft.connId" :options="connOptions" class="sshx-fw-conn" />
        <AppSelect v-model="draft.type" :options="typeOptions" class="sshx-fw-typesel" />
        <input
          v-model.number="draft.bindPort"
          type="number"
          min="0"
          max="65535"
          class="sshx-fw-input"
          :placeholder="t('ssh.fwd.bindPort')"
        />
        <template v-if="draft.type !== 'dynamic'">
          <span class="sshx-fw-arrow mono">{{ draft.type === 'local' ? '→' : '←' }}</span>
          <input
            v-model="draft.destHost"
            type="text"
            class="sshx-fw-input"
            :placeholder="t('ssh.fwd.destHost')"
          />
          <input
            v-model.number="draft.destPort"
            type="number"
            min="1"
            max="65535"
            class="sshx-fw-input sshx-fw-input-sm"
            :placeholder="t('ssh.fwd.destPort')"
          />
        </template>
      </div>
      <div class="sshx-fw-fact">
        <span class="sshx-fw-hint">{{ t('ssh.fwd.bindHint') }}</span>
        <button class="btn sm" @click="adding = false">{{ t('common.cancel') }}</button>
        <button class="btn pri sm" :disabled="!canAdd || starting" @click="add">
          {{ t('ssh.fwd.add') }}
        </button>
      </div>
    </div>

    <div class="sshx-fw-scroll">
      <SshEmptyState
        v-if="!forwards.length"
        icon="forward"
        :title="hasLiveConn ? t('ssh.fwd.empty') : t('ssh.fwd.noConnectionTitle')"
        :body="hasLiveConn ? t('ssh.fwd.emptyBody') : t('ssh.fwd.noConnection')"
      />
      <div v-else class="sshx-fw-list">
        <div v-for="f in forwards" :key="f.forwardId" class="sshx-fw-row">
          <span class="sshx-fw-type">{{ t('ssh.forward.' + f.forward.type) }}</span>
          <span class="mono sshx-fw-body">{{ forwardLabel(f) }}</span>
          <span v-if="hostName(f)" class="sshx-fw-host">{{ hostName(f) }}</span>
          <span
            class="sshx-fw-status"
            :style="{ color: f.status === 'error' ? 'var(--danger)' : 'var(--green)' }"
            :title="f.error || undefined"
          >
            <span class="sshx-fw-dot" />
            {{ t('ssh.fwd.status.' + f.status) }}
          </span>
          <button
            class="sshx-fw-stop"
            :title="t('ssh.fwd.stop')"
            :aria-label="t('ssh.fwd.stop')"
            @click="stop(f.forwardId)"
          >
            <Icon name="x" style="width: 13px; height: 13px" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Port Forwarding section of the SSH workspace — lists ACTIVE tunnels across every
// live connection (ssh.forward.list with no connId) with a stop button per row, and
// an Add form to start a new tunnel over a chosen live connection. Refreshes on
// mount + on the ssh:forward-changed event. The empty state / disabled Add prompt
// Connect when there's no live connection yet.
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import AppSelect from '~/components/common/AppSelect.vue'
import SshEmptyState from '~/components/ssh/SshEmptyState.vue'
import { useSshApi, type SshForwardInfo } from '~/composables/useSshApi'
import { useSidecar, type UnlistenFn } from '~/composables/useSidecar'
import { useToasts } from '~/composables/useToasts'
import { useSshStore, type PortForward } from '~/stores/ssh'

const { t } = useI18n()
const api = useSshApi()
const sc = useSidecar()
const store = useSshStore()
const { pushToast } = useToasts()

const forwards = ref<SshForwardInfo[]>([])

// True when at least one host has a live connection — decides whether the empty
// state prompts Connect or just says "no tunnels".
const hasLiveConn = computed(() => Object.keys(store.liveConnByHost).length > 0)

// --- add a tunnel ----------------------------------------------------------
// A new forward runs over a chosen LIVE connection; the picker lists open hosts.
type ForwardType = PortForward['type']
const adding = ref(false)
const starting = ref(false)
const draft = reactive<{
  connId: string
  type: ForwardType
  bindPort: number | null
  destHost: string
  destPort: number | null
}>({ connId: '', type: 'local', bindPort: null, destHost: '', destPort: null })

const liveConns = computed(() => {
  const out: { connId: string; label: string }[] = []
  for (const hostId of Object.keys(store.liveConnByHost)) {
    const connId = store.liveConnByHost[hostId]
    if (connId) out.push({ connId, label: store.hostById(hostId)?.name || hostId })
  }
  return out
})
const connOptions = computed(() =>
  liveConns.value.map((c) => ({ label: c.label, value: c.connId })),
)
const typeOptions = computed(() => [
  { label: t('ssh.forward.local'), value: 'local' },
  { label: t('ssh.forward.remote'), value: 'remote' },
  { label: t('ssh.forward.dynamic'), value: 'dynamic' },
])
const canAdd = computed(() => {
  if (!draft.connId || draft.bindPort == null || draft.bindPort < 0) return false
  if (draft.type === 'dynamic') return true
  return !!draft.destHost.trim() && draft.destPort != null && draft.destPort > 0
})

function openAdd(): void {
  draft.connId = liveConns.value[0]?.connId ?? ''
  draft.type = 'local'
  draft.bindPort = null
  draft.destHost = ''
  draft.destPort = null
  adding.value = true
}
function buildForward(): PortForward {
  const id = `fwd-${Date.now().toString(36)}`
  const bindPort = draft.bindPort ?? 0
  if (draft.type === 'dynamic') return { id, type: 'dynamic', bindPort }
  return {
    id,
    type: draft.type,
    bindPort,
    destHost: draft.destHost.trim(),
    destPort: draft.destPort ?? 0,
  }
}
async function add(): Promise<void> {
  if (!canAdd.value || starting.value) return
  starting.value = true
  try {
    await api.forwardStart(draft.connId, buildForward())
    adding.value = false
    await refresh()
  } catch (err) {
    pushToast(t('ssh.fwd.startFailed', { error: err instanceof Error ? err.message : '' }), 'error')
  } finally {
    starting.value = false
  }
}

const forwardLabel = (f: SshForwardInfo): string => {
  const fwd = f.forward
  const bind = `${fwd.bindHost ?? '127.0.0.1'}:${fwd.bindPort}`
  if (fwd.type === 'dynamic') return `${bind} (SOCKS)`
  const arrow = fwd.type === 'local' ? '→' : '←'
  return `${bind} ${arrow} ${fwd.destHost}:${fwd.destPort}`
}

// Best-effort human label for the tunnel's connection (the host whose live connId
// matches). Falls back to nothing so the row stays clean when it can't resolve.
const hostName = (f: SshForwardInfo): string => {
  const hostId = Object.keys(store.liveConnByHost).find(
    (id) => store.liveConnByHost[id] === f.connId,
  )
  const host = hostId ? store.hostById(hostId) : undefined
  return host?.name || ''
}

async function refresh(): Promise<void> {
  if (!sc.available) {
    forwards.value = []
    return
  }
  try {
    const res = await api.forwardList()
    forwards.value = res.forwards
  } catch (err) {
    console.warn('[ssh] forwardList failed', err)
  }
}

async function stop(forwardId: string): Promise<void> {
  try {
    await api.forwardStop(forwardId)
    await refresh()
  } catch (err) {
    pushToast(t('ssh.fwd.stopFailed', { error: err instanceof Error ? err.message : '' }), 'error')
  }
}

let unlisten: UnlistenFn | null = null
onMounted(async () => {
  await refresh()
  if (sc.available) {
    try {
      unlisten = await sc.onEvent((evt) => {
        if (evt?.type === 'ssh:forward-changed' || evt?.type === 'ssh:status-changed')
          void refresh()
      })
    } catch {
      unlisten = null
    }
  }
})
onBeforeUnmount(() => {
  if (unlisten) unlisten()
  unlisten = null
})
</script>

<style scoped>
.sshx-fw {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.sshx-fw-top {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
}
.sshx-fw-title {
  font-size: 1.0769rem;
  font-weight: 650;
  color: var(--text);
}
.sshx-fw-count {
  font-size: 12px;
  line-height: 1;
  padding: 3px 8px;
  border-radius: 99px;
  color: var(--textDim);
  background: var(--bgHover);
}
.sshx-fw-add {
  margin-left: auto;
  flex: 0 0 auto;
}
.sshx-fw-refresh {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  flex: 0 0 auto;
  transition:
    background 0.12s,
    color 0.12s,
    border-color 0.12s;
}
/* ── Add-tunnel form ─────────────────────────────────────────────────────── */
.sshx-fw-form {
  flex: 0 0 auto;
  padding: 12px 18px;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.sshx-fw-frow {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.sshx-fw-conn {
  flex: 1 1 150px;
  min-width: 0;
}
.sshx-fw-typesel {
  width: 116px;
  flex: 0 0 auto;
}
.sshx-fw-input {
  height: 32px;
  min-width: 0;
  flex: 1 1 90px;
  padding: 0 9px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bgInput);
  color: var(--text);
  font-size: 0.9231rem;
  outline: none;
}
.sshx-fw-input:focus {
  border-color: var(--accent);
}
.sshx-fw-input-sm {
  flex: 0 0 84px;
}
.sshx-fw-arrow {
  flex: 0 0 auto;
  color: var(--textDim);
}
.sshx-fw-fact {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sshx-fw-hint {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--textDim);
}
.sshx-fw-refresh:hover {
  border-color: var(--borderStrong);
  color: var(--text);
}
.sshx-fw-refresh:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.sshx-fw-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.sshx-fw-list {
  padding: 8px 12px;
}
.sshx-fw-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bgEl);
}
.sshx-fw-row + .sshx-fw-row {
  margin-top: 8px;
}
.sshx-fw-type {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  line-height: 1;
  padding: 3px 8px;
  border-radius: 99px;
  color: var(--textDim);
  background: var(--bgHover);
  flex: 0 0 auto;
}
.sshx-fw-body {
  flex: 1;
  min-width: 0;
  font-size: 0.9231rem;
  color: var(--text);
  word-break: break-all;
}
.sshx-fw-host {
  font-size: 0.8462rem;
  color: var(--textDim);
  white-space: nowrap;
  flex: 0 0 auto;
}
.sshx-fw-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-family: var(--code);
  line-height: 1;
  padding: 3px 8px;
  border: 1px solid currentColor;
  border-radius: 99px;
  background: transparent;
  flex: 0 0 auto;
}
.sshx-fw-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
  flex: 0 0 auto;
}
.sshx-fw-stop {
  width: 26px;
  height: 26px;
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
.sshx-fw-stop:hover {
  background: var(--dangerDim);
  color: var(--danger);
}
.sshx-fw-stop:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
</style>
