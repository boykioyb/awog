import { ref } from 'vue'

// App-lifetime SINGLETON toast queue — the one notification surface for the whole
// app. Replaces the five queues that came before it: the per-caller one (19 copies
// of the same `.toast` v-for, all stacked on one fixed point so a second toast hid
// the first), the action-toast singleton (which only existed because a
// `position: fixed` toast rendered inside a transformed ancestor — the composer — is
// positioned against that ancestor, not the viewport), the quota guard's, the code
// workspace's, and the schedules page's.
//
// The call-site API is deliberately Nuxt UI's `useToast()` shape
// (https://ui.nuxt.com/docs/components/toast): add/update/remove/clear taking
// { title, description, icon, color, actions, duration, close }. We
// implement it on Reka UI's Toast primitives (already a dependency) rather than
// installing @nuxt/ui, which would drag in Tailwind v4 plus its own icon/font/
// color-mode modules — see docs/features/toast-system.md.
//
// Timing is NOT owned here: ToastRoot runs the dismiss timer, so pause-on-hover,
// pause-on-window-blur and swipe-to-dismiss come for free. `duration: 0` means the
// toast never auto-closes (Reka UI skips the timer for <= 0), matching Nuxt UI.

// Nuxt UI's semantic colors. Each maps to an AWOG theme token in AppToaster —
// never to a hex, so the Cute theme family can restyle them.
export type ToastColor = 'primary' | 'success' | 'error' | 'warning' | 'info' | 'neutral'

export type ToastAction = {
  label: string
  // Icon sprite name (components/Icon.vue), not an Iconify id.
  icon?: string
  onClick?: (e: MouseEvent) => void
}

export type ToastProps = {
  // Stable id lets a caller update or dedupe its own toast (e.g. one progress
  // toast per git op instead of a new one per tick). Omitted → generated.
  id?: string
  title: string
  // Full detail. Unlike `title` this WRAPS — it exists because a git error is
  // several lines and the old single-line ellipsis cut it off.
  description?: string
  // Icon sprite name; defaults per color.
  icon?: string
  color?: ToastColor
  // ms before auto-close. 0 = stays until dismissed. Default DEFAULT_DURATION.
  duration?: number
  // Show the dismiss button. Forced on when duration is 0 — a toast that never
  // expires and can't be closed is a permanent obstruction.
  close?: boolean
  actions?: ToastAction[]
  // Whole-toast click-through (the GitHub-notification pattern): runs, then
  // dismisses. Prefer `actions` when the toast has more than one outcome.
  onClick?: () => void
  // Reka UI a11y sensitivity: 'foreground' interrupts (result of a user action),
  // 'background' waits its turn. Defaults to 'foreground'.
  type?: 'foreground' | 'background'
}

export type Toast = Omit<ToastProps, 'id'> & { id: string; open: boolean }

const DEFAULT_DURATION = 5000
// A toast that offers a choice is only useful if the user gets to make it, so it
// outlives a plain acknowledgement.
const ACTIONABLE_DURATION = 8000
// Cap the visible stack; beyond this the oldest is dropped rather than growing a
// column taller than the window.
const MAX_VISIBLE = 5

const toasts = ref<Toast[]>([])

let seq = 0
function nextId(): string {
  seq += 1
  return `toast-${seq}`
}

function add(props: ToastProps): Toast {
  const id = props.id ?? nextId()
  // Re-adding a known id updates in place: callers that key a toast to an
  // operation get one row that changes, not a pile of near-identical rows.
  if (toasts.value.some((tt) => tt.id === id)) {
    update(id, props)
    // Re-read: update() rebuilds the row, so the pre-update object is detached.
    return toasts.value.find((tt) => tt.id === id) as Toast
  }

  const actionable = !!props.onClick || !!props.actions?.length
  const duration = props.duration ?? (actionable ? ACTIONABLE_DURATION : DEFAULT_DURATION)
  const toast: Toast = {
    ...props,
    id,
    open: true,
    duration,
    // A toast with no timer MUST be dismissible by hand.
    close: props.close ?? duration === 0,
  }
  const next = [...toasts.value, toast]
  toasts.value = next.length > MAX_VISIBLE ? next.slice(next.length - MAX_VISIBLE) : next
  return toast
}

function update(id: string, props: Partial<ToastProps>): void {
  toasts.value = toasts.value.map((tt) => {
    if (tt.id !== id) return tt
    const merged = { ...tt, ...props, id: tt.id }
    if (props.duration !== undefined && props.close === undefined) {
      merged.close = props.duration === 0 ? true : tt.close
    }
    return merged
  })
}

// Drop a toast from the queue. The host calls this when ToastRoot reports closed
// (timer elapsed / swiped / dismissed), so the exit animation runs first.
function remove(id: string): void {
  toasts.value = toasts.value.filter((tt) => tt.id !== id)
}

function clear(): void {
  toasts.value = []
}

export function useToast() {
  return { toasts, add, update, remove, clear }
}
