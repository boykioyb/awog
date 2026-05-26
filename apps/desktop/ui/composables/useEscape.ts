import type { Ref } from 'vue'

/**
 * ESC key handler với module-level stack (LIFO).
 *
 * Khi nhiều modal/editor mở chồng, ESC chỉ trigger handler ở **top of stack**
 * (last pushed). Cơ chế này tránh việc ESC đóng tất cả modal cùng lúc và không
 * cần caller tự `e.preventDefault()` / `stopPropagation()` (xem ADR 0009a §5).
 *
 * Chỉ có **1 global keydown listener** cho cả app — đăng ký lần đầu khi stack
 * có handler, gỡ khi stack rỗng.
 *
 * @example
 * useEscape(() => emit('close'))
 *
 * @example
 * const enabled = computed(() => props.open)
 * useEscape(() => emit('close'), { enabled })
 */
type EscapeEntry = {
  handler: () => void
  enabled?: Ref<boolean>
}

// Module-level stack (visible to all useEscape callers in cùng JS context)
const escapeStack: EscapeEntry[] = []

const onKeydown = (e: KeyboardEvent) => {
  if (e.key !== 'Escape') return
  const top = escapeStack[escapeStack.length - 1]
  if (!top) return
  if (top.enabled && !top.enabled.value) return
  top.handler()
}

const attachListener = () => {
  if (escapeStack.length === 1 && typeof window !== 'undefined') {
    window.addEventListener('keydown', onKeydown)
  }
}

const detachListener = () => {
  if (escapeStack.length === 0 && typeof window !== 'undefined') {
    window.removeEventListener('keydown', onKeydown)
  }
}

export const useEscape = (handler: () => void, options?: { enabled?: Ref<boolean> }) => {
  const entry: EscapeEntry = { handler, enabled: options?.enabled }

  onMounted(() => {
    escapeStack.push(entry)
    attachListener()
  })

  onBeforeUnmount(() => {
    const i = escapeStack.indexOf(entry)
    if (i >= 0) escapeStack.splice(i, 1)
    detachListener()
  })
}

// Test-only: expose stack length cho QA verify cleanup (mount/unmount leak check)
export const getEscapeStackLength = () => escapeStack.length
