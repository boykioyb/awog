// Mức tải (UsageLevel) → class màu Tailwind ngữ nghĩa. Bản class của
// `levelColor()` trong composables/useMonitorManager.ts (trả CSS var cho :style) —
// giữ cùng bảng: high = đỏ, warn = vàng, ok = xanh, null = chữ mờ.
import type { UsageLevel } from '~/composables/useMonitorManager'

export function levelText(l: UsageLevel | null): string {
  if (l === 'high') return 'text-destructive'
  if (l === 'warn') return 'text-warning'
  if (l === 'ok') return 'text-success'
  return 'text-dim'
}

export function levelBg(l: UsageLevel | null): string {
  if (l === 'high') return 'bg-destructive'
  if (l === 'warn') return 'bg-warning'
  if (l === 'ok') return 'bg-success'
  return 'bg-dim'
}
