import { onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { buzz } from './notify'

// Touch/scroll helpers shared by the list-style views. Everything here is
// hand-rolled — the PWA deliberately carries no gesture library.

// Pull-to-refresh. The scroller must be at scrollTop 0 when the finger lands;
// from there a downward drag opens the indicator with damping, and past the
// threshold a release fires onRefresh. While engaged we preventDefault the
// touchmove, which is also what stops iOS's rubber-band from double-animating
// the same gesture.
export function usePullToRefresh(
  scroller: Ref<HTMLElement | null>,
  onRefresh: () => void | Promise<void>,
): { pull: Ref<number>; refreshing: Ref<boolean>; engaged: Ref<boolean>; threshold: number } {
  const threshold = 64
  const pull = ref(0)
  const refreshing = ref(false)
  const engaged = ref(false)
  let startY = 0
  let active = false

  function onStart(e: TouchEvent): void {
    const el = scroller.value
    if (!el || refreshing.value) return
    if (el.scrollTop > 0.5) return
    startY = e.touches[0].clientY
    active = true
  }

  function onMove(e: TouchEvent): void {
    if (!active) return
    const el = scroller.value
    if (!el) {
      active = false
      return
    }
    const dy = e.touches[0].clientY - startY
    // Finger reversed upward, or content scrolled away from the top — the
    // gesture is over, hand control back to the scroller.
    if (dy <= 0 || el.scrollTop > 0.5) {
      active = false
      engaged.value = false
      pull.value = 0
      return
    }
    engaged.value = true
    pull.value = Math.min(dy * 0.45, 96)
    if (pull.value > 6 && e.cancelable) e.preventDefault()
  }

  function onEnd(): void {
    if (!active) return
    active = false
    engaged.value = false
    if (pull.value >= threshold) {
      refreshing.value = true
      pull.value = 44
      buzz(8)
      Promise.resolve(onRefresh()).finally(() => {
        refreshing.value = false
        pull.value = 0
      })
    } else {
      pull.value = 0
    }
  }

  let bound: HTMLElement | null = null
  function bind(el: HTMLElement | null): void {
    if (bound) {
      bound.removeEventListener('touchstart', onStart)
      bound.removeEventListener('touchmove', onMove)
      bound.removeEventListener('touchend', onEnd)
      bound.removeEventListener('touchcancel', onEnd)
    }
    bound = el
    if (el) {
      el.addEventListener('touchstart', onStart, { passive: true })
      // passive:false — preventDefault inside onMove is what suppresses the
      // browser's own overscroll while a pull is engaged.
      el.addEventListener('touchmove', onMove, { passive: false })
      el.addEventListener('touchend', onEnd, { passive: true })
      el.addEventListener('touchcancel', onEnd, { passive: true })
    }
  }

  watch(scroller, (el) => bind(el), { immediate: true, flush: 'post' })
  onBeforeUnmount(() => bind(null))

  return { pull, refreshing, engaged, threshold }
}

// Scroll-driven collapse flag for the iOS large-title pattern: false while the
// big title is on screen, true once the scroller passes `offset`.
export function useScrollCollapse(
  scroller: Ref<HTMLElement | null>,
  offset = 36,
): Ref<boolean> {
  const collapsed = ref(false)
  function onScroll(): void {
    collapsed.value = (scroller.value?.scrollTop ?? 0) > offset
  }
  let bound: HTMLElement | null = null
  watch(
    scroller,
    (el) => {
      bound?.removeEventListener('scroll', onScroll)
      bound = el
      el?.addEventListener('scroll', onScroll, { passive: true })
      onScroll()
    },
    { immediate: true, flush: 'post' },
  )
  onBeforeUnmount(() => bound?.removeEventListener('scroll', onScroll))
  return collapsed
}
