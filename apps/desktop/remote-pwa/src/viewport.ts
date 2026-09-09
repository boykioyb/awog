import { ref } from 'vue'

// Virtual-keyboard aware layout.
//
// On a phone the software keyboard does NOT shrink the layout viewport (iOS
// Safari never does; Android only with `interactive-widget=resizes-content`), so
// a bottom-docked composer ends up UNDER the keyboard. The visual viewport does
// report the real visible box — we turn the difference into `--kb` and let the
// app shell subtract it, which keeps the composer (and any bottom sheet) sitting
// right on top of the keyboard.
//
// `--sab` shadows the safe-area inset while the keyboard is open: the home-bar
// padding is meaningless then and would just add dead space.

export const keyboardInset = ref(0)

export function initViewport(): void {
  const vv = window.visualViewport
  if (!vv) return
  const root = document.documentElement

  const sync = (): void => {
    // While the page is pinch-zoomed the visual viewport is smaller than the
    // layout viewport for a reason that has nothing to do with the keyboard, so
    // the difference is not an inset — subtracting it would shrink the app under
    // the user's fingers. (iOS has always ignored `user-scalable=no`; now that
    // the meta tag no longer sets it — WCAG 1.4.4 — Android can zoom too.)
    if (vv.scale > 1.01) {
      if (keyboardInset.value === 0) return
      keyboardInset.value = 0
      root.style.setProperty('--kb', '0px')
      root.style.removeProperty('--sab')
      return
    }
    // offsetTop matters when the browser scrolls the visual viewport itself.
    const px = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
    if (px === keyboardInset.value) return
    keyboardInset.value = px
    root.style.setProperty('--kb', `${px}px`)
    if (px > 0) root.style.setProperty('--sab', '0px')
    else root.style.removeProperty('--sab')
  }

  vv.addEventListener('resize', sync)
  vv.addEventListener('scroll', sync)
  // iOS scrolls the whole document to reveal a focused field; the shell already
  // resized for the keyboard, so pull it back to avoid a half-scrolled header.
  window.addEventListener('focusin', () => {
    requestAnimationFrame(() => window.scrollTo(0, 0))
  })
  sync()
}
