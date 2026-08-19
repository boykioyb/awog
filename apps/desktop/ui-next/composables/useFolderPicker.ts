// Thin wrapper over the native folder picker exposed by the Electron bridge
// (`window.awog.pickFolder`). Returns null when running in a plain browser (dev)
// so callers fall back to manual text entry. Ported from
// apps/desktop/ui/composables/useFolderPicker.ts.

interface PickFolderOptions {
  title?: string
  defaultPath?: string
}

export async function pickFolder(opts: PickFolderOptions = {}): Promise<string | null> {
  const api = typeof window !== 'undefined' ? window.awog : undefined
  if (!api) return null
  return api.pickFolder(opts)
}

interface PickFileOptions {
  title?: string
  defaultPath?: string
  filters?: { name: string; extensions: string[] }[]
}

// Native single-file picker (`window.awog.pickFile`). Returns null in a plain
// browser (dev) so callers fall back to manual text entry.
export async function pickFile(opts: PickFileOptions = {}): Promise<string | null> {
  const api = typeof window !== 'undefined' ? window.awog : undefined
  if (!api) return null
  return api.pickFile(opts)
}

// Native MULTI-folder picker (`window.awog.pickFolders`). Returns [] on cancel
// and in a plain browser (dev).
export async function pickFolders(opts: PickFolderOptions = {}): Promise<string[]> {
  const api = typeof window !== 'undefined' ? window.awog : undefined
  if (!api?.pickFolders) return []
  return api.pickFolders(opts)
}

// Native MULTI-file picker (`window.awog.pickFiles`) — one dialog, many files.
// Returns [] on cancel and in a plain browser (dev).
export async function pickFiles(opts: PickFileOptions = {}): Promise<string[]> {
  const api = typeof window !== 'undefined' ? window.awog : undefined
  if (!api?.pickFiles) return []
  return api.pickFiles(opts)
}

// Native save dialog (`window.awog.savePath`) — pick a destination path/name for
// a file to be written. Returns null on cancel, or in a plain browser (dev).
export async function saveFilePath(opts: PickFileOptions = {}): Promise<string | null> {
  const api = typeof window !== 'undefined' ? window.awog : undefined
  if (!api) return null
  return api.savePath(opts)
}

// Whether the Electron bridge is present (used to choose a native dialog over a
// text-prompt fallback).
export function hasBridge(): boolean {
  return typeof window !== 'undefined' && !!window.awog
}
