import { computed, watch, type ComputedRef } from 'vue'
import { useConfirm } from '~/composables/useConfirm'
import { useToast } from '~/composables/useToast'
import { copyText } from '~/utils/clipboard'
import { draftToMrkdwn, mrkdwnToDraft, mrkdwnToPlain, type SlackDraft } from '~/utils/slack-mrkdwn'
import {
  useSlackStore,
  type SlackMessage,
  type SlackThreadDetail,
  type SlackUser,
} from '~/stores/slack'

// Phần "tin nhắn" của trang Slack: tra cứu user/kênh/emoji để render, gộp tin liên
// tiếp, và các thao tác trên MỘT tin (react, sửa, xoá, copy). Tách khỏi useSlackManager
// cho gọn; được trải vào cùng context nên component chỉ gọi `useSlackCtx()`.

// Tin liên tiếp cùng người trong khoảng này thì gộp (không lặp avatar/tên) — như Slack.
const GROUP_WINDOW_S = 5 * 60

export type SlackMessageRow = { m: SlackMessage; compact: boolean }

type Options = {
  detail: ComputedRef<SlackThreadDetail | null>
  reload: () => Promise<void>
  fail: (titleKey: string, err: unknown) => void
}

export function useSlackMessageActions({ detail, reload, fail }: Options) {
  const store = useSlackStore()
  const toast = useToast()
  const { confirm } = useConfirm()
  const { t } = useI18n()

  const userOf = (id: string | null): SlackUser | null =>
    id ? (detail.value?.users[id] ?? null) : null
  const userName = (id: string): string | null => {
    const u = userOf(id)
    return u ? u.displayName || u.realName || u.name : null
  }
  const userRealName = (id: string): string | null => userOf(id)?.realName || null
  const authorName = (m: SlackMessage): string =>
    (m.userId ? userName(m.userId) : null) ?? m.botName ?? t('slack.message.unknownUser')
  const channelName = (id: string): string | null => detail.value?.channels[id] ?? null
  const isMine = (m: SlackMessage): boolean => !!m.userId && m.userId === detail.value?.selfUserId

  // Emoji tuỳ chỉnh: ưu tiên bộ của thread (sidecar gửi kèm), rồi bộ cả workspace nếu
  // picker đã nạp (tra Map trong store, không quét mảng mỗi lần render một emoji).
  // Thuần — gọi trong render; việc xin ảnh nằm ở watch dưới.
  function customEmojiUrl(name: string): string | null {
    const d = detail.value
    return d ? (store.resolveCustomEmoji(d.thread.teamId, name, d.customEmoji)?.url ?? null) : null
  }

  // Emoji tuỳ chỉnh dùng trong thread (sidecar báo trong `customEmoji`) mà chưa có ảnh ⇒
  // xin theo lô. Store tự bỏ qua tên đã xin.
  watch(
    () => detail.value?.customEmoji,
    (emoji) => {
      const d = detail.value
      if (!d || !emoji) return
      const missing = Object.keys(emoji).flatMap((n) => {
        const r = store.resolveCustomEmoji(d.thread.teamId, n, emoji)
        return r && !r.url ? [r.name] : []
      })
      store.requestEmojiImages(d.thread.teamId, missing)
    },
    { immediate: true },
  )

  const authorKey = (m: SlackMessage): string => m.userId ?? `bot:${m.botName ?? ''}`
  const rows = computed<SlackMessageRow[]>(() => {
    const out: SlackMessageRow[] = []
    let prev: SlackMessage | null = null
    for (const m of detail.value?.messages ?? []) {
      const compact =
        !!prev &&
        !prev.isParent &&
        !m.isParent &&
        authorKey(prev) === authorKey(m) &&
        Number(m.ts) - Number(prev.ts) < GROUP_WINDOW_S
      out.push({ m, compact })
      prev = m
    }
    return out
  })

  const timeOf = (ts: string): string =>
    new Date(Number(ts) * 1000).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  const fullDateOf = (ts: string): string => new Date(Number(ts) * 1000).toLocaleString()

  async function toggleReaction(m: SlackMessage, name: string): Promise<void> {
    const d = detail.value
    if (!d) return
    const mine = m.reactions.find((r) => r.name === name)?.mine ?? false
    try {
      await store.setReaction(d.thread.id, m.ts, name, !mine)
      await reload()
    } catch (err) {
      fail('slack.toast.reactFailed', err)
    }
  }

  /** Thêm reaction từ picker — đã react rồi thì thôi (picker không phải công tắc). */
  async function addReaction(m: SlackMessage, name: string): Promise<void> {
    if (m.reactions.some((r) => r.name === name && r.mine)) return
    await toggleReaction(m, name)
  }

  // Bản sửa: mention thành `@Tên`, token khác (kênh, link, @here) giữ nguyên `<…>` để
  // lưu lại không mất (utils/slack-mrkdwn.ts). `'all'` an toàn ở đây vì chỉ tin của
  // CHÍNH người dùng mới sửa được — token trong đó là do người dùng đã gửi.
  const editDraftOf = (m: SlackMessage): SlackDraft =>
    mrkdwnToDraft(m.text, userName, userRealName, 'all')

  async function saveEdit(m: SlackMessage, edit: SlackDraft): Promise<boolean> {
    const d = detail.value
    const text = edit.draft.trim()
    if (!d || !text) return false
    try {
      await store.updateMessage(d.thread.id, m.ts, draftToMrkdwn(text, edit.mentions, edit.tokens))
      await reload()
      return true
    } catch (err) {
      fail('slack.toast.editFailed', err)
      return false
    }
  }

  async function deleteMessage(m: SlackMessage): Promise<void> {
    const d = detail.value
    if (!d) return
    const ok = await confirm({
      title: t('slack.message.deleteTitle'),
      description: t('slack.message.deleteBody'),
    })
    if (!ok) return
    try {
      await store.deleteMessage(d.thread.id, m.ts)
      await reload()
    } catch (err) {
      fail('slack.toast.deleteFailed', err)
    }
  }

  async function copyMessage(text: string): Promise<void> {
    const ok = await copyText(mrkdwnToPlain(text, userName))
    toast.add({
      title: t(ok ? 'common.copied' : 'slack.toast.copyFailed'),
      color: ok ? 'success' : 'error',
    })
  }

  return {
    userOf,
    userName,
    userRealName,
    authorName,
    channelName,
    isMine,
    customEmojiUrl,
    rows,
    timeOf,
    fullDateOf,
    toggleReaction,
    addReaction,
    editDraftOf,
    saveEdit,
    deleteMessage,
    copyMessage,
  }
}
