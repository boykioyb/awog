import { ref } from 'vue'

// Per-caller transient toast queue. Each call to useToasts() owns its own queue
// (matches the old UI's per-page behaviour); pages render it with the prototype
// `.toast` class. Ported from apps/desktop/ui/composables/useToasts.ts — the
// theme-token styling is dropped in favour of a `kind` the template maps to a
// `var(--token)` accent (success → green, error → danger).

export type ToastKind = 'info' | 'success' | 'error'

export type Toast = {
  id: string
  text: string
  kind: ToastKind
}

const TOAST_TTL_MS = 3200

export function useToasts() {
  const toasts = ref<Toast[]>([])

  const pushToast = (text: string, kind: ToastKind = 'info'): void => {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    toasts.value = [...toasts.value, { id, text, kind }]
    setTimeout(() => {
      toasts.value = toasts.value.filter((tt) => tt.id !== id)
    }, TOAST_TTL_MS)
  }

  // Border accent color for a toast kind — pairs with the prototype `.toast`
  // surface. Returned as a CSS color string so the template binds it inline.
  const toastColor = (kind: ToastKind): string => {
    if (kind === 'success') return 'var(--green)'
    if (kind === 'error') return 'var(--danger)'
    return 'var(--borderStrong)'
  }

  return { toasts, pushToast, toastColor }
}
