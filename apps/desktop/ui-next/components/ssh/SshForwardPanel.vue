<template>
  <div class="ssh-fp-surface">
    <div class="ssh-fp-head">
      <Icon name="move" style="width: 13px; height: 13px" />
      <span class="ssh-fp-head-t">{{ t('ssh.section.forwards') }}</span>
      <span class="ssh-fp-count">{{ forwards.length }}</span>
      <button
        class="ssh-fp-x"
        :title="t('ssh.panel.close')"
        :aria-label="t('ssh.panel.close')"
        @click="emit('close')"
      >
        <Icon name="x" style="width: 13px; height: 13px" />
      </button>
    </div>

    <!-- Active tunnels -->
    <div v-if="!forwards.length" class="ssh-fp-empty">{{ t('ssh.fwd.empty') }}</div>
    <div v-else class="ssh-fp-list">
      <div v-for="f in forwards" :key="f.forwardId" class="ssh-fp-row">
        <span class="ssh-fp-type">{{ t('ssh.forward.' + f.forward.type) }}</span>
        <span class="mono ssh-fp-body">{{ forwardLabel(f) }}</span>
        <span
          class="ssh-fp-status"
          :style="{ color: f.status === 'error' ? 'var(--danger)' : 'var(--green)' }"
          :title="f.error || undefined"
        >
          <span class="ssh-fp-dot" />
          {{ t('ssh.fwd.status.' + f.status) }}
        </span>
        <button
          class="ssh-fp-stop"
          :title="t('ssh.fwd.stop')"
          :aria-label="t('ssh.fwd.stop')"
          @click="stop(f.forwardId)"
        >
          <Icon name="x" style="width: 12px; height: 12px" />
        </button>
      </div>
    </div>

    <!-- Add a tunnel -->
    <div class="ssh-fp-add">
      <div class="ssh-fp-add-row">
        <AppSelect v-model="draft.type" :options="typeOptions" class="ssh-fp-type-sel" />
        <input
          v-model.number="draft.bindPort"
          type="number"
          class="ssh-fp-input"
          :placeholder="t('ssh.fwd.bindPort')"
          min="0"
          max="65535"
        />
        <template v-if="draft.type !== 'dynamic'">
          <span class="ssh-fp-arrow mono">{{ draft.type === 'local' ? '→' : '←' }}</span>
          <input
            v-model="draft.destHost"
            type="text"
            class="ssh-fp-input"
            :placeholder="t('ssh.fwd.destHost')"
          />
          <input
            v-model.number="draft.destPort"
            type="number"
            class="ssh-fp-input ssh-fp-input-sm"
            :placeholder="t('ssh.fwd.destPort')"
            min="1"
            max="65535"
          />
        </template>
      </div>
      <div class="ssh-fp-add-actions">
        <span class="ssh-fp-hint">{{ t('ssh.fwd.bindHint') }}</span>
        <button class="btn pri sm" :disabled="!canAdd || adding" @click="add">
          <Icon name="plus" style="width: 12px; height: 12px" />
          {{ t('ssh.fwd.add') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Port-forward panel (ADR 0063 P4) — lists + starts/stops tunnels over an open
// SSH connection (connId). Local/dynamic bind 127.0.0.1 by default (invariant 6,
// enforced sidecar-side). Refreshes on the ssh:forward-changed event.
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useSshApi, type SshForwardInfo } from '~/composables/useSshApi'
import { useSidecar, type UnlistenFn } from '~/composables/useSidecar'
import { useToasts } from '~/composables/useToasts'
import type { PortForward } from '~/stores/ssh'

const props = defineProps<{ connId: string }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const api = useSshApi()
const sc = useSidecar()
const { pushToast } = useToasts()

const forwards = ref<SshForwardInfo[]>([])
const adding = ref(false)

type ForwardType = PortForward['type']
const draft = reactive<{
  type: ForwardType
  bindPort: number | null
  destHost: string
  destPort: number | null
}>({ type: 'local', bindPort: null, destHost: '', destPort: null })

const typeOptions = computed(() => [
  { label: t('ssh.forward.local'), value: 'local' },
  { label: t('ssh.forward.remote'), value: 'remote' },
  { label: t('ssh.forward.dynamic'), value: 'dynamic' },
])

const canAdd = computed(() => {
  if (draft.bindPort == null || draft.bindPort < 0) return false
  if (draft.type === 'dynamic') return true
  return !!draft.destHost.trim() && draft.destPort != null && draft.destPort > 0
})

const forwardLabel = (f: SshForwardInfo): string => {
  const fwd = f.forward
  const bind = `${fwd.bindHost ?? '127.0.0.1'}:${fwd.bindPort}`
  if (fwd.type === 'dynamic') return `${bind} (SOCKS)`
  const arrow = fwd.type === 'local' ? '→' : '←'
  return `${bind} ${arrow} ${fwd.destHost}:${fwd.destPort}`
}

async function refresh(): Promise<void> {
  if (!sc.available) return
  try {
    const res = await api.forwardList(props.connId)
    forwards.value = res.forwards
  } catch (err) {
    console.warn('[ssh] forwardList failed', err)
  }
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
  if (!canAdd.value || adding.value) return
  adding.value = true
  try {
    await api.forwardStart(props.connId, buildForward())
    draft.destHost = ''
    draft.destPort = null
    await refresh()
  } catch (err) {
    pushToast(t('ssh.fwd.startFailed', { error: err instanceof Error ? err.message : '' }), 'error')
  } finally {
    adding.value = false
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
        if (evt?.type === 'ssh:forward-changed') void refresh()
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
/* Live surface shown inside the detail's panel area — mirrors SshDetail's terminal
   surface: a hairline-bordered card with a sentence-case head (icon + title +
   count + close). A scoped parent reaches only a child's root, so the head/rows
   are styled locally rather than inherited. */
.ssh-fp-surface {
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
}
.ssh-fp-head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px 12px;
  font-size: 0.8462rem;
  color: var(--textDim);
  border-bottom: 1px solid var(--border);
}
.ssh-fp-head-t {
  flex: 1;
  min-width: 0;
}
.ssh-fp-count {
  font-size: 12px;
  line-height: 1;
  padding: 3px 8px;
  border-radius: 99px;
  color: var(--textDim);
  background: var(--bgHover);
}
.ssh-fp-x {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  flex: 0 0 auto;
}
.ssh-fp-x:hover {
  background: var(--bgHover);
  color: var(--text);
}
.ssh-fp-x:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.ssh-fp-empty {
  padding: 12px 14px;
  font-size: 0.9231rem;
  color: var(--textDim);
}
.ssh-fp-list {
  display: flex;
  flex-direction: column;
}
.ssh-fp-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
}
.ssh-fp-row + .ssh-fp-row {
  border-top: 1px solid var(--border);
}
.ssh-fp-type {
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
.ssh-fp-body {
  flex: 1;
  min-width: 0;
  font-size: 0.9231rem;
  color: var(--text);
  word-break: break-all;
}
/* Status = colored border + dot on a transparent pill; the color comes from an
   inline token (green/danger) and border/dot follow it via currentColor. */
.ssh-fp-status {
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
.ssh-fp-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
  flex: 0 0 auto;
}
.ssh-fp-stop {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  flex: 0 0 auto;
}
.ssh-fp-stop:hover {
  background: var(--bgHover);
  color: var(--text);
}
.ssh-fp-stop:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.ssh-fp-add {
  border-top: 1px solid var(--border);
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ssh-fp-add-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.ssh-fp-type-sel {
  width: 116px;
  flex: 0 0 auto;
}
.ssh-fp-input {
  height: 30px;
  min-width: 0;
  flex: 1 1 90px;
  padding: 0 8px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bgInput);
  color: var(--text);
  font-size: 0.9231rem;
}
.ssh-fp-input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.ssh-fp-input-sm {
  flex: 0 0 84px;
}
.ssh-fp-arrow {
  flex: 0 0 auto;
  color: var(--textDim);
}
.ssh-fp-add-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.ssh-fp-hint {
  font-size: 12px;
  color: var(--textDim);
}
</style>
