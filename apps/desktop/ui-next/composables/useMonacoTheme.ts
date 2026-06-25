import type * as Monaco from 'monaco-editor'
import { computed, readonly, ref } from 'vue'
import { useSidecar } from '~/composables/useSidecar'

// Theme for the Preview Monaco code viewer (ADR 0053). Two kinds of theme:
//   'follow-app' — derive editor colors from the live CSS tokens (dark/light +
//                  accent). Owned by MonacoViewer; reacts to the app theme.
//   curated      — a fixed VSCode-style scheme bundled from `monaco-themes`
//                  (Dracula/Monokai/…). Lazy-loaded JSON; does NOT follow app theme.
//
// The selected theme id persists to `~/.awog/settings.json` (key
// `monacoPreviewTheme`) via the sidecar settings.get/settings.set RPC (ADR 0045) —
// the first app setting ui-next writes to the file (others migrate later). The
// sidecar stores an opaque blob; this composable owns the schema + coercion (the
// file is L1 input). Browser-dev (no sidecar) keeps the value in memory only.
//
// State is module-level so the picker (PreviewToolbar) and the applier
// (MonacoViewer) share one source of truth. SoC: this orchestrates persistence
// only — no DOM / Monaco mutation here (the viewer reads `current` + `loadThemeData`).

export const FOLLOW_APP = 'follow-app'
const SETTINGS_KEY = 'monacoPreviewTheme'

export type MonacoThemeGroup = 'app' | 'dark' | 'light'
export interface MonacoThemeOption {
  id: string
  // Proper-noun themes show their name verbatim (not translated); 'follow-app'
  // has no label and the UI renders an i18n string for it.
  label?: string
  group: MonacoThemeGroup
}

// Curated set (ADR 0053). Loaders are lazy dynamic imports → one chunk each,
// fetched only when the theme is actually applied. Keys map to `monaco-themes`
// file basenames (kept verbatim, spaces and all).
const LOADERS: Record<string, () => Promise<{ default: Monaco.editor.IStandaloneThemeData }>> = {
  dracula: () => import('monaco-themes/themes/Dracula.json'),
  monokai: () => import('monaco-themes/themes/Monokai.json'),
  nord: () => import('monaco-themes/themes/Nord.json'),
  'night-owl': () => import('monaco-themes/themes/Night Owl.json'),
  'tomorrow-night': () => import('monaco-themes/themes/Tomorrow-Night.json'),
  'tomorrow-night-eighties': () => import('monaco-themes/themes/Tomorrow-Night-Eighties.json'),
  cobalt2: () => import('monaco-themes/themes/Cobalt2.json'),
  'oceanic-next': () => import('monaco-themes/themes/Oceanic Next.json'),
  'github-dark': () => import('monaco-themes/themes/GitHub Dark.json'),
  'solarized-dark': () => import('monaco-themes/themes/Solarized-dark.json'),
  'github-light': () => import('monaco-themes/themes/GitHub Light.json'),
  'solarized-light': () => import('monaco-themes/themes/Solarized-light.json'),
  tomorrow: () => import('monaco-themes/themes/Tomorrow.json'),
  clouds: () => import('monaco-themes/themes/Clouds.json'),
  xcode: () => import('monaco-themes/themes/Xcode_default.json'),
  iplastic: () => import('monaco-themes/themes/iPlastic.json'),
}

// Display order + grouping for the picker. Labels are proper nouns (verbatim).
export const MONACO_THEMES: MonacoThemeOption[] = [
  { id: FOLLOW_APP, group: 'app' },
  { id: 'dracula', label: 'Dracula', group: 'dark' },
  { id: 'monokai', label: 'Monokai', group: 'dark' },
  { id: 'nord', label: 'Nord', group: 'dark' },
  { id: 'night-owl', label: 'Night Owl', group: 'dark' },
  { id: 'tomorrow-night', label: 'Tomorrow Night', group: 'dark' },
  { id: 'tomorrow-night-eighties', label: 'Tomorrow Night Eighties', group: 'dark' },
  { id: 'cobalt2', label: 'Cobalt2', group: 'dark' },
  { id: 'oceanic-next', label: 'Oceanic Next', group: 'dark' },
  { id: 'github-dark', label: 'GitHub Dark', group: 'dark' },
  { id: 'solarized-dark', label: 'Solarized Dark', group: 'dark' },
  { id: 'github-light', label: 'GitHub Light', group: 'light' },
  { id: 'solarized-light', label: 'Solarized Light', group: 'light' },
  { id: 'tomorrow', label: 'Tomorrow', group: 'light' },
  { id: 'clouds', label: 'Clouds', group: 'light' },
  { id: 'xcode', label: 'Xcode', group: 'light' },
  { id: 'iplastic', label: 'iPlastic', group: 'light' },
]

const isKnown = (id: string): boolean => id === FOLLOW_APP || id in LOADERS

// Shared (module-level) selected theme id. Default 'follow-app' until the file
// hydrates. Curated theme JSON is cached after first load to avoid refetching.
const current = ref<string>(FOLLOW_APP)
const cache = new Map<string, Monaco.editor.IStandaloneThemeData>()
let hydrated = false

export function useMonacoTheme() {
  const sc = useSidecar()

  // Read the persisted id from settings.json once per app session. No-op outside
  // Electron; any read/coerce failure silently keeps the default.
  async function hydrate(): Promise<void> {
    if (hydrated) return
    hydrated = true
    if (!sc.available) return
    try {
      const blob = await sc.request<Record<string, unknown>>('settings.get')
      const v = blob?.[SETTINGS_KEY]
      if (typeof v === 'string' && isKnown(v)) current.value = v
    } catch {
      // keep default; settings.json is best-effort here
    }
  }

  // Persist the selection. The sidecar shallow-merges this key into settings.json;
  // browser-dev keeps it in memory only.
  async function setTheme(id: string): Promise<void> {
    if (!isKnown(id)) return
    current.value = id
    if (!sc.available) return
    try {
      await sc.request('settings.set', { patch: { [SETTINGS_KEY]: id } })
    } catch {
      // non-fatal — the change stays in memory for this session
    }
  }

  // Resolve the IStandaloneThemeData for a curated id (null for follow-app /
  // unknown). Cached after first load.
  async function loadThemeData(id: string): Promise<Monaco.editor.IStandaloneThemeData | null> {
    if (id === FOLLOW_APP) return null
    const cached = cache.get(id)
    if (cached) return cached
    const loader = LOADERS[id]
    if (!loader) return null
    const data = (await loader()).default
    cache.set(id, data)
    return data
  }

  return {
    current: readonly(current),
    isFollowApp: computed(() => current.value === FOLLOW_APP),
    themes: MONACO_THEMES,
    hydrate,
    setTheme,
    loadThemeData,
  }
}
