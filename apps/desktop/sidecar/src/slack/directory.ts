// Danh bạ của một workspace Slack: user, emoji tuỳ chỉnh, tên kênh.
//
// Cache 6 giờ, lưu `~/.awog/slack/cache/<teamId>/directory.json`: mỗi lần mở
// thread cần tên + avatar của vài chục người, gọi `users.info` lại từng người
// mỗi lần thì vừa chậm vừa ăn rate-limit. Đổi tên/avatar trên Slack chậm vài
// giờ mới hiện là chấp nhận được.
//
// `users.list` (cả workspace) chỉ kéo khi cần TÌM user cho gợi ý `@` — đọc
// thread chỉ cần đúng những người xuất hiện, tra theo id bằng `users.info`.
//
// Thiếu scope `emoji:read` (token hiện tại chưa có) ⇒ emoji tuỳ chỉnh là rỗng,
// không phải lỗi: UI vẫn hiện tên `:emoji:` dạng chữ.
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { SlackApiError } from './client.js'
import { cachedImageDataUri, dropCachedImage } from './avatar.js'
import { mapLimit } from './concurrency.js'
import { readJsonFile, serialize, slackHome, writeJsonAtomic } from './json-file.js'
import { ConversationInfoSchema, RawUserSchema, nextCursorOf, type RawUser } from './payload.js'
import { TEAM_RE, USER_RE } from './params.js'
import type { SlackSession } from './session.js'
import type { SlackEmoji, SlackUser } from './types.js'
import { log } from '../util/logger.js'

export const DIRECTORY_TTL_MS = 6 * 60 * 60_000
const USERS_PAGE_LIMIT = 200
const USERS_MAX_PAGES = 50
const MEMBERS_MAX_PAGES = 10
const SEARCH_LIMIT = 20
const API_CONCURRENCY = 4
const IMAGE_CONCURRENCY = 6

const UserEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string(),
  realName: z.string(),
  isBot: z.boolean(),
  deleted: z.boolean(),
  avatarUrl: z.string().nullable(),
  at: z.number(),
  // Slack trả `user_not_found` (user đã rời Slack Connect, id lạ trong reaction…).
  // Vẫn ghi lại để TTL chặn hỏi lại mỗi lần mở thread; không hiện trong gợi ý `@`.
  notFound: z.boolean().optional(),
})
type UserEntry = z.infer<typeof UserEntrySchema>

const DirectorySchema = z.object({
  version: z.literal(1),
  users: z.record(UserEntrySchema),
  usersListedAt: z.number().nullable(),
  // Giá trị thô của `emoji.list`: URL ảnh hoặc `alias:<tên>`.
  emoji: z.record(z.string()),
  emojiAt: z.number().nullable(),
})
type Directory = z.infer<typeof DirectorySchema>

function emptyDirectory(): Directory {
  return { version: 1, users: {}, usersListedAt: null, emoji: {}, emojiAt: null }
}

export function teamCacheDir(teamId: string): string {
  // teamId đến từ auth.test/params đã qua regex — kiểm lại vì nó thành đường dẫn.
  if (!TEAM_RE.test(teamId)) throw new Error('invalid team id')
  return join(slackHome(), 'cache', teamId)
}

function directoryFile(teamId: string): string {
  return join(teamCacheDir(teamId), 'directory.json')
}

const memory = new Map<string, Directory>()

async function loadDirectory(teamId: string): Promise<Directory> {
  const hit = memory.get(teamId)
  if (hit) return hit
  const dir = (await readJsonFile(directoryFile(teamId), DirectorySchema)) ?? emptyDirectory()
  memory.set(teamId, dir)
  return dir
}

// Mọi sửa đổi danh bạ đi qua đây: tuần tự theo team, ghi đĩa sau khi sửa RAM.
function updateDirectory(teamId: string, fn: (dir: Directory) => void): Promise<void> {
  return serialize(`slack-dir-${teamId}`, async () => {
    const dir = await loadDirectory(teamId)
    fn(dir)
    try {
      await writeJsonAtomic(directoryFile(teamId), dir)
    } catch (err) {
      log.warn('slack: failed to write directory cache', {
        err: err instanceof Error ? err.message : String(err),
      })
    }
  })
}

function isFresh(at: number | null | undefined): boolean {
  return typeof at === 'number' && Date.now() - at < DIRECTORY_TTL_MS
}

function entryFromRaw(raw: RawUser): UserEntry {
  const profile = raw.profile ?? {}
  return {
    id: raw.id,
    name: raw.name ?? raw.id,
    displayName: profile.display_name ?? '',
    realName: profile.real_name ?? raw.real_name ?? '',
    isBot: raw.is_bot ?? false,
    deleted: raw.deleted ?? false,
    avatarUrl: profile.image_72 ?? profile.image_48 ?? null,
    at: Date.now(),
  }
}

// userId đến từ payload Slack (L1) và thành một đoạn đường dẫn ⇒ id lệch regex
// thì không có file avatar nào (null), không bao giờ `join` thẳng.
function avatarBase(teamId: string, userId: string): string | null {
  if (!USER_RE.test(userId)) return null
  return join(teamCacheDir(teamId), 'avatars', userId)
}

async function withAvatar(session: SlackSession, e: UserEntry): Promise<SlackUser> {
  const base = avatarBase(session.teamId, e.id)
  return {
    id: e.id,
    name: e.name,
    displayName: e.displayName,
    realName: e.realName,
    avatar: base ? await cachedImageDataUri(session, e.avatarUrl, base) : null,
    isBot: e.isBot,
    deleted: e.deleted,
  }
}

// Ghi entry mới; avatar đổi URL thì bỏ ảnh cũ trên đĩa, nếu không người dùng
// thấy mặt cũ mãi vì file cache được đặt tên theo userId.
async function storeEntries(teamId: string, entries: UserEntry[]): Promise<void> {
  const stale: string[] = []
  await updateDirectory(teamId, (dir) => {
    for (const e of entries) {
      // id từ `users.list`/`users.info` vẫn là payload L1 — lệch regex thì bỏ.
      if (!USER_RE.test(e.id)) continue
      const prev = dir.users[e.id]
      if (prev && prev.avatarUrl !== e.avatarUrl) stale.push(e.id)
      dir.users[e.id] = e
    }
  })
  await Promise.all(
    stale.map((id) => {
      const base = avatarBase(teamId, id)
      return base ? dropCachedImage(base) : undefined
    }),
  )
}

function placeholderEntry(id: string, at: number): UserEntry {
  return {
    id,
    name: id,
    displayName: '',
    realName: '',
    isBot: false,
    deleted: false,
    avatarUrl: null,
    at,
  }
}

async function fetchUserInfo(session: SlackSession, id: string): Promise<UserEntry | null> {
  try {
    const data = await session.api('users.info', { user: id })
    const parsed = RawUserSchema.safeParse(data.user)
    return parsed.success ? entryFromRaw(parsed.data) : null
  } catch (err) {
    // Negative cache: không có entry thì mỗi lần mở thread lại hỏi `users.info`
    // cho cùng một id chết, ăn rate-limit vô ích.
    if (err instanceof SlackApiError && err.code === 'user_not_found') {
      return { ...placeholderEntry(id, Date.now()), notFound: true }
    }
    throw err
  }
}

// User theo id (tác giả, người được nhắc, người react). Id không tra được vẫn
// có mặt trong kết quả với tên = id, để UI không phải xử lý "user vắng".
export async function getUsers(
  session: SlackSession,
  ids: readonly string[],
): Promise<Record<string, SlackUser>> {
  // Id lệch regex (payload L1) bỏ hẳn: không hỏi Slack, không thành đường dẫn.
  const unique = [...new Set(ids)].filter((id) => USER_RE.test(id))
  const dir = await loadDirectory(session.teamId)
  const missing = unique.filter((id) => !isFresh(dir.users[id]?.at))
  if (missing.length > 0) {
    const fetched = await mapLimit(missing, API_CONCURRENCY, async (id) => {
      try {
        return await fetchUserInfo(session, id)
      } catch (err) {
        // Mạng/rate-limit: dùng bản cũ nếu có, không làm hỏng cả thread.
        log.warn('slack: users.info failed', {
          code: err instanceof SlackApiError ? err.code : 'unknown',
        })
        return null
      }
    })
    await storeEntries(
      session.teamId,
      fetched.filter((e): e is UserEntry => e !== null),
    )
  }
  const entries = unique.map((id): UserEntry => dir.users[id] ?? placeholderEntry(id, 0))
  const users = await mapLimit(entries, IMAGE_CONCURRENCY, (e) => withAvatar(session, e))
  return Object.fromEntries(users.map((u) => [u.id, u]))
}

async function ensureUserList(session: SlackSession): Promise<Directory> {
  const dir = await loadDirectory(session.teamId)
  if (isFresh(dir.usersListedAt)) return dir
  const collected: UserEntry[] = []
  let cursor: string | null = null
  for (let page = 0; page < USERS_MAX_PAGES; page += 1) {
    // eslint-disable-next-line no-await-in-loop -- phân trang bằng cursor, buộc tuần tự
    const data = await session.api('users.list', {
      limit: USERS_PAGE_LIMIT,
      ...(cursor ? { cursor } : {}),
    })
    const members = Array.isArray(data.members) ? data.members : []
    for (const m of members) {
      const parsed = RawUserSchema.safeParse(m)
      if (parsed.success) collected.push(entryFromRaw(parsed.data))
    }
    cursor = nextCursorOf(data as { response_metadata?: { next_cursor?: string } })
    if (!cursor) break
  }
  await storeEntries(session.teamId, collected)
  await updateDirectory(session.teamId, (d) => {
    d.usersListedAt = Date.now()
  })
  return loadDirectory(session.teamId)
}

const members = new Map<string, { ids: Set<string>; at: number }>()

async function channelMembers(session: SlackSession, channelId: string): Promise<Set<string>> {
  const key = `${session.teamId}:${channelId}`
  const hit = members.get(key)
  if (hit && isFresh(hit.at)) return hit.ids
  const ids = new Set<string>()
  try {
    let cursor: string | null = null
    for (let page = 0; page < MEMBERS_MAX_PAGES; page += 1) {
      // eslint-disable-next-line no-await-in-loop -- phân trang bằng cursor
      const data = await session.api('conversations.members', {
        channel: channelId,
        limit: USERS_PAGE_LIMIT,
        ...(cursor ? { cursor } : {}),
      })
      for (const id of Array.isArray(data.members) ? data.members : []) {
        if (typeof id === 'string') ids.add(id)
      }
      cursor = nextCursorOf(data as { response_metadata?: { next_cursor?: string } })
      if (!cursor) break
    }
  } catch (err) {
    // Không xếp hạng được theo kênh vẫn gợi ý được — không phải lỗi chặn.
    log.warn('slack: conversations.members failed', {
      code: err instanceof SlackApiError ? err.code : 'unknown',
    })
  }
  members.set(key, { ids, at: Date.now() })
  return ids
}

function norm(s: string): string {
  return s.normalize('NFKC').toLowerCase()
}

// Gợi ý `@user`: thành viên kênh xếp trước, rồi khớp đầu chuỗi trước khớp giữa.
export async function searchUsers(
  session: SlackSession,
  query: string | undefined,
  channelId: string | undefined,
): Promise<SlackUser[]> {
  const dir = await ensureUserList(session)
  const inChannel = channelId ? await channelMembers(session, channelId) : new Set<string>()
  const q = norm(query?.trim() ?? '')
  const scored: Array<{ e: UserEntry; score: number }> = []
  for (const e of Object.values(dir.users)) {
    if (e.deleted || e.notFound || e.id === 'USLACKBOT') continue
    const names = [e.name, e.displayName, e.realName].map(norm)
    let score = 0
    if (q) {
      if (names.some((n) => n.startsWith(q))) score = 2
      else if (names.some((n) => n.includes(q))) score = 1
      else continue
    }
    if (inChannel.has(e.id)) score += 10
    if (e.isBot) score -= 5
    scored.push({ e, score })
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (a.e.displayName || a.e.realName || a.e.name).localeCompare(
        b.e.displayName || b.e.realName || b.e.name,
      ),
  )
  return mapLimit(
    scored.slice(0, SEARCH_LIMIT).map((s) => s.e),
    IMAGE_CONCURRENCY,
    (e) => withAvatar(session, e),
  )
}

async function emojiMap(session: SlackSession): Promise<Record<string, string>> {
  const dir = await loadDirectory(session.teamId)
  if (isFresh(dir.emojiAt)) return dir.emoji
  if (!session.hasScope('emoji:read')) return {}
  try {
    const data = await session.api('emoji.list', {})
    const raw = typeof data.emoji === 'object' && data.emoji !== null ? data.emoji : {}
    // Không prototype: tên emoji do người trong workspace đặt, `:__proto__:` là tên hợp lệ.
    const emoji = Object.create(null) as Record<string, string>
    for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'string') emoji[name] = value
    }
    await updateDirectory(session.teamId, (d) => {
      d.emoji = emoji
      d.emojiAt = Date.now()
    })
    return emoji
  } catch (err) {
    const code = err instanceof SlackApiError ? err.code : 'unknown'
    if (code !== 'missing_scope') log.warn('slack: emoji.list failed', { code })
    return dir.emoji
  }
}

function emojiImageBase(teamId: string, url: string): string {
  // Đặt tên theo hash URL: emoji up lại cùng tên có URL mới ⇒ tự ra file mới.
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 24)
  return join(teamCacheDir(teamId), 'emoji', hash)
}

type EmojiTarget = { alias: string | null; url: string | null }

// Tra map emoji CHỈ theo khoá riêng: tên emoji (từ tin, reaction, renderer) là L1, và
// `map['constructor']` / `map['__proto__']` trên object thường trả về hàm/prototype
// của Object ⇒ `.startsWith` nổ, cả thread không mở được. Map nạp lại từ đĩa (zod) là
// object thường nên phải kiểm ở chỗ tra, không chỉ ở chỗ dựng.
function emojiValue(map: Record<string, string>, name: string): string | undefined {
  return Object.hasOwn(map, name) ? map[name] : undefined
}

// Giải alias: alias tới emoji CHUẨN ⇒ không có ảnh; UI vẽ emoji chuẩn theo `alias`.
function emojiTarget(map: Record<string, string>, name: string): EmojiTarget | null {
  const value = emojiValue(map, name)
  if (value === undefined) return null
  if (!value.startsWith('alias:')) return { alias: null, url: value }
  const alias = value.slice('alias:'.length)
  const target = emojiValue(map, alias)
  return { alias, url: target && !target.startsWith('alias:') ? target : null }
}

async function emojiDataUri(session: SlackSession, url: string | null): Promise<string | null> {
  return url ? cachedImageDataUri(session, url, emojiImageBase(session.teamId, url)) : null
}

async function toEmoji(
  session: SlackSession,
  map: Record<string, string>,
  name: string,
): Promise<SlackEmoji | null> {
  const target = emojiTarget(map, name)
  if (!target) return null
  return { name, url: await emojiDataUri(session, target.url), alias: target.alias }
}

// Chỉ những emoji tuỳ chỉnh có tên trong `names` (bỏ qua tên chuẩn/không có).
export async function resolveCustomEmoji(
  session: SlackSession,
  names: readonly string[],
): Promise<Record<string, SlackEmoji>> {
  const map = await emojiMap(session)
  const wanted = [...new Set(names)].filter((n) => emojiValue(map, n) !== undefined)
  const list = await mapLimit(wanted, IMAGE_CONCURRENCY, (n) => toEmoji(session, map, n))
  return Object.fromEntries(
    list.filter((e): e is SlackEmoji => e !== null).map((e) => [e.name, e]),
  )
}

// Danh sách cho picker: CHỈ tên + alias, không ảnh. Workspace có hàng nghìn emoji
// tuỳ chỉnh; tải + base64 hết trong một RPC là hàng chục MB và hàng nghìn request
// ra CDN chỉ để mở picker. Ảnh lấy theo lô qua `emojiImages` cho phần đang hiện.
export async function listCustomEmoji(session: SlackSession): Promise<SlackEmoji[]> {
  const map = await emojiMap(session)
  return Object.keys(map)
    .map((name): SlackEmoji | null => {
      const target = emojiTarget(map, name)
      return target ? { name, url: null, alias: target.alias } : null
    })
    .filter((e): e is SlackEmoji => e !== null)
}

// Ảnh (data URI) cho một lô tên emoji tuỳ chỉnh. Tên không có / alias tới emoji
// chuẩn / tải hỏng thì vắng trong kết quả.
export async function emojiImages(
  session: SlackSession,
  names: readonly string[],
): Promise<Record<string, string>> {
  const map = await emojiMap(session)
  const wanted = [...new Set(names)].filter((n) => emojiValue(map, n) !== undefined)
  const uris = await mapLimit(wanted, IMAGE_CONCURRENCY, (n) =>
    emojiDataUri(session, emojiTarget(map, n)?.url ?? null),
  )
  const out = Object.create(null) as Record<string, string>
  wanted.forEach((n, i) => {
    const uri = uris[i]
    if (uri) out[n] = uri
  })
  return out
}

const channelNames = new Map<string, { name: string; at: number }>()

// Tên hiển thị của kênh (không '#'). DM thì lấy tên người kia.
export async function getChannelName(session: SlackSession, channelId: string): Promise<string> {
  const key = `${session.teamId}:${channelId}`
  const hit = channelNames.get(key)
  if (hit && isFresh(hit.at)) return hit.name
  const data = await session.api('conversations.info', { channel: channelId })
  const parsed = ConversationInfoSchema.safeParse(data)
  let name = channelId
  if (parsed.success) {
    const ch = parsed.data.channel
    if (ch.is_im && ch.user) {
      const users = await getUsers(session, [ch.user])
      const u = users[ch.user]
      name = u ? u.displayName || u.realName || u.name : ch.user
    } else if (ch.name) {
      name = ch.name
    }
  }
  channelNames.set(key, { name, at: Date.now() })
  return name
}

// Như getChannelName nhưng không ném: kênh không tra được (mất quyền, kênh
// riêng người dùng không ở trong) vẫn hiện bằng id.
export async function getChannelNames(
  session: SlackSession,
  ids: readonly string[],
): Promise<Record<string, string>> {
  const unique = [...new Set(ids)]
  const names = await mapLimit(unique, API_CONCURRENCY, async (id) => {
    try {
      return await getChannelName(session, id)
    } catch {
      return id
    }
  })
  return Object.fromEntries(unique.map((id, i) => [id, names[i] ?? id]))
}
