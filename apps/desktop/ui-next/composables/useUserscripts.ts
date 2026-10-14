import { ref } from 'vue'
import type { UserscriptItem } from '~/types'
import { SidecarUnavailableError, useSidecar } from '~/composables/useSidecar'

// Userscript của trình duyệt nhúng (docs/features/browser-userscripts.md).
//
// Sidecar SỞ HỮU danh sách (`~/.awog/browser/userscripts/`); đây chỉ là bản chiếu
// phía UI, state cấp module để Settings và menu ⋮ nhìn cùng một sự thật. Event
// `userscripts.changed` kéo nó về đồng bộ (cả khi cửa sổ khác sửa).
//
// Việc chạy script (khớp URL, tiêm vào trang) hoàn toàn ở Electron main — UI không
// bao giờ thấy hay thực thi mã script, chỉ soạn nguồn và gửi cho sidecar lưu.

const scripts = ref<UserscriptItem[]>([])
const loaded = ref(false)

let loadingPromise: Promise<void> | null = null
let unlisten: (() => void) | null = null

const fetchList = async (): Promise<void> => {
  const res = await useSidecar().request<{ scripts: UserscriptItem[] }>('userscripts.list')
  scripts.value = res.scripts
  loaded.value = true
}

const subscribe = async (): Promise<void> => {
  if (unlisten) return
  try {
    unlisten = await useSidecar().onEvent((evt) => {
      if (evt?.type === 'userscripts.changed') void fetchList().catch(() => {})
    })
  } catch {
    // Không có engine (browser-dev) — không có gì để nghe.
  }
}

const load = (force = false): Promise<void> => {
  if (loaded.value && !force) return Promise.resolve()
  if (!loadingPromise || force) {
    loadingPromise = fetchList()
      .catch((err: unknown) => {
        if (!(err instanceof SidecarUnavailableError)) console.warn('[userscripts] load', err)
      })
      .finally(() => {
        loadingPromise = null
      })
  }
  void subscribe()
  return loadingPromise
}

// Mẫu script mới. `pageUrl` (khi mở từ trình duyệt) quyết định `@match`: chỉ origin của
// trang, vì pattern theo đúng đường dẫn hiếm khi là thứ người dùng muốn. URL không phải
// http(s) (about:blank, wspreview://…) không có origin để khớp → để ví dụ.
export function userscriptMatchFor(pageUrl?: string | null): string {
  if (pageUrl) {
    try {
      const u = new URL(pageUrl)
      if (u.protocol === 'http:' || u.protocol === 'https:') return `*://${u.host}/*`
    } catch {
      // URL hỏng — rơi về ví dụ.
    }
  }
  return 'https://example.com/*'
}

export function buildUserscriptTemplate(pageUrl?: string | null): string {
  return [
    '// ==UserScript==',
    '// @name         New userscript',
    '// @namespace    awog',
    '// @version      0.1.0',
    '// @description  What this script does',
    `// @match        ${userscriptMatchFor(pageUrl)}`,
    '// @run-at       document-end',
    '// @grant        none',
    '// ==/UserScript==',
    '',
    '(function () {',
    "  'use strict'",
    '  // …',
    '})()',
    '',
  ].join('\n')
}

export function useUserscripts() {
  const sc = useSidecar()
  void load()

  const get = async (id: string): Promise<string> =>
    (await sc.request<{ id: string; source: string }>('userscripts.get', { id })).source

  // `id` vắng = tạo mới. Sidecar parse + validate và ném lỗi đọc được (thiếu @name…).
  const save = async (source: string, id?: string): Promise<UserscriptItem> => {
    const item = await sc.request<UserscriptItem>('userscripts.save', {
      ...(id ? { id } : {}),
      source,
    })
    await load(true)
    return item
  }

  const setEnabled = async (id: string, enabled: boolean): Promise<void> => {
    await sc.request('userscripts.setEnabled', { id, enabled })
    await load(true)
  }

  const remove = async (id: string): Promise<void> => {
    await sc.request('userscripts.remove', { id })
    await load(true)
  }

  // Sidecar tải (https-only, qua guard SSRF, cap 512KB) rồi LƯU luôn.
  const importUrl = async (url: string): Promise<UserscriptItem> => {
    const item = await sc.request<UserscriptItem>('userscripts.importUrl', { url })
    await load(true)
    return item
  }

  return {
    scripts,
    loaded,
    reload: () => load(true),
    get,
    save,
    setEnabled,
    remove,
    importUrl,
  }
}
