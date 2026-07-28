import { ref } from 'vue'
import { useSidecar } from '~/composables/useSidecar'
import { useSettingsStore } from '~/stores/settings'
import { useProjectsStore } from '~/stores/projects'
import type { ProviderName } from '~/types'

// Shared, app-wide "translate the highlighted text" state (selection-to-translate).
// A single SelectionTranslatePopover instance (mounted in the layout, like the
// shared PreviewModal) reads this store so any host — a session transcript, the
// preview modal — can pop a translation without prop-drilling. Module-level refs
// → one source of truth for every caller; hosts detect the selection + render the
// floating trigger button, then call open() with the source text and its rect.

// Translation targets, ordered by priority (vi, en, ja). LANG_LABEL maps each to
// the language NAME the text.translate / gh.translate RPC expects. Lifted here so
// both this feature and useProjectGh share one definition.
export type TranslateLang = 'vi' | 'en' | 'ja'
export const TRANSLATE_LANGS: readonly TranslateLang[] = ['vi', 'en', 'ja'] as const
export const LANG_LABEL: Record<TranslateLang, string> = {
  vi: 'Vietnamese',
  en: 'English',
  ja: 'Japanese',
}

// Viewport-space anchor (fixed positioning) the popover places itself against.
export interface SelAnchor {
  cx: number
  top: number
  bottom: number
}

// A DOMRect-like shape (hosts pass the live selection rect). Only the fields the
// anchor needs — a real DOMRect satisfies this structurally.
export interface RectLike {
  left: number
  top: number
  bottom: number
  width: number
}

interface TranslateState {
  text: string
  anchor: SelAnchor
  provider: ProviderName
  modelId: string
  accountId?: string
}

const STORAGE_KEY = 'awog.translate.lang'

function loadLang(): TranslateLang {
  if (typeof localStorage === 'undefined') return 'vi'
  const v = localStorage.getItem(STORAGE_KEY)
  return v === 'vi' || v === 'en' || v === 'ja' ? v : 'vi'
}

// ── module-singleton state ──────────────────────────────────────────────────
const active = ref<TranslateState | null>(null)
const lang = ref<TranslateLang>(loadLang())
const loading = ref(false)
const result = ref<string | null>(null)
const error = ref(false)
const copied = ref(false)
// (lang, sourceText) → translated text. Toggling language re-uses a prior result
// instead of re-calling the model.
const cache = new Map<string, string>()

let copyTimer: ReturnType<typeof setTimeout> | null = null

export function useSelectionTranslate() {
  const sc = useSidecar()
  const settings = useSettingsStore()
  const projects = useProjectsStore()

  // Resolution order: a pinned translate setting wins; otherwise fall back to the
  // session-style resolution (project llmDefaults → app defaults).
  function resolveLlm(projectId?: string): {
    provider: ProviderName
    modelId: string
    accountId?: string
  } {
    const tr = settings.translate
    if (tr && !tr.followAppDefault) {
      return {
        provider: tr.provider,
        modelId: tr.modelId,
        ...(tr.accountId ? { accountId: tr.accountId } : {}),
      }
    }
    const ld = projectId ? projects.projectById(projectId)?.llmDefaults : undefined
    if (ld) {
      return {
        provider: ld.provider,
        modelId: ld.modelId,
        ...(ld.accountId ? { accountId: ld.accountId } : {}),
      }
    }
    return { provider: settings.defaults.provider, modelId: settings.defaults.modelId }
  }

  async function translateActive(): Promise<void> {
    const st = active.value
    if (!st) return
    const key = `${lang.value}::${st.text}`
    const cached = cache.get(key)
    if (cached !== undefined) {
      result.value = cached
      loading.value = false
      error.value = false
      return
    }
    loading.value = true
    error.value = false
    result.value = null
    const forLang = lang.value
    try {
      if (!sc.available) throw new Error('engine unavailable')
      const res = await sc.request<{ text: string }>('text.translate', {
        text: st.text,
        targetLang: LANG_LABEL[forLang],
        provider: st.provider,
        modelId: st.modelId,
        ...(st.accountId ? { accountId: st.accountId } : {}),
      })
      cache.set(`${forLang}::${st.text}`, res.text)
      // Ignore a stale response if the popover closed or the language changed.
      if (active.value === st && lang.value === forLang) result.value = res.text
    } catch {
      if (active.value === st && lang.value === forLang) error.value = true
    } finally {
      if (active.value === st && lang.value === forLang) loading.value = false
    }
  }

  // Open the popover for `text`, anchored to its selection rect. `projectId`
  // resolves the LLM defaults (undefined → app defaults).
  function open(text: string, rect: RectLike, projectId?: string): void {
    const trimmed = text.trim()
    if (!trimmed) return
    const llm = resolveLlm(projectId)
    active.value = {
      text: trimmed,
      anchor: { cx: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom },
      provider: llm.provider,
      modelId: llm.modelId,
      ...(llm.accountId ? { accountId: llm.accountId } : {}),
    }
    copied.value = false
    void translateActive()
  }

  function setLang(next: TranslateLang): void {
    if (next === lang.value) return
    lang.value = next
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, next)
    copied.value = false
    if (active.value) void translateActive()
  }

  function retry(): void {
    if (active.value) void translateActive()
  }

  function close(): void {
    active.value = null
    result.value = null
    error.value = false
    loading.value = false
    copied.value = false
  }

  async function copyResult(): Promise<void> {
    if (!result.value) return
    try {
      await navigator.clipboard.writeText(result.value)
      copied.value = true
      if (copyTimer) clearTimeout(copyTimer)
      copyTimer = setTimeout(() => {
        copied.value = false
      }, 1400)
    } catch {
      // clipboard denied — silent (the text stays visible to copy manually)
    }
  }

  return {
    active,
    lang,
    loading,
    result,
    error,
    copied,
    TRANSLATE_LANGS,
    LANG_LABEL,
    open,
    setLang,
    retry,
    close,
    copyResult,
  }
}
