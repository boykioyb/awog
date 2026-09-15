import { computed, watch } from 'vue'
import { THINKING_LEVELS } from '~/composables/useSessionsData'
import { isUserStyleId, useOutputStyles } from '~/composables/useOutputStyles'
import type { Session, ThinkingLevel } from '~/composables/useSessionsData'
import type { AccountOption } from '~/composables/useAccounts'

// Session model/account/effort/style config — extracted from SessionComposer so the
// global status bar can surface each as its own footer chip (the composer keeps only
// the per-turn Mode chip). Reads the given session, writes through store actions so
// selections persist + drive engineSettings on the next turn. Pure orchestration.

// Models with no reasoning support — the effort chip hides for these.
const NO_THINK = new Set(['Haiku 4.5', 'GPT-4.1'])

// Built-in response-style catalog. `id` is the engine contract (sent via
// store.setStyle — never translate it); `slug` derives the i18n name/hint keys;
// `icon` is a lucide sprite glyph. Mirrors the (now-removed) composer catalog.
// Styles the USER writes are NOT here: they live on disk and arrive async via
// useOutputStyles — see `styleGroups` below.
type StyleRow = { id: string; slug: string; icon: string }
type StyleGroup = { key: string; rows: StyleRow[] }

// One row as the picker renders it — built-in and user-written styles collapse to
// the same shape so the menu template stays free of "which kind is this" branches
// (built-in names come from i18n, user names from the file's frontmatter).
export type StylePickerRow = {
  // Engine id: a STYLE_DIRECTIVES key, or the file name of a user style.
  slug: string
  icon: string
  name: string
  hint: string
  desc: string
  // Style của người dùng trùng id một style dựng sẵn ⇒ bản của họ được dùng.
  // Nói ra ngay trên hàng, y như Settings → Phong cách.
  overridesBuiltIn: boolean
}
export type StylePickerGroup = { key: string; label: string; rows: StylePickerRow[] }

// Icon dùng chung cho mọi style người dùng tự viết (file trên đĩa không mang icon).
const USER_STYLE_ICON = 'palette'
// Card mô tả rộng 230px — directive có thể dài tới 8000 ký tự, cắt bớt để nó
// không tràn khỏi màn hình khi style không có `description`.
const MAX_STYLE_DESC = 240
const clampDesc = (text: string): string =>
  text.length > MAX_STYLE_DESC ? `${text.slice(0, MAX_STYLE_DESC).trimEnd()}…` : text
const RESPONSE_STYLES: StyleGroup[] = [
  {
    key: 'default',
    rows: [
      { id: 'Normal', slug: 'normal', icon: 'text' },
      // Auto (ADR 0046): the model self-selects a serious style per turn — the
      // sidecar resolves the 'auto' slug via buildStylePrompt (no fixed directive).
      { id: 'Auto', slug: 'auto', icon: 'sparkles' },
    ],
  },
  {
    key: 'fast',
    rows: [
      { id: 'Military', slug: 'military', icon: 'shield' },
      { id: 'Caveman', slug: 'caveman', icon: 'zap' },
      { id: 'Reality Check', slug: 'reality-check', icon: 'search' },
      { id: 'Step by Step', slug: 'step-by-step', icon: 'listol' },
      { id: 'Socratic', slug: 'socratic', icon: 'help' },
      { id: 'BLUF', slug: 'bluf', icon: 'pin' },
      { id: 'Checklist', slug: 'checklist', icon: 'listul' },
      { id: 'Code First', slug: 'code-first', icon: 'code' },
    ],
  },
  {
    key: 'fun',
    rows: [
      { id: 'Yoda', slug: 'yoda', icon: 'sparkles' },
      { id: 'Pirate', slug: 'pirate', icon: 'flag' },
      { id: '80s Hacker', slug: 'hacker-80s', icon: 'save' },
      { id: 'Dad Joke', slug: 'dad-joke', icon: 'smile' },
      { id: 'Noir', slug: 'noir', icon: 'moon' },
      { id: 'Speedrun', slug: 'speedrun', icon: 'forward' },
      { id: 'Corporate', slug: 'corporate', icon: 'globe' },
    ],
  },
  {
    key: 'deep',
    rows: [
      { id: 'Rubber Duck', slug: 'rubber-duck', icon: 'message' },
      { id: 'Feynman', slug: 'feynman', icon: 'bulb' },
      { id: 'First Principles', slug: 'first-principles', icon: 'layers' },
      { id: "Devil's Advocate", slug: 'devils-advocate', icon: 'alert' },
      { id: 'Mentor', slug: 'mentor', icon: 'brain' },
      { id: 'Pair', slug: 'pair', icon: 'fork' },
    ],
  },
]
const ALL_STYLE_ROWS = RESPONSE_STYLES.flatMap((g) => g.rows)
const STYLE_SLUGS = new Set(ALL_STYLE_ROWS.map((r) => r.slug))
// Styles that once existed but were removed from the catalog (their directive is gone
// from the sidecar too). Map them to Normal so an old session that still stores one
// degrades cleanly in the UI — matching the sidecar's "unknown id → no style".
const REMOVED_STYLE_SLUGS = new Set(['git-log', 'git log'])
// Display label (`row.id`, e.g. "Pirate") → engine slug ("pirate"). A pre-fix bug
// stored/sent the label as `responseStyle`, so we translate it back here.
const SLUG_BY_LABEL = new Map(ALL_STYLE_ROWS.map((r) => [r.id, r.slug]))

// Canonicalize a stored/selected style value to the ENGINE ID (a STYLE_DIRECTIVES
// key in the sidecar, or the file name of a style the user wrote), or 'Default'
// for no-style. The engine only knows ids ('pirate', 'hacker-80s', 'my-haiku'…),
// so this is what must be sent as `responseStyle`.
// Accepts: a built-in slug (passthrough), the id of a user style (WP12 —
// checked FIRST, see below), a display label (the identity the UI wrongly
// persisted before this fix → mapped back so old sessions round-trip), or the
// Default/Normal sentinels. An unknown value still passes through: the sidecar
// resolves it and logs LOUDLY when it cannot, which beats this layer quietly
// rewriting the user's choice to "no style".
export function normalizeStyleSlug(value: string | undefined | null): string {
  if (!value || value === 'Default' || value === 'Normal' || value === 'normal') return 'Default'
  // A style the user wrote outranks every legacy rule below — its id is what the
  // sidecar resolves first, and nothing stops them from naming a file after a
  // slug we once shipped and later removed ('git-log'). Checking this first is
  // what keeps such a style from being degraded to Default behind their back.
  // Before the list loads this is false, and the value falls through to the
  // passthrough on the last line — still not a silent degrade.
  if (isUserStyleId(value)) return value
  if (REMOVED_STYLE_SLUGS.has(value)) return 'Default'
  if (STYLE_SLUGS.has(value)) return value
  return SLUG_BY_LABEL.get(value) ?? value
}

export function useSessionModelConfig(session: () => Session) {
  const { t } = useI18n()
  const store = useSessionsStore()
  const { providerOf } = useSessionsData()
  const { accounts, accountById, modelsForAccount } = useAccounts()
  const { stylesForProject, stylesScanned, ensureStylesLoaded } = useOutputStyles()

  // ── Model ──
  const selectedModel = computed(() => session().model || 'Opus 5')
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
    // Nothing connected yet (fresh install): say so, rather than naming a provider
    // the user has no account for.
    if (!disp && !accounts.value.length) return t('sessions.config.noAccount')
    // An accountId we cannot resolve means `disp` is a hydrate fallback carrying the
    // raw sidecar id ("acc_… · Anthropic") — show the provider tail, never the id.
    if (selectedAccountId.value) return providerOf(disp)
    const idx = disp.lastIndexOf(' · ')
    return (idx > 0 ? disp.slice(0, idx) : disp) || providerOf(disp)
  })
  function selectAccount(a: AccountOption) {
    store.selectAccount(session().id, { id: a.id, display: a.display })
  }

  // ── Reasoning effort (thinking) ──
  // Same catalog + same localized labels as Settings → Defaults and the per-project
  // LLM defaults, so the three pickers always offer the same wording and options.
  const THINK = computed<[ThinkingLevel, string][]>(() =>
    THINKING_LEVELS.map((lv) => [lv, t(`common.thinking.${lv}`)]),
  )
  const thinkSupported = computed(() => !NO_THINK.has(selectedModel.value))
  const thinking = computed<ThinkingLevel>(() => session().thinkingLevel ?? 'high')
  // Bậc "Ultracode" (ADR 0089) là bậc THỨ SÁU của chính picker này, nhưng chỉ tồn
  // tại trên nhánh Claude SDK: SDK cấp nó như một cờ riêng trong `Settings` (xhigh
  // + điều phối dynamic-workflow), không phải một giá trị của `effort`. Provider
  // khác không có gì tương đương ⇒ ẩn hàng thay vì hiện một lựa chọn không chạy.
  const ultracodeSupported = computed(
    () => thinkSupported.value && store.providerOf(session()) === 'anthropic',
  )
  const ultracodeOn = computed(() => ultracodeSupported.value && !!session().ultracode)
  const thinkingLabel = computed(() =>
    ultracodeOn.value
      ? t('common.thinking.ultracode')
      : (THINK.value.find(([v]) => v === thinking.value)?.[1] ?? t('common.thinking.high')),
  )
  function selectThink(v: ThinkingLevel) {
    if (thinkSupported.value) store.setThinking(session().id, v)
  }
  function selectUltracode() {
    if (ultracodeSupported.value) store.setUltracode(session().id)
  }

  // ── Response style + no-markdown ──
  // Identity is the engine ID throughout (matches the sidecar STYLE_DIRECTIVES +
  // the persisted `responseStyle`); the display label comes from i18n for built-ins
  // and from the file's frontmatter for user styles. 'Default' (no style) surfaces
  // as the 'normal' row for highlight/label purposes.
  const activeStyleId = computed(() => {
    const slug = normalizeStyleSlug(session().style)
    return slug === 'Default' ? 'normal' : slug
  })

  // Styles the user wrote, scoped to THIS session's project (global tier + this
  // project's tier only — a style living in another project's repo must not show
  // up here, it would not resolve at turn time either).
  const projectId = computed(() => session().project || '')
  const userStyles = computed<StylePickerRow[]>(() =>
    stylesForProject(projectId.value).map((s) => ({
      slug: s.id,
      icon: USER_STYLE_ICON,
      name: s.name || s.id,
      hint: s.description,
      desc: s.description || clampDesc(s.body),
      overridesBuiltIn: STYLE_SLUGS.has(s.id),
    })),
  )
  // Warm the list as soon as a session is on screen (and again if it moves to
  // another project) so the picker is already complete by the time it is opened.
  // Deliberately not awaited: the menu renders the built-ins meanwhile.
  watch(projectId, (id) => void ensureStylesLoaded(id ? [id] : []), { immediate: true })

  const styleGroups = computed<StylePickerGroup[]>(() => {
    const mine = userStyles.value
    // Same id ⇒ the user's file wins at turn time, so the built-in row must GO:
    // two identical-looking rows where only one has any effect is a trap.
    const shadowed = new Set(mine.filter((r) => r.overridesBuiltIn).map((r) => r.slug))
    const groups: StylePickerGroup[] = []
    for (const g of RESPONSE_STYLES) {
      const rows = g.rows
        .filter((r) => !shadowed.has(r.slug))
        .map<StylePickerRow>((r) => ({
          slug: r.slug,
          icon: r.icon,
          name: t(`sessions.style.${r.slug}.name`),
          hint: t(`sessions.style.${r.slug}.hint`),
          desc: t(`sessions.style.${r.slug}.desc`),
          overridesBuiltIn: false,
        }))
      if (rows.length) groups.push({ key: g.key, label: t(`sessions.style.group.${g.key}`), rows })
      // Right below Normal/Auto: close to the top (the user's own styles are what
      // they reach for) without pushing the default off the first screen.
      if (g.key === 'default' && mine.length) {
        groups.push({ key: 'mine', label: t('settingsStyles.mine.heading'), rows: mine })
      }
    }
    return groups
  })

  const styleName = computed(() => {
    const slug = normalizeStyleSlug(session().style)
    if (slug === 'Default') return t('sessions.style.normal.name')
    // User style first — mirrors the sidecar's resolve order for a shadowed id.
    const mine = userStyles.value.find((r) => r.slug === slug)
    if (mine) return mine.name
    if (STYLE_SLUGS.has(slug)) return t(`sessions.style.${slug}.name`)
    // Scanned this project and still nothing: the file was deleted or renamed on
    // disk (or belongs to another project). Say so — a bare id reads like a working
    // selection, and the turn will run with no style at all. Until the scan covers
    // this project, show the raw id rather than accusing a style that may well exist.
    return stylesScanned(projectId.value) ? t('settingsStyles.picker.missing', { id: slug }) : slug
  })
  const noMd = computed(() => session().noMarkdown ?? false)
  // Receives the row's SLUG. 'normal' collapses to the 'Default' no-style sentinel.
  function selectStyle(slug: string) {
    store.setStyle(session().id, slug === 'normal' ? 'Default' : slug)
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
    ultracodeSupported,
    ultracodeOn,
    selectUltracode,
    THINK,
    selectThink,
    activeStyleId,
    styleName,
    styleGroups,
    noMd,
    selectStyle,
    toggleNoMd,
  }
}
