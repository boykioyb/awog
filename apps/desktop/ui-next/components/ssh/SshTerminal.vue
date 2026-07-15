<template>
  <WorkspaceTerminal
    :root="null"
    :ready="sc.available"
    :pty-key="`ssh:${hostId}`"
    :visible="visible"
    :transport="transport"
    :unavailable-label="t('ssh.terminal.unavailable')"
    @conn="(id) => emit('conn', id)"
  />
</template>

<script setup lang="ts">
// SSH terminal — reuses the generic WorkspaceTerminal (xterm + tabs) with an SSH
// TerminalTransport (ADR 0063 P2). Each tab = one interactive shell over ssh.*.
// The host-key TOFU prompt is handled app-wide by the ssh store (ssh:host-key-
// prompt → SshHostKeyModal), so the connect() promise here only resolves once the
// user has accepted the key. Keyed by hostId at the mount site so the transport's
// hostId stays stable for the component's lifetime.
import WorkspaceTerminal from '~/components/session/workspace/WorkspaceTerminal.vue'
import { useSidecar } from '~/composables/useSidecar'
import { useSshApi } from '~/composables/useSshApi'
import type { TerminalTransport } from '~/composables/useTerminalApi'

const props = withDefaults(defineProps<{ hostId: string; visible?: boolean }>(), {
  visible: true,
})
// Bubble the active pane's live connId up so the co-pilot drives THIS exact shell.
const emit = defineEmits<{ conn: [id: string | null] }>()

const { t } = useI18n()
const sc = useSidecar()
const api = useSshApi()

const transport: TerminalTransport = {
  create: (cols, rows) => api.connect(props.hostId, cols, rows).then((r) => ({ id: r.connId })),
  write: (id, data) => api.write(id, data),
  resize: (id, cols, rows) => api.resize(id, cols, rows),
  kill: (id) => api.disconnect(id),
  dataEvent: 'ssh:data',
  exitEvent: 'ssh:exit',
  idField: 'connId',
}
</script>
