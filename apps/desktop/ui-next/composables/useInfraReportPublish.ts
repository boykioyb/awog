// Nối "agent viết xong" với hộp xuất (mốc 6.6 — chỗ còn hở).
//
// VẤN ĐỀ. Bộ xuất đã xử lý ĐỦ một báo cáo (`kind: 'report'`): che · khử · xem trước ·
// lưu Wiki · gửi chat · xuất tệp · đặt lịch. Nhưng `openShare()` chỉ có hai bên gọi và
// cả hai đều nằm ở `/playbooks`, nên không có đường nào đi từ chỗ bản báo cáo THẬT SỰ
// ra đời — một lượt trả lời của agent trong phiên — tới hộp xuất. Màn Báo cáo không
// thể là điểm nối đó: lúc bấm "Hỏi agent" thì chưa có gì để xuất, đúng như comment đầu
// `InfraReports.vue` nói.
//
// NÊN ĐIỂM NỐI NẰM Ở TRANSCRIPT. Đó là nơi duy nhất tồn tại chuỗi để xuất, và cũng là
// nơi người dùng vừa đọc xong bản báo cáo.
//
// VÌ SAO PHẢI HỎI LOẠI BÁO CÁO. `reportKind` không phải trang trí: nó quyết định thư
// mục + tag của trang Wiki (`bao-cao/<kind>-<ngày>.md`) và là hàng "nguồn" trong bản
// xuất. Transcript không mang thông tin đó — agent viết văn xuôi — mà đoán thì trang
// Wiki nằm sai chỗ và không ai phát hiện ra. Nên hỏi: bốn lựa chọn, một cú bấm.
//
// KHÔNG TỰ CHỌN HỘ. Tiêu đề và thân đều lấy nguyên từ lượt trả lời; hộp chọn này không
// sửa một chữ nào của bản báo cáo — nó chỉ trả lời "đây là loại nào".
//
// TRẠNG THÁI Ở MỌC MODULE, cùng lý do với `useShareExport`/`useInfraAskAgent`: `app.vue`
// bọc `<NuxtPage keepalive />` nên hộp chọn và bên gọi nó không chung một vòng đời.
import { ref } from 'vue'
import { useShareExport } from '~/composables/useShareExport'
import type { ReportKind } from '~/composables/useShareExport'

/** Trần tiêu đề — khớp `MAX_TITLE_CHARS` của `infra.share-export` (300), chừa đệm. */
const MAX_TITLE_CHARS = 200

type PendingReport = {
  title: string
  body: string
  /** Có project ⇒ trang Wiki lưu ở tier project thay vì tier global. */
  projectId?: string
}

const open = ref(false)
const pending = ref<PendingReport | null>(null)

/**
 * Tiêu đề suy từ chính bản báo cáo: heading Markdown đầu tiên, không có thì dòng không
 * rỗng đầu tiên. Cắt ở `MAX_TITLE_CHARS` — đây là tiêu đề một trang Wiki và một hàng
 * trong bản xuất, không phải một đoạn văn.
 */
function deriveReportTitle(text: string): string {
  let picked = ''
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const heading = /^#{1,6}\s+(.+)$/.exec(line)
    picked = heading?.[1] ?? line
    break
  }
  // Bỏ ký tự Markdown trang trí ở hai đầu: tiêu đề không phải chỗ để in `**`.
  const clean = picked.replace(/^[*_`>#\s]+/, '').replace(/[*_`\s]+$/, '')
  return clean.slice(0, MAX_TITLE_CHARS)
}

export function useInfraReportPublish() {
  const { openShare } = useShareExport()
  const { t } = useI18n()

  /**
   * Mở hộp chọn loại cho một đoạn văn bản agent vừa viết.
   *
   * Trả `false` khi không có gì để xuất: xuất một báo cáo rỗng là ghi một trang Wiki
   * trắng, và lần sau người dùng sẽ tưởng agent đã viết ra thứ gì đó.
   */
  function publishReport(text: string, opts: { projectId?: string } = {}): boolean {
    const body = text.trim()
    if (!body) return false
    const title = deriveReportTitle(body) || t('infra.report.publish.untitled')
    // `Session.project` là '' cho tab Default (phiên không thuộc project nào), không
    // phải một id. Chuỗi rỗng lọt xuống dưới sẽ thành `projectId: ''` — sidecar coi đó
    // là "có project" và trang Wiki rơi vào tier project của một id không tồn tại.
    const projectId = opts.projectId || undefined
    pending.value = {
      title,
      body,
      ...(projectId !== undefined ? { projectId } : {}),
    }
    open.value = true
    return true
  }

  /**
   * Chốt loại rồi mở hộp xuất với đúng khuôn `ShareSubject` của báo cáo.
   *
   * Dọn `pending` TRƯỚC khi mở: hộp xuất dựng lại từ RPC ở mỗi hành động, nên nếu giữ
   * bản nháp lại thì một cú bấm thứ hai (đổi loại) sẽ mở một hộp thứ hai chồng lên bản
   * đang xem.
   */
  async function chooseReportKind(kind: ReportKind): Promise<void> {
    const p = pending.value
    if (!p) return
    open.value = false
    pending.value = null
    await openShare(
      {
        kind: 'report',
        reportKind: kind,
        title: p.title,
        body: p.body,
        ...(p.projectId !== undefined ? { projectId: p.projectId } : {}),
      },
      { label: p.title },
    )
  }

  function closeReportPublish(): void {
    open.value = false
    pending.value = null
  }

  return { open, pending, publishReport, chooseReportKind, closeReportPublish }
}
