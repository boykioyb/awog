import { computed, ref, watch } from 'vue'
import type { BookmarkFolder, BookmarkNode, BookmarkUrl } from '~/types'
import { SidecarUnavailableError, useSidecar } from '~/composables/useSidecar'

// Bookmark của trình duyệt nhúng (ADR 0101, docs/features/browser-profiles-bookmarks.md).
//
// Thay cho "pin" cũ (`awog.browserPins` ở localStorage): bookmark thuộc về MỘT HỒ SƠ
// và sidecar sở hữu dữ liệu (`~/.awog/browser/profiles/<id>/bookmarks.json`), nên cây
// ở đây chỉ là bản chiếu — mọi ghi đi qua RPC rồi chờ `bookmarks.changed` (hoặc kết
// quả của chính lệnh) kéo về, không sửa cây cục bộ trước ("lạc quan" sẽ lệch khi
// sidecar từ chối URL không phải http/https hay vượt trần 500 mục).
//
// State cấp module theo `profileId`: thanh bookmark, ☆ trong ô URL, menu "Tất cả
// bookmark" và thẻ ở empty-state cùng nhìn một cây.

const LEGACY_PINS_KEY = 'awog.browserPins'

const trees = ref<Record<string, BookmarkNode[]>>({})
const inflight = new Map<string, Promise<void>>()
let unlisten: (() => void) | null = null
let migration: Promise<void> | null = null

// So URL bỏ "/" cuối: `wc.getURL()` chuẩn hoá `https://x.com` thành `https://x.com/`
// còn URL người dùng gõ/dán thì không — thiếu bước này cùng một trang lưu hai lần và
// ☆ không bao giờ sáng.
export const bookmarkKey = (url: string): string =>
  String(url ?? '')
    .trim()
    .replace(/\/+$/, '')

const fetchTree = async (profileId: string): Promise<void> => {
  const res = await useSidecar().request<{ items: BookmarkNode[] }>('bookmarks.list', {
    profileId,
  })
  trees.value = { ...trees.value, [profileId]: res.items }
}

const ensureLoaded = (profileId: string, force = false): Promise<void> => {
  if (!force && trees.value[profileId]) return Promise.resolve()
  const running = inflight.get(profileId)
  if (running && !force) return running
  const p = fetchTree(profileId)
    .catch((err: unknown) => {
      if (!(err instanceof SidecarUnavailableError)) console.warn('[bookmarks] load', err)
    })
    .finally(() => {
      inflight.delete(profileId)
    })
  inflight.set(profileId, p)
  return p
}

const subscribe = async (): Promise<void> => {
  if (unlisten) return
  try {
    unlisten = await useSidecar().onEvent((evt) => {
      if (evt?.type !== 'bookmarks.changed') return
      const payload = evt.payload
      const pid =
        payload && typeof payload === 'object' && 'profileId' in payload
          ? payload.profileId
          : undefined
      // Chỉ nạp lại hồ sơ ĐANG được giữ — hồ sơ chưa ai xem sẽ nạp lúc cần.
      if (typeof pid === 'string' && trees.value[pid]) void ensureLoaded(pid, true)
    })
  } catch {
    // Không engine (browser-dev).
  }
}

// Chuyển pin cũ một lần: đọc `awog.browserPins`, đổ vào bookmark của hồ sơ mặc định
// (sidecar idempotent theo URL), rồi XOÁ khoá. Chỉ xoá khi RPC thành công — mất engine
// giữa chừng thì lần mở sau thử lại, không mất pin.
const readLegacyPins = (): { url: string; title: string }[] => {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(LEGACY_PINS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((p: unknown) => {
      if (!p || typeof p !== 'object' || !('url' in p) || typeof p.url !== 'string') return []
      const title = 'title' in p && typeof p.title === 'string' ? p.title : ''
      return [{ url: p.url, title }]
    })
  } catch {
    return []
  }
}

const migrateLegacyPins = (): Promise<void> => {
  if (migration) return migration
  migration = (async () => {
    if (typeof window === 'undefined') return
    if (window.localStorage.getItem(LEGACY_PINS_KEY) === null) return
    const pins = readLegacyPins()
    try {
      if (pins.length) {
        await useSidecar().request('bookmarks.importPins', { profileId: 'default', pins })
        await ensureLoaded('default', true)
      }
      window.localStorage.removeItem(LEGACY_PINS_KEY)
    } catch (err) {
      // Không engine thì để khoá nguyên — thử lại ở lần khởi động sau.
      migration = null
      if (!(err instanceof SidecarUnavailableError)) console.warn('[bookmarks] migrate pins', err)
    }
  })()
  return migration
}

export function useBookmarks(profileId: () => string) {
  const sc = useSidecar()

  const pid = computed(() => profileId() || 'default')
  // Hồ sơ của scope về SAU khi component đã dựng (sau reload: `profileOf` bất đồng bộ;
  // đổi hồ sơ phiên: event `session.browser-profile`) ⇒ phải nạp cây theo `pid`, không
  // chỉ một lần lúc setup — smoke app thật bắt được: thanh trống + ☆ không sáng dù
  // bookmarks.json có dữ liệu. Watch đăng ký ĐỒNG BỘ trong setup để tự gỡ khi component
  // unmount; chờ migration trước để bản đầu của `default` có pin cũ.
  watch(
    pid,
    (p) => {
      void migrateLegacyPins().then(() => ensureLoaded(p))
    },
    { immediate: true },
  )
  void subscribe()

  const items = computed<BookmarkNode[]>(() => trees.value[pid.value] ?? [])
  const loaded = computed(() => !!trees.value[pid.value])

  const folders = computed<BookmarkFolder[]>(() =>
    items.value.filter((n): n is BookmarkFolder => n.kind === 'folder'),
  )

  // Mọi bookmark url, phẳng — cả ở gốc lẫn trong thư mục — kèm thư mục chứa.
  const flat = computed<{ node: BookmarkUrl; folderId: string | null }[]>(() =>
    items.value.flatMap<{ node: BookmarkUrl; folderId: string | null }>((n) =>
      n.kind === 'url'
        ? [{ node: n, folderId: null }]
        : n.children.map((c) => ({ node: c, folderId: n.id })),
    ),
  )

  const find = (url: string): { node: BookmarkUrl; folderId: string | null } | undefined => {
    const k = bookmarkKey(url)
    return k ? flat.value.find((e) => bookmarkKey(e.node.url) === k) : undefined
  }
  const isBookmarked = (url: string): boolean => !!find(url)

  // Sau mỗi lệnh ghi nạp lại cây ngay thay vì chỉ chờ event: event tới sau và một
  // lệnh lỗi không phát event nào.
  const refresh = (): Promise<void> => ensureLoaded(pid.value, true)

  const add = async (url: string, title: string, folderId?: string): Promise<void> => {
    await sc.request('bookmarks.add', {
      profileId: pid.value,
      url,
      title,
      ...(folderId ? { folderId } : {}),
    })
    await refresh()
  }

  // `folderId: null` = đưa về gốc; vắng = không đổi chỗ.
  const update = async (
    id: string,
    patch: { title?: string; url?: string; folderId?: string | null; index?: number },
  ): Promise<void> => {
    await sc.request('bookmarks.update', { profileId: pid.value, id, ...patch })
    await refresh()
  }

  const remove = async (id: string): Promise<void> => {
    await sc.request('bookmarks.remove', { profileId: pid.value, id })
    await refresh()
  }

  // Trả id thư mục mới để dialog "thêm bookmark" bỏ bookmark vào ngay sau khi tạo.
  const addFolder = async (title: string): Promise<string> => {
    const node = await sc.request<BookmarkFolder>('bookmarks.addFolder', {
      profileId: pid.value,
      title,
    })
    await refresh()
    return node.id
  }

  // Chip/hàng hiển thị: tiêu đề, không có thì host, không có nữa thì URL thô.
  const labelOf = (b: { title: string; url?: string }): string => {
    if (b.title.trim()) return b.title.trim()
    const url = b.url ?? ''
    try {
      return new URL(url).host || url
    } catch {
      return url
    }
  }

  return {
    profileId: pid,
    items,
    folders,
    flat,
    loaded,
    find,
    isBookmarked,
    add,
    update,
    remove,
    addFolder,
    refresh,
    labelOf,
  }
}
