<template>
  <div class="ssh-detail">
    <!-- Hero: colored monogram + name + endpoint + status/tags, then a primary
         Connect CTA and icon-only secondary actions. Stays compact so an open
         terminal/SFTP/forward panel below gets the full remaining height. -->
    <header class="ssh-hero">
      <span class="ssh-mono" :style="monoStyle">{{ initial }}</span>
      <div class="ssh-hero-main">
        <div class="ssh-hero-name">{{ host.name || host.host }}</div>
        <div class="ssh-hero-endpoint mono">{{ endpoint }}</div>
        <div class="ssh-hero-meta">
          <span class="ssh-pill" :style="{ color: statusColor, borderColor: statusColor }">
            <span class="ssh-pill-dot" :style="{ background: statusColor }" />
            {{ statusLabel }}
          </span>
          <span class="ssh-chip">{{ authMethodLabel }}</span>
          <span v-if="folder" class="ssh-chip ssh-chip-folder">
            <Icon name="folder" style="width: 11px; height: 11px" />
            {{ folder }}
          </span>
          <span v-for="tag in tags" :key="tag" class="ssh-chip">{{ tag }}</span>
          <span
            v-if="host.options?.strictHostKey === false"
            class="ssh-chip ssh-chip-warn"
            :title="t('ssh.detail.hostKeyOffHint')"
          >
            <Icon name="alert" style="width: 11px; height: 11px" />
            {{ t('ssh.detail.hostKeyOff') }}
          </span>
        </div>
      </div>
      <div class="ssh-hero-actions">
        <button
          class="ssh-connect"
          :class="{ on: showTerminal }"
          :title="t('ssh.detail.connect')"
          @click="emit('connect')"
        >
          <Icon name="play" style="width: 13px; height: 13px" />
          {{ t('ssh.detail.connect') }}
        </button>
        <button
          class="ssh-act"
          :title="t('ssh.detail.test')"
          :aria-label="t('ssh.detail.test')"
          @click="emit('test')"
        >
          <Icon name="refresh" style="width: 14px; height: 14px" />
        </button>
        <button
          class="ssh-act"
          :class="{ on: showSftp }"
          :title="t('ssh.detail.sftp')"
          :aria-label="t('ssh.detail.sftp')"
          @click="toggleSftp"
        >
          <Icon name="folder" style="width: 14px; height: 14px" />
        </button>
        <button
          class="ssh-act"
          :class="{ on: showForward }"
          :title="t('ssh.detail.forward')"
          :aria-label="t('ssh.detail.forward')"
          @click="toggleForward"
        >
          <Icon name="move" style="width: 14px; height: 14px" />
        </button>
        <span class="ssh-act-sep" />
        <button
          class="ssh-act"
          :title="t('ssh.detail.edit')"
          :aria-label="t('ssh.detail.edit')"
          @click="emit('edit')"
        >
          <Icon name="edit" style="width: 14px; height: 14px" />
        </button>
        <button
          class="ssh-act ssh-act-danger"
          :title="t('ssh.detail.delete')"
          :aria-label="t('ssh.detail.delete')"
          @click="emit('delete')"
        >
          <Icon name="trash" style="width: 14px; height: 14px" />
        </button>
      </div>
    </header>

    <!-- Body: a live surface (terminal / SFTP / forward) takes over full height
         when open; otherwise the host info list scrolls. -->
    <div v-if="hasPanel" class="ssh-panels">
      <section v-if="showTerminal" class="ssh-surface ssh-surface-grow">
        <div class="ssh-surface-head">
          <Icon name="ssh" style="width: 13px; height: 13px" />
          {{ t('ssh.terminal.title') }}
          <span class="ssh-surface-sub mono">{{ endpoint }}</span>
          <button
            class="ssh-surface-x"
            :title="t('ssh.terminal.close')"
            :aria-label="t('ssh.terminal.close')"
            @click="store.closeTerminal()"
          >
            <Icon name="x" style="width: 13px; height: 13px" />
          </button>
        </div>
        <div class="ssh-surface-body ssh-term-body">
          <SshTerminal :key="host.id" :host-id="host.id" />
        </div>
      </section>

      <SshSftpBrowser v-if="showSftp && connId" :conn-id="connId" @close="store.closeSftp()" />
      <ConnectGate
        v-else-if="showSftp"
        @connect="store.openTerminal(host.id)"
        @close="store.closeSftp()"
      />

      <SshForwardPanel
        v-if="showForward && connId"
        :conn-id="connId"
        @close="store.closeForward()"
      />
      <ConnectGate
        v-else-if="showForward"
        @connect="store.openTerminal(host.id)"
        @close="store.closeForward()"
      />
    </div>

    <div v-else class="ssh-info">
      <div class="ssh-sec-h">{{ t('ssh.section.connection') }}</div>
      <dl class="ssh-kv">
        <div class="ssh-kv-row">
          <dt>{{ t('ssh.editor.host') }}</dt>
          <dd class="mono">{{ endpoint }}</dd>
        </div>
        <div class="ssh-kv-row">
          <dt>{{ t('ssh.detail.authMethod') }}</dt>
          <dd>{{ authMethodLabel }}</dd>
        </div>
        <div v-if="host.authMethod === 'key'" class="ssh-kv-row">
          <dt>{{ t('ssh.detail.identity') }}</dt>
          <dd>
            <template v-if="identity">
              <span>{{ identity.name }}</span>
              <span v-if="identity.hasPassphrase" class="ssh-chip ssh-chip-accent">
                {{ t('ssh.detail.passphrase') }}
              </span>
              <button
                class="ssh-linkbtn"
                :title="t('ssh.identity.edit')"
                @click="emit('edit-identity', identity.id)"
              >
                <Icon name="edit" style="width: 12px; height: 12px" />
              </button>
            </template>
            <button v-else class="ssh-linkbtn ssh-linkbtn-text" @click="emit('new-identity')">
              <Icon name="plus" style="width: 12px; height: 12px" />
              {{ t('ssh.identity.new') }}
            </button>
          </dd>
        </div>
        <div v-if="host.authMethod === 'key' && identity?.keyPath" class="ssh-kv-row">
          <dt>{{ t('ssh.detail.keyPath') }}</dt>
          <dd class="mono">{{ identity.keyPath }}</dd>
        </div>
        <div v-if="jumpHostName" class="ssh-kv-row">
          <dt>{{ t('ssh.detail.jumpHost') }}</dt>
          <dd>{{ jumpHostName }}</dd>
        </div>
        <div class="ssh-kv-row">
          <dt>{{ t('ssh.detail.lastConnected') }}</dt>
          <dd>{{ lastConnectedRelative }}</dd>
        </div>
      </dl>

      <div v-if="connectionError" class="ssh-err">
        <Icon name="alert" style="width: 13px; height: 13px; flex: 0 0 auto; margin-top: 2px" />
        <span class="mono">{{ connectionError }}</span>
      </div>

      <template v-if="portForwards.length">
        <div class="ssh-sec-h">{{ t('ssh.section.forwards') }}</div>
        <div class="ssh-fwds">
          <div v-for="fwd in portForwards" :key="fwd.id" class="ssh-fwd">
            <span class="ssh-chip">{{ t('ssh.forward.' + fwd.type) }}</span>
            <span class="mono ssh-fwd-body">{{ forwardLabel(fwd) }}</span>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
// SSH host detail (ADR 0063) — Termius-inspired: a compact hero (colored monogram
// + name + endpoint + status/tags + primary Connect) over EITHER a full-height
// live surface (terminal / SFTP / forward) when one is open, OR a flat host-info
// list. Connect is driven from the page (openTerminal) so the card quick-action
// and this button share one path; SFTP/Forward toggle here. Nothing reads a secret.
import { computed } from 'vue'
import SshTerminal from '~/components/ssh/SshTerminal.vue'
import SshSftpBrowser from '~/components/ssh/SshSftpBrowser.vue'
import SshForwardPanel from '~/components/ssh/SshForwardPanel.vue'
import ConnectGate from '~/components/ssh/SshConnectGate.vue'
import { useSshDetail } from '~/composables/useSshDetail'
import { hostAccent, useSshStore, type PortForward, type SshHost } from '~/stores/ssh'

const props = defineProps<{ host: SshHost }>()

const emit = defineEmits<{
  edit: []
  delete: []
  connect: []
  sftp: []
  forward: []
  test: []
  'edit-identity': [id: string]
  'new-identity': []
}>()

const { t } = useI18n()
const store = useSshStore()

const showTerminal = computed(() => store.terminalHostId === props.host.id)
const showSftp = computed(() => store.sftpHostId === props.host.id)
const showForward = computed(() => store.forwardHostId === props.host.id)
const hasPanel = computed(() => showTerminal.value || showSftp.value || showForward.value)
const connId = computed(() => store.liveConnByHost[props.host.id] ?? null)
const toggleSftp = () => (showSftp.value ? store.closeSftp() : store.openSftp(props.host.id))
const toggleForward = () =>
  showForward.value ? store.closeForward() : store.openForward(props.host.id)

const {
  host,
  statusColor,
  statusLabel,
  endpoint,
  authMethodLabel,
  identity,
  jumpHostName,
  portForwards,
  tags,
  folder,
  connectionError,
  lastConnectedRelative,
} = useSshDetail(() => props.host)

const initial = computed(() => (props.host.name || props.host.host || '?').charAt(0).toUpperCase())
const monoStyle = computed(() => {
  const a = hostAccent(props.host.folder || props.host.name || props.host.host)
  return { background: a.bg, color: a.fg, border: `1px solid ${a.border}` }
})

const forwardLabel = (fwd: PortForward): string => {
  const bind = `${fwd.bindHost ?? '127.0.0.1'}:${fwd.bindPort}`
  if (fwd.type === 'dynamic') return `${bind} (SOCKS)`
  const arrow = fwd.type === 'local' ? '→' : '←'
  return `${bind} ${arrow} ${fwd.destHost}:${fwd.destPort}`
}
</script>

<style scoped>
.ssh-detail {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}

/* ── Hero ──────────────────────────────────────────────────────────────────── */
.ssh-hero {
  flex: 0 0 auto;
  display: flex;
  align-items: flex-start;
  gap: 13px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--border);
}
.ssh-mono {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  font-size: 1.15rem;
  font-family: var(--code);
  font-weight: 650;
  flex: 0 0 auto;
}
.ssh-hero-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ssh-hero-name {
  font-size: 1.15rem;
  font-weight: 650;
  color: var(--text);
  word-break: break-word;
}
.ssh-hero-endpoint {
  font-size: 0.9231rem;
  color: var(--textDim);
  word-break: break-all;
}
.ssh-hero-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 4px;
}
.ssh-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-family: var(--code);
  line-height: 1;
  padding: 3px 8px;
  border: 1px solid;
  border-radius: 99px;
  background: transparent;
}
.ssh-pill-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}
.ssh-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  line-height: 1;
  padding: 3px 8px;
  border-radius: 99px;
  color: var(--textDim);
  background: var(--bgHover);
}
.ssh-chip-folder {
  font-family: var(--code);
}
.ssh-chip-accent {
  color: var(--accent);
  background: var(--accentDim);
}
.ssh-chip-warn {
  color: var(--amber, var(--danger));
  background: transparent;
  border: 1px solid var(--amber, var(--danger));
}
.ssh-hero-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.ssh-connect {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 13px;
  margin-right: 4px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: var(--accent);
  color: var(--accentText, #fff);
  font-size: 0.9231rem;
  font-weight: 550;
  cursor: pointer;
  transition:
    filter 0.12s,
    background 0.12s;
}
.ssh-connect:hover {
  filter: brightness(1.08);
}
.ssh-connect.on {
  background: var(--accentDim);
  color: var(--accent);
  border-color: var(--accentBorder);
}
.ssh-connect:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.ssh-act {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  transition:
    background 0.12s,
    color 0.12s;
}
.ssh-act:hover {
  background: var(--bgHover);
  color: var(--text);
}
.ssh-act.on {
  background: var(--accentDim);
  color: var(--accent);
}
.ssh-act.ssh-act-danger:hover {
  background: var(--dangerDim, var(--bgHover));
  color: var(--danger);
}
.ssh-act:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.ssh-act-sep {
  width: 1px;
  height: 18px;
  margin: 0 3px;
  background: var(--border);
}

/* ── Info list (no panel) ──────────────────────────────────────────────────── */
.ssh-info {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 18px;
}
.ssh-sec-h {
  font-size: 0.8462rem;
  font-weight: 600;
  color: var(--textDim);
  margin: 0 0 6px;
}
.ssh-sec-h + .ssh-kv,
.ssh-sec-h + .ssh-fwds {
  margin-bottom: 22px;
}
.ssh-kv {
  margin: 0 0 22px;
}
.ssh-kv-row {
  display: flex;
  gap: 16px;
  padding: 8px 0;
  font-size: 0.9231rem;
}
.ssh-kv-row + .ssh-kv-row {
  border-top: 1px solid var(--border);
}
.ssh-kv-row dt {
  flex: 0 0 auto;
  width: 116px;
  color: var(--textDim);
}
.ssh-kv-row dd {
  flex: 1;
  min-width: 0;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  color: var(--text);
  word-break: break-word;
}
.ssh-linkbtn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
}
.ssh-linkbtn:hover {
  background: var(--bgHover);
  color: var(--text);
}
.ssh-linkbtn-text {
  color: var(--accent);
}
.ssh-err {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  margin-bottom: 22px;
  border-radius: 10px;
  font-size: 0.8846rem;
  color: var(--danger);
  background: var(--dangerDim);
  border: 1px solid var(--dangerBorder);
}
.ssh-fwds {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}
.ssh-fwd {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
}
.ssh-fwd + .ssh-fwd {
  border-top: 1px solid var(--border);
}
.ssh-fwd-body {
  font-size: 0.9231rem;
  color: var(--text);
  word-break: break-all;
}

/* ── Live surfaces (terminal / SFTP / forward) ─────────────────────────────── */
.ssh-panels {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 18px 18px;
  overflow: hidden;
}
.ssh-surface {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
}
.ssh-surface-grow {
  flex: 1;
}
.ssh-surface-head {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: 0 0 auto;
  padding: 9px 12px;
  color: var(--textDim);
  border-bottom: 1px solid var(--border);
  font-size: 0.8462rem;
}
.ssh-surface-sub {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ssh-surface-x {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  flex: 0 0 auto;
}
.ssh-surface-x:hover {
  background: var(--bgHover);
  color: var(--text);
}
.ssh-term-body {
  flex: 1;
  min-height: 0;
  background: var(--bg);
}
</style>
