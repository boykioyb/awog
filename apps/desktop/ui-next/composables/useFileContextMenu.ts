import { computed, ref } from 'vue'
import type { MenuItem } from '~/composables/useContextMenu'
import { useContextMenu } from '~/composables/useContextMenu'
import { useFsApi } from '~/composables/useFsApi'
import { useSidecar } from '~/composables/useSidecar'
import { useConfirm } from '~/composables/useConfirm'
import { useTextPrompt } from '~/composables/useTextPrompt'
import { copyText } from '~/utils/clipboard'

// The shared, FULL file action menu for local-fs trees (Sessions Files tab +
// Project Code Workspace editor). Builds the MenuItem list per target kind and
// runs the chosen action through the sidecar bridge / fs RPCs. Mutating ops are
// gated by useTextPrompt (names) + useConfirm (delete); errors are surfaced via
// `notify` and never thrown out of the handler. SoC: orchestrates IPC only.

export type FileMenuTarget = { path: string; kind: 'file' | 'dir' }

export type FileContextMenuConfig = {
  // Workspace root the relative paths resolve against. null = unavailable (no-op).
  root: () => string | null
  // How "Open" behaves per surface (Sessions → preview modal; Editor → open tab).
  // Omitted → the "Open" item is hidden.
  onOpen?: (target: FileMenuTarget) => void
  // Reload the given directory's children after a mutating op (create/rename/delete).
  onChanged?: (parentDir: string) => void | Promise<void>
  // Surface an error message (e.g. a toast). Default: console.error.
  notify?: (text: string, kind: 'error' | 'success' | 'info') => void
}

export function useFileContextMenu(config: FileContextMenuConfig) {
  const { t } = useI18n()
  const sc = useSidecar()
  const fs = useFsApi()
  const { confirm } = useConfirm()
  const { prompt } = useTextPrompt()

  const { pos, target, open, close } = useContextMenu<FileMenuTarget>()

  const notify = config.notify ?? ((text: string) => console.error('[file-menu]', text))

  // Probe VS Code availability once; gates the "Open in VS Code" row.
  const vscode = ref(false)
  void sc
    .isVscodeAvailable()
    .then((ok) => (vscode.value = ok))
    .catch(() => {})

  const items = computed<MenuItem[]>(() => {
    const tgt = target.value
    if (!tgt) return []
    const sep: MenuItem = { separator: true }
    const rows: MenuItem[] = []

    // Open (preview/tab) — files only, and only when the surface provides it.
    if (tgt.kind === 'file' && config.onOpen) {
      rows.push({ id: 'open', label: t('files.ctx.open') })
    }
    if (vscode.value) rows.push({ id: 'vscode', label: t('files.ctx.openInVscode') })
    rows.push({ id: 'reveal', label: t('files.ctx.reveal') })
    rows.push({ id: 'os-open', label: t('files.ctx.openDefault') })
    rows.push(sep)
    rows.push({ id: 'copy-path', label: t('files.ctx.copyPath') })
    rows.push({ id: 'copy-rel', label: t('files.ctx.copyRelPath') })
    rows.push({ id: 'copy-name', label: t('files.ctx.copyName') })
    rows.push(sep)
    rows.push({ id: 'new-file', label: t('files.ctx.newFile') })
    rows.push({ id: 'new-folder', label: t('files.ctx.newFolder') })
    rows.push({ id: 'rename', label: t('files.ctx.rename') })
    rows.push({ id: 'delete', label: t('files.ctx.delete'), danger: true })
    return rows
  })

  async function onSelect(id: string): Promise<void> {
    const tgt = target.value
    const root = config.root()
    close()
    if (!tgt || !root) return

    const { path, kind } = tgt
    const abs = `${root}/${path}`
    const name = path.split('/').pop() ?? path
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    // Where New File / New Folder are created: inside a dir target, else its parent.
    const dirForNew = kind === 'dir' ? path : parent

    try {
      switch (id) {
        case 'open':
          config.onOpen?.(tgt)
          break
        case 'vscode':
          await sc.openInVscode(root, path)
          break
        case 'reveal':
          await sc.revealPath(root, path)
          break
        case 'os-open':
          await sc.openPath(root, path)
          break
        case 'copy-path':
          await copyText(abs)
          break
        case 'copy-rel':
          await copyText(path)
          break
        case 'copy-name':
          await copyText(name)
          break
        case 'new-file': {
          const n = await prompt({
            title: t('files.prompt.newFileTitle'),
            placeholder: t('files.prompt.newFilePh'),
            submitLabel: t('files.ctx.newFile'),
          })
          if (!n) break
          const p = dirForNew ? `${dirForNew}/${n}` : n
          await fs.createFile(root, p)
          await config.onChanged?.(dirForNew)
          break
        }
        case 'new-folder': {
          const n = await prompt({
            title: t('files.prompt.newFolderTitle'),
            submitLabel: t('files.ctx.newFolder'),
          })
          if (!n) break
          const p = dirForNew ? `${dirForNew}/${n}` : n
          await fs.createDir(root, p)
          await config.onChanged?.(dirForNew)
          break
        }
        case 'rename': {
          const n = await prompt({
            title: t('files.prompt.renameTitle'),
            value: name,
            submitLabel: t('files.ctx.rename'),
          })
          if (!n || n === name) break
          const to = parent ? `${parent}/${n}` : n
          await fs.rename(root, path, to)
          await config.onChanged?.(parent)
          break
        }
        case 'delete': {
          const ok = await confirm({
            title: t('files.confirm.deleteTitle'),
            description: path,
            kind: 'danger',
          })
          if (!ok) break
          await fs.deletePath(root, path, kind === 'dir')
          await config.onChanged?.(parent)
          break
        }
        default:
          break
      }
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : String(err)
      notify(msg, 'error')
    }
  }

  return { menu: pos, open, close, items, onSelect }
}
