import { ref } from 'vue'
import { useTheme } from '~/composables/useTheme'

// Proto-only color-scheme picker (light / dark / system) — the shadcn docs
// ModeToggle contract. 'system' tracks prefers-color-scheme live. The resolved
// value feeds the same `body.light` + `awog-theme` storage the real theme uses,
// so the proto and the rest of the app never disagree.
export type ProtoScheme = 'light' | 'dark' | 'system'

const STORAGE_SCHEME = 'awog-proto-scheme'
const mode = ref<ProtoScheme>('dark')

let media: MediaQueryList | undefined
let mediaBound = false

export function useProtoTheme() {
  const { isDark } = useTheme()

  function apply() {
    const dark = mode.value === 'system' ? (media?.matches ?? true) : mode.value === 'dark'
    isDark.value = dark
    document.body.classList.toggle('light', !dark)
    localStorage.setItem('awog-theme', dark ? 'dark' : 'light')
  }

  function setMode(m: ProtoScheme) {
    mode.value = m
    localStorage.setItem(STORAGE_SCHEME, m)
    apply()
  }

  function init() {
    const saved = localStorage.getItem(STORAGE_SCHEME)
    if (saved === 'light' || saved === 'dark' || saved === 'system') mode.value = saved
    media ??= window.matchMedia('(prefers-color-scheme: dark)')
    if (!mediaBound) {
      media.addEventListener('change', () => {
        if (mode.value === 'system') apply()
      })
      mediaBound = true
    }
    // app.vue's useTheme().init() runs after children mount — re-assert our mode
    // on the next tick so the restored scheme wins the paint.
    apply()
    setTimeout(apply, 0)
  }

  return { mode, setMode, init, isDark }
}
