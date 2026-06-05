import { defineStore } from 'pinia'
import { ref } from 'vue'

// Standalone "Session Info" panel — a right-docked overlay floating over the
// chat, separate from the Workspace tools drawer (Diff / Files / Terminal …).
// Open state is per-session (`openBySession[id]`); `widthPx` is a global
// ergonomic persisted to localStorage like the workspace panel. The real upper
// cap is the chat area itself — enforced live in SessionInfoPanel (drag clamps
// to the offsetParent + CSS max-width: 100%).

const WIDTH_KEY = 'awog.sessionInfoPanel.width'

const DEFAULT_WIDTH = 360
const MIN_WIDTH = 280
const MAX_WIDTH = 1920

const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n))

const readWidth = (): number => {
  if (typeof window === 'undefined') return DEFAULT_WIDTH
  const n = Number(window.localStorage.getItem(WIDTH_KEY))
  return Number.isFinite(n) && n > 0 ? clamp(n, MIN_WIDTH, MAX_WIDTH) : DEFAULT_WIDTH
}

export const useSessionInfoPanelStore = defineStore('sessionInfoPanel', () => {
  const widthPx = ref<number>(readWidth())
  // Absent / false = closed for that session.
  const openBySession = ref<Record<string, boolean>>({})

  const isOpen = (sessionId: string): boolean => openBySession.value[sessionId] ?? false

  const open = (sessionId: string): void => {
    openBySession.value = { ...openBySession.value, [sessionId]: true }
  }
  const close = (sessionId: string): void => {
    openBySession.value = { ...openBySession.value, [sessionId]: false }
  }
  const toggle = (sessionId: string): void => {
    if (isOpen(sessionId)) close(sessionId)
    else open(sessionId)
  }

  // Live during drag — clamps but does not persist. Commit on drag end.
  const setWidth = (px: number): void => {
    widthPx.value = clamp(px, MIN_WIDTH, MAX_WIDTH)
  }
  const commitWidth = (): void => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(WIDTH_KEY, String(widthPx.value))
    } catch {
      // ignore quota / privacy-mode errors
    }
  }

  return { widthPx, isOpen, open, close, toggle, setWidth, commitWidth }
})
