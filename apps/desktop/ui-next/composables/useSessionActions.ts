import type { MenuItem } from '~/composables/useContextMenu'
import type { Session } from '~/composables/useSessionsData'
import { useSessionsStore } from '~/stores/sessions'
import { useSidecar } from '~/composables/useSidecar'
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import { useConfirm } from '~/composables/useConfirm'
import { useSessionExportModal } from '~/composables/useSessionExportModal'

// Thao tác trên MỘT phiên (open / rename / auto-title / pin / archive / select /
// duplicate / export / group / grid / window / copy path·id / delete) — nguồn duy
// nhất cho menu chuột phải của SessionList (cột /sessions) và SessionsView
// (Workbench explorer). Phần cần UI cục bộ đi qua `hooks`: mở phiên, bắt đầu
// rename inline, mở hộp chọn nhóm — mỗi surface tự quyết nó trông ra sao.
export type SessionActionHooks = {
  open: (s: Session) => void
  rename: (s: Session) => void
  group: (s: Session) => void
}

export type SessionActionOptions = {
  // Chế độ chọn nhiều (bulk bar) — chỉ SessionList có UI cho nó.
  select?: boolean
  // Archive. Workbench bỏ vì "Đóng" của tab đã là archive (useSessionStrip.closeTab).
  archive?: boolean
}

export function useSessionActions(hooks: SessionActionHooks) {
  const store = useSessionsStore()
  const sc = useSidecar()
  const { t } = useI18n()
  const toast = useToast()
  const { confirm } = useConfirm()
  const exportModal = useSessionExportModal()

  // Phiên có phiên con không — quét TOÀN BỘ store: con bị lọc khỏi list vẫn là con.
  function hasChildren(s: Session): boolean {
    return !!s.engineId && store.sessions.some((x) => x.teamRunId === s.engineId)
  }
  // Popout theo engineId, không giữa lượt (cùng gate với nút header).
  function canWindow(s: Session): boolean {
    if (!s.engineId || !sc.available) return false
    return store.isWindowed(s.engineId) || (s.status !== 'streaming' && s.status !== 'awaiting')
  }

  function items(s: Session, opts: SessionActionOptions = {}): MenuItem[] {
    const { select = false, archive = true } = opts
    const archived = store.isArchived(s.id)
    const out: MenuItem[] = [
      { id: 'open', icon: 'sessions', label: t('sessions.ctx.open') },
      { id: 'rename', icon: 'edit', label: t('sessions.ctx.rename') },
      { id: 'auto-title', icon: 'sparkles', label: t('sessions.ctx.autoTitle') },
      { id: 'pin', icon: 'pin', label: s.pinned ? t('sessions.ctx.unpin') : t('sessions.ctx.pin') },
    ]
    if (archive) {
      out.push({
        id: 'archive',
        icon: archived ? 'eye' : 'eye-off',
        label: archived
          ? t('sessionsSearch.archive.unarchive')
          : t('sessionsSearch.archive.archive'),
      })
    }
    if (select) out.push({ id: 'select', icon: 'check', label: t('sessions.ctx.select') })
    out.push(
      { id: 'duplicate', icon: 'fork', label: t('sessions.ctx.duplicate') },
      { id: 'export', icon: 'save', label: t('sessions.ctx.export') },
      {
        id: 'group',
        icon: 'folder',
        label: s.teamRunId ? t('sessions.ctx.changeGroup') : t('sessions.ctx.moveToGroup'),
      },
    )
    if (hasChildren(s)) {
      out.push({ id: 'grid', icon: 'layers', label: t('sessions.ctx.gridChildren') })
    }
    if (s.teamRunId) out.push({ id: 'ungroup', icon: 'x', label: t('sessions.team.detach') })
    if (canWindow(s)) {
      out.push({
        id: 'window',
        icon: 'external',
        label: store.isWindowed(s.engineId)
          ? t('sessions.ctx.bringBackWindow')
          : t('sessions.ctx.openWindow'),
      })
    }
    out.push(
      { separator: true },
      { id: 'copy-path', icon: 'copy', label: t('sessions.ctx.copyPath') },
    )
    if (sc.available) {
      out.push({ id: 'open-finder', icon: 'folder', label: t('sessions.ctx.openFinder') })
    }
    out.push(
      { id: 'copy-id', icon: 'commands', label: t('sessions.ctx.copyId') },
      { separator: true },
      { id: 'delete', icon: 'trash', label: t('sessions.ctx.delete'), danger: true },
    )
    return out
  }

  // Chạy một action theo id; trả false nếu id không thuộc bộ này (caller thử bộ khác).
  async function run(id: string, s: Session): Promise<boolean> {
    switch (id) {
      case 'open':
        hooks.open(s)
        return true
      case 'rename':
        hooks.rename(s)
        return true
      case 'auto-title':
        // Tóm tắt transcript thành tiêu đề qua model (best-effort).
        void store.regenerateTitle(s.id)
        return true
      case 'pin':
        store.togglePin(s.id)
        return true
      case 'archive':
        void store.setArchived(s.id, !store.isArchived(s.id))
        return true
      case 'select':
        store.setSelectMode(true)
        store.toggleSelect(s.id)
        return true
      case 'duplicate':
        store.fork(s.id, s.msgs.length - 1, 'copy')
        return true
      case 'export':
        exportModal.open(s.id)
        return true
      case 'group':
        hooks.group(s)
        return true
      case 'grid':
        // Mở phiên cha RỒI đặt yêu cầu lưới (`gridMode` là ref cục bộ của SessionDetail).
        store.requestGridView(s.id)
        hooks.open(s)
        return true
      case 'ungroup':
        void store.setRunMembership(s.id, null)
        return true
      case 'window':
        if (store.isWindowed(s.engineId)) void store.closeWindowFor(s.id)
        else void store.openInWindow(s.id)
        return true
      case 'copy-path': {
        if (!s.engineId) {
          toast.add({ title: t('sessions.ctx.notSaved'), color: 'info' })
          return true
        }
        // Main suy ra đường dẫn tuyệt đối từ engineId (invariant #4); browser-dev
        // không có bridge → no-op.
        try {
          const path = sc.available ? await sc.sessionFolderPath(s.engineId) : null
          if (path) await navigator.clipboard.writeText(path)
        } catch {
          // best-effort: bridge unavailable or clipboard blocked
        }
        return true
      }
      case 'open-finder':
        if (!s.engineId) {
          toast.add({ title: t('sessions.ctx.notSaved'), color: 'info' })
          return true
        }
        if (sc.available) void sc.revealSessionFolder(s.engineId).catch(() => undefined)
        return true
      case 'copy-id':
        void navigator.clipboard.writeText(s.engineId ?? String(s.id))
        return true
      case 'delete': {
        const ok = await confirm({
          title: t('sessions.delete.title'),
          description: t('sessions.delete.one', { title: s.title }),
        })
        if (ok) store.remove(s.id)
        return true
      }
      default:
        return false
    }
  }

  return { items, run }
}
