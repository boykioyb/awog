// Thin wrapper over the native folder picker exposed by the Electron bridge.
// Returns null when running in a plain browser (dev) so callers can fall back to
// manual text input.

interface PickFolderOptions {
  title?: string
  defaultPath?: string
}

export async function pickFolder(opts: PickFolderOptions = {}): Promise<string | null> {
  const api = typeof window !== 'undefined' ? window.awog : undefined
  if (!api) return null
  return api.pickFolder(opts)
}
