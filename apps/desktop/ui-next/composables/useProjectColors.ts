// Per-project accent color for the session-list group dot (.pdot). A user
// preference set from the project group context menu, persisted per-machine in
// localStorage keyed by engine projectId. Replaces the old hardcoded PCOL seed —
// every project now starts neutral and the user paints the ones they care about.
// SoC: this is UI display only; the sidecar / Project entity is unaware of the
// dot color. Theme tokens (var(--…)) are stored so the choice stays theme-safe.
import { ref, type Ref } from 'vue'

const STORAGE_KEY = 'awog.projects.colors'

// Curated palette offered in the picker. Tokens resolve per theme, so a saved
// choice reads correctly in both dark and light. `label` feeds the swatch tooltip.
export const PROJECT_COLOR_PALETTE: { token: string; label: string }[] = [
  { token: 'var(--accent)', label: 'Accent' },
  { token: 'var(--blue)', label: 'Blue' },
  { token: 'var(--violet)', label: 'Violet' },
  { token: 'var(--green)', label: 'Green' },
  { token: 'var(--amber)', label: 'Amber' },
  { token: 'var(--danger)', label: 'Red' },
]

// Neutral fallback for projects the user hasn't colored.
export const PROJECT_COLOR_DEFAULT = 'var(--textDim)'

// A stored value is "custom" when it's a raw hex the user picked from the native
// color picker (e.g. `#ff5733`) — i.e. not a theme token from the palette and not
// the neutral default. Used by the picker UI to highlight the custom swatch.
export function isCustomColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value)
}

function read(): Record<string, string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    if (raw && typeof raw === 'object') {
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(raw as Record<string, unknown>))
        if (typeof v === 'string') out[k] = v
      return out
    }
  } catch {
    // Corrupt value → start empty (every project neutral).
  }
  return {}
}

// Lazy module singleton so every consumer shares one reactive map (and the
// localStorage read happens once, on first use — not at module eval).
let colors: Ref<Record<string, string>> | null = null

export function useProjectColors() {
  if (!colors) colors = ref<Record<string, string>>(read())
  const map = colors

  const colorOf = (projectId: string): string => map.value[projectId] ?? PROJECT_COLOR_DEFAULT

  // Set a color token, or pass null to clear back to the neutral default.
  const setColor = (projectId: string, token: string | null): void => {
    const next = { ...map.value }
    if (token) next[projectId] = token
    else delete next[projectId]
    map.value = next
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }

  return { colorOf, setColor }
}
