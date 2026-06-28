import { computed } from 'vue'
import type { Session, ThinkingLevel } from '~/composables/useSessionsData'
import type { AccountOption } from '~/composables/useAccounts'

// Session model/account/effort/style config — extracted from SessionComposer so the
// global status bar can surface each as its own footer chip (the composer keeps only
// the per-turn Mode chip). Reads the given session, writes through store actions so
// selections persist + drive engineSettings on the next turn. Pure orchestration.

// Thinking (reasoning effort) levels + the models that don't support it.
const THINK: [ThinkingLevel, string][] = [
  ['low', 'Low'],
  ['medium', 'Medium'],
  ['high', 'High'],
  ['extra-high', 'Extra high'],
  ['max', 'Max'],
]
const NO_THINK = new Set(['Haiku 4.5', 'GPT-4.1'])

// Response-style catalog. `id` is the engine contract (sent via store.setStyle —
// never translate it); `slug` derives the i18n name/hint keys; `icon` is a lucide
// sprite glyph. Mirrors the (now-removed) composer catalog.
export type StyleRow = { id: string; slug: string; icon: string }
export type StyleGroup = { key: string; rows: StyleRow[] }
const RESPONSE_STYLES: StyleGroup[] = [
  { key: 'default', rows: [{ id: 'Normal', slug: 'normal', icon: 'text' }] },
  {
    key: 'fast',
    rows: [
      { id: 'Military', slug: 'military', icon: 'shield' },
      { id: 'Caveman', slug: 'caveman', icon: 'zap' },
      { id: 'Reality Check', slug: 'reality-check', icon: 'search' },
      { id: 'git log', slug: 'git-log', icon: 'git' },
      { id: 'Socratic', slug: 'socratic', icon: 'help' },
      { id: 'BLUF', slug: 'bluf', icon: 'pin' },
    ],
  },
  {
    key: 'fun',
    rows: [
      { id: 'Yoda', slug: 'yoda', icon: 'sparkles' },
      { id: 'Pirate', slug: 'pirate', icon: 'flag' },
      { id: '80s Hacker', slug: 'hacker-80s', icon: 'save' },
      { id: 'Dad Joke', slug: 'dad-joke', icon: 'smile' },
    ],
  },
  {
    key: 'deep',
    rows: [
      { id: 'Rubber Duck', slug: 'rubber-duck', icon: 'message' },
      { id: 'Feynman', slug: 'feynman', icon: 'bulb' },
      { id: 'First Principles', slug: 'first-principles', icon: 'layers' },
    ],
  },
]
const STYLE_SLUG = new Map(RESPONSE_STYLES.flatMap((g) => g.rows).map((r) => [r.id, r.slug]))

export function useSessionModelConfig(session: () => Session) {
  const { t } = useI18n()
  const store = useSessionsStore()
  const { providerOf } = useSessionsData()
  const { accounts, accountById, modelsForAccount } = useAccounts()

  // ── Model ──
  const selectedModel = computed(() => session().model || 'Opus 4.8')
  const selectedAccountId = computed(() => session().accountId ?? '')
  const selectedAccountDisplay = computed(() => session().account || '')
  const availableModels = computed(() => {
    const opt = selectedAccountId.value ? accountById(selectedAccountId.value) : undefined
    if (opt) return modelsForAccount(opt)
    return modelsForAccount({
      id: '',
      label: '',
      provider: providerOf(selectedAccountDisplay.value),
      providerDisplay: providerOf(selectedAccountDisplay.value),
      display: selectedAccountDisplay.value,
    })
  })
  function selectModel(m: string) {
    store.setModel(session().id, m)
  }

  // ── Account ──
  // Concise account LABEL (e.g. "Malme Co (tran.quang_hoa)") — with several accounts
  // on one provider, the provider name alone can't say which is active.
  const accountShort = computed(() => {
    const opt = selectedAccountId.value ? accountById(selectedAccountId.value) : undefined
    if (opt?.label) return opt.label
    const disp = selectedAccountDisplay.value
    const idx = disp.lastIndexOf(' · ')
    return (idx > 0 ? disp.slice(0, idx) : disp) || providerOf(disp)
  })
  function selectAccount(a: AccountOption) {
    store.selectAccount(session().id, { id: a.id, display: a.display })
  }

  // ── Reasoning effort (thinking) ──
  const thinkSupported = computed(() => !NO_THINK.has(selectedModel.value))
  const thinking = computed<ThinkingLevel>(() => session().thinkingLevel ?? 'high')
  const thinkingLabel = computed(() => THINK.find(([v]) => v === thinking.value)?.[1] ?? 'High')
  function selectThink(v: ThinkingLevel) {
    if (thinkSupported.value) store.setThinking(session().id, v)
  }

  // ── Response style + no-markdown ──
  const activeStyleId = computed(() => {
    const st = session().style
    return st && st !== 'Default' ? st : 'Normal'
  })
  const styleName = computed(() => {
    const st = session().style
    const slug = st && st !== 'Default' ? (STYLE_SLUG.get(st) ?? null) : 'normal'
    return slug ? t(`sessions.style.${slug}.name`) : (st ?? t('sessions.style.normal.name'))
  })
  const noMd = computed(() => session().noMarkdown ?? false)
  function selectStyle(id: string) {
    store.setStyle(session().id, id === 'Normal' ? 'Default' : id)
  }
  function toggleNoMd() {
    store.setNoMarkdown(session().id, !noMd.value)
  }

  return {
    accounts,
    selectedModel,
    availableModels,
    selectModel,
    selectedAccountId,
    accountShort,
    selectAccount,
    thinking,
    thinkingLabel,
    thinkSupported,
    THINK,
    selectThink,
    activeStyleId,
    styleName,
    RESPONSE_STYLES,
    noMd,
    selectStyle,
    toggleNoMd,
  }
}
