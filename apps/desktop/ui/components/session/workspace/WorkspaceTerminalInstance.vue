<template>
  <div class="flex flex-col h-full overflow-hidden" :style="{ background: t.bg }">
    <div
      v-if="errorMsg"
      class="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center"
    >
      <TerminalSquare :size="28" :stroke-width="1.5" :style="{ color: t.textFaint }" />
      <p class="text-[1em]" :style="{ color: t.textDim }">{{ errorMsg }}</p>
    </div>
    <div
      v-show="!errorMsg"
      ref="containerRef"
      class="flex-1 overflow-hidden"
      style="padding: 4px"
    />
  </div>
</template>

<script setup lang="ts">
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { TerminalSquare } from 'lucide-vue-next'
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { useTerminalApi } from '~/composables/useTerminalApi'
import { useSidecar, type SidecarEvent } from '~/composables/useSidecar'
import '@xterm/xterm/css/xterm.css'

const props = defineProps<{
  // Opaque grouping key for the sidecar PTY manager — a session id, or
  // `proj:<projectId>` for the Project Code Workspace (terminal.list groups by it).
  sessionId: string
  workspaceRoot: string
  // True when this instance is the visible tab — drives deferred PTY creation
  // / refit (an off-screen `v-show: none` terminal has zero size).
  visible: boolean
}>()

const { t } = useTheme()
const { t: tr } = useI18n()
const api = useTerminalApi()

const containerRef = ref<HTMLElement | null>(null)
const term = shallowRef<Terminal | null>(null)
const errorMsg = ref<string | null>(null)

let fit: FitAddon | null = null
let terminalId: string | null = null
let unlisten: UnlistenFn | null = null
let resizeObserver: ResizeObserver | null = null
let creating = false
// Events that arrive between PTY spawn and us learning its terminalId. Without
// this buffer the first burst (p10k instant prompt) is lost and xterm starts
// parsing mid-escape-sequence → garbage like `]]]]zzz`.
let pending: SidecarEvent[] = []

const routeEvent = (instance: Terminal, evt: SidecarEvent) => {
  const payload = evt.payload as { terminalId?: string; chunk?: string; exitCode?: number }
  if (payload?.terminalId !== terminalId) return
  if (evt.type === 'terminal.data' && typeof payload.chunk === 'string') {
    instance.write(payload.chunk)
  } else if (evt.type === 'terminal.exit') {
    instance.write(
      `\r\n\x1b[90m[${tr('workspace.terminal.exited')} ${payload.exitCode ?? 0}]\x1b[0m\r\n`,
    )
    terminalId = null
  }
}

// Spawn the PTY at the terminal's real fitted size. The data listener is
// already attached (see init) so no early output is dropped.
const createPty = async (instance: Terminal, cols: number, rows: number) => {
  if (terminalId || creating) return
  creating = true
  try {
    const result = await api.create(props.workspaceRoot, props.sessionId, cols, rows)
    terminalId = result.terminalId
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : tr('workspace.terminal.unavailable')
    return
  } finally {
    creating = false
  }

  instance.onData((data) => {
    if (terminalId) api.write(terminalId, data).catch(() => undefined)
  })

  // Flush any buffered early output for this terminal (synchronous — no live
  // event can interleave before this completes).
  const buffered = pending
  pending = []
  buffered.forEach((evt) => routeEvent(instance, evt))
}

const syncSize = () => {
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
    createPty(term.value, cols, rows)
  } else {
    api.resize(terminalId, cols, rows).catch(() => undefined)
  }
}

const init = async () => {
  const container = containerRef.value
  if (!container || term.value) return

  const instance = new Terminal({
    fontSize: 13,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    cursorBlink: true,
    theme: {
      background: t.value.bg,
      foreground: t.value.text,
      cursor: t.value.accent,
    },
  })
  fit = new FitAddon()
  instance.loadAddon(fit)
  instance.open(container)
  term.value = instance

  // Attach the data listener BEFORE the PTY can exist. Buffers until we know
  // our terminalId, then routes live.
  const sidecar = useSidecar()
  if (sidecar.available) {
    unlisten = await sidecar.onEvent((evt) => {
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

onMounted(init)

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  if (unlisten) unlisten()
  if (terminalId) api.kill(terminalId).catch(() => undefined)
  term.value?.dispose()
})
</script>
