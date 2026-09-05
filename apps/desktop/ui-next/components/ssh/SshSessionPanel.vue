<template>
  <div class="sshsess">
    <div class="sshsess-head">
      <!-- Session switcher: current session + a menu to start a New one, jump to a
           past co-pilot session, or delete one. -->
      <div class="sshsess-switch">
        <button
          class="sshsess-sesbtn"
          :title="t('ssh.session.switchTitle')"
          @click.stop="toggleMenu('session')"
        >
          <Icon name="sessions" style="width: 13px; height: 13px" />
          <span class="sshsess-title">{{ currentTitle }}</span>
          <Icon name="chev" style="width: 12px; height: 12px" />
        </button>
        <div v-if="menu === 'session'" class="smenu sshsess-menu" @click.stop>
          <button class="mi sshsess-new" @click="newSession">
            <Icon name="plus" style="width: 13px; height: 13px" />
            {{ t('ssh.session.new') }}
          </button>
          <div class="sshsess-menu-div" />
          <div
            v-for="s in hostSessions"
            :key="s.id"
            class="sshsess-row"
            :class="{ on: s.id === sessionId }"
          >
            <button class="sshsess-rowmain" @click="switchSession(s.id)">
              <Icon
                v-if="s.id === sessionId"
                name="check"
                class="sshsess-row-ck"
                style="width: 13px; height: 13px"
              />
              <span v-else class="sshsess-row-ckspace" />
              <span class="sshsess-row-title">{{ s.title || t('ssh.session.untitled') }}</span>
              <span class="sshsess-row-when tnum">{{ s.when }}</span>
            </button>
            <button
              class="sshsess-del"
              :title="t('ssh.session.delete')"
              :aria-label="t('ssh.session.delete')"
              @click.stop="askDelete(s.id)"
            >
              <Icon name="trash" style="width: 13px; height: 13px" />
            </button>
          </div>
        </div>
      </div>

      <!-- Terminal picker: which of the host's live shells the agent drives. -->
      <div class="sshsess-termwrap">
        <button
          class="sshsess-term"
          :class="{ live: !!boundConnId }"
          :disabled="shells.length === 0"
          :title="t('ssh.session.driving')"
          @click.stop="shells.length > 1 && toggleMenu('term')"
        >
          <span class="sshsess-term-dot" />
          <span class="sshsess-term-lbl">{{ termLabel }}</span>
          <Icon v-if="shells.length > 1" name="chev" style="width: 11px; height: 11px" />
        </button>
        <div v-if="menu === 'term'" class="smenu sshsess-termmenu" @click.stop>
          <button v-for="(c, i) in shells" :key="c" class="mi" @click="pickTerminal(c)">
            <span class="sshsess-row-title">{{ t('ssh.session.terminalN', { n: i + 1 }) }}</span>
            <Icon
              v-if="c === boundConnId"
              name="check"
              class="sshsess-row-ck"
              style="width: 13px; height: 13px"
            />
          </button>
        </div>
      </div>

      <button
        class="sshsess-x"
        :title="t('ssh.terminal.close')"
        :aria-label="t('ssh.terminal.close')"
        @click="emit('close')"
      >
        <Icon name="x" style="width: 13px; height: 13px" />
      </button>
      <div v-if="menu" class="sshsess-backdrop" @click="menu = null" />
    </div>

    <div v-if="session" class="sshsess-body">
      <SessionTranscript
        :messages="session.msgs"
        :fallback-when="session.when"
        :loading="!!session.loading"
      />
      <!-- Model / Account / Reasoning-effort / Style chips (same as the app status
           bar; popovers open upward into the transcript). Mode lives in the composer. -->
      <div class="sshsess-cfg">
        <StatusConfig :session="session" />
      </div>
      <SessionComposer @send="onSend" />
    </div>
  </div>
</template>

<script setup lang="ts">
// Docked SSH co-pilot chat (ADR 0064 / SSH terminal co-pilot). Reuses SessionTranscript
// + SessionComposer + StatusConfig chips. Supports multiple sessions per host (New /
// switch / delete) and picking WHICH live shell the agent drives. The shown session is
// the store's ACTIVE one (composer/chips bind to store.active); its sshTerminalConnId
// tracks the picked (or primary) shell so ssh_terminal_run drives it.
import { computed, onMounted, ref, watch } from 'vue'
import SessionComposer from '~/components/session/SessionComposer.vue'
import SessionTranscript from '~/components/session/SessionTranscript.vue'
import StatusConfig from '~/components/shell/StatusConfig.vue'
import type { SlashCommandRef } from '~/composables/useSessionsData'

const props = withDefaults(
  defineProps<{ hostId: string; visible?: boolean; terminalConnId?: string }>(),
  { visible: true, terminalConnId: undefined },
)
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const { confirm } = useConfirm()
const sessions = useSessionsStore()
const ssh = useSshStore()

// The docked co-pilot is the second transcript surface: without this, every jump
// from inside this panel (follow-up anchor, quote card) would resolve to no
// transcript at all and return 'not-found' (ADR 0075).
provideTranscriptSurface()

const menu = ref<'session' | 'term' | null>(null)
const toggleMenu = (m: 'session' | 'term') => (menu.value = menu.value === m ? null : m)

const sessionId = ref(0)
const session = computed(() => sessions.sessions.find((s) => s.id === sessionId.value))
const currentTitle = computed(() => session.value?.title || t('ssh.session.copilotTitle'))

// This host's co-pilot sessions (history), newest first (higher client id = later).
const hostSessions = computed(() =>
  sessions.sessions.filter((s) => s.aboutSshHostId === props.hostId).sort((a, b) => b.id - a.id),
)

// ── Terminal picker ──────────────────────────────────────────────────────────
const shells = computed(() => ssh.shellsForHost(props.hostId))
const pickedConnId = ref<string | null>(null)
// The shell the agent drives: the user's explicit pick if still live, else the ACTUAL
// visible pane connId bubbled from the terminal (props.terminalConnId — authoritative,
// not a store guess), else the host's primary live connId.
const boundConnId = computed(() => {
  const picked = pickedConnId.value
  if (picked && shells.value.includes(picked)) return picked
  return props.terminalConnId ?? ssh.connIdForHost(props.hostId) ?? ''
})
const termLabel = computed(() => {
  if (!boundConnId.value) return t('ssh.session.noTerminal')
  const i = shells.value.indexOf(boundConnId.value)
  return i >= 0 ? t('ssh.session.terminalN', { n: i + 1 }) : t('ssh.session.terminalBound')
})
function pickTerminal(connId: string): void {
  pickedConnId.value = connId
  menu.value = null
}

// ── Session lifecycle ────────────────────────────────────────────────────────
function createSession(): number {
  const host = ssh.hostById(props.hostId)
  const title = host ? `SSH: ${host.name || host.host}` : 'SSH'
  const id = sessions.createForSshHost(props.hostId, '', title)
  ssh.linkCopilotSession(props.hostId, id)
  return id
}
function ensureSession(): number {
  const remembered = ssh.copilotSessionId(props.hostId)
  if (remembered != null && sessions.sessions.some((s) => s.id === remembered)) return remembered
  const latest = hostSessions.value[0]
  if (latest) {
    ssh.linkCopilotSession(props.hostId, latest.id)
    return latest.id
  }
  return createSession()
}
function newSession(): void {
  sessionId.value = createSession()
  menu.value = null
}
function switchSession(id: number): void {
  sessionId.value = id
  ssh.linkCopilotSession(props.hostId, id)
  menu.value = null
}
async function askDelete(id: number): Promise<void> {
  const ok = await confirm({
    title: t('ssh.session.deleteTitle'),
    description: t('ssh.session.deleteConfirm'),
  })
  if (!ok) return
  sessions.remove(id)
  if (id === sessionId.value) {
    const next = hostSessions.value.find((s) => s.id !== id)
    sessionId.value = next ? next.id : createSession()
    ssh.linkCopilotSession(props.hostId, sessionId.value)
  }
}

onMounted(() => {
  sessionId.value = ensureSession()
})

// Active-session gating: the composer + chips bind to store.active, so make THIS the
// active session whenever the panel is the shown tab.
watch(
  () => [props.visible, sessionId.value] as const,
  ([vis, sid]) => {
    if (vis && sid) sessions.setActive(sid)
  },
  { immediate: true },
)

// Bind the driven shell → the agent's ssh_terminal_run targets it (null when none).
watch(
  () => [sessionId.value, boundConnId.value] as const,
  ([sid, connId]) => {
    if (sid) sessions.setSshTerminalConnId(sid, connId || null)
  },
  { immediate: true },
)

function onSend(text: string, command?: SlashCommandRef) {
  if (sessionId.value) sessions.sendMessage(sessionId.value, text, [], command)
}
</script>

<style scoped>
.sshsess {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  overflow: hidden;
  background: var(--bg);
}
.sshsess-head {
  position: relative;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px 6px 10px;
  border-bottom: 1px solid var(--border);
  color: var(--textDim);
}
/* Session switcher */
.sshsess-switch {
  position: relative;
  min-width: 0;
}
.sshsess-sesbtn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 200px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  transition:
    background 0.12s,
    color 0.12s;
}
.sshsess-sesbtn:hover {
  background: var(--bgHover);
  color: var(--text);
}
.sshsess-title {
  font-size: var(--fs-sm);
  font-weight: 550;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sshsess-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 60;
  width: 280px;
  max-width: 78vw;
  max-height: 340px;
  overflow-y: auto;
  padding: 5px;
}
.sshsess-menu-div {
  height: 1px;
  margin: 5px 6px;
  background: var(--border);
}
.sshsess-new {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--accent);
}
/* History row = main select button + trailing delete. */
.sshsess-row {
  display: flex;
  align-items: center;
  border-radius: var(--r-xs);
}
.sshsess-row:hover {
  background: var(--bgHover);
}
.sshsess-rowmain {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 4px 8px 10px;
  border: 0;
  background: transparent;
  color: var(--textMuted);
  cursor: pointer;
  text-align: left;
}
.sshsess-row.on .sshsess-rowmain {
  color: var(--accent);
}
.sshsess-row-ck {
  flex: 0 0 auto;
  color: var(--accent);
}
.sshsess-row-ckspace {
  flex: 0 0 auto;
  width: 13px;
}
.sshsess-row-title {
  font-weight: 500;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sshsess-row-when {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--textFaint);
}
.sshsess-del {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 30px;
  margin-right: 4px;
  border: 0;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--textFaint);
  cursor: pointer;
  opacity: 0;
  transition:
    opacity 0.12s,
    color 0.12s,
    background 0.12s;
}
.sshsess-row:hover .sshsess-del {
  opacity: 1;
}
.sshsess-del:hover {
  color: var(--danger);
  background: var(--dangerBg, var(--bgHover));
}
.sshsess-backdrop {
  position: fixed;
  inset: 0;
  z-index: 55;
}
/* Terminal picker */
.sshsess-termwrap {
  position: relative;
  margin-left: auto;
  flex: 0 1 auto;
  min-width: 0;
}
.sshsess-term {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 140px;
  height: 24px;
  padding: 0 7px;
  border: 1px solid transparent;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--textFaint);
  font-size: 12px;
  cursor: pointer;
  transition:
    background 0.12s,
    color 0.12s;
}
.sshsess-term:not(:disabled):hover {
  background: var(--bgHover);
  color: var(--text);
}
.sshsess-term:disabled {
  cursor: default;
}
.sshsess-term-lbl {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sshsess-term-dot {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--textFaint);
}
.sshsess-term.live {
  color: var(--green);
}
.sshsess-term.live .sshsess-term-dot {
  background: var(--green);
}
.sshsess-termmenu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 60;
  min-width: 160px;
}
.sshsess-x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  border: none;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
}
.sshsess-x:hover {
  background: var(--bgHover);
  color: var(--text);
}
.sshsess-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
/* Config-chip bar above the composer. StatusConfig's .sb-item chips normally get
   their sizing from the app status bar (:deep there); replicate it here so the chips
   render as proper chips. Popovers are re-anchored to the bar so they stay inside. */
.sshsess-cfg {
  position: relative;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 8px;
  border-top: 1px solid var(--border);
}
.sshsess-cfg :deep(.sb-item) {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--textDim);
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition:
    color 0.12s,
    background 0.12s;
}
.sshsess-cfg :deep(.sb-item:hover) {
  color: var(--text);
  background: var(--bgHover);
}
/* Contain StatusConfig's popovers INSIDE the dock (they anchor right:0 to a narrow
   chip → spill onto the terminal). Neutralise .sb-wrap so menus anchor to the bar. */
.sshsess-cfg :deep(.sb-wrap) {
  position: static;
}
.sshsess-cfg :deep(.sb-menu) {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: calc(100% + 6px);
  min-width: 0;
  max-width: none;
}
.sshsess-cfg :deep(.styinfocard) {
  display: none;
}
/* The composer toolbar forces flex-wrap:nowrap (built for the wide /sessions view),
   so in this narrow dock its action buttons + Send overflow the right edge. Re-enable
   wrapping HERE only: at a comfortable width the flex spacer keeps Send right-aligned
   on one row; when narrow, the actions wrap to a second row instead of spilling out. */
.sshsess :deep(.composer .cbar) {
  flex-wrap: wrap;
  row-gap: 6px;
}
</style>
