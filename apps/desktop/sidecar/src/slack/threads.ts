// Nghiệp vụ thread: thêm thread từ permalink, dựng SlackThreadDetail, map tin.
//
// Hành vi phân trang `conversations.replies` (đo 2026-10-16 trên workspace
// thật): mỗi trang LUÔN kèm tin gốc ở đầu; trang đầu là các reply MỚI NHẤT,
// `cursor` dẫn về các reply CŨ hơn. Vì vậy `nextCursor` của slack.thread.get
// nghĩa là "tải thêm tin cũ", và tin gốc trùng giữa các trang là bình thường.
import { log } from '../util/logger.js'
import { SlackApiError } from './client.js'
import { getChannelNames, getUsers, resolveCustomEmoji } from './directory.js'
import { hydrateFiles, rememberFiles, toSlackFile } from './files.js'
import {
  baseEmojiName,
  emojiNames,
  firstLine,
  mentionedChannels,
  mentionedUserIds,
} from './mrkdwn.js'
import { RepliesSchema, nextCursorOf, type RawMessage } from './payload.js'
import { emitSlackChanged } from './rpc.js'
import { hostOfTeamUrl, parsePermalink } from './permalink.js'
import {
  listSlackSources,
  openSlackSession,
  openSlackSessionForTeam,
  type SlackSession,
} from './session.js'
import { TS_RE, USER_RE } from './params.js'
import { getThread, insertThread, maxTs, mutateThread, requireThread } from './store.js'
import {
  threadIdOf,
  type SlackMessage,
  type SlackThread,
  type SlackThreadDetail,
  type SlackThreadError,
  type SlackUnfurl,
} from './types.js'

const DETAIL_PAGE_LIMIT = 200

// Mã lỗi Slack nghĩa là "thread này không còn đọc được" — ghi vào thread.error
// để UI hiện trạng thái thay vì báo lỗi mỗi lần poll.
export function threadErrorOf(code: string): SlackThreadError | null {
  if (code === 'thread_not_found' || code === 'message_not_found') return 'not_found'
  if (code === 'channel_not_found' || code === 'not_in_channel' || code === 'access_denied') {
    return 'no_access'
  }
  return null
}

// ts từ payload Slack (L1) trước khi vào store: lệch TS_RE ⇒ giữ giá trị cũ.
export function validTsOr(ts: string | undefined, fallback: string): string {
  return ts !== undefined && TS_RE.test(ts) ? ts : fallback
}

function httpsOrNull(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

function toUnfurls(raw: RawMessage): SlackUnfurl[] {
  return (raw.attachments ?? []).map((a) => ({
    title: a.title ?? null,
    text: a.text ?? a.fallback ?? null,
    url: httpsOrNull(a.title_link ?? a.from_url ?? a.original_url),
    serviceName: a.service_name ?? null,
    imageUrl: httpsOrNull(a.image_url ?? a.thumb_url),
  }))
}

export function toSlackMessage(
  raw: RawMessage,
  threadTs: string,
  selfUserId: string,
  canReadFiles: boolean,
): SlackMessage {
  const isBot = !raw.user || Boolean(raw.bot_id && raw.subtype === 'bot_message')
  return {
    ts: raw.ts,
    userId: isBot ? null : (raw.user ?? null),
    botName: isBot ? (raw.bot_profile?.name ?? raw.username ?? null) : null,
    text: raw.text ?? '',
    editedTs: raw.edited?.ts ?? null,
    reactions: (raw.reactions ?? []).map((r) => {
      const users = r.users ?? []
      return { name: r.name, count: r.count ?? users.length, users, mine: users.includes(selfUserId) }
    }),
    files: (raw.files ?? []).map((f) => toSlackFile(f, canReadFiles)),
    unfurls: toUnfurls(raw),
    isParent: raw.ts === threadTs,
    subtype: raw.subtype ?? null,
  }
}

async function fetchReplies(
  session: SlackSession,
  channelId: string,
  ts: string,
  extra: Record<string, string | number | boolean>,
): Promise<{ messages: RawMessage[]; nextCursor: string | null }> {
  const data = await session.api('conversations.replies', { channel: channelId, ts, ...extra })
  const parsed = RepliesSchema.safeParse(data)
  if (!parsed.success) throw new SlackApiError('bad_response', 'conversations.replies: bad shape')
  return { messages: parsed.data.messages, nextCursor: nextCursorOf(parsed.data) }
}

async function computeFirstLine(session: SlackSession, text: string): Promise<string> {
  const ids = mentionedUserIds(text)
  if (ids.length === 0) return firstLine(text)
  try {
    const users = await getUsers(session, ids)
    return firstLine(text, (id) => {
      // id lấy từ `<@…>` trong tin: chỉ tra khoá riêng (`<@constructor>`).
      const u = Object.hasOwn(users, id) ? users[id] : undefined
      return u ? u.displayName || u.realName || u.name : null
    })
  } catch {
    return firstLine(text)
  }
}

// Chọn nguồn Slack cho một permalink: link app.slack.com mang team id; link
// `<ws>.slack.com` so với host trong `auth.test.url`. Chỉ có một nguồn thì
// dùng luôn cho link `slack.com` trơn.
async function sessionForLink(link: {
  teamId: string | null
  workspaceHost: string | null
}): Promise<SlackSession> {
  if (link.teamId) return openSlackSessionForTeam(link.teamId)
  const sources = await listSlackSources()
  if (sources.length === 0) {
    throw new SlackApiError('not_connected', 'No Slack source — add one in Sources first')
  }
  let lastErr: unknown = null
  for (const source of sources) {
    try {
      // eslint-disable-next-line no-await-in-loop -- 1–2 nguồn
      const session = await openSlackSession(source.id)
      if (!link.workspaceHost && sources.length === 1) return session
      if (link.workspaceHost && hostOfTeamUrl(session.teamUrl) === link.workspaceHost) {
        return session
      }
    } catch (err) {
      lastErr = err
    }
  }
  if (lastErr instanceof SlackApiError && sources.length === 1) throw lastErr
  throw new SlackApiError(
    'workspace_not_connected',
    `No connected Slack source for ${link.workspaceHost ?? 'this workspace'}`,
  )
}

export async function addThreadFromLink(
  url: string,
  projectId: string | null,
): Promise<{ thread: SlackThread; created: boolean }> {
  const link = parsePermalink(url)
  if (!link) throw new SlackApiError('invalid_link', 'Not a Slack message link')
  const session = await sessionForLink(link)

  // Link đã chỉ rõ tin gốc và thread đã có ⇒ khỏi gọi Slack.
  const knownTs = link.threadTs ?? link.messageTs
  const existing = await getThread(threadIdOf(session.teamId, link.channelId, knownTs))
  if (existing) return { thread: existing, created: false }

  let { messages } = await fetchReplies(session, link.channelId, knownTs, { limit: 1 })
  const first = messages[0]
  if (!first) throw new SlackApiError('thread_not_found', 'Message not found')
  // Link vào reply mà không có `thread_ts` ⇒ Slack trả đúng tin đó kèm
  // `thread_ts` của tin gốc; hỏi lại bằng ts tin gốc.
  // `thread_ts` là payload L1 và sắp thành một phần id thread + khoá store (schema
  // store kiểm TS_RE — ghi giá trị lệch sẽ làm hỏng cả file ở lần đọc sau).
  const threadTs = first.thread_ts ?? first.ts
  if (!TS_RE.test(threadTs)) throw new SlackApiError('bad_response', 'Slack returned an invalid ts')
  if (threadTs !== knownTs) {
    const dup = await getThread(threadIdOf(session.teamId, link.channelId, threadTs))
    if (dup) return { thread: dup, created: false }
    ;({ messages } = await fetchReplies(session, link.channelId, threadTs, { limit: 1 }))
  }
  const parent = messages.find((m) => m.ts === threadTs)
  if (!parent) throw new SlackApiError('thread_not_found', 'Thread parent not found')

  const [names, line] = await Promise.all([
    getChannelNames(session, [link.channelId]),
    computeFirstLine(session, parent.text ?? ''),
  ])
  const lastReplyTs = validTsOr(parent.latest_reply, threadTs)
  const thread: SlackThread = {
    id: threadIdOf(session.teamId, link.channelId, threadTs),
    sourceId: session.sourceId,
    teamId: session.teamId,
    teamName: session.teamName,
    teamUrl: session.teamUrl,
    channelId: link.channelId,
    channelName: names[link.channelId] ?? link.channelId,
    threadTs,
    title: null,
    firstLine: line,
    projectId,
    sessionId: null,
    sessionSyncedTs: null,
    lastReplyTs,
    // Người dùng vừa dán link tức là vừa xem thread trên Slack — không bật chấm
    // chưa đọc ngay khi thêm.
    lastSeenTs: lastReplyTs,
    replyCount: parent.reply_count ?? 0,
    addedAt: Date.now(),
    error: null,
  }
  return insertThread(thread)
}

export type ThreadDetailPage = SlackThreadDetail & { nextCursor: string | null }

async function markThreadError(id: string, error: SlackThreadError): Promise<SlackThread> {
  return mutateThread(id, (t) => (t.error === error ? null : { ...t, error }))
}

// Đồng bộ ngược vào store có đổi gì (số reply, lỗi) thì tự phát `slack.changed`
// để cửa sổ còn lại cập nhật cây thread.
export async function getThreadDetail(
  threadId: string,
  cursor: string | undefined,
  limit: number = DETAIL_PAGE_LIMIT,
): Promise<ThreadDetailPage> {
  const tracked = await requireThread(threadId)
  const session = await openSlackSession(tracked.sourceId)

  let raws: RawMessage[]
  let nextCursor: string | null
  try {
    ;({ messages: raws, nextCursor } = await fetchReplies(
      session,
      tracked.channelId,
      tracked.threadTs,
      { limit, ...(cursor ? { cursor } : {}) },
    ))
  } catch (err) {
    const gone = err instanceof SlackApiError ? threadErrorOf(err.code) : null
    if (!gone) throw err
    const thread = await markThreadError(threadId, gone)
    if (thread.error !== tracked.error) emitSlackChanged([threadId])
    return {
      thread,
      messages: [],
      users: {},
      selfUserId: session.selfUserId,
      channels: { [thread.channelId]: thread.channelName },
      customEmoji: {},
      nextCursor: null,
    }
  }

  // Sắp theo thời gian, bỏ trùng (tin gốc có mặt ở mọi trang). Tin có `ts` lệch
  // TS_RE (payload L1) bị bỏ: ts đi vào so sánh BigInt, mốc store, khoá dịch.
  const byTs = new Map<string, RawMessage>()
  for (const m of raws) {
    if (TS_RE.test(m.ts)) byTs.set(m.ts, m)
  }
  const ordered = [...byTs.values()].sort((a, b) =>
    a.ts === tracked.threadTs ? -1 : b.ts === tracked.threadTs ? 1 : a.ts.localeCompare(b.ts),
  )

  const canRead = session.hasScope('files:read')
  for (const m of ordered) {
    if (!m.files?.length) continue
    // eslint-disable-next-line no-await-in-loop -- hiếm tin có file; tuần tự cho nhẹ rate-limit
    m.files = await hydrateFiles(session, m.files)
    rememberFiles(session.teamId, m.files)
  }
  const messages = ordered.map((m) =>
    toSlackMessage(m, tracked.threadTs, session.selfUserId, canRead),
  )

  const userIds = new Set<string>([session.selfUserId])
  const channelIds = new Map<string, string | null>([[tracked.channelId, tracked.channelName]])
  const emoji = new Set<string>()
  // Id user lấy từ payload (L1) chỉ được vào getUsers khi khớp USER_RE — getUsers
  // biến id thành tên file avatar.
  const addUser = (id: string): void => {
    if (USER_RE.test(id)) userIds.add(id)
  }
  for (const m of messages) {
    if (m.userId) addUser(m.userId)
    for (const id of mentionedUserIds(m.text)) addUser(id)
    for (const c of mentionedChannels(m.text)) {
      if (!channelIds.get(c.id)) channelIds.set(c.id, c.name)
    }
    for (const name of emojiNames(m.text)) emoji.add(name)
    for (const r of m.reactions) {
      emoji.add(baseEmojiName(r.name))
      for (const u of r.users) addUser(u)
    }
  }
  const unnamed = [...channelIds].filter(([, name]) => !name).map(([id]) => id)
  const [users, lookedUp, customEmoji] = await Promise.all([
    getUsers(session, [...userIds]),
    getChannelNames(session, unnamed),
    resolveCustomEmoji(session, [...emoji]).catch((err: unknown) => {
      log.warn('slack: custom emoji lookup failed', {
        code: err instanceof SlackApiError ? err.code : 'unknown',
      })
      return {}
    }),
  ])
  const channels: Record<string, string> = {}
  for (const [id, name] of channelIds) channels[id] = name ?? lookedUp[id] ?? id

  // Trang đầu (không cursor) mang trạng thái mới nhất của tin gốc ⇒ đồng bộ
  // ngược vào store: số reply, reply mới nhất, dòng đầu (tin gốc có thể đã sửa).
  let thread = tracked
  const parentRaw = byTs.get(tracked.threadTs)
  if (!cursor && parentRaw) {
    const newest = ordered.reduce((acc, m) => maxTs(acc, m.ts), tracked.threadTs)
    const line = firstLine(parentRaw.text ?? '', (id) => {
      // id lấy từ `<@…>` trong tin: chỉ tra khoá riêng (`<@constructor>`).
      const u = Object.hasOwn(users, id) ? users[id] : undefined
      return u ? u.displayName || u.realName || u.name : null
    })
    thread = await mutateThread(threadId, (t) => ({
      ...t,
      lastReplyTs: validTsOr(parentRaw.latest_reply, newest),
      replyCount: parentRaw.reply_count ?? t.replyCount,
      firstLine: line,
      error: null,
    }))
    if (JSON.stringify(thread) !== JSON.stringify(tracked)) emitSlackChanged([threadId])
  }

  return {
    thread,
    messages,
    users,
    selfUserId: session.selfUserId,
    channels,
    customEmoji,
    nextCursor,
  }
}

// Tin `ts` trong thread có phải của chính người dùng không — điều kiện trước
// khi sửa/xoá. Slack cũng tự chặn (`cant_update_message`), nhưng kiểm trước
// thì không phụ thuộc vào việc token có quyền admin xoá tin người khác.
export async function assertOwnMessage(
  session: SlackSession,
  thread: SlackThread,
  ts: string,
): Promise<void> {
  const { messages } = await fetchReplies(session, thread.channelId, thread.threadTs, {
    oldest: ts,
    latest: ts,
    inclusive: true,
    limit: 2,
  })
  const msg = messages.find((m) => m.ts === ts)
  if (!msg) throw new SlackApiError('message_not_found', 'Message not found in this thread')
  if (msg.user !== session.selfUserId) {
    throw new SlackApiError('not_own_message', 'Only your own messages can be changed')
  }
}
