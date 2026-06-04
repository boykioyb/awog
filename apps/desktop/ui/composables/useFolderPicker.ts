// Thin wrapper over the Tauri dialog plugin. Returns null when running in a
// plain browser (dev) so callers can fall back to manual text input. The plugin
// is lazy-imported so the module bundle does not assume Tauri is present.

interface PickFolderOptions {
  title?: string
  defaultPath?: string
}

const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export async function pickFolder(opts: PickFolderOptions = {}): Promise<string | null> {
  if (!isTauri()) return null
  const { open } = await import('@tauri-apps/plugin-dialog')
  const args: { directory: true; multiple: false; title?: string; defaultPath?: string } = {
    directory: true,
    multiple: false,
  }
  if (opts.title) args.title = opts.title
  if (opts.defaultPath) args.defaultPath = opts.defaultPath
  const picked = await open(args)
  if (typeof picked === 'string') return picked
  return null
}
