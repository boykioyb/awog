import type { CSSProperties } from 'vue'

export type ToastKind = 'info' | 'success' | 'error'

export type Toast = {
  id: string
  text: string
  kind: ToastKind
}

// Per-caller transient toast queue + theme-aware styling. Each call owns its own
// queue (matches the prior inline-per-page behavior); shared so list pages
// (agents, skills, …) stop duplicating the same block.
export function useToasts() {
  const { t } = useTheme()
  const toasts = ref<Toast[]>([])

  const pushToast = (text: string, kind: ToastKind = 'info') => {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    toasts.value = [...toasts.value, { id, text, kind }]
    setTimeout(() => {
      toasts.value = toasts.value.filter((tt) => tt.id !== id)
    }, 3200)
  }

  const toastStyle = (kind: ToastKind): CSSProperties => {
    if (kind === 'success') {
      return {
        background: t.value.infoBg,
        color: t.value.info,
        border: `1px solid ${t.value.infoBorder}`,
      }
    }
    if (kind === 'error') {
      return {
        background: t.value.dangerBg,
        color: t.value.danger,
        border: `1px solid ${t.value.dangerBorder}`,
      }
    }
    return {
      background: t.value.bgPanel,
      color: t.value.text,
      border: `1px solid ${t.value.border}`,
    }
  }

  return { toasts, pushToast, toastStyle }
}
