import { onBeforeUnmount, onMounted, toValue, type MaybeRefOrGetter } from 'vue'

// Close a modal/overlay on Escape from anywhere on screen. Uses a window-level
// keydown listener — so ESC fires even when focus isn't inside the overlay (a
// button, a drag handle, the backdrop) — gated on `isOpen` and torn down on unmount.
//
// `isOpen` is a ref or getter the caller composes, which is where any extra guard
// goes: e.g. a <KeepAlive>-cached SessionDetail passes `() => isActive.value &&
// !!notePop.value` so a hidden-but-mounted instance can't swallow the key for the
// session now on screen.
//
// `preventDefault` (default true) calls e.preventDefault() so the ESC doesn't also
// fire a browser default action (e.g. leaving fullscreen); pass false for a modal
// that should leave the key's default untouched.
export function useEscToClose(
  isOpen: MaybeRefOrGetter<boolean>,
  onClose: () => void,
  options: { preventDefault?: boolean } = {},
) {
  const { preventDefault = true } = options
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !toValue(isOpen)) return
    if (preventDefault) e.preventDefault()
    onClose()
  }
  onMounted(() => window.addEventListener('keydown', onKey))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
}
