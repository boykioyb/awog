import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { useSidecar, type UnlistenFn } from '~/composables/useSidecar'
import type { ProviderName } from '~/types'
import type { SlackDraft } from '~/utils/slack-mrkdwn'

// Slack threads (docs/features/slack-threads.md, ADR 0107) — store phía renderer.
//
// Type dưới đây là GƯƠNG của `apps/desktop/sidecar/src/slack/types.ts`; sửa một bên thì
// sửa cả hai trong cùng lượt (không có codegen nào bắt lệch).
//
// Store chỉ giữ dữ liệu + gọi RPC. Không toast, không điều hướng: báo lỗi là việc của
// page-controller (`useSlackManager`), vì cùng một lỗi cần câu chữ khác nhau tuỳ chỗ gọi.
// Đổi lỗi thành chữ: utils/slack-errors.ts.

export type SlackThreadError = 'not_found' | 'no_access'

export type SlackThread = {
  id: string
  sourceId: string
  teamId: string
  teamName: string
  teamUrl: string
  channelId: string
  channelName: string
  threadTs: string
  title: string | null
  firstLine: string
  projectId: string | null
  sessionId: string | null
  sessionSyncedTs: string | null
  lastReplyTs: string
  lastSeenTs: string
  replyCount: number
  addedAt: number
  error: SlackThreadError | null
}

export type SlackFileKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'office'
  | 'text'
  | 'snippet'
  | 'other'

// `external`: file remote do app ngoài đặt URL (Google Drive…) — không tải, không xem
// trước; UI chỉ cho mở `externalUrl` sau khi người dùng xác nhận.
export type SlackFileUnavailable = 'deleted' | 'no_access' | 'too_large' | 'external'

export type SlackFile = {
  id: string
  name: string
  title: string
  mimetype: string
  filetype: string
  size: number
  kind: SlackFileKind
  thumb: { size: 360 | 720; width: number; height: number } | null
  hasVideoPoster: boolean
  preview: string | null
  permalink: string
  unavailable: SlackFileUnavailable | null
  externalUrl: string | null
}

export type SlackReaction = { name: string; count: number; users: string[]; mine: boolean }

export type SlackUnfurl = {
  title: string | null
  text: string | null
  url: string | null
  serviceName: string | null
  imageUrl: string | null
}

export type SlackMessage = {
  ts: string
  userId: string | null
  botName: string | null
  text: string
  editedTs: string | null
  reactions: SlackReaction[]
  files: SlackFile[]
  unfurls: SlackUnfurl[]
  isParent: boolean
  subtype: string | null
}

export type SlackUser = {
  id: string
  name: string
  displayName: string
  realName: string
  avatar: string | null
  isBot: boolean
  deleted: boolean
}

// `slack.directory.emoji` trả `url: null` (danh sách tên, không kèm ảnh — vài nghìn data
// URI một lượt là quá nặng); ảnh nạp lười theo lô qua `slack.directory.emojiImages`.
// Emoji gửi kèm chi tiết thread (`customEmoji`) có thể đã có sẵn `url`.
export type SlackEmoji = { name: string; url: string | null; alias: string | null }

export type SlackThreadDetail = {
  thread: SlackThread
  messages: SlackMessage[]
  users: Record<string, SlackUser>
  selfUserId: string
  channels: Record<string, string>
  customEmoji: Record<string, SlackEmoji>
}

export type SlackStatusSource = {
  sourceId: string
  teamId: string | null
  teamName: string | null
  connected: boolean
  missingScopes: string[]
}

export type SlackStatus = { sources: SlackStatusSource[] }

export type SlackChangedEvent = { threadIds: string[] }
export type SlackDraftEvent = { threadId: string; text: string }

export type SlackLlm = { provider: ProviderName; modelId: string; accountId?: string }

// Cài đặt Slack — gương của `apps/desktop/sidecar/src/slack/settings.ts`. Ở sidecar (một
// nguồn cho modal + cửa sổ riêng), phát `slack.settings-changed` khi đổi.
export type SlackTranslateStyle = 'precise' | 'balanced' | 'natural'
export type SlackLlmSetting = { mode: 'inherit' } | ({ mode: 'pinned' } & SlackLlm)
export type SlackTranslateSettings = {
  llm: SlackLlmSetting
  style: SlackTranslateStyle
  // null = theo ngôn ngữ giao diện.
  readLang: string | null
  // Ngôn ngữ dịch tin gửi đi, theo thứ tự trong tin (vd ['Japanese', 'English'] = song ngữ).
  sendLangs: string[]
  keepJapaneseTerms: boolean
}
export type SlackSettings = { translate: SlackTranslateSettings }
export type SlackSettingsChangedEvent = {
  settings: SlackSettings
  reason: 'settings' | 'glossary'
}
export type SlackGlossary = { text: string; path: string }

// Bản dùng tới khi đọc được từ sidecar — trùng mặc định phía sidecar.
export const DEFAULT_SLACK_SETTINGS: SlackSettings = {
  translate: {
    llm: { mode: 'inherit' },
    style: 'precise',
    readLang: null,
    sendLangs: ['Japanese'],
    keepJapaneseTerms: true,
  },
}

// `sessionId` / `sessionSyncedTs` KHÔNG sửa được từ UI — chỉ sidecar gắn khi mở / đẩy phiên.
export type SlackThreadPatch = {
  title?: string | null
  projectId?: string | null
}

export type SlackFetchedFile = { path: string; name: string; mimetype: string }

// Bridge cửa sổ Slack của Electron (electron/src/slack-window.ts). Optional: shell cũ
// hoặc `pnpm dev` trong trình duyệt không có ⇒ nút liên quan tự ẩn.
export const slackBridge = () => (typeof window !== 'undefined' ? window.awog?.slack : undefined)

// So `ts` của Slack: luôn `^\d{10}\.\d{6}$` nên so chuỗi cùng độ dài là đủ. Dùng số
// thực thì mất chữ số cuối của phần micro giây.
export const tsAfter = (a: string, b: string): boolean => a > b

// Gom loạt `slack.changed` sát nhau (một thao tác ghi thường kéo theo 2–3 event).
const CHANGED_DEBOUNCE_MS = 150

// Mỗi lời gọi `slack.directory.emojiImages` tối đa bao nhiêu tên (trần của sidecar).
const EMOJI_IMAGE_BATCH = 64
// Theo alias tối đa bấy nhiêu bước — alias vòng tròn thì dừng.
const EMOJI_ALIAS_HOPS = 4

export const useSlackStore = defineStore('slack', () => {
  const sc = useSidecar()
  const available = computed(() => sc.available)

  const threads = ref<SlackThread[]>([])
  const loaded = ref(false)
  const status = ref<SlackStatus | null>(null)
  // Chỉ giữ chi tiết của thread đang mở — mỗi cửa sổ xem một thread một lúc, giữ nhiều
  // thì phải nghĩ tới chuyện dọn. shallowRef: thay nguyên khối mỗi lần nạp lại.
  const detail = shallowRef<SlackThreadDetail | null>(null)
  const detailLoading = ref(false)
  // Con trỏ tới trang reply CŨ HƠN của thread đang mở; null = đã có tới đầu thread.
  const olderCursor = ref<string | null>(null)
  const loadingOlder = ref(false)
  // Nháp đang gõ dở theo thread — ở store chứ không ở composer: composer chỉ sống khi
  // thread đang mở, đổi thread / đóng modal rồi quay lại vẫn còn chữ. Không reactive:
  // composer đọc lúc mount / đổi thread và ghi lại lúc rời.
  const drafts = new Map<string, SlackDraft>()
  // Nháp agent soạn (tool `slack_draft_reply`) CHỜ người dùng nhận, theo thread, dạng
  // mrkdwn thô (đổi sang `@Tên` lúc nhận — khi đó mới có danh bạ của thread). Ghi ngay
  // khi event tới, kể cả lúc chưa composer nào mount — trước đây nháp tới lúc đó là mất.
  const agentDrafts = ref<Record<string, string>>({})
  // Emoji tuỳ chỉnh của cả workspace (picker), theo teamId. Nạp lười khi mở picker.
  const teamEmoji = ref<Record<string, SlackEmoji[]>>({})
  // Chỉ mục tên → emoji theo team, cho tra cứu O(1) lúc render (mỗi emoji mỗi tin).
  const teamEmojiIndex = computed(() => {
    const out: Record<string, Map<string, SlackEmoji>> = {}
    for (const [teamId, list] of Object.entries(teamEmoji.value))
      out[teamId] = new Map(list.map((e) => [e.name, e]))
    return out
  })
  // Ảnh emoji tuỳ chỉnh (data URI) đã nạp, theo teamId → tên.
  const emojiImages = ref<Record<string, Record<string, string>>>({})
  // Tên đã xin ảnh (đang chờ hoặc đã có) theo team — không xin lại. Lỗi thì gỡ ra để
  // lần hiện sau thử lại.
  const emojiRequested = new Map<string, Set<string>>()
  // Thumbnail data URI theo `teamId:fileId:size` — tránh gọi lại khi re-render.
  const thumbs = new Map<string, Promise<string | null>>()
  const changedListeners = new Set<(ids: string[]) => void>()
  const settings = ref<SlackSettings>(DEFAULT_SLACK_SETTINGS)
  const settingsListeners = new Set<(e: SlackSettingsChangedEvent) => void>()
  let unlisten: UnlistenFn | null = null

  const threadById = (id: string): SlackThread | undefined => threads.value.find((t) => t.id === id)

  function upsert(thread: SlackThread): void {
    const i = threads.value.findIndex((t) => t.id === thread.id)
    if (i < 0) threads.value = [...threads.value, thread]
    else threads.value = threads.value.map((t) => (t.id === thread.id ? thread : t))
    if (detail.value?.thread.id === thread.id) detail.value = { ...detail.value, thread }
  }

  async function subscribe(): Promise<void> {
    if (!available.value || unlisten) return
    try {
      unlisten = await sc.onEvent((evt) => {
        if (evt?.type === 'slack.changed') {
          queueChanged((evt.payload as SlackChangedEvent | undefined)?.threadIds ?? [])
        } else if (evt?.type === 'slack.draft') {
          const p = evt.payload as SlackDraftEvent | undefined
          if (p?.threadId && typeof p.text === 'string' && p.text.trim()) {
            agentDrafts.value = { ...agentDrafts.value, [p.threadId]: p.text }
          }
        } else if (evt?.type === 'slack.settings-changed') {
          const p = evt.payload as SlackSettingsChangedEvent | undefined
          if (p?.settings?.translate) {
            settings.value = p.settings
            for (const fn of settingsListeners) fn(p)
          }
        }
      })
    } catch {
      unlisten = null
    }
  }

  // Sidecar phát `slack.changed` sau MỌI thao tác sửa store (cả markSeen, reply, react,
  // và thread.get đồng bộ ngược số reply), thường thành loạt. Gom loạt đó thành MỘT lần
  // đọc lại danh sách (đọc đĩa, không gọi Slack) rồi mới báo listener — listener so trên
  // danh sách đã mới, không phải bản cũ.
  const pendingIds = new Set<string>()
  let changedTimer: ReturnType<typeof setTimeout> | null = null
  function queueChanged(ids: string[]): void {
    for (const id of ids) pendingIds.add(id)
    if (changedTimer) return
    changedTimer = setTimeout(async () => {
      changedTimer = null
      const batch = [...pendingIds]
      pendingIds.clear()
      try {
        await fetchThreads()
      } catch {
        // Đọc lại hỏng — lần event sau sẽ thử lại; danh sách cũ vẫn dùng được.
      }
      for (const fn of changedListeners) fn(batch)
    }, CHANGED_DEBOUNCE_MS)
  }

  /** Đăng ký nghe `slack.changed` (đã gom + đọc lại danh sách); trả hàm huỷ. */
  function onChanged(fn: (ids: string[]) => void): () => void {
    changedListeners.add(fn)
    return () => changedListeners.delete(fn)
  }

  /** Nghe `slack.settings-changed` (cài đặt hoặc bảng thuật ngữ đổi, ở bất kỳ cửa sổ nào). */
  function onSettingsChanged(fn: (e: SlackSettingsChangedEvent) => void): () => void {
    settingsListeners.add(fn)
    return () => settingsListeners.delete(fn)
  }

  async function fetchSettings(): Promise<void> {
    if (!available.value) return
    settings.value = await sc.request<SlackSettings>('slack.settings.get', {})
    void subscribe()
  }

  // Ghi một phần cài đặt dịch; sidecar pick đúng field + validate, trả bản đầy đủ.
  async function saveSettings(patch: Partial<SlackTranslateSettings>): Promise<void> {
    settings.value = await sc.request<SlackSettings>('slack.settings.set', { translate: patch })
  }

  async function fetchGlossary(): Promise<SlackGlossary> {
    return sc.request<SlackGlossary>('slack.glossary.get', {})
  }

  async function saveGlossary(text: string): Promise<void> {
    await sc.request('slack.glossary.set', { text })
  }

  async function fetchStatus(): Promise<void> {
    if (!available.value) return
    status.value = await sc.request<SlackStatus>('slack.status', {})
  }

  async function fetchThreads(): Promise<void> {
    if (!available.value) {
      loaded.value = true
      return
    }
    try {
      const res = await sc.request<{ threads: SlackThread[] }>('slack.threads.list', {})
      threads.value = Array.isArray(res?.threads) ? res.threads : []
    } finally {
      loaded.value = true
      void subscribe()
    }
  }

  async function addThread(url: string, projectId: string | null): Promise<SlackThread> {
    const res = await sc.request<{ thread: SlackThread }>('slack.threads.add', {
      url,
      ...(projectId ? { projectId } : {}),
    })
    upsert(res.thread)
    return res.thread
  }

  async function removeThread(threadId: string): Promise<void> {
    await sc.request('slack.threads.remove', { threadId })
    threads.value = threads.value.filter((t) => t.id !== threadId)
    if (detail.value?.thread.id === threadId) detail.value = null
  }

  async function updateThread(threadId: string, patch: SlackThreadPatch): Promise<SlackThread> {
    const res = await sc.request<{ thread: SlackThread }>('slack.threads.update', {
      threadId,
      ...patch,
    })
    upsert(res.thread)
    return res.thread
  }

  // `slack.thread.get` trang đầu = reply MỚI NHẤT (tin gốc có ở mọi trang); `nextCursor`
  // lùi về reply cũ hơn. Nạp lại (poll / event) chỉ lấy trang đầu rồi ghép vào phần cũ
  // đã cuộn lên xem, để người đang đọc giữa thread không bị cắt mất phần trên.
  async function loadDetail(threadId: string): Promise<SlackThreadDetail | null> {
    if (!available.value) return null
    detailLoading.value = true
    try {
      const page = await sc.request<SlackPage>('slack.thread.get', {
        threadId,
        limit: FIRST_PAGE_REPLIES,
      })
      const prev = detail.value?.thread.id === threadId ? detail.value : null
      const merged = mergeLatest(prev, prev ? olderCursor.value : null, page)
      upsert(merged.detail.thread)
      detail.value = merged.detail
      olderCursor.value = merged.cursor
      return merged.detail
    } finally {
      detailLoading.value = false
    }
  }

  /** Nạp thêm reply cũ hơn (cuộn lên đầu thread). Trả false khi không còn gì để nạp. */
  async function loadOlder(): Promise<boolean> {
    const d = detail.value
    const cursor = olderCursor.value
    if (!d || !cursor || loadingOlder.value || !available.value) return false
    loadingOlder.value = true
    try {
      const page = await sc.request<SlackPage>('slack.thread.get', {
        threadId: d.thread.id,
        cursor,
        limit: OLDER_PAGE_REPLIES,
      })
      if (detail.value?.thread.id !== d.thread.id) return false
      detail.value = mergeOlder(detail.value, page)
      olderCursor.value = page.nextCursor
      return true
    } finally {
      loadingOlder.value = false
    }
  }

  function clearDetail(): void {
    detail.value = null
    olderCursor.value = null
  }

  async function markSeen(threadId: string, ts: string): Promise<void> {
    const res = await sc.request<{ thread: SlackThread }>('slack.thread.markSeen', { threadId, ts })
    upsert(res.thread)
  }

  // `force`: bỏ qua nhịp giãn của sidecar (nút "Làm mới" — người dùng chủ động hỏi).
  // Nhận cả mảng id trơn (dạng cũ, chip phiên còn gọi `poll([id])`).
  async function poll(
    arg: string[] | { threadIds?: string[]; force?: boolean } = {},
  ): Promise<string[]> {
    if (!available.value) return []
    const opts = Array.isArray(arg) ? { threadIds: arg } : arg
    const res = await sc.request<{ changed: string[] }>('slack.poll', {
      ...(opts.threadIds ? { threadIds: opts.threadIds } : {}),
      ...(opts.force ? { force: true } : {}),
    })
    return Array.isArray(res?.changed) ? res.changed : []
  }

  // ── Nháp ──────────────────────────────────────────────────────────────────
  const readDraft = (threadId: string): SlackDraft | undefined => drafts.get(threadId)
  function saveDraft(threadId: string, d: SlackDraft): void {
    if (d.draft.trim()) drafts.set(threadId, d)
    else drafts.delete(threadId)
  }
  const clearDraft = (threadId: string): void => {
    drafts.delete(threadId)
  }
  function clearAgentDraft(threadId: string): void {
    if (!(threadId in agentDrafts.value)) return
    const { [threadId]: _drop, ...rest } = agentDrafts.value
    agentDrafts.value = rest
  }

  // Ghi lên Slack — KHÔNG retry ở bất kỳ tầng nào (chat.postMessage không idempotent).
  async function reply(threadId: string, text: string, broadcast: boolean): Promise<string> {
    const res = await sc.request<{ ts: string }>('slack.reply', { threadId, text, broadcast })
    return res.ts
  }

  async function updateMessage(threadId: string, ts: string, text: string): Promise<void> {
    await sc.request('slack.message.update', { threadId, ts, text })
  }

  async function deleteMessage(threadId: string, ts: string): Promise<void> {
    await sc.request('slack.message.delete', { threadId, ts })
  }

  async function setReaction(
    threadId: string,
    ts: string,
    name: string,
    on: boolean,
  ): Promise<void> {
    await sc.request(on ? 'slack.reaction.add' : 'slack.reaction.remove', { threadId, ts, name })
  }

  async function searchUsers(
    teamId: string,
    query: string,
    channelId?: string,
  ): Promise<SlackUser[]> {
    if (!available.value) return []
    const res = await sc.request<{ users: SlackUser[] }>('slack.directory.users', {
      teamId,
      ...(query ? { query } : {}),
      ...(channelId ? { channelId } : {}),
    })
    return Array.isArray(res?.users) ? res.users : []
  }

  async function loadTeamEmoji(teamId: string): Promise<SlackEmoji[]> {
    const cached = teamEmoji.value[teamId]
    if (cached) return cached
    if (!available.value) return []
    const res = await sc.request<{ emoji: SlackEmoji[] }>('slack.directory.emoji', { teamId })
    const list = Array.isArray(res?.emoji) ? res.emoji : []
    teamEmoji.value = { ...teamEmoji.value, [teamId]: list }
    return list
  }

  /**
   * Emoji tuỳ chỉnh `name` của team: đi theo alias tới tên đích, trả tên đích + ảnh
   * (null khi chưa nạp). `threadEmoji` = bộ gửi kèm chi tiết thread, ưu tiên trước.
   * Không phải emoji tuỳ chỉnh đã biết ⇒ null.
   */
  function resolveCustomEmoji(
    teamId: string,
    name: string,
    threadEmoji?: Record<string, SlackEmoji>,
  ): { name: string; url: string | null } | null {
    const index = teamEmojiIndex.value[teamId]
    const images = emojiImages.value[teamId]
    let cur = name
    for (let hop = 0; hop < EMOJI_ALIAS_HOPS; hop++) {
      const e = threadEmoji?.[cur] ?? index?.get(cur)
      if (!e) return null
      if (!e.alias) return { name: cur, url: e.url ?? images?.[cur] ?? null }
      cur = e.alias
    }
    return null
  }

  /** Xin ảnh cho các emoji tuỳ chỉnh đang hiện; tên đã xin rồi thì bỏ qua. */
  function requestEmojiImages(teamId: string, names: string[]): void {
    if (!available.value || !names.length) return
    let seen = emojiRequested.get(teamId)
    if (!seen) {
      seen = new Set()
      emojiRequested.set(teamId, seen)
    }
    const todo = [...new Set(names)].filter((n) => !seen.has(n))
    for (const n of todo) seen.add(n)
    for (let i = 0; i < todo.length; i += EMOJI_IMAGE_BATCH) {
      const chunk = todo.slice(i, i + EMOJI_IMAGE_BATCH)
      sc.request<{ images: Record<string, string> }>('slack.directory.emojiImages', {
        teamId,
        names: chunk,
      })
        .then((res) => {
          const got = res?.images ?? {}
          emojiImages.value = {
            ...emojiImages.value,
            [teamId]: { ...emojiImages.value[teamId], ...got },
          }
          // Tên không có ảnh (emoji bị xoá…) thì thôi, không xin lại trong phiên này.
        })
        .catch(() => {
          for (const n of chunk) seen.delete(n)
        })
    }
  }

  async function translate(
    threadId: string,
    items: Array<{ ts: string; editedTs: string | null; text: string }>,
    targetLang: string,
    llm: SlackLlm,
  ): Promise<Record<string, string>> {
    const res = await sc.request<{ texts: Record<string, string> }>('slack.translate', {
      threadId,
      items,
      targetLang,
      ...llm,
    })
    return res?.texts ?? {}
  }

  async function translateOutgoing(
    text: string,
    targetLang: string,
    llm: SlackLlm,
  ): Promise<string> {
    const res = await sc.request<{ text: string }>('slack.translateOutgoing', {
      text,
      targetLang,
      ...llm,
    })
    return res.text
  }

  function fileThumb(teamId: string, fileId: string, size: 360 | 720): Promise<string | null> {
    const key = `${teamId}:${fileId}:${size}`
    let p = thumbs.get(key)
    if (!p) {
      p = available.value
        ? sc
            .request<{ dataUrl: string }>('slack.file.thumb', { teamId, fileId, size })
            .then((r) => r.dataUrl || null)
            .catch(() => {
              // Lỗi không được cache: lần render sau thử lại (mạng chập chờn, vừa cấp scope).
              thumbs.delete(key)
              return null
            })
        : Promise.resolve(null)
      thumbs.set(key, p)
    }
    return p
  }

  async function fetchFile(teamId: string, fileId: string): Promise<SlackFetchedFile> {
    return sc.request<SlackFetchedFile>('slack.file.fetch', { teamId, fileId })
  }

  async function saveFileToProject(
    teamId: string,
    fileId: string,
    projectId: string,
  ): Promise<string> {
    const res = await sc.request<{ path: string }>('slack.file.saveToProject', {
      teamId,
      fileId,
      projectId,
    })
    return res.path
  }

  return {
    available,
    threads,
    loaded,
    status,
    detail,
    detailLoading,
    olderCursor,
    loadingOlder,
    agentDrafts,
    teamEmoji,
    emojiImages,
    threadById,
    onChanged,
    settings,
    onSettingsChanged,
    fetchSettings,
    saveSettings,
    fetchGlossary,
    saveGlossary,
    fetchStatus,
    fetchThreads,
    addThread,
    removeThread,
    updateThread,
    loadDetail,
    loadOlder,
    clearDetail,
    markSeen,
    poll,
    readDraft,
    saveDraft,
    clearDraft,
    clearAgentDraft,
    reply,
    updateMessage,
    deleteMessage,
    setReaction,
    searchUsers,
    loadTeamEmoji,
    resolveCustomEmoji,
    requestEmojiImages,
    translate,
    translateOutgoing,
    fileThumb,
    fetchFile,
    saveFileToProject,
  }
})

type SlackPage = SlackThreadDetail & { nextCursor: string | null }

const byTs = (a: SlackMessage, b: SlackMessage): number => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0)

function withMessages(
  base: SlackThreadDetail,
  extra: SlackThreadDetail,
  messages: SlackMessage[],
): SlackThreadDetail {
  return {
    thread: extra.thread,
    messages,
    users: { ...base.users, ...extra.users },
    selfUserId: extra.selfUserId || base.selfUserId,
    channels: { ...base.channels, ...extra.channels },
    customEmoji: { ...base.customEmoji, ...extra.customEmoji },
  }
}

// Mở thread chỉ hiện vài reply mới nhất; tin cũ hơn nạp theo nút "Tải tin cũ hơn".
const FIRST_PAGE_REPLIES = 5
const OLDER_PAGE_REPLIES = 10

const parentOf = (d: SlackThreadDetail): SlackMessage[] =>
  d.messages.filter((m) => m.isParent).slice(0, 1)
const repliesOf = (d: SlackThreadDetail): SlackMessage[] =>
  d.messages.filter((m) => !m.isParent).sort(byTs)

// Trang mới nhất ghép với phần cũ đã nạp: reply trong khoảng trang mới phủ lấy bản mới
// (sửa / xoá / reaction mới), reply cũ hơn khoảng đó giữ nguyên.
function mergeLatest(
  prev: SlackThreadDetail | null,
  prevCursor: string | null,
  page: SlackPage,
): { detail: SlackThreadDetail; cursor: string | null } {
  const { nextCursor, ...fresh } = page
  const replies = repliesOf(fresh)
  if (!prev || !nextCursor || !replies.length) {
    const base = prev ?? fresh
    const parent = parentOf(fresh).length ? parentOf(fresh) : parentOf(base)
    return { detail: withMessages(base, fresh, [...parent, ...replies]), cursor: nextCursor }
  }
  const oldest = replies[0]!.ts
  // Trang mới không chạm phần đã có (≥ FIRST_PAGE_REPLIES reply mới tới giữa hai lần
  // nạp) ⇒ có khoảng hở chưa tải ở giữa: bỏ phần cũ, dùng cursor của trang mới, thay
  // vì ghép hai khúc rời nhau làm người đọc tưởng thread liền mạch.
  if (!repliesOf(prev).some((m) => m.ts >= oldest)) {
    const parent = parentOf(fresh).length ? parentOf(fresh) : parentOf(prev)
    return { detail: withMessages(prev, fresh, [...parent, ...replies]), cursor: nextCursor }
  }
  const kept = repliesOf(prev).filter((m) => m.ts < oldest)
  const parent = parentOf(fresh).length ? parentOf(fresh) : parentOf(prev)
  return {
    detail: withMessages(prev, fresh, [...parent, ...kept, ...replies]),
    cursor: kept.length ? prevCursor : nextCursor,
  }
}

function mergeOlder(prev: SlackThreadDetail, page: SlackPage): SlackThreadDetail {
  const { nextCursor: _cursor, ...older } = page
  const have = new Set(prev.messages.map((m) => m.ts))
  const add = repliesOf(older).filter((m) => !have.has(m.ts))
  const replies = [...add, ...repliesOf(prev)].sort(byTs)
  return withMessages(prev, { ...older, thread: prev.thread }, [...parentOf(prev), ...replies])
}
