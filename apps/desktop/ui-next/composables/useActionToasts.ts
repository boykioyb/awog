import { ref } from 'vue'

// App-lifetime SINGLETON toast queue for one-shot action feedback (e.g. /compact
// success / failure) that isn't tied to any single page's own useToasts() queue.
// Unlike useToasts() (per-caller), the state here is module-level so ANY component
// or store can `pushActionToast(...)` and the single ActionToastHost mounted at the
// layout root renders it — mounting at the root avoids the position:fixed containing
// -block issues you'd hit rendering inside a transformed ancestor (e.g. the composer).

export type ActionToastKind = 'info' | 'success' | 'error'
export type ActionToast = { id: string; text: string; kind: ActionToastKind }

const TTL_MS = 3600

// Module-level (singleton) queue shared across all callers + the host.
const toasts = ref<ActionToast[]>([])

export function pushActionToast(text: string, kind: ActionToastKind = 'info'): void {
  const id = `at-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  toasts.value = [...toasts.value, { id, text, kind }]
  setTimeout(() => {
    toasts.value = toasts.value.filter((tt) => tt.id !== id)
  }, TTL_MS)
}

export function dismissActionToast(id: string): void {
  toasts.value = toasts.value.filter((tt) => tt.id !== id)
}

// Border accent color per kind — pairs with the prototype `.toast` surface.
export function actionToastColor(kind: ActionToastKind): string {
  if (kind === 'success') return 'var(--green)'
  if (kind === 'error') return 'var(--danger)'
  return 'var(--borderStrong)'
}

export function useActionToasts() {
  return { toasts }
}
