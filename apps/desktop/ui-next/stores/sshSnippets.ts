import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

// SSH Snippets store — a reusable-command library (like Termius Snippets) wired
// into the SSH workspace sidebar. Renderer-only: snippets are a per-machine UI
// convenience with no secret material, so they persist to localStorage rather
// than crossing IPC to the sidecar (mirrors useProjectColors' renderer-local
// pattern). A snippet is run by writing its command into a LIVE terminal
// connection — the store just holds the library; the section component picks the
// target connId + calls useSshApi().write.

export interface SshSnippet {
  id: string
  name: string
  command: string
}

const STORAGE_KEY = 'awog-ssh-snippets'

// Read + validate the persisted library at the trust boundary (localStorage is
// L1 — a corrupt / hand-edited value must not poison the store). Keeps only
// well-shaped entries.
function read(): SshSnippet[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (e): e is SshSnippet =>
        !!e &&
        typeof e === 'object' &&
        typeof (e as SshSnippet).id === 'string' &&
        typeof (e as SshSnippet).name === 'string' &&
        typeof (e as SshSnippet).command === 'string',
    )
  } catch {
    // Corrupt value → start empty rather than throw at store init.
    return []
  }
}

export const useSshSnippetsStore = defineStore('sshSnippets', () => {
  const snippets = ref<SshSnippet[]>(read())

  // Monotonic suffix so two snippets added within the same millisecond still get
  // distinct ids (Date.now alone can collide on a fast double-add).
  let counter = 0
  function nextId(): string {
    counter += 1
    return `snip-${Date.now().toString(36)}-${counter.toString(36)}`
  }

  // Persist the whole library on any change (deep — command/name edits mutate
  // fields in place via update()). One source of truth for the write.
  watch(
    snippets,
    (list) => {
      if (typeof localStorage !== 'undefined')
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
    },
    { deep: true },
  )

  function add(name: string, command: string): SshSnippet {
    const snippet: SshSnippet = { id: nextId(), name: name.trim(), command }
    snippets.value.push(snippet)
    return snippet
  }

  function update(id: string, name: string, command: string): void {
    const s = snippets.value.find((x) => x.id === id)
    if (!s) return
    s.name = name.trim()
    s.command = command
  }

  function remove(id: string): void {
    snippets.value = snippets.value.filter((s) => s.id !== id)
  }

  return { snippets, add, update, remove }
})
