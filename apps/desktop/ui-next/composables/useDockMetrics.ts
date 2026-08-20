import { ref } from 'vue'

// Geometry of the app-wide bottom dock (the global terminal), shared between the dock,
// the page that owns a leading rail, and the CSS that reserves room for it.
//
// WHY this exists: the dock is a SINGLE app-lifetime mount in the layout — that is what
// lets its PTYs survive navigation — so it cannot be a DOM child of a page's detail
// column. Left in the layout's flex column it would take height from the ENTIRE page row,
// shortening the Sessions list and leaving a dead gap beneath it. So the dock is
// positioned over the bottom of `.main` instead, and these two numbers are what make that
// read as a real panel:
//
//   inset  — how far in from the left the dock starts, published by a page that has a
//            leading rail (the resizable Sessions list). The dock then lines up with the
//            detail column instead of running under the rail. 0 on every other page.
//   height — the dock's actual rendered height, published by the dock itself (measured,
//            not assumed, so a collapsed header / a resize drag / a theme with different
//            header padding all stay correct). CSS mirrors it as `--awog-dock-h` and the
//            column underneath reserves that much padding, so nothing hides behind it.
//
// Module-level refs so every consumer shares one value with no prop plumbing.
//
// Pages are <NuxtPage keepalive>, so a page MUST clear its inset on `onDeactivated` (not
// just `onUnmounted`, which never fires for a cached page) and re-publish on
// `onActivated` — otherwise every other page renders the dock indented by a rail it does
// not have.
const inset = ref(0)
const height = ref(0)

export function useDockMetrics() {
  const setInset = (px: number) => {
    inset.value = Math.max(0, Math.round(px))
  }
  const clearInset = () => {
    inset.value = 0
  }
  // Mirrored to CSS so purely-presentational rules (which column reserves room) stay in
  // the stylesheet instead of being computed per page in JS.
  const setDockHeight = (px: number) => {
    height.value = Math.max(0, Math.round(px))
    document.documentElement.style.setProperty('--awog-dock-h', `${height.value}px`)
  }
  return { inset, height, setInset, clearInset, setDockHeight }
}
