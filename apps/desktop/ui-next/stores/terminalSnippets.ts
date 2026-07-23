import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

// Terminal Snippets store — a reusable-command library for the GLOBAL terminal
// dock, scoped per project (+ a shared Global tier). Renderer-only: snippets hold
// no secret material and are a per-machine UI convenience, so they persist to
// localStorage rather than crossing IPC (mirrors sshSnippets / useProjectColors).
// A snippet runs by writing its command into the active terminal tab — the store
// just holds the library; the rail resolves the target + calls the tab's write.
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

// Read + validate the persisted library at the trust boundary (localStorage is L1
// — a corrupt / hand-edited value must not poison the store). Keeps only
// well-shaped entries; normalizes a missing/invalid `project` to null (Global).
function read(): TerminalSnippet[] {
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
    // Corrupt value → start empty rather than throw at store init.
    return []
  }
}

export const useTerminalSnippetsStore = defineStore('terminalSnippets', () => {
  const snippets = ref<TerminalSnippet[]>(read())

  // Monotonic suffix so two snippets added within the same millisecond still get
  // distinct ids (Date.now alone can collide on a fast double-add).
  let counter = 0
  function nextId(): string {
    counter += 1
    return `tsnip-${Date.now().toString(36)}-${counter.toString(36)}`
  }

  // Persist the whole library on any change (deep — field edits mutate in place).
  watch(
    snippets,
    (list) => {
      if (typeof localStorage !== 'undefined')
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
    },
    { deep: true },
  )

  function add(name: string, command: string, project: string | null): TerminalSnippet {
    const snippet: TerminalSnippet = { id: nextId(), name: name.trim(), command, project }
    snippets.value.push(snippet)
    return snippet
  }

  function update(id: string, name: string, command: string, project: string | null): void {
    const s = snippets.value.find((x) => x.id === id)
    if (!s) return
    s.name = name.trim()
    s.command = command
    s.project = project
  }

  function remove(id: string): void {
    snippets.value = snippets.value.filter((s) => s.id !== id)
  }

  return { snippets, add, update, remove }
})
