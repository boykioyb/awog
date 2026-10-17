import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type { AppSelectOption } from '~/components/common/AppSelect.vue'
import { ACTIVE_ACCOUNT, useLlmPicker, type LlmPick } from '~/composables/useLlmPicker'
import { useSlackTranslation } from '~/composables/useSlackTranslation'
import { useToast } from '~/composables/useToast'
import { useSettingsStore } from '~/stores/settings'
import {
  useSlackStore,
  type SlackLlmSetting,
  type SlackTranslateSettings,
  type SlackTranslateStyle,
} from '~/stores/slack'
import { SLACK_LANGS, SLACK_SEND_CHOICES, sendChoiceId } from '~/utils/slack-langs'

// Controller của bảng Cài đặt dịch Slack (SlackSettingsDialog). Cài đặt nằm ở sidecar
// (`slack.settings.*`) để modal và cửa sổ Slack riêng dùng chung.
//
// Bản LOCAL (`local`) giữ lựa chọn trong bảng: đổi provider kéo theo chỉnh model ngay
// trong cùng một lượt (useLlmPicker đọc lại giá trị vừa đặt) — đọc thẳng từ store thì
// lượt thứ hai vẫn thấy provider cũ vì RPC chưa về. Ghi xuống sidecar gom bằng debounce
// ngắn; đóng bảng thì ghi ngay phần còn chờ. Bảng thuật ngữ có nút Lưu riêng.

const SAVE_DEBOUNCE_MS = 300
const UI_LANG = '__ui'

const PROVIDER_LABEL: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
}

export const SLACK_TRANSLATE_STYLES: SlackTranslateStyle[] = ['precise', 'balanced', 'natural']

export function useSlackSettingsPanel(open: Ref<boolean>, projectId: () => string | null) {
  const store = useSlackStore()
  const appSettings = useSettingsStore()
  const translation = useSlackTranslation()
  const toast = useToast()
  const { t } = useI18n()

  const local = ref<SlackTranslateSettings>({ ...store.settings.translate })
  let pendingPatch: Partial<SlackTranslateSettings> = {}
  let timer: ReturnType<typeof setTimeout> | null = null

  // Bản trên sidecar đổi (event / kết quả ghi) ⇒ đồng bộ vào bảng, trừ khi đang có thay
  // đổi chưa ghi (đè thì lựa chọn vừa bấm nhảy ngược).
  watch(
    () => store.settings,
    (s) => {
      if (!timer) local.value = { ...s.translate }
    },
  )

  async function flush(): Promise<void> {
    if (timer) clearTimeout(timer)
    timer = null
    const patch = pendingPatch
    pendingPatch = {}
    if (!Object.keys(patch).length) return
    try {
      await store.saveSettings(patch)
      toast.add({ title: t('slack.toast.settingsSaved'), color: 'success' })
    } catch (err) {
      toast.add({
        title: t('slack.toast.settingsFailed'),
        description: err instanceof Error ? err.message : String(err),
        color: 'error',
      })
      // Lựa chọn trên bảng không còn đúng với đĩa — đọc lại bản thật.
      await store.fetchSettings().catch(() => undefined)
      local.value = { ...store.settings.translate }
    }
  }

  function patch(p: Partial<SlackTranslateSettings>): void {
    local.value = { ...local.value, ...p }
    pendingPatch = { ...pendingPatch, ...p }
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS)
  }

  // ── Model dịch ──────────────────────────────────────────────────────────────
  const inherited = computed(() => translation.inheritedLlm(projectId()))

  function accountLabel(pick: LlmPick): string {
    const cfg = appSettings.providers[pick.provider]
    const id = pick.accountId ?? cfg?.activeAccountId ?? null
    const acct = cfg?.accounts.find((a) => a.id === id)
    return acct ? acct.label || acct.fingerprint : t('slack.settings.model.noAccount')
  }

  const pinned = computed<LlmPick>(() => {
    const llm = local.value.llm
    return llm.mode === 'pinned' ? llm : inherited.value
  })

  function setPinned(next: LlmPick): void {
    const llm: SlackLlmSetting = {
      mode: 'pinned',
      provider: next.provider,
      modelId: next.modelId,
      ...(next.accountId ? { accountId: next.accountId } : {}),
    }
    patch({ llm })
  }

  const picker = useLlmPicker({
    get: () => pinned.value,
    update: (p) => setPinned({ ...pinned.value, ...p }),
  })

  const llmMode = computed<'inherit' | 'pinned'>({
    get: () => local.value.llm.mode,
    set: (mode) => {
      if (mode === local.value.llm.mode) return
      // Chuyển sang "chọn riêng" bắt đầu từ đúng model đang được dùng.
      if (mode === 'pinned') setPinned(inherited.value)
      else patch({ llm: { mode: 'inherit' } })
    },
  })

  // Dòng phụ của "Dùng model dịch chung": model THỰC TẾ đang được resolve.
  const inheritedLabel = computed(() =>
    [
      PROVIDER_LABEL[inherited.value.provider] ?? inherited.value.provider,
      picker.modelLabel(inherited.value.modelId),
      accountLabel(inherited.value),
    ].join(' · '),
  )

  const providerOptions = computed<AppSelectOption[]>(() =>
    Object.entries(PROVIDER_LABEL).map(([value, label]) => ({ value, label })),
  )
  const accountOptions = computed<AppSelectOption[]>(() => [
    { value: ACTIVE_ACCOUNT, label: t('slack.settings.model.activeAccount') },
    ...picker.accounts.value.map((a) => ({ value: a.id, label: a.label || a.fingerprint })),
  ])
  const modelOptions = computed<AppSelectOption[]>(() =>
    picker.availableModelIds.value.map((id) => ({ value: id, label: picker.modelLabel(id) })),
  )

  // ── Phong cách + ngôn ngữ + thuật ngữ ────────────────────────────────────────
  const style = computed<SlackTranslateStyle>({
    get: () => local.value.style,
    set: (v) => patch({ style: v }),
  })

  const langOptions = computed<AppSelectOption[]>(() =>
    SLACK_LANGS.map((l) => ({ value: l.value, label: t(l.labelKey) })),
  )
  const readLangOptions = computed<AppSelectOption[]>(() => [
    { value: UI_LANG, label: t('slack.settings.lang.ui') },
    ...langOptions.value,
  ])
  const readLang = computed<string>({
    get: () => local.value.readLang ?? UI_LANG,
    set: (v) => patch({ readLang: v === UI_LANG ? null : v }),
  })
  const sendOptions = computed<AppSelectOption[]>(() =>
    SLACK_SEND_CHOICES.map((c) => ({ value: sendChoiceId(c.langs), label: t(c.labelKey) })),
  )
  // Ô chọn làm việc với id ("Japanese+English"); lưu xuống là danh sách.
  const sendChoice = computed<string>({
    get: () => sendChoiceId(local.value.sendLangs),
    set: (v) => patch({ sendLangs: v.split('+') }),
  })
  const keepJapaneseTerms = computed<boolean>({
    get: () => local.value.keepJapaneseTerms,
    set: (v) => patch({ keepJapaneseTerms: v }),
  })

  // ── Bảng thuật ngữ (nút Lưu riêng) ──────────────────────────────────────────
  const glossaryText = ref('')
  const glossarySaved = ref('')
  const glossaryPath = ref('')
  const glossarySaving = ref(false)
  const glossaryDirty = computed(() => glossaryText.value !== glossarySaved.value)

  async function loadGlossary(): Promise<void> {
    try {
      const g = await store.fetchGlossary()
      glossaryText.value = g.text
      glossarySaved.value = g.text
      glossaryPath.value = g.path
    } catch (err) {
      toast.add({
        title: t('slack.toast.glossaryLoadFailed'),
        description: err instanceof Error ? err.message : String(err),
        color: 'error',
      })
    }
  }

  async function saveGlossary(): Promise<void> {
    if (!glossaryDirty.value || glossarySaving.value) return
    glossarySaving.value = true
    const text = glossaryText.value
    try {
      await store.saveGlossary(text)
      glossarySaved.value = text
      toast.add({ title: t('slack.toast.glossarySaved'), color: 'success' })
    } catch (err) {
      toast.add({
        title: t('slack.toast.glossaryFailed'),
        description: err instanceof Error ? err.message : String(err),
        color: 'error',
      })
    } finally {
      glossarySaving.value = false
    }
  }

  // Mở bảng: nạp bản mới nhất. Cửa sổ Slack riêng không có app shell nên danh sách
  // account có thể chưa nạp — hydrateFromSidecar() tự gộp lời gọi trùng.
  watch(
    open,
    (isOpen) => {
      if (!isOpen) {
        void flush()
        return
      }
      void appSettings.hydrateFromSidecar()
      void store
        .fetchSettings()
        .then(() => {
          if (!timer) local.value = { ...store.settings.translate }
        })
        .catch(() => undefined)
      void loadGlossary()
    },
    { immediate: true },
  )
  onBeforeUnmount(() => void flush())

  return {
    llmMode,
    inheritedLabel,
    provider: picker.provider,
    accountId: picker.accountId,
    modelId: picker.modelId,
    providerOptions,
    accountOptions,
    modelOptions,
    style,
    readLang,
    readLangOptions,
    sendOptions,
    sendChoice,
    langOptions,
    keepJapaneseTerms,
    glossaryText,
    glossaryPath,
    glossaryDirty,
    glossarySaving,
    saveGlossary,
  }
}
