import { computed, nextTick, onBeforeUnmount, ref, watch, type ComputedRef } from 'vue'
import { useToast } from '~/composables/useToast'
import { useSlackTranslation } from '~/composables/useSlackTranslation'
import { searchStandardEmoji } from '~/utils/slack-emoji'
import { SLACK_SEND_CHOICES, sendChoiceId, slackLangCodes } from '~/utils/slack-langs'
import {
  draftToMrkdwn,
  mrkdwnToDraft,
  uniqueMentionLabel,
  type DraftMention,
  type SlackDraft,
} from '~/utils/slack-mrkdwn'
import {
  useSlackStore,
  type SlackThread,
  type SlackThreadDetail,
  type SlackUser,
} from '~/stores/slack'

// Ô trả lời thread Slack: gợi ý `@user` + `:emoji:`, Enter gửi / Shift+Enter xuống dòng,
// "Also send to #channel", "Dịch sang <ngôn ngữ gửi>" (cài đặt Slack `sendLangs`, mặc định
// tiếng Nhật) có xem trước, nhận nháp agent soạn.
//
// GỬI KHÔNG RETRY: `chat.postMessage` không idempotent — thử lại sau một lỗi mạng có
// thể đăng hai lần. Lỗi thì giữ nguyên nháp để người dùng tự bấm lại khi đã kiểm tra.
//
// Mention trong textarea hiện dạng `@Tên` và được ghi lại trong `mentions`; lúc gửi mới
// đổi thành `<@U…>` (utils/slack-mrkdwn.ts → draftToMrkdwn). Nháp agent và bản dịch là
// chữ MODEL sinh ra (model đã đọc thread của người ngoài): chỉ mention user được giữ
// thành `<@U…>`; `<!channel>`, `<url|nhãn>`, `<#C…>` model tự chèn thành chữ đọc được,
// không đi lên Slack như lệnh ping/link giả nhãn. Bản dịch chỉ giữ lại đúng các token
// đã có trong bản nháp trước khi dịch (`tokens`).
//
// NHÁP AGENT KHÔNG ĐÈ CHỮ ĐANG GÕ: ô trống thì đổ thẳng vào; ô đang có chữ thì nháp nằm
// chờ (store.agentDrafts) và composer hiện băng "Agent đã soạn nháp — Thay bằng nháp /
// Bỏ qua". Người dùng đang gõ dở mà bị thay mất chữ là mất việc, không lấy lại được.

const MAX_SUGGESTIONS = 8
const USER_SEARCH_DEBOUNCE_MS = 200

export type SlackSuggestion =
  | { kind: 'user'; key: string; label: string; sub: string; avatar: string | null; id: string }
  | { kind: 'emoji'; key: string; label: string; char: string | null; url: string | null }

const USER_TOKEN = /(^|\s)@([^\s@]{0,40})$/
const EMOJI_TOKEN = /(^|\s):([\p{Ll}\p{Lo}\p{Lm}\p{N}_+'-]{2,40})$/u

type Options = {
  thread: ComputedRef<SlackThread | undefined>
  detail: ComputedRef<SlackThreadDetail | null>
  userName: (id: string) => string | null
  // Tên thật — chỉ để tách hai người trùng tên hiển thị trong nhãn mention.
  userRealName: (id: string) => string | null
  textarea: () => HTMLTextAreaElement | null
  onSent: () => Promise<void>
  fail: (titleKey: string, err: unknown) => void
}

export function useSlackComposer(opts: Options) {
  const store = useSlackStore()
  const toast = useToast()
  const translation = useSlackTranslation()
  const { t } = useI18n()

  const draft = ref('')
  const mentions = ref<DraftMention[]>([])
  const tokens = ref<string[]>([])
  const broadcast = ref(false)
  const sending = ref(false)
  const translating = ref(false)
  // Bản trước khi dịch — có thì ô đang hiện bản dịch xem trước, kèm nút khôi phục.
  const beforeTranslate = ref<SlackDraft | null>(null)

  const suggestions = ref<SlackSuggestion[]>([])
  const activeIndex = ref(0)
  let token: { start: number; end: number } | null = null
  let searchTimer: ReturnType<typeof setTimeout> | null = null
  let searchSeq = 0

  const sendLangs = computed(() => store.settings.translate.sendLangs)
  const sendLangCode = computed(() => slackLangCodes(sendLangs.value))
  const sendChoiceCurrent = computed(() => sendChoiceId(sendLangs.value))

  const canSend = computed(() => !!draft.value.trim() && !sending.value && !!opts.thread.value)

  // ── Nháp theo thread (giữ ở store) ──────────────────────────────────────────
  const current = (): SlackDraft => ({
    draft: draft.value,
    mentions: mentions.value,
    tokens: tokens.value,
  })
  function setDraft(d: SlackDraft | undefined): void {
    draft.value = d?.draft ?? ''
    mentions.value = d?.mentions ?? []
    tokens.value = d?.tokens ?? []
  }

  const nameFor = (id: string): string | null =>
    mentions.value.find((m) => m.id === id)?.label ?? opts.userName(id)
  // `keep` mặc định rỗng: chữ do model sinh — xem ghi chú đầu file.
  const parse = (text: string, keep: readonly string[] = []): SlackDraft =>
    mrkdwnToDraft(text, nameFor, opts.userRealName, keep)

  // Nháp agent đang chờ của thread đang mở (null = không có).
  const pendingAgentDraft = computed(() => {
    const id = opts.thread.value?.id
    return id ? (store.agentDrafts[id] ?? null) : null
  })

  function acceptAgentDraft(): void {
    const id = opts.thread.value?.id
    const text = pendingAgentDraft.value
    if (!id || text === null) return
    setDraft(parse(text))
    beforeTranslate.value = null
    store.clearAgentDraft(id)
  }
  function dismissAgentDraft(): void {
    const id = opts.thread.value?.id
    if (id) store.clearAgentDraft(id)
  }

  // Ô trống ⇒ nhận luôn (kèm toast); đang có chữ ⇒ để nằm chờ, băng trên ô hiện lên.
  function offerAgentDraft(): void {
    if (pendingAgentDraft.value === null || draft.value.trim()) return
    acceptAgentDraft()
    toast.add({ title: t('slack.composer.agentDraft'), color: 'info' })
  }

  watch(
    () => opts.thread.value?.id,
    (id, prev) => {
      if (prev) store.saveDraft(prev, current())
      setDraft(id ? store.readDraft(id) : undefined)
      broadcast.value = false
      beforeTranslate.value = null
      closeSuggestions()
      offerAgentDraft()
    },
    { immediate: true },
  )
  watch(pendingAgentDraft, offerAgentDraft)

  onBeforeUnmount(() => {
    const id = opts.thread.value?.id
    if (id) store.saveDraft(id, current())
  })

  // ── Gợi ý @user / :emoji: ───────────────────────────────────────────────────
  function closeSuggestions(): void {
    suggestions.value = []
    activeIndex.value = 0
    token = null
    if (searchTimer) clearTimeout(searchTimer)
  }

  const userSuggestion = (u: SlackUser): SlackSuggestion => ({
    kind: 'user',
    key: u.id,
    id: u.id,
    label: u.displayName || u.realName || u.name,
    sub: u.realName && u.realName !== u.displayName ? u.realName : u.name,
    avatar: u.avatar,
  })

  function localUsers(q: string): SlackSuggestion[] {
    const users = Object.values(opts.detail.value?.users ?? {})
    const ql = q.toLowerCase()
    return users
      .filter((u) => !u.deleted && !u.isBot)
      .filter((u) => [u.displayName, u.realName, u.name].some((s) => s.toLowerCase().includes(ql)))
      .slice(0, MAX_SUGGESTIONS)
      .map(userSuggestion)
  }

  function queueUserSearch(q: string): void {
    const th = opts.thread.value
    if (!th) return
    if (searchTimer) clearTimeout(searchTimer)
    const seq = ++searchSeq
    searchTimer = setTimeout(async () => {
      try {
        const remote = await store.searchUsers(th.teamId, q, th.channelId)
        if (seq !== searchSeq || !token) return
        const seen = new Set(suggestions.value.map((s) => s.key))
        const extra = remote.filter((u) => !seen.has(u.id) && !u.deleted).map(userSuggestion)
        suggestions.value = [...suggestions.value, ...extra].slice(0, MAX_SUGGESTIONS)
      } catch {
        // Danh bạ lỗi — vẫn còn gợi ý từ người trong thread.
      }
    }, USER_SEARCH_DEBOUNCE_MS)
  }

  function emojiSuggestions(q: string): SlackSuggestion[] {
    const teamId = opts.thread.value?.teamId
    if (!teamId) return []
    const matched = (store.teamEmoji[teamId] ?? [])
      .filter((e) => e.name.includes(q))
      .slice(0, MAX_SUGGESTIONS)
    const resolved = matched.map((e) => store.resolveCustomEmoji(teamId, e.name))
    // Ảnh của vài gợi ý đang hiện — nạp lười, gợi ý tự có ảnh khi về.
    store.requestEmojiImages(
      teamId,
      resolved.flatMap((r) => (r && !r.url ? [r.name] : [])),
    )
    const custom = matched.map(
      (e, i): SlackSuggestion => ({
        kind: 'emoji',
        key: `c:${e.name}`,
        label: e.name,
        char: null,
        url: resolved[i]?.url ?? null,
      }),
    )
    const std = searchStandardEmoji(q, MAX_SUGGESTIONS).map(
      (e): SlackSuggestion => ({
        kind: 'emoji',
        key: `s:${e.name}`,
        label: e.name,
        char: e.char,
        url: null,
      }),
    )
    return [...std, ...custom].slice(0, MAX_SUGGESTIONS)
  }

  function onInput(): void {
    const el = opts.textarea()
    if (!el || el.selectionStart !== el.selectionEnd) return closeSuggestions()
    const caret = el.selectionStart
    const before = draft.value.slice(0, caret)
    const user = USER_TOKEN.exec(before)
    if (user) {
      const q = user[2] ?? ''
      token = { start: caret - q.length - 1, end: caret }
      suggestions.value = localUsers(q)
      activeIndex.value = 0
      if (q) queueUserSearch(q)
      return
    }
    const emoji = EMOJI_TOKEN.exec(before)
    if (emoji) {
      const q = emoji[2] ?? ''
      token = { start: caret - q.length - 1, end: caret }
      const teamId = opts.thread.value?.teamId
      if (teamId && !store.teamEmoji[teamId]) {
        void store.loadTeamEmoji(teamId).then(
          () => {
            if (token) suggestions.value = emojiSuggestions(q)
          },
          () => undefined,
        )
      }
      suggestions.value = emojiSuggestions(q)
      activeIndex.value = 0
      return
    }
    closeSuggestions()
  }

  async function pick(s: SlackSuggestion): Promise<void> {
    if (!token) return
    let insert = `:${s.label}: `
    if (s.kind === 'user') {
      // Hai người cùng tên hiển thị phải mang nhãn khác nhau, nếu không lúc gửi cả hai
      // thành cùng một `<@U…>`.
      const known = mentions.value.find((m) => m.id === s.id)
      const label =
        known?.label ?? uniqueMentionLabel(s.label, opts.userRealName(s.id), s.id, mentions.value)
      if (!known) mentions.value = [...mentions.value, { label, id: s.id }]
      insert = `@${label} `
    }
    const { start, end } = token
    draft.value = draft.value.slice(0, start) + insert + draft.value.slice(end)
    closeSuggestions()
    await nextTick()
    const el = opts.textarea()
    el?.focus()
    el?.setSelectionRange(start + insert.length, start + insert.length)
  }

  // ── Gửi ─────────────────────────────────────────────────────────────────────
  async function send(): Promise<void> {
    const th = opts.thread.value
    const text = draft.value.trim()
    if (!th || !text || sending.value) return
    sending.value = true
    try {
      const used = mentions.value.filter((m) => text.includes(`@${m.label}`))
      await store.reply(th.id, draftToMrkdwn(text, used, tokens.value), broadcast.value)
      store.clearDraft(th.id)
      // Người dùng có thể đã chuyển sang thread khác trong lúc chờ: khi đó ô đang hiện
      // nháp của thread KIA — xoá nó là mất chữ người ta đang gõ. Chỉ dọn ô khi vẫn là
      // thread vừa gửi; nháp đã lưu của thread vừa gửi thì bỏ ở trên.
      if (opts.thread.value?.id === th.id) {
        setDraft(undefined)
        broadcast.value = false
        beforeTranslate.value = null
      }
      await opts.onSent()
    } catch (err) {
      opts.fail('slack.toast.sendFailed', err)
    } finally {
      sending.value = false
    }
  }

  function onKeydown(e: KeyboardEvent): void {
    // IME (tiếng Nhật / tiếng Việt): Enter lúc đang ghép chữ là chốt chữ, không phải gửi.
    if (e.isComposing) return
    if (suggestions.value.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const n = suggestions.value.length
        activeIndex.value = (activeIndex.value + (e.key === 'ArrowDown' ? 1 : n - 1)) % n
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        const s = suggestions.value[activeIndex.value]
        if (s) void pick(s)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        closeSuggestions()
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  // ── Dịch sang ngôn ngữ gửi (xem trước trong ô, người bấm Gửi mới gửi) ────────
  // Song ngữ (vd Nhật + Anh): dịch SONG SONG từng ngôn ngữ rồi ghép theo thứ tự đã chọn,
  // cách nhau một dòng trống — khách đọc phần tiếng Nhật trước, phần tiếng Anh ngay dưới.
  // Chữ trong ô ngay sau lần dịch gần nhất — so với ô hiện tại để biết người dùng đã sửa tay chưa.
  let lastTranslated = ''
  async function translateOutgoing(langs: readonly string[] = sendLangs.value): Promise<void> {
    const th = opts.thread.value
    if (!th || !draft.value.trim() || translating.value || !langs.length) return
    translating.value = true
    try {
      // Dịch lại ngay sau khi đã dịch (đổi JA → JA + EN) ⇒ dịch từ BẢN NHÁP GỐC, không
      // dịch chồng bản dịch. Người dùng đã sửa tay bản dịch ⇒ dịch từ chữ đang có, không
      // vứt phần đã sửa.
      const untouched = beforeTranslate.value !== null && draft.value === lastTranslated
      const src = untouched && beforeTranslate.value ? beforeTranslate.value : current()
      const text = draftToMrkdwn(src.draft, src.mentions, src.tokens)
      const llm = translation.resolveLlm(th.projectId)
      const parts = await Promise.all(langs.map((l) => store.translateOutgoing(text, l, llm)))
      // Đã chuyển thread trong lúc dịch ⇒ bỏ kết quả, không đổ bản dịch vào thread khác.
      if (opts.thread.value?.id !== th.id) return
      // Chỉ token của bản nháp gốc được khôi phục; token mới model tạo thành chữ.
      const parsed = parse(parts.map((p) => p.trim()).join('\n\n'), src.tokens)
      beforeTranslate.value = beforeTranslate.value ?? src
      setDraft(parsed)
      lastTranslated = draft.value
    } catch (err) {
      opts.fail('slack.toast.translateFailed', err)
    } finally {
      translating.value = false
    }
  }

  // Chọn ngôn ngữ từ menu cạnh nút dịch: nhớ vào cài đặt (đồng bộ bảng Cài đặt + cửa sổ
  // kia) rồi dịch luôn theo lựa chọn vừa chọn.
  async function translateTo(langs: readonly string[]): Promise<void> {
    if (sendChoiceId(langs) !== sendChoiceCurrent.value) {
      void store.saveSettings({ sendLangs: [...langs] }).catch((err: unknown) => {
        opts.fail('slack.toast.settingsFailed', err)
      })
    }
    await translateOutgoing(langs)
  }

  function restoreOriginal(): void {
    if (!beforeTranslate.value) return
    setDraft(beforeTranslate.value)
    beforeTranslate.value = null
  }

  return {
    draft,
    broadcast,
    sending,
    translating,
    canSend,
    sendLangCode,
    sendChoiceCurrent,
    sendChoices: SLACK_SEND_CHOICES,
    translateTo,
    isPreviewingTranslation: computed(() => !!beforeTranslate.value),
    hasPendingAgentDraft: computed(() => pendingAgentDraft.value !== null),
    acceptAgentDraft,
    dismissAgentDraft,
    suggestions,
    activeIndex,
    onInput,
    onKeydown,
    pick,
    closeSuggestions,
    send,
    translateOutgoing,
    restoreOriginal,
  }
}
