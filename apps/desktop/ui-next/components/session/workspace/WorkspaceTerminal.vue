<template>
  <div class="wsterm">
    <div v-if="errorMsg || !ready" class="empty" style="padding: 30px">
      <div class="et">{{ errorMsg ?? unavailableMsg }}</div>
    </div>
    <div v-show="!errorMsg && ready" ref="containerRef" class="wsterm-box" />
  </div>
</template>

<script setup lang="ts">
// Terminal tab (§5/§10) — real PTY via terminal.create/write/resize/kill, output
// streamed through sc.onEvent (terminal.data / terminal.exit). One PTY per session
// tab; cleaned up on unmount. Ported from the old WorkspaceTerminalInstance wiring.
// Degrades to an empty state when the engine bridge / workspace root is absent.
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import type { Session } from '~/composables/useSessionsMock'
import { useSidecar, type SidecarEvent, type UnlistenFn } from '~/composables/useSidecar'
import { useTerminalApi } from '~/composables/useTerminalApi'
import { useWorkspaceData } from '~/composables/useWorkspaceData'
import '@xterm/xterm/css/xterm.css'

const props = defineProps<{
  session: Session
  // True when this is the visible tab — drives deferred PTY spawn / refit (an
  // off-screen terminal has zero size).
  visible: boolean
}>()

const { t } = useI18n()
const sc = useSidecar()
const api = useTerminalApi()
const { root, ready } = useWorkspaceData(() => props.session.project)

const containerRef = useTemplateRef<HTMLElement>('containerRef')
const term = shallowRef<Terminal | null>(null)
const errorMsg = ref<string | null>(null)

const unavailableMsg = computed(() =>
  sc.available ? t('sessions.workspace.noProject') : t('sessions.workspace.unavailable'),
)

// Opaque PTY grouping key for the sidecar — the session's client id.
const ptyKey = computed(() => `ses:${props.session.id}`)

let fit: FitAddon | null = null
let terminalId: string | null = null
let unlisten: UnlistenFn | null = null
let resizeObserver: ResizeObserver | null = null
let creating = false
// Events that arrive between PTY spawn and us learning its terminalId. Without
// this buffer the first burst (instant prompt) is lost and xterm starts parsing
// mid-escape-sequence → garbage.
let pending: SidecarEvent[] = []

const routeEvent = (instance: Terminal, evt: SidecarEvent): void => {
  const payload = evt.payload as { terminalId?: string; chunk?: string; exitCode?: number }
  if (payload?.terminalId !== terminalId) return
  if (evt.type === 'terminal.data' && typeof payload.chunk === 'string') {
    instance.write(payload.chunk)
  } else if (evt.type === 'terminal.exit') {
    instance.write(
      `\r\n\x1b[90m[${t('sessions.workspace.terminal.exited')} ${payload.exitCode ?? 0}]\x1b[0m\r\n`,
    )
    terminalId = null
  }
}

// Spawn the PTY at the terminal's real fitted size. The data listener is already
// attached (see init) so no early output is dropped.
const createPty = async (instance: Terminal, cols: number, rows: number): Promise<void> => {
  if (terminalId || creating || !root.value) return
  creating = true
  try {
    const result = await api.create(root.value, ptyKey.value, cols, rows)
    terminalId = result.terminalId
  } catch (err) {
    errorMsg.value =
      err instanceof Error ? err.message : t('sessions.workspace.terminal.unavailable')
    return
  } finally {
    creating = false
  }

  instance.onData((data) => {
    if (terminalId) api.write(terminalId, data).catch(() => undefined)
  })

  // Flush any buffered early output for this terminal.
  const buffered = pending
  pending = []
  buffered.forEach((evt) => routeEvent(instance, evt))
}

const syncSize = (): void => {
  const container = containerRef.value
  if (!fit || !term.value || !container) return
  if (container.clientWidth === 0 || container.clientHeight === 0) return
  try {
    fit.fit()
  } catch {
    // container not measurable yet — ignore
  }
  const { cols, rows } = term.value
  if (!terminalId) {
    void createPty(term.value, cols, rows)
  } else {
    api.resize(terminalId, cols, rows).catch(() => undefined)
  }
}

// Read CSS theme tokens off the live document so xterm matches the active theme.
const cssVar = (name: string, fallback: string): string => {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

const init = async (): Promise<void> => {
  const container = containerRef.value
  if (!container || term.value || !ready.value) return

  const instance = new Terminal({
    fontSize: 13,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    cursorBlink: true,
    macOptionClickForcesSelection: true,
    rightClickSelectsWord: true,
    theme: {
      background: cssVar('--bg', '#0d0d0d'),
      foreground: cssVar('--text', '#e5e5e5'),
      cursor: cssVar('--accent', '#3b82f6'),
      selectionBackground: cssVar('--accent', '#3b82f6'),
      selectionForeground: cssVar('--accentText', '#ffffff'),
    },
  })
  fit = new FitAddon()
  instance.loadAddon(fit)
  instance.open(container)
  term.value = instance

  // Copy/paste: xterm doesn't bind these by default. Cmd+C/V (mac) +
  // Ctrl+Shift+C/V (win/linux); plain Ctrl+C stays SIGINT.
  instance.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true
    const wantsCopy =
      (e.metaKey && e.code === 'KeyC') || (e.ctrlKey && e.shiftKey && e.code === 'KeyC')
    if (wantsCopy && instance.hasSelection()) {
      navigator.clipboard.writeText(instance.getSelection()).catch(() => undefined)
      return false
    }
    const wantsPaste =
      (e.metaKey && e.code === 'KeyV') || (e.ctrlKey && e.shiftKey && e.code === 'KeyV')
    if (wantsPaste) {
      navigator.clipboard
        .readText()
        .then((text) => {
          if (terminalId && text) api.write(terminalId, text).catch(() => undefined)
        })
        .catch(() => undefined)
      return false
    }
    return true
  })

  // Attach the data listener BEFORE the PTY can exist. Buffer until we know our
  // terminalId, then route live.
  if (sc.available) {
    unlisten = await sc.onEvent((evt) => {
      if (evt.type !== 'terminal.data' && evt.type !== 'terminal.exit') return
      if (!terminalId) {
        pending.push(evt)
        return
      }
      routeEvent(instance, evt)
    })
  }

  resizeObserver = new ResizeObserver(() => syncSize())
  resizeObserver.observe(container)
  syncSize()
}

watch(
  () => props.visible,
  (v) => {
    if (!v) return
    syncSize()
    term.value?.focus()
  },
)

// The root may resolve after mount — init once it's ready + the tab is visible.
watch([ready, () => props.visible], () => {
  if (ready.value && props.visible && !term.value) void init()
})

onMounted(() => {
  if (props.visible) void init()
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  if (unlisten) unlisten()
  if (terminalId) api.kill(terminalId).catch(() => undefined)
  term.value?.dispose()
})
</script>

<style scoped>
.wsterm {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg);
}
.wsterm-box {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 4px;
}
</style>
