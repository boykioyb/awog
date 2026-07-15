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
