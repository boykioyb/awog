import { ref } from 'vue'
import {
  previewKindFromPath,
  slackMediaFileUrl,
  usePreview,
  type PreviewRef,
} from '~/composables/usePreview'
import { useToast } from '~/composables/useToast'
import { useConfirm } from '~/composables/useConfirm'
import { useLinkOpen } from '~/composables/useLinkOpen'
import { slackBridge, useSlackStore, type SlackFile } from '~/stores/slack'
import { describeSlackError, isSlackOpenBlocked } from '~/utils/slack-errors'

// Thao tác trên file đính kèm Slack: xem trước, tải về, lưu vào project, mở bằng app
// mặc định. File luôn đi qua sidecar (`slack.file.fetch` tải về `~/.awog/slack/files`
// rồi trả path tuyệt đối) — renderer không bao giờ cầm URL `url_private` (ADR 0107 D-3).
//
// Xem trước dùng PreviewModal chung: video/audio stream qua `slackMediaFileUrl` (gốc cố
// định ở main), loại còn lại mở như "file trong thư mục" với gốc = thư mục chứa file.
//
// HTML từ Slack xem ở dạng MÃ NGUỒN (`kind: 'text'`), không render: file do người ngoài
// gửi, render HTML là chạy markup lạ trong app (iframe vẫn tải ảnh/CSS remote ⇒ lộ IP +
// "đã mở" cho người gửi). Markdown THÌ được xem trước: useMarkdown đã bỏ HTML thô, còn ảnh
// từ link ngoài bị PreviewModal chặn cho file `readOnlyFile` (blockRemoteImages).

const RE_OFFICE_PREVIEWABLE = /\.(docx|docm|dotx|xlsx|xlsm|xltx)$/i
// Kiểu xem trước chạy markup của người gửi ⇒ hạ về xem mã nguồn. `notebook` cũng vậy:
// output của cell có thể là HTML/ảnh do người gửi nhúng.
const RENDERED_KINDS: ReadonlySet<PreviewRef['kind']> = new Set(['html', 'notebook'])
const SAFE_EXTERNAL_URL = /^https?:\/\//i

/** File có xem được trong PreviewModal không (loại khác chỉ tải về / mở bằng app). */
export function canPreviewSlackFile(f: SlackFile): boolean {
  if (f.unavailable) return false
  if (f.kind === 'office') return RE_OFFICE_PREVIEWABLE.test(f.name)
  return f.kind !== 'other'
}

function splitPath(abs: string): { dir: string; base: string } {
  const i = Math.max(abs.lastIndexOf('/'), abs.lastIndexOf('\\'))
  return { dir: abs.slice(0, i), base: abs.slice(i + 1) }
}

// Đang tải file nào (theo id) — nút của thẻ file hiện trạng thái bận.
const busy = ref(new Set<string>())

export function useSlackFiles() {
  const store = useSlackStore()
  const preview = usePreview()
  const toast = useToast()
  const { confirm } = useConfirm()
  const { openLink } = useLinkOpen()
  const { t } = useI18n()

  const fail = (key: string, err: unknown): void => {
    toast.add({ title: t(key), description: describeSlackError(err, t), color: 'error' })
  }

  async function withFile<T>(
    teamId: string,
    f: SlackFile,
    run: (path: string) => Promise<T>,
  ): Promise<T | null> {
    const next = new Set(busy.value)
    next.add(f.id)
    busy.value = next
    try {
      const fetched = await store.fetchFile(teamId, f.id)
      return await run(fetched.path)
    } finally {
      const rest = new Set(busy.value)
      rest.delete(f.id)
      busy.value = rest
    }
  }

  async function open(teamId: string, f: SlackFile): Promise<void> {
    try {
      await withFile(teamId, f, async (path) => {
        const name = f.name || f.title
        let item: PreviewRef
        if (f.kind === 'video' || f.kind === 'audio') {
          item = {
            name,
            kind: f.kind,
            src: slackMediaFileUrl(path),
            mime: f.mimetype,
            size: f.size,
          }
        } else {
          const { dir, base } = splitPath(path)
          const kind = previewKindFromPath(base)
          item = {
            name,
            kind: RENDERED_KINDS.has(kind) ? 'text' : kind,
            workspaceRoot: dir,
            path: base,
            size: f.size,
            // File do người ngoài gửi, nằm trong cache: chỉ xem (không sửa/xoá/mở ngoài).
            readOnlyFile: true,
          }
        }
        preview.open(item)
      })
    } catch (err) {
      fail('slack.toast.fileFailed', err)
    }
  }

  async function download(teamId: string, f: SlackFile): Promise<void> {
    const bridge = slackBridge()
    if (!bridge) return
    try {
      const saved = await withFile(teamId, f, (path) => bridge.saveFileAs(path, f.name))
      if (saved) toast.add({ title: t('slack.toast.saved'), description: saved, color: 'success' })
    } catch (err) {
      fail('slack.toast.fileFailed', err)
    }
  }

  async function saveToProject(teamId: string, f: SlackFile, projectId: string): Promise<void> {
    try {
      const path = await store.saveFileToProject(teamId, f.id, projectId)
      toast.add({ title: t('slack.toast.saved'), description: path, color: 'success' })
    } catch (err) {
      fail('slack.toast.fileFailed', err)
    }
  }

  // Main chỉ mở loại trong allowlist chỉ-xem (ảnh, pdf, văn bản…); còn lại (file thực
  // thi, script, loại lạ) bị từ chối với `slack_open_blocked:*` — lỗi đó cần câu gợi ý
  // "Lưu thành…" kèm nút làm luôn, chứ không chỉ một dòng lỗi thô.
  async function openDefault(teamId: string, f: SlackFile): Promise<void> {
    const bridge = slackBridge()
    if (!bridge) return
    try {
      await withFile(teamId, f, (path) => bridge.openPath(path))
    } catch (err) {
      if (!isSlackOpenBlocked(err)) return fail('slack.toast.openFailed', err)
      toast.add({
        title: t('slack.toast.openBlocked'),
        description: t('slack.toast.openBlockedHint'),
        color: 'warning',
        actions: [{ label: t('slack.file.download'), onClick: () => void download(teamId, f) }],
      })
    }
  }

  // File remote (Google Drive…): AWOG không tải, chỉ mở link — sau khi người dùng thấy
  // URL và xác nhận, vì URL do app ngoài đặt (L1). Mở qua đường link chung của app
  // (useLinkOpen: hỏi mở trong app hay trình duyệt ngoài).
  async function openExternal(f: SlackFile): Promise<void> {
    const url = f.externalUrl
    if (!url || !SAFE_EXTERNAL_URL.test(url)) return
    const ok = await confirm({
      title: t('slack.file.externalConfirmTitle'),
      description: t('slack.file.externalConfirmBody', { name: f.title || f.name, url }),
      confirmLabel: t('slack.file.externalOpen'),
      kind: 'primary',
    })
    if (ok) await openLink(url)
  }

  return {
    hasBridge: !!slackBridge(),
    isBusy: (f: SlackFile): boolean => busy.value.has(f.id),
    open,
    download,
    saveToProject,
    openDefault,
    openExternal,
  }
}
