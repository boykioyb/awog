<template>
  <!-- Tab "Terminal" của một pod: một shell tương tác chạy `kubectl exec -it` bên
       trong pod. Tái dụng NGUYÊN `WorkspaceTerminal` (xterm + tab + split) như SSH
       làm — chỉ khác cái transport: `create` đi qua cổng duyệt hạ tầng
       (`kube.startPodExec`) rồi nhận `terminalId`, còn write/resize/kill là các RPC
       `terminal.*` chung (shell nào cũng gõ/đổi cỡ/tắt như nhau).

       `root: null` vì transport này không phải PTY cục bộ (không cần cwd của
       workspace); `canCreatePane` trong host chỉ đòi cwd cho transport cục bộ nên
       transport tuỳ biến vẫn spawn được. -->
  <div class="ikm-term">
    <WorkspaceTerminal
      :root="null"
      :ready="sc.available"
      :pty-key="ptyKey"
      :visible="visible"
      :transport="transport"
      :unavailable-label="t('infra.kube.exec.unavailable')"
    />
  </div>
</template>

<script setup lang="ts">
import WorkspaceTerminal from '~/components/session/workspace/WorkspaceTerminal.vue'
import { useSidecar } from '~/composables/useSidecar'
import { useTerminalApi } from '~/composables/useTerminalApi'
import type { InfraKubeController } from '~/composables/useInfraKube'
import type { TerminalTransport } from '~/composables/useTerminalApi'

const props = defineProps<{ kube: InfraKubeController; visible: boolean }>()

const { t } = useI18n()
const sc = useSidecar()
const api = useTerminalApi()

// Khoá gom nhóm cho registry runner của WorkspaceTerminal — riêng cho pod đang xem
// để không đụng terminal của phiên/toàn cục (cha đã `:key` theo pod nên component
// remount khi đổi pod, khoá theo pod là đủ ổn định trong vòng đời một lần mở).
const ptyKey = computed(() => `kube-exec:${props.kube.out.value.pod}`)

const transport: TerminalTransport = {
  // Mở shell = qua cổng duyệt (startPodExec ném khi bị chặn/huỷ ⇒ host hiện lý do).
  create: (cols, rows) => props.kube.startPodExec(cols, rows),
  write: (id, data) => api.write(id, data),
  resize: (id, cols, rows) => api.resize(id, cols, rows),
  kill: (id) => api.kill(id),
  dataEvent: 'terminal.data',
  exitEvent: 'terminal.exit',
  idField: 'terminalId',
}
</script>
