<template>
  <div class="flex h-full min-w-0 flex-col overflow-hidden bg-background">
    <div class="flex shrink-0 items-center gap-1.5 py-1.5 pr-2 pl-2.5 text-muted-foreground">
      <!-- Session switcher: current session + a menu to start a New one, jump to a
           past co-pilot session, or delete one. -->
      <DropdownMenu
        :open="menu === 'session'"
        @update:open="(v: boolean) => (menu = v ? 'session' : null)"
      >
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="xs"
            class="max-w-50 min-w-0 gap-1.5 px-2 text-muted-foreground"
            :title="t('ssh.session.switchTitle')"
          >
            <Icon name="sessions" />
            <span class="truncate text-sm font-medium text-foreground">{{ currentTitle }}</span>
            <Icon name="chev" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" class="max-h-85 w-70 max-w-[78vw] overflow-y-auto">
          <DropdownMenuItem class="text-primary [&_svg]:text-primary" @select="newSession">
            <Icon name="plus" />
            {{ t('ssh.session.new') }}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <!-- Hàng lịch sử = item chọn phiên + nút xoá hiện khi hover hàng. -->
          <div
            v-for="s in hostSessions"
            :key="s.id"
            class="group flex items-center rounded-md hover:bg-accent"
          >
            <DropdownMenuItem
              class="min-w-0 flex-1 gap-2 focus:bg-transparent"
              :class="s.id === sessionId ? 'text-primary' : 'text-muted-foreground'"
              @select="switchSession(s.id)"
            >
              <Icon v-if="s.id === sessionId" name="check" class="text-primary!" />
              <span v-else class="w-3.5 shrink-0" />
              <span class="min-w-0 flex-1 truncate font-medium">
                {{ s.title || t('ssh.session.untitled') }}
              </span>
              <span class="shrink-0 text-sm text-faint tabular-nums">{{ s.when }}</span>
            </DropdownMenuItem>
            <Button
              variant="ghost"
              size="iconSm"
              class="mr-1 shrink-0 text-faint opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100"
              :title="t('ssh.session.delete')"
              :aria-label="t('ssh.session.delete')"
              @click.stop="askDelete(s.id)"
            >
              <Icon name="trash" />
            </Button>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <!-- Terminal picker: which of the host's live shells the agent drives. Chỉ mở
           menu khi có > 1 shell (1 shell thì nút vẫn bấm được nhưng không có gì để chọn). -->
      <DropdownMenu
        :open="menu === 'term'"
        @update:open="(v: boolean) => (menu = v && shells.length > 1 ? 'term' : null)"
      >
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="xs"
            class="ml-auto max-w-35 min-w-0 shrink gap-1 px-2 text-sm"
            :class="boundConnId ? 'text-success' : 'text-faint'"
            :disabled="shells.length === 0"
            :title="t('ssh.session.driving')"
          >
            <span class="size-2 shrink-0 rounded-full bg-current" />
            <span class="truncate font-medium">{{ termLabel }}</span>
            <Icon v-if="shells.length > 1" name="chev" class="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="min-w-40">
          <DropdownMenuItem v-for="(c, i) in shells" :key="c" @select="pickTerminal(c)">
            <span class="min-w-0 flex-1 truncate font-medium">
              {{ t('ssh.session.terminalN', { n: i + 1 }) }}
            </span>
            <Icon v-if="c === boundConnId" name="check" class="text-primary!" />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        variant="ghost"
        size="iconSm"
        class="shrink-0 text-muted-foreground"
        :title="t('ssh.terminal.close')"
        :aria-label="t('ssh.terminal.close')"
        @click="emit('close')"
      >
        <Icon name="x" />
      </Button>
    </div>
    <Separator />

    <div v-if="session" class="sshsess-body flex min-h-0 flex-1 flex-col overflow-hidden">
      <SessionTranscript
        :messages="session.msgs"
        :fallback-when="session.when"
        :loading="!!session.loading"
      />
      <!-- Account / Style chip (same as the app status bar; popovers open upward into
           the transcript). Model / effort / mode live in the composer footer. -->
      <Separator />
      <!-- hook-ok: <style> bên dưới chạm DOM con của StatusConfig qua class này. -->
      <div class="sshsess-cfg relative flex shrink-0 items-center gap-0.5 px-2 py-1">
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

// Menu đang mở (DropdownMenu điều khiển qua open) — các action đóng bằng `menu = null`.
const menu = ref<'session' | 'term' | null>(null)

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
/* style-ok: chạm DOM con của StatusConfig + SessionComposer (component khác, CSS scoped
   KHÔNG nằm trong layer) — utility Tailwind ở layer `utilities` không thắng được nên
   phải giữ :deep. StatusConfig dựng chip cho status bar app; trong dock hẹp này thu chip
   lại và neo popover vào thanh để không tràn ra terminal. Bỏ khối này khi hai component
   đó chuyển sang shadcn. */
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
  line-height: 12px;
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
/* Toolbar composer ép flex-wrap:nowrap (dựng cho /sessions rộng) — trong dock hẹp cho
   phép xuống dòng để nút Send không tràn mép phải. */
.sshsess-body :deep(.composer .cbar) {
  flex-wrap: wrap;
  row-gap: 6px;
}
</style>
