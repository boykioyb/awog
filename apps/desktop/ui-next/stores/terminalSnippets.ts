import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useSidecar, type UnlistenFn } from '~/composables/useSidecar'

// Terminal Snippets store — thư viện lệnh hay dùng của terminal (dock toàn cục + dock
// Workbench), theo project (+ tầng Global dùng chung). Chạy một snippet = ghi lệnh vào
// tab terminal đang chọn; store chỉ giữ thư viện, rail lo chỗ chạy.
//
// NGUỒN DỮ LIỆU: sidecar (`~/.awog/terminal-snippets.json`, terminal/snippets.ts) — để
// tool của agent (terminal_snippet_*) đọc/ghi CÙNG thư viện với người dùng. Mỗi lần
// ghi, từ UI hay từ agent, sidecar phát `terminalSnippets.changed` và store tải lại.
// Lần đầu chạy bản mới: thư viện cũ trong localStorage được chuyển sang một lần
// (`terminalSnippets.import` chỉ nhận khi file còn rỗng) rồi xoá khỏi localStorage.
// Ngoài Electron (dev trên trình duyệt) không có sidecar ⇒ dùng localStorage như cũ.
//
// Kept SEPARATE from sshSnippets (SSH-workspace-specific, flat, no project scope)
// by product decision: two libraries, no cross-contamination.

export interface TerminalSnippet {
  id: string
  name: string
  command: string
  // Owning tier: null = Global (shown in every project); else a project key
  // (shown only when that project is the active one).
  project: string | null
}

const STORAGE_KEY = 'awog-terminal-snippets'

// Read + validate the legacy localStorage library at the trust boundary (L1 — a
// corrupt / hand-edited value must not poison the store).
function readLocal(): TerminalSnippet[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw
      .filter(
        (e): e is Record<string, unknown> =>
          !!e &&
          typeof e === 'object' &&
          typeof (e as TerminalSnippet).id === 'string' &&
          typeof (e as TerminalSnippet).name === 'string' &&
          typeof (e as TerminalSnippet).command === 'string',
      )
      .map((e) => ({
        id: e.id as string,
        name: e.name as string,
        command: e.command as string,
        project: typeof e.project === 'string' ? e.project : null,
      }))
  } catch {
    return []
  }
}

function writeLocal(list: TerminalSnippet[]): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
}

export const useTerminalSnippetsStore = defineStore('terminalSnippets', () => {
  const sc = useSidecar()
  const available = computed(() => sc.available)
  const snippets = ref<TerminalSnippet[]>(available.value ? [] : readLocal())
  let unlisten: UnlistenFn | null = null

  async function load(): Promise<void> {
    if (!available.value) return
    try {
      const res = await sc.request<{ snippets: TerminalSnippet[] }>('terminalSnippets.list', {})
      let list = Array.isArray(res.snippets) ? res.snippets : []
      // Chuyển thư viện cũ một lần. Chỉ xoá localStorage khi sidecar đã nhận.
      const legacy = readLocal()
      if (list.length === 0 && legacy.length > 0) {
        const r = await sc.request<{ imported: number }>('terminalSnippets.import', {
          snippets: legacy,
        })
        if (r.imported > 0) {
          localStorage.removeItem(STORAGE_KEY)
          const again = await sc.request<{ snippets: TerminalSnippet[] }>(
            'terminalSnippets.list',
            {},
          )
          list = Array.isArray(again.snippets) ? again.snippets : []
        }
      }
      snippets.value = list.map((s) => ({
        id: s.id,
        name: s.name,
        command: s.command,
        project: s.project ?? null,
      }))
    } catch (err) {
      console.warn('[terminalSnippets] load failed', err)
    } finally {
      void subscribe()
    }
  }

  // Agent sửa thư viện (hoặc cửa sổ khác) ⇒ tải lại để rail thấy ngay.
  async function subscribe(): Promise<void> {
    if (!available.value || unlisten) return
    try {
      unlisten = await sc.onEvent((evt) => {
        if (!evt || evt.type !== 'terminalSnippets.changed') return
        void load()
      })
    } catch {
      unlisten = null
    }
  }

  // Singleton app-lifetime — tải ngay khi store được dựng.
  void load()

  // Ngoài Electron: id cục bộ, giữ đúng dạng `tsnip-…` để import về sau hợp lệ.
  let counter = 0
  function localId(): string {
    counter += 1
    return `tsnip-${Date.now().toString(36)}-${counter.toString(36)}`
  }

  async function save(
    id: string | null,
    name: string,
    command: string,
    project: string | null,
  ): Promise<void> {
    if (!available.value) {
      const list = snippets.value.filter((s) => s.id !== id)
      list.push({ id: id ?? localId(), name: name.trim(), command, project })
      snippets.value = list
      writeLocal(list)
      return
    }
    await sc.request('terminalSnippets.upsert', {
      ...(id ? { id } : {}),
      name: name.trim(),
      command,
      project,
    })
    // Sidecar phát `terminalSnippets.changed` ⇒ load() cập nhật danh sách.
  }

  function add(name: string, command: string, project: string | null): Promise<void> {
    return save(null, name, command, project)
  }

  function update(
    id: string,
    name: string,
    command: string,
    project: string | null,
  ): Promise<void> {
    return save(id, name, command, project)
  }

  async function remove(id: string): Promise<void> {
    if (!available.value) {
      snippets.value = snippets.value.filter((s) => s.id !== id)
      writeLocal(snippets.value)
      return
    }
    await sc.request('terminalSnippets.delete', { id })
  }

  return { snippets, add, update, remove, load }
})
