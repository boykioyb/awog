import { computed } from 'vue'
import { useContextMenu, type MenuItem } from '~/composables/useContextMenu'
import { isArchive, type SftpBrowser } from '~/composables/useSftpBrowser'
import { useToasts } from '~/composables/useToasts'
import { copyText } from '~/utils/clipboard'
import type { SftpEntry, CompressFormat } from '~/composables/useSshApi'

// Right-click menu for the SFTP table, built on top of a useSftpBrowser instance.
// It does NOT mutate the persistent selection: right-clicking operates on the
// current selection IF the clicked row is part of it, otherwise on just that row
// (ephemeral) — so a plain right-click never raises the bulk bar. Building a
// selection is explicit: the "Select"/"Deselect" items, or Ctrl/⌘/Shift-click.
// Missing archive tools stay clickable and offer an install command.

const COMPRESS_FORMATS: { fmt: CompressFormat; need: string[] }[] = [
  { fmt: 'zip', need: ['zip'] },
  { fmt: 'tar.gz', need: ['tar'] },
  { fmt: 'tar.bz2', need: ['tar', 'bzip2'] },
  { fmt: 'tar.xz', need: ['tar', 'xz'] },
  { fmt: 'rar', need: ['rar'] },
  { fmt: '7z', need: ['7z'] },
]

export function useSftpContextMenu(browser: SftpBrowser) {
  const { t } = useI18n()
  const { pushToast } = useToasts()
  const { pos, target, open: openAt, close } = useContextMenu<SftpEntry>()

  // Effective targets: the whole selection when the right-clicked row is part of
  // it, else just that one row (without adding it to the selection).
  function effectiveTargets(): SftpEntry[] {
    const tgt = target.value
    if (!tgt) return []
    return browser.isSelected(tgt.name) ? browser.selectedEntries.value : [tgt]
  }

  function open(ev: MouseEvent, entry: SftpEntry): void {
    openAt(ev, entry)
  }

  const items = computed<MenuItem[]>(() => {
    const tgt = target.value
    if (!tgt) return []
    const targets = effectiveTargets()
    const only = targets.length === 1 ? targets[0] : null
    const sep: MenuItem = { separator: true }
    const rows: MenuItem[] = []

    if (only) {
      if (only.type === 'file')
        rows.push({ id: 'open', label: t('ssh.sftp.ctx.open'), icon: 'eye' })
      if (only.type === 'file')
        rows.push({ id: 'download', label: t('ssh.sftp.download'), icon: 'download' })
      rows.push({ id: 'rename', label: t('ssh.sftp.rename'), icon: 'edit' })
      rows.push({ id: 'duplicate', label: t('ssh.sftp.ctx.duplicate'), icon: 'copy' })
    }
    rows.push({ id: 'copy', label: t('ssh.sftp.ctx.copyTo') })
    rows.push({ id: 'move', label: t('ssh.sftp.ctx.moveTo') })

    // Compress submenu — a missing tool stays clickable and offers an install cmd.
    rows.push({
      id: 'compress',
      label: t('ssh.sftp.ctx.compress'),
      children: COMPRESS_FORMATS.map(({ fmt, need }) => {
        const ready =
          fmt === '7z'
            ? browser.toolReady('7z') || browser.toolReady('7za')
            : need.every((n) => browser.toolReady(n))
        if (ready) return { id: `compress:${fmt}`, label: fmt }
        const missing = fmt === '7z' ? '7z' : (need.find((n) => !browser.toolReady(n)) ?? need[0])
        return { id: `install:${missing}`, label: fmt, hint: t('ssh.sftp.ctx.installHint') }
      }),
    })
    if (only && isArchive(only.name))
      rows.push({ id: 'extract', label: t('ssh.sftp.ctx.extractHere') })

    rows.push(sep)
    rows.push({
      id: browser.isSelected(tgt.name) ? 'deselect' : 'select',
      label: browser.isSelected(tgt.name) ? t('ssh.sftp.ctx.deselect') : t('ssh.sftp.ctx.select'),
      icon: 'check',
    })
    if (browser.hasSelection.value)
      rows.push({ id: 'clearsel', label: t('ssh.sftp.clearSelection') })

    rows.push(sep)
    rows.push({ id: 'newfile', label: t('ssh.sftp.newFile'), icon: 'plus' })
    rows.push({ id: 'newfolder', label: t('ssh.sftp.mkdir'), icon: 'folder' })
    rows.push(sep)
    rows.push({ id: 'chmod', label: t('ssh.sftp.ctx.permissions') })
    rows.push({ id: 'chown', label: t('ssh.sftp.ctx.changeOwner') })
    if (only) {
      rows.push(sep)
      rows.push({ id: 'terminal', label: t('ssh.sftp.ctx.openTerminalHere') })
      rows.push({ id: 'copypath', label: t('ssh.sftp.ctx.copyPath') })
      rows.push({ id: 'copyname', label: t('ssh.sftp.ctx.copyName') })
    }
    rows.push(sep)
    rows.push({ id: 'delete', label: t('ssh.sftp.delete'), icon: 'trash', danger: true })
    return rows
  })

  async function onSelect(id: string): Promise<void> {
    const tgt = target.value
    const targets = effectiveTargets()
    const only = targets.length === 1 ? targets[0] : null
    close()
    if (!tgt) return

    if (id.startsWith('compress:')) {
      await browser.compress(targets, id.slice('compress:'.length) as CompressFormat)
      return
    }
    if (id.startsWith('install:')) {
      await browser.suggestInstall(id.slice('install:'.length))
      return
    }
    switch (id) {
      case 'open':
        if (only) await browser.previewFile(only)
        break
      case 'download':
        if (only) await browser.download(only)
        break
      case 'rename':
        if (only) await browser.rename(only)
        break
      case 'duplicate':
        if (only) await browser.duplicate(only)
        break
      case 'copy':
        browser.openPathPicker('copy', targets)
        break
      case 'move':
        browser.openPathPicker('move', targets)
        break
      case 'extract':
        if (only) await browser.extract(only)
        break
      case 'select':
      case 'deselect':
        browser.selectToggle(tgt.name)
        break
      case 'clearsel':
        browser.clearSelection()
        break
      case 'newfile':
        await browser.newFile()
        break
      case 'newfolder':
        await browser.mkdir()
        break
      case 'chmod':
        browser.openChmod(targets)
        break
      case 'chown':
        browser.openChown(targets)
        break
      case 'terminal':
        if (only) await browser.openTerminalHere(only)
        break
      case 'copypath':
        if (only) {
          await copyText(
            browser.cwd.value === '.' ? only.name : `${browser.cwd.value}/${only.name}`,
          )
          pushToast(t('ssh.sftp.ctx.copiedPath'), 'success')
        }
        break
      case 'copyname':
        if (only) {
          await copyText(only.name)
          pushToast(t('ssh.sftp.ctx.copiedName'), 'success')
        }
        break
      case 'delete':
        await browser.del(targets)
        break
      default:
        break
    }
  }

  return { pos, open, close, items, onSelect }
}
