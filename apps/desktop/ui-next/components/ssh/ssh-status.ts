import type { SshConnectionStatus } from '~/stores/ssh'

// Class màu theo trạng thái kết nối — cùng nghĩa SSH_STATUS_COLORS của store
// (green → success, danger → destructive, textDim → muted) nhưng ở dạng utility
// ngữ nghĩa, để chấm trạng thái / Badge không tô `:style` bằng var thô.
export const SSH_STATUS_DOT: Record<SshConnectionStatus, string> = {
  connected: 'bg-success',
  disconnected: 'bg-muted-foreground',
  error: 'bg-destructive',
  unknown: 'bg-muted-foreground',
}

export const SSH_STATUS_BADGE: Record<SshConnectionStatus, string> = {
  connected: 'border-transparent bg-success/15 text-success',
  disconnected: 'border-transparent bg-muted text-muted-foreground',
  error: 'border-transparent bg-destructive/15 text-destructive',
  unknown: 'border-transparent bg-muted text-muted-foreground',
}
