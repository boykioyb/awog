<template>
  <div class="sshx">
    <!-- Top tab strip: a persistent Hosts tab + one tab per open terminal + a
         trailing "＋" that focuses the Hosts tab. -->
    <div class="sshx-tabs" role="tablist" :aria-label="t('ssh.nav.hosts')">
      <button
        class="sshx-tab sshx-tab-hosts"
        :class="{ active: store.activeTab === 'hosts' }"
        role="tab"
        :aria-selected="store.activeTab === 'hosts'"
        :title="t('ssh.nav.hosts')"
        @click="store.setActiveTab('hosts')"
      >
        <Icon name="conn" style="width: 14px; height: 14px" />
        <span class="sshx-tab-label">{{ t('ssh.nav.hosts') }}</span>
      </button>

      <button
        v-for="tab in store.terminalTabs"
        :key="tab.id"
        class="sshx-tab"
        :class="{ active: store.activeTab === tab.id }"
        role="tab"
        :aria-selected="store.activeTab === tab.id"
        :title="tabLabels[tab.id]"
        @click="store.setActiveTab(tab.id)"
      >
        <span class="sshx-tab-dot" :style="tabDot(tab.hostId)" />
        <span class="sshx-tab-label">{{ tabLabels[tab.id] }}</span>
        <span
          class="sshx-tab-x"
          role="button"
          :title="t('ssh.terminal.close')"
          :aria-label="t('ssh.terminal.close')"
          @click.stop="store.closeTerminalTab(tab.id)"
        >
          <Icon name="x" style="width: 12px; height: 12px" />
        </span>
      </button>

      <button
        class="sshx-tab-add"
        :title="t('ssh.tab.new')"
        :aria-label="t('ssh.tab.new')"
        @click="store.setSection('hosts')"
      >
        <Icon name="plus" style="width: 14px; height: 14px" />
      </button>

      <button
        class="sshx-appearance-toggle"
        :class="{ on: appearanceOpen }"
        :title="t('ssh.appearance.title')"
        :aria-label="t('ssh.appearance.title')"
        :aria-pressed="appearanceOpen"
        @click="appearanceOpen = !appearanceOpen"
      >
        <Icon name="palette" style="width: 15px; height: 15px" />
      </button>
    </div>

    <!-- Stage: the Hosts management view + every terminal tab live here, overlaid;
         only the active one is shown. Terminal tabs stay MOUNTED (v-show, never
         v-if) so switching tabs never disconnects a live SSH shell. -->
    <div class="sshx-stage">
      <div v-show="store.activeTab === 'hosts'" class="sshx-manage">
        <SshSidebar />
        <div class="sshx-section">
          <SshHostGrid
            v-if="store.sshSection === 'hosts'"
            :hosts="hosts"
            @connect="(h) => emit('connect', h)"
            @menu="(e, h) => emit('menu', e, h)"
            @new="emit('new-host')"
            @import="emit('import')"
          />
          <SshKeychainSection
            v-else-if="store.sshSection === 'keychain'"
            :identities="identities"
            @new="emit('new-identity')"
            @edit="(id) => emit('edit-identity', id)"
            @delete="(id) => emit('delete-identity', id)"
          />
          <SshForwardingSection v-else-if="store.sshSection === 'forwarding'" />
          <SshEmptyState
            v-else-if="store.sshSection === 'known-hosts'"
            icon="folder"
            :title="t('ssh.nav.knownHosts')"
            :body="t('ssh.placeholder.knownHosts')"
          />
          <SshSnippetsSection v-else-if="store.sshSection === 'snippets'" />
          <SshEmptyState
            v-else
            icon="act"
            :title="t('ssh.nav.logs')"
            :body="t('ssh.placeholder.logs')"
          />
        </div>
      </div>

      <div
        v-for="tab in store.terminalTabs"
        v-show="store.activeTab === tab.id"
        :key="tab.id"
        class="sshx-term"
      >
        <!-- Per-tab toolbar: host name + user@host, plus an SFTP toggle. The tab's
             close lives on the top tab bar, so it's not repeated here. -->
        <div class="sshx-tbar">
          <span class="sshx-tbar-dot" :style="tabDot(tab.hostId)" />
          <span class="sshx-tbar-name">{{ tabHostName(tab.hostId) }}</span>
          <span class="sshx-tbar-sub mono">{{ tabUserHost(tab.hostId) }}</span>
          <div class="sshx-tbar-actions">
            <button
              class="sshx-tbar-btn"
              :class="{ on: sessionOpen[tab.id] }"
              :title="t('ssh.session.copilotTitle')"
              :aria-label="t('ssh.session.copilotTitle')"
              @click="toggleSession(tab.id)"
            >
              <Icon name="sessions" style="width: 13px; height: 13px" />
              <span>{{ t('ssh.tterm.session') }}</span>
            </button>
            <button
              class="sshx-tbar-btn"
              :class="{ on: sftpOpen[tab.id] }"
              :disabled="!store.connIdForHost(tab.hostId) && !sftpOpen[tab.id]"
              :title="
                store.connIdForHost(tab.hostId)
                  ? t('ssh.section.sftp')
                  : t('ssh.tterm.connectFirst')
              "
              :aria-label="t('ssh.section.sftp')"
              @click="toggleSftp(tab.id)"
            >
              <Icon name="folder" style="width: 13px; height: 13px" />
              <span>{{ t('ssh.tterm.sftp') }}</span>
            </button>
          </div>
        </div>

        <!-- Body: terminal fills alone, or splits terminal (top ~58%) + SFTP
             browser (bottom ~42%) when toggled. The terminal stays MOUNTED the
             whole time — only the shell container's flex-basis changes, which its
             ResizeObserver picks up to refit (never v-if on SshTerminal). -->
        <div class="sshx-tbody" :class="{ split: sftpOpen[tab.id] || sessionOpen[tab.id] }">
          <div class="sshx-tshell">
            <SshTerminal :host-id="tab.hostId" :visible="store.activeTab === tab.id" />
          </div>
          <template v-if="sftpOpen[tab.id]">
            <div
              class="sshx-tsplit"
              role="separator"
              aria-orientation="vertical"
              :title="t('ssh.tterm.resize')"
              @pointerdown="startResize(tab.id, $event)"
            />
            <div class="sshx-tside" :style="sideStyle(tab.id)">
              <SshSftpBrowser
                v-if="store.connIdForHost(tab.hostId)"
                :conn-id="store.connIdForHost(tab.hostId) ?? ''"
                @close="sftpOpen[tab.id] = false"
              />
              <div v-else class="sshx-tsftp-note">{{ t('ssh.tterm.connectToBrowse') }}</div>
            </div>
          </template>
          <!-- Co-pilot session docked on the RIGHT (mutually exclusive with SFTP). The
               agent drives the terminal on the left via ssh_terminal_run. -->
          <template v-else-if="sessionOpen[tab.id]">
            <div
              class="sshx-tsplit"
              role="separator"
              aria-orientation="vertical"
              :title="t('ssh.tterm.resize')"
              @pointerdown="startResize(tab.id, $event)"
            />
            <div class="sshx-tside" :style="sideStyle(tab.id)">
              <SshSessionPanel
                :host-id="tab.hostId"
                :visible="store.activeTab === tab.id"
                @close="sessionOpen[tab.id] = false"
              />
            </div>
          </template>
        </div>
      </div>

      <!-- Right-docked appearance drawer, overlaid on the stage (doesn't push the
           terminal). Changes apply live to every open xterm via the shared store. -->
      <SshAppearancePanel v-if="appearanceOpen" @close="appearanceOpen = false" />
    </div>
  </div>
</template>

<script setup lang="ts">
// Termius-style SSH workspace shell (ADR 0063 P6). A top tab bar drives a stage
// that holds the Hosts management view (left section nav + section content) plus
// one full-screen terminal per open connection. All terminal tabs stay mounted
// (v-show) so switching tabs never tears down a live SSH shell — only
// closeTerminalTab unmounts one (which intentionally disconnects it). Host/identity
// mutations bubble to the page via events; tab + section state lives in the store.
import { computed, reactive, ref, watch } from 'vue'
import SshAppearancePanel from '~/components/ssh/SshAppearancePanel.vue'
import SshEmptyState from '~/components/ssh/SshEmptyState.vue'
import SshForwardingSection from '~/components/ssh/SshForwardingSection.vue'
import SshHostGrid from '~/components/ssh/SshHostGrid.vue'
import SshKeychainSection from '~/components/ssh/SshKeychainSection.vue'
import SshSessionPanel from '~/components/ssh/SshSessionPanel.vue'
import SshSftpBrowser from '~/components/ssh/SshSftpBrowser.vue'
import SshSnippetsSection from '~/components/ssh/SshSnippetsSection.vue'
import SshSidebar from '~/components/ssh/SshSidebar.vue'
import SshTerminal from '~/components/ssh/SshTerminal.vue'
import { hostAccent, useSshStore, type SshHost, type SshIdentity } from '~/stores/ssh'

defineProps<{ hosts: SshHost[]; identities: SshIdentity[] }>()

const emit = defineEmits<{
  connect: [host: SshHost]
  menu: [event: MouseEvent, host: SshHost]
  'new-host': []
  import: []
  'new-identity': []
  'edit-identity': [id: string]
  'delete-identity': [id: string]
}>()

const { t } = useI18n()
const store = useSshStore()

// Terminal appearance drawer visibility — local to this shell (renderer-only).
const appearanceOpen = ref(false)

// One top-tab per host, so the label is just the host name (multiple shells to
// the same host live in the WorkspaceTerminal's own inner tab strip).
const tabLabels = computed<Record<string, string>>(() => {
  const out: Record<string, string> = {}
  for (const tab of store.terminalTabs) {
    const host = store.hostById(tab.hostId)
    out[tab.id] = host?.name || host?.host || 'ssh'
  }
  return out
})

const tabDot = (hostId: string) => {
  const host = store.hostById(hostId)
  const a = hostAccent(host?.folder || host?.name || host?.host || hostId)
  return { background: a.fg }
}

const tabHostName = (hostId: string): string => {
  const host = store.hostById(hostId)
  return host?.name || host?.host || 'ssh'
}
const tabUserHost = (hostId: string): string => {
  const host = store.hostById(hostId)
  return host ? `${host.user}@${host.host}` : ''
}

// SFTP split state is PER terminal tab (keyed by tab id) and local to the shell —
// toggling it only resizes the split, never unmounts the live SshTerminal. Pruned
// when a tab closes so the map can't leak stale keys.
const sftpOpen = reactive<Record<string, boolean>>({})
// Co-pilot session split state — PER tab, mutually exclusive with SFTP (both dock
// on the right). Local to the shell; the session itself lives in the sessions store.
const sessionOpen = reactive<Record<string, boolean>>({})
const toggleSftp = (tabId: string): void => {
  sftpOpen[tabId] = !sftpOpen[tabId]
  if (sftpOpen[tabId]) sessionOpen[tabId] = false
}
const toggleSession = (tabId: string): void => {
  sessionOpen[tabId] = !sessionOpen[tabId]
  if (sessionOpen[tabId]) sftpOpen[tabId] = false
}

// Right-panel (SFTP / session) width per tab, in px — resizable by dragging the
// splitter. Default ~40% of a typical stage; clamped so neither side collapses.
const SIDE_DEFAULT = 460
// Min width so the reused session composer + step-action buttons don't overflow/wrap
// awkwardly in the dock; terminal keeps at least TERM_MIN.
const SIDE_MIN = 360
const TERM_MIN = 320
const sideW = reactive<Record<string, number>>({})
const sideStyle = (tabId: string) => ({ flexBasis: `${sideW[tabId] ?? SIDE_DEFAULT}px` })
const startResize = (tabId: string, e: PointerEvent): void => {
  const splitter = e.currentTarget as HTMLElement
  const body = splitter.parentElement
  if (!body) return
  e.preventDefault()
  splitter.setPointerCapture(e.pointerId)
  const onMove = (ev: PointerEvent): void => {
    const rect = body.getBoundingClientRect()
    // Right panel width = distance from the pointer to the body's right edge.
    const next = rect.right - ev.clientX
    const max = rect.width - TERM_MIN
    sideW[tabId] = Math.max(SIDE_MIN, Math.min(next, max))
  }
  const onUp = (ev: PointerEvent): void => {
    splitter.releasePointerCapture(ev.pointerId)
    splitter.removeEventListener('pointermove', onMove)
    splitter.removeEventListener('pointerup', onUp)
  }
  splitter.addEventListener('pointermove', onMove)
  splitter.addEventListener('pointerup', onUp)
}
watch(
  () => store.terminalTabs.map((tab) => tab.id),
  (ids) => {
    for (const key of Object.keys(sftpOpen)) if (!ids.includes(key)) delete sftpOpen[key]
    for (const key of Object.keys(sessionOpen)) if (!ids.includes(key)) delete sessionOpen[key]
  },
)
</script>

<style scoped>
.sshx {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* ── Top tab strip ─────────────────────────────────────────────────────────── */
.sshx-tabs {
  display: flex;
  align-items: center;
  gap: 3px;
  flex: 0 0 auto;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
}
.sshx-tab {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  flex: 0 0 auto;
  max-width: 220px;
  padding: 6px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--textDim);
  font-size: 0.9231rem;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background 0.12s,
    color 0.12s;
}
.sshx-tab:hover {
  background: var(--bgHover);
  color: var(--text);
}
.sshx-tab.active {
  background: var(--bgActive);
  color: var(--accent);
}
.sshx-tab-label {
  overflow: hidden;
  text-overflow: ellipsis;
}
.sshx-tab-dot {
  width: 9px;
  height: 9px;
  border-radius: 3px;
  flex: 0 0 auto;
}
.sshx-tab-x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 17px;
  height: 17px;
  border-radius: 5px;
  color: var(--textDim);
  flex: 0 0 auto;
}
.sshx-tab-x:hover {
  background: var(--dangerBg, var(--bgHover));
  color: var(--danger);
}
.sshx-tab-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  transition:
    background 0.12s,
    color 0.12s;
}
.sshx-tab-add:hover {
  background: var(--bgHover);
  color: var(--text);
}
/* Appearance toggle pinned to the right end of the tab strip. */
.sshx-appearance-toggle {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  transition:
    background 0.12s,
    color 0.12s,
    border-color 0.12s;
}
.sshx-appearance-toggle:hover {
  background: var(--bgHover);
  color: var(--text);
}
.sshx-appearance-toggle.on {
  background: var(--accentDim);
  color: var(--accent);
  border-color: var(--accentBorder);
}
.sshx-tab:focus-visible,
.sshx-tab-add:focus-visible,
.sshx-appearance-toggle:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

/* ── Stage ─────────────────────────────────────────────────────────────────── */
.sshx-stage {
  position: relative;
  flex: 1;
  min-height: 0;
}
/* Both the manage view and each terminal tab are absolutely stacked so the active
   one always gets the full stage height (terminals need a definite height). */
.sshx-manage,
.sshx-term {
  position: absolute;
  inset: 0;
}
.sshx-manage {
  display: flex;
  min-height: 0;
  overflow: hidden;
}
.sshx-section {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
/* A flex column: a slim per-tab toolbar over the body. The body hands the
   WorkspaceTerminal (`.wsterm`, height:100%) a definite-height container in both
   states (fills alone, or a 58% flex-basis when split) so it always refits. */
.sshx-term {
  background: var(--bg);
  display: flex;
  flex-direction: column;
}
.sshx-tbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 12px;
  border-bottom: 1px solid var(--border);
}
.sshx-tbar-dot {
  width: 9px;
  height: 9px;
  border-radius: 3px;
  flex: 0 0 auto;
}
.sshx-tbar-name {
  font-size: 0.9231rem;
  font-weight: 550;
  color: var(--text);
  flex: 0 0 auto;
}
.sshx-tbar-sub {
  font-size: 0.8462rem;
  color: var(--textDim);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sshx-tbar-actions {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}
.sshx-tbar-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: transparent;
  color: var(--textDim);
  font-size: 0.8846rem;
  cursor: pointer;
  transition:
    background 0.12s,
    color 0.12s,
    border-color 0.12s;
}
.sshx-tbar-btn:hover:not(:disabled) {
  border-color: var(--borderStrong);
  color: var(--text);
}
.sshx-tbar-btn.on {
  background: var(--accentDim);
  color: var(--accent);
  border-color: var(--accentBorder);
}
.sshx-tbar-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.sshx-tbar-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.sshx-tbody {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
/* Split = terminal LEFT (grows), SFTP browser / co-pilot session RIGHT (fixed px
   width from sideStyle, drag the splitter to resize). */
.sshx-tbody.split {
  flex-direction: row;
}
.sshx-tshell {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}
/* Draggable vertical splitter: a 1px hairline centered in a 7px grab zone. */
.sshx-tsplit {
  flex: 0 0 auto;
  width: 7px;
  align-self: stretch;
  cursor: col-resize;
  background: linear-gradient(var(--border), var(--border)) center / 1px 100% no-repeat;
  transition: background-color 0.12s;
}
.sshx-tsplit:hover {
  background: linear-gradient(var(--accent), var(--accent)) center / 1px 100% no-repeat;
}
.sshx-tside {
  flex: 0 0 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.sshx-tsftp-note {
  padding: 24px 12px;
  text-align: center;
  font-size: 0.9231rem;
  color: var(--textDim);
}
</style>
