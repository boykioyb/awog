<template>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col">
    <div class="flex shrink-0 items-center gap-2.5 px-4 py-3.5">
      <span class="text-lg font-semibold text-foreground">{{ t('ssh.nav.forwarding') }}</span>
      <Badge variant="secondary">{{ forwards.length }}</Badge>
      <Button
        :disabled="!hasLiveConn"
        :title="hasLiveConn ? t('ssh.fwd.add') : t('ssh.fwd.noConnection')"
        class="ml-auto shrink-0 disabled:pointer-events-auto disabled:cursor-not-allowed"
        variant="default"
        size="sm"
        @click="openAdd"
      >
        <Icon name="plus" />
        {{ t('ssh.fwd.add') }}
      </Button>
      <Button
        variant="outline"
        size="iconMd"
        class="shrink-0 text-muted-foreground"
        :title="t('ssh.sftp.refresh')"
        :aria-label="t('ssh.sftp.refresh')"
        @click="refresh"
      >
        <Icon name="refresh" />
      </Button>
    </div>
    <Separator />

    <!-- Add-tunnel form (opens on the Add button): pick a live connection + the
         forward shape. Local/dynamic bind 127.0.0.1 (enforced sidecar-side). -->
    <template v-if="adding">
      <div class="flex shrink-0 flex-col gap-2.5 px-4 py-3">
        <div class="flex flex-wrap items-center gap-2">
          <AppSelect
            v-model="draft.connId"
            :options="connOptions"
            class="min-w-0 flex-1 basis-37.5"
          />
          <AppSelect v-model="draft.type" :options="typeOptions" class="shrink-0" />
          <Input
            v-model.number="draft.bindPort"
            class="min-w-0 flex-1 basis-22"
            type="number"
            min="0"
            max="65535"
            :placeholder="t('ssh.fwd.bindPort')"
          />
          <template v-if="draft.type !== 'dynamic'">
            <span class="shrink-0 font-mono text-muted-foreground">
              {{ draft.type === 'local' ? '→' : '←' }}
            </span>
            <Input
              v-model="draft.destHost"
              type="text"
              class="min-w-0 flex-1 basis-22"
              :placeholder="t('ssh.fwd.destHost')"
            />
            <Input
              v-model.number="draft.destPort"
              type="number"
              min="1"
              max="65535"
              :placeholder="t('ssh.fwd.destPort')"
              class="w-21 shrink-0"
            />
          </template>
        </div>
        <div class="flex items-center gap-2">
          <span class="min-w-0 flex-1 text-sm text-muted-foreground">
            {{ t('ssh.fwd.bindHint') }}
          </span>
          <Button variant="outline" size="sm" @click="adding = false">
            {{ t('common.cancel') }}
          </Button>
          <Button :disabled="!canAdd || starting" variant="default" size="sm" @click="add">
            {{ t('ssh.fwd.add') }}
          </Button>
        </div>
      </div>
      <Separator />
    </template>

    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <SshEmptyState
        v-if="!forwards.length"
        icon="forward"
        :title="hasLiveConn ? t('ssh.fwd.empty') : t('ssh.fwd.noConnectionTitle')"
        :body="hasLiveConn ? t('ssh.fwd.emptyBody') : t('ssh.fwd.noConnection')"
      />
      <div v-else class="flex flex-col gap-2 px-3 py-2">
        <Card
          v-for="f in forwards"
          :key="f.forwardId"
          class="flex-row items-center gap-2.5 rounded-lg px-3 py-3 shadow-none"
        >
          <Badge variant="secondary" class="shrink-0">
            {{ t('ssh.forward.' + f.forward.type) }}
          </Badge>
          <span class="min-w-0 flex-1 font-mono text-sm break-all text-foreground">
            {{ forwardLabel(f) }}
          </span>
          <span v-if="hostName(f)" class="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
            {{ hostName(f) }}
          </span>
          <Badge
            variant="outline"
            class="shrink-0 border-current tabular-nums"
            :class="f.status === 'error' ? 'text-destructive' : 'text-success'"
            :title="f.error || undefined"
          >
            <span class="size-2 shrink-0 rounded-full bg-current" />
            {{ t('ssh.fwd.status.' + f.status) }}
          </Badge>
          <Button
            variant="ghost"
            size="iconSm"
            class="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            :title="t('ssh.fwd.stop')"
            :aria-label="t('ssh.fwd.stop')"
            @click="stop(f.forwardId)"
          >
            <Icon name="x" />
          </Button>
        </Card>
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
import { useSshStore, type PortForward } from '~/stores/ssh'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

const { t } = useI18n()
const api = useSshApi()
const sc = useSidecar()
const store = useSshStore()

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
    useToast().add({
      title: t('ssh.fwd.startFailed', { error: err instanceof Error ? err.message : '' }),
      color: 'error',
    })
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
    useToast().add({
      title: t('ssh.fwd.stopFailed', { error: err instanceof Error ? err.message : '' }),
      color: 'error',
    })
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
