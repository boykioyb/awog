<template>
  <div class="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
    <!-- Top tab strip: a persistent Hosts tab + one tab per open terminal + a
         trailing "＋" that focuses the Hosts tab. -->
    <div
      class="flex shrink-0 items-center gap-0.5 overflow-x-auto px-2 py-1.5"
      role="tablist"
      :aria-label="t('ssh.nav.hosts')"
    >
      <Button
        variant="ghost"
        size="sm"
        :class="[TAB, { [TAB_ON]: store.activeTab === 'hosts' }]"
        role="tab"
        :aria-selected="store.activeTab === 'hosts'"
        :title="t('ssh.nav.hosts')"
        @click="store.setActiveTab('hosts')"
      >
        <Icon name="conn" />
        <span class="truncate">{{ t('ssh.nav.hosts') }}</span>
      </Button>

      <Button
        v-for="tab in store.terminalTabs"
        :key="tab.id"
        variant="ghost"
        size="sm"
        :class="[TAB, { [TAB_ON]: store.activeTab === tab.id }]"
        role="tab"
        :aria-selected="store.activeTab === tab.id"
        :title="tabLabels[tab.id]"
        @click="store.setActiveTab(tab.id)"
      >
        <!-- Màu chấm theo host (HSL dữ liệu, không phải token theme). -->
        <span class="size-2.25 shrink-0 rounded-full" :style="tabDot(tab.hostId)" />
        <span class="truncate">{{ tabLabels[tab.id] }}</span>
        <!-- span role=button: không được lồng nút trong nút (tab đã là nút). -->
        <span
          class="inline-flex size-4.5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          role="button"
          :title="t('ssh.terminal.close')"
          :aria-label="t('ssh.terminal.close')"
          @click.stop="store.closeTerminalTab(tab.id)"
        >
          <Icon name="x" />
        </span>
      </Button>

      <Button
        variant="ghost"
        size="iconSm"
        class="shrink-0 text-muted-foreground"
        :title="t('ssh.tab.new')"
        :aria-label="t('ssh.tab.new')"
        @click="store.setSection('hosts')"
      >
        <Icon name="plus" />
      </Button>

      <!-- Appearance toggle ghim ở mép phải dải tab. -->
      <Button
        variant="ghost"
        size="iconSm"
        class="ml-auto shrink-0 border border-transparent text-muted-foreground"
        :class="{
          'border-selected-border bg-selected text-primary hover:bg-selected hover:text-primary':
            appearanceOpen,
        }"
        :title="t('ssh.appearance.title')"
        :aria-label="t('ssh.appearance.title')"
        :aria-pressed="appearanceOpen"
        @click="appearanceOpen = !appearanceOpen"
      >
        <Icon name="palette" class="size-4!" />
      </Button>
    </div>
    <Separator />

    <!-- Stage: the Hosts management view + every terminal tab live here, overlaid;
         only the active one is shown. Terminal tabs stay MOUNTED (v-show, never
         v-if) so switching tabs never disconnects a live SSH shell. -->
    <div class="relative min-h-0 flex-1">
      <!-- Manage view và từng tab terminal xếp chồng absolute để tab đang hiện luôn có
           đủ chiều cao stage (terminal cần chiều cao xác định). -->
      <div
        v-show="store.activeTab === 'hosts'"
        class="absolute inset-0 flex min-h-0 overflow-hidden"
      >
        <SshSidebar />
        <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
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
          <VpnSection v-else-if="store.sshSection === 'vpn'" />
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
        class="absolute inset-0 flex flex-col bg-background"
      >
        <!-- Per-tab toolbar: host name + user@host, plus an SFTP toggle. The tab's
             close lives on the top tab bar, so it's not repeated here. -->
        <div class="flex shrink-0 items-center gap-2 px-3 py-1.5">
          <span class="size-2.25 shrink-0 rounded-full" :style="tabDot(tab.hostId)" />
          <span class="shrink-0 text-sm font-medium text-foreground">
            {{ tabHostName(tab.hostId) }}
          </span>
          <span class="min-w-0 truncate font-mono text-xs text-muted-foreground">
            {{ tabUserHost(tab.hostId) }}
          </span>
          <div class="ml-auto inline-flex shrink-0 items-center gap-1.5">
            <Button
              variant="outline"
              size="xs"
              class="gap-1.5 px-2.5 text-sm text-muted-foreground"
              :class="{ [DOCK_ON]: activeDock[tab.id] === 'snippets' }"
              :title="t('ssh.nav.snippets')"
              :aria-label="t('ssh.nav.snippets')"
              @click="toggleDock(tab.id, 'snippets')"
            >
              <Icon name="commands" />
              <span>{{ t('ssh.nav.snippets') }}</span>
            </Button>
            <Button
              variant="outline"
              size="xs"
              class="gap-1.5 px-2.5 text-sm text-muted-foreground"
              :class="{ [DOCK_ON]: activeDock[tab.id] === 'session' }"
              :title="t('ssh.session.copilotTitle')"
              :aria-label="t('ssh.session.copilotTitle')"
              @click="toggleDock(tab.id, 'session')"
            >
              <Icon name="sessions" />
              <span>{{ t('ssh.tterm.session') }}</span>
            </Button>
            <Button
              variant="outline"
              size="xs"
              class="gap-1.5 px-2.5 text-sm text-muted-foreground disabled:pointer-events-auto disabled:cursor-not-allowed"
              :class="{ [DOCK_ON]: activeDock[tab.id] === 'sftp' }"
              :disabled="!store.connIdForHost(tab.hostId) && activeDock[tab.id] !== 'sftp'"
              :title="
                store.connIdForHost(tab.hostId)
                  ? t('ssh.section.sftp')
                  : t('ssh.tterm.connectFirst')
              "
              :aria-label="t('ssh.section.sftp')"
              @click="toggleDock(tab.id, 'sftp')"
            >
              <Icon name="folder" />
              <span>{{ t('ssh.tterm.sftp') }}</span>
            </Button>
          </div>
        </div>

        <Separator />

        <!-- Body: terminal fills alone, or splits terminal (top ~58%) + SFTP
             browser (bottom ~42%) when toggled. The terminal stays MOUNTED the
             whole time — only the shell container's flex-basis changes, which its
             ResizeObserver picks up to refit (never v-if on SshTerminal). -->
        <div class="flex min-h-0 flex-1" :class="activeDock[tab.id] ? 'flex-row' : 'flex-col'">
          <div class="min-h-0 min-w-0 flex-auto">
            <SshTerminal
              :host-id="tab.hostId"
              :visible="store.activeTab === tab.id"
              @conn="(id) => (termConn[tab.id] = id)"
            />
          </div>
          <!-- One of three right-docked panels (mutually exclusive): SFTP browser,
               co-pilot session, or the snippets library. Each shares the splitter. -->
          <template v-if="activeDock[tab.id]">
            <!-- Splitter kéo dọc: hairline 1px giữa vùng nắm 7px. -->
            <div
              class="group flex w-1.75 shrink-0 cursor-col-resize justify-center self-stretch"
              role="separator"
              aria-orientation="vertical"
              :title="t('ssh.tterm.resize')"
              @pointerdown="startResize(tab.id, $event)"
            >
              <div class="w-px bg-border transition-colors group-hover:bg-primary" />
            </div>
            <div class="min-h-0 min-w-0 shrink-0 grow-0 overflow-hidden" :style="sideStyle(tab.id)">
              <template v-if="activeDock[tab.id] === 'sftp'">
                <SshSftpBrowser
                  v-if="store.connIdForHost(tab.hostId)"
                  :conn-id="store.connIdForHost(tab.hostId) ?? ''"
                  @close="activeDock[tab.id] = null"
                />
                <div v-else class="px-3 py-6 text-center text-sm text-muted-foreground">
                  {{ t('ssh.tterm.connectToBrowse') }}
                </div>
              </template>
              <SshSessionPanel
                v-else-if="activeDock[tab.id] === 'session'"
                :host-id="tab.hostId"
                :visible="store.activeTab === tab.id"
                :terminal-conn-id="termConn[tab.id] ?? undefined"
                @close="activeDock[tab.id] = null"
              />
              <!-- Snippets write into the EXACT shell on screen (termConn = the
                   active pane's live connId), never the store's "primary" guess —
                   otherwise Run silently hits an off-screen shell. -->
              <SshSnippetsPanel
                v-else-if="activeDock[tab.id] === 'snippets'"
                :conn-id="termConn[tab.id] ?? ''"
                @close="activeDock[tab.id] = null"
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
import SshSnippetsPanel from '~/components/ssh/SshSnippetsPanel.vue'
import SshSnippetsSection from '~/components/ssh/SshSnippetsSection.vue'
import SshSidebar from '~/components/ssh/SshSidebar.vue'
import SshTerminal from '~/components/ssh/SshTerminal.vue'
import VpnSection from '~/components/vpn/VpnSection.vue'
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

// Class lặp của dải tab + nút dock. Đang chọn = accent-tint (không nền xám).
const TAB = 'max-w-55 shrink-0 gap-2 px-2.5 text-sm font-medium text-muted-foreground'
const TAB_ON = 'bg-selected text-primary hover:bg-selected hover:text-primary'
const DOCK_ON =
  'border-selected-border bg-selected text-primary hover:bg-selected hover:text-primary'
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

// Right-dock state is PER terminal tab (keyed by tab id) and local to the shell.
// The three docks — SFTP browser / co-pilot session / snippets — are mutually
// exclusive (all dock on the right); toggling only resizes the split, never
// unmounts the live SshTerminal. Pruned when a tab closes so the map can't leak.
// Active pane connId per tab (bubbled from SshTerminal) → the co-pilot drives the
// EXACT shell the user is watching, not a store guess.
const termConn = reactive<Record<string, string | null>>({})
type DockKind = 'sftp' | 'session' | 'snippets'
const activeDock = reactive<Record<string, DockKind | null>>({})
const toggleDock = (tabId: string, kind: DockKind): void => {
  activeDock[tabId] = activeDock[tabId] === kind ? null : kind
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
    for (const key of Object.keys(activeDock)) if (!ids.includes(key)) delete activeDock[key]
  },
)
</script>
