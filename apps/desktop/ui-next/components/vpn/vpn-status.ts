import type { VpnStatus } from '~/stores/vpn'

// Class Badge theo trạng thái tunnel — cùng nghĩa VPN_STATUS_COLORS của store
// (green → success, accent → primary, textDim → muted, danger → destructive) nhưng ở
// dạng utility ngữ nghĩa để Badge tô màu, không tô `:style` bằng var thô.
export const VPN_STATUS_BADGE: Record<VpnStatus, string> = {
  up: 'border-transparent bg-success/15 text-success',
  connecting: 'border-transparent bg-primary/15 text-primary',
  down: 'border-transparent bg-muted text-muted-foreground',
  error: 'border-transparent bg-destructive/15 text-destructive',
}
