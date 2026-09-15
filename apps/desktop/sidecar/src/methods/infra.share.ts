// `infra.share-export` · `infra.report-kinds` · `infra.report-save` — bộ xuất và
// báo cáo (mốc 6.5 · 6.6 · 6.7).
//
// TRẢ VỀ CHUỖI, CỐ Ý KHÔNG TỰ GHI FILE. Cùng khuôn với `infra.audit-export.ts`:
// việc ghi đi qua `fs.writeFile` (đã có `assertInsideWorkspace` + ghi nguyên tử),
// và đường ra ngoài thư mục làm việc đi qua hộp thoại lưu của hệ điều hành. Sidecar
// ghi file ở đây là tạo ra đường ghi thứ hai phải bảo vệ — và là đường duy nhất
// trong họ tính năng không đi qua invariant #2.
//
// CHE RỒI MỚI KHỬ, VÀ ĐÓ LÀ HAI LỚP KHÁC NHAU. `mask.ts` trả lời "đây có phải
// định danh hạ tầng không", `sessions/redact.ts` trả lời "đây có phải bí mật
// không". Spec (`playbooks.md:126`) đòi cả hai: che để gửi cho người ngoài, khử để
// bắt token lỡ nằm trong ghi chú. Gộp chúng lại là tự tạo định nghĩa thứ hai về
// "bí mật" — đúng thứ `.claude/rules/security.md` cấm.
//
// MỌI LẦN XUẤT ĐỀU VÀO NHẬT KÝ. Chia sẻ playbook là một hành động rò rỉ tiềm
// tàng (spec, §"Che thông tin"); nhật ký là chỗ duy nhất trả lời được "tuần trước
// ai xuất cái gì ra ngoài".

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { recordInfraAction, INFRA_SURFACES } from '../infra/audit/store.js'
import { builtinPlaybook } from '../infra/playbook/builtin.js'
import { readPlaybook } from '../infra/playbook/store.js'
import { loadRun } from '../infra/playbook/runner.js'
import { saveWikiPage } from '../wiki/store.js'
import { invalidateWikiCache } from '../wiki/inject.js'
import { redactString } from '../sessions/redact.js'
import {
  REPORT_DEFINITIONS,
  REPORT_KINDS,
  audienceForcesMask,
  buildPlaybookShare,
  buildReportShare,
  buildRunShare,
} from '../infra/share/templates.js'
import { SHARE_LANGS, applyMask, applyRedact, renderDoc, shareFilename } from '../infra/share/kit.js'
import type { ShareDoc } from '../infra/share/kit.js'
import type { Playbook, PlaybookIssue } from '../infra/playbook/schema.js'

const MAX_BODY_CHARS = 200_000
const MAX_MERMAID_CHARS = 20_000
const MAX_TITLE_CHARS = 300

/**
 * Bề mặt phát ra hành động, cho nhật ký.
 *
 * ⚠ `INFRA_SURFACES` KHÔNG có mục nào cho màn Báo cáo (`explorer` · `logs` ·
 * `graph` · `playbook` · `session` · `terminal` · `pipeline` · `settings`). Thêm
 * một giá trị vào enum đó nằm ngoài phạm vi WS-B (`audit/store.ts` không thuộc
 * danh sách file được sửa), nên tạm dùng `explorer` — cùng cách
 * `infra/resources/services-catalog.ts` đã dùng cho các hành động phát ra từ
 * `/infra`. Người gọi LUÔN ghi đè được bằng tham số `surface`.
 */
const REPORT_SURFACE_DEFAULT = 'explorer' as const

// ─── Xuất ────────────────────────────────────────────────────────────────────

const PlaybookSource = z.enum(['builtin', 'global', 'project'])

const Subject = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('playbook'),
    id: z.string().min(1).max(64),
    source: PlaybookSource,
    projectId: z.string().max(200).optional(),
    /**
     * Mẫu chia sẻ. `approval` và `runbook` là hai hàm dựng KHÁC NHAU, không phải
     * hai mức chi tiết của một hàm — xem ghi chú đầu `templates.ts`.
     */
    audience: z.enum(['approval', 'runbook']),
  }),
  // Một lượt chạy đã xong ⇒ luôn là mẫu "Báo cáo sau khi chạy".
  z.object({ kind: z.literal('run'), id: z.string().min(1).max(200) }),
  z.object({
    kind: z.literal('report'),
    reportKind: z.enum(REPORT_KINDS),
    title: z.string().min(1).max(MAX_TITLE_CHARS),
    body: z.string().max(MAX_BODY_CHARS),
    scope: z.string().max(300).optional(),
    /** Sơ đồ agent viết (Mermaid) — báo cáo sự cố nhúng graph kiến trúc. */
    mermaid: z.string().max(MAX_MERMAID_CHARS).optional(),
  }),
])

const SAVE_FORMATS = ['markdown', 'html'] as const

const ExportParams = z.object({
  subject: Subject,
  format: z.enum(SAVE_FORMATS).default('markdown'),
  lang: z.enum(SHARE_LANGS).default('en'),
  /**
   * Hai công tắc của lớp che. `enabled` mặc định BẬT (spec, §"Che thông tin");
   * `bucketsDomains` mặc định TẮT vì nó là công tắc RIÊNG — tên bucket nhiều khi
   * chính là thứ cần bàn.
   */
  mask: z
    .object({
      enabled: z.boolean().optional(),
      bucketsDomains: z.boolean().optional(),
    })
    .default({}),
  surface: z.enum(INFRA_SURFACES).optional(),
})

export type ShareSubject = z.infer<typeof Subject>

type LoadFailure = { ok: false; error: 'not-found' | 'invalid'; issues?: PlaybookIssue[] }
type LoadedPlaybook = { ok: true; playbook: Playbook }

async function loadPlaybook(subject: {
  id: string
  source: z.infer<typeof PlaybookSource>
  projectId?: string | undefined
}): Promise<LoadedPlaybook | LoadFailure> {
  if (subject.source === 'builtin') {
    const playbook = builtinPlaybook(subject.id)
    return playbook ? { ok: true, playbook } : { ok: false, error: 'not-found' }
  }
  const parsed = await readPlaybook(subject.source, subject.projectId, subject.id)
  if (!parsed) return { ok: false, error: 'not-found' }
  if (!parsed.ok) return { ok: false, error: 'invalid', issues: parsed.issues }
  return { ok: true, playbook: parsed.playbook }
}

/** Nhãn dùng cho TÊN FILE và cho dòng nhật ký — chưa che, chỉ để nhận diện. */
function subjectLabel(subject: ShareSubject): string {
  switch (subject.kind) {
    case 'playbook':
      return subject.id
    case 'run':
      return subject.id
    case 'report':
      return subject.reportKind
  }
}

/** Bề mặt mặc định của nhật ký khi người gọi không chỉ định. */
function subjectSurface(subject: ShareSubject): 'playbook' | 'explorer' {
  return subject.kind === 'report' ? REPORT_SURFACE_DEFAULT : 'playbook'
}

register('infra.share-export', async (raw) => {
  const p = ExportParams.parse(raw)
  const now = new Date()

  const buildResult = await buildSubjectDoc(p.subject, now, p.lang)
  if (!buildResult.ok) return buildResult

  // Mẫu "Kế hoạch để duyệt" BỊ BUỘC che: đó là định nghĩa của mẫu, không phải
  // một giá trị mặc định người dùng đổi được. Xem `audienceForcesMask`.
  const forced = p.subject.kind === 'playbook' && audienceForcesMask(p.subject.audience)
  const maskEnabled = forced || (p.mask.enabled ?? true)
  const bucketsDomains = p.mask.bucketsDomains ?? false

  // Che TRƯỚC khử: placeholder của lớp che chứa `<` (một thẻ HTML nếu chèn thẳng
  // vào markup đã render), và bộ khử bí mật không cần biết về chúng.
  const masked = applyMask(buildResult.doc, { enabled: maskEnabled, bucketsDomains })
  const redacted = applyRedact(masked)
  const text = renderDoc(redacted, p.format)

  const surface = p.surface ?? subjectSurface(p.subject)
  await recordInfraAction({
    actor: 'human',
    surface,
    tool: 'infra_share',
    argv: [
      'share',
      p.subject.kind,
      subjectLabel(p.subject),
      p.subject.kind === 'playbook' ? p.subject.audience : p.format,
      p.format,
      maskEnabled ? '--mask' : '--no-mask',
      ...(bucketsDomains ? ['--mask-buckets'] : []),
    ],
    context: {},
    class: 'read',
    decision: 'auto',
    result: {
      summary:
        `exported ${p.subject.kind} ${subjectLabel(p.subject)} as ${p.format}` +
        `${maskEnabled ? ' with masking' : ' WITHOUT masking'}`,
    },
  })

  return {
    ok: true as const,
    filename: shareFilename(subjectLabel(p.subject), p.format, now),
    text,
    format: p.format,
    bytes: Buffer.byteLength(text, 'utf8'),
    masked: maskEnabled,
    bucketsDomains,
  }
})

async function buildSubjectDoc(
  subject: ShareSubject,
  now: Date,
  lang: (typeof SHARE_LANGS)[number],
): Promise<{ ok: true; doc: ShareDoc } | { ok: false; error: 'not-found' | 'invalid'; issues?: PlaybookIssue[] }> {
  const generatedAt = now.toISOString()
  switch (subject.kind) {
    case 'playbook': {
      const found = await loadPlaybook(subject)
      if (!found.ok) return found
      return {
        ok: true,
        doc: buildPlaybookShare({
          playbook: found.playbook,
          audience: subject.audience,
          generatedAt,
          lang,
          // Một playbook chưa gửi duyệt vẫn xuất được: bản xuất là ảnh chụp, và
          // "đang ở trạng thái nào" chính là thứ chân trang phải nói.
          status: 'draft',
        }),
      }
    }
    case 'run': {
      const run = await loadRun(subject.id)
      if (!run) return { ok: false, error: 'not-found' }
      return { ok: true, doc: buildRunShare({ run, generatedAt, lang }) }
    }
    case 'report': {
      const doc = buildReportShare({
        kind: subject.reportKind,
        title: subject.title,
        body: subject.body,
        generatedAt,
        lang,
        ...(subject.scope !== undefined ? { scope: subject.scope } : {}),
        ...(subject.mermaid !== undefined ? { diagram: { mermaid: subject.mermaid } } : {}),
      })
      return { ok: true, doc }
    }
  }
}

// ─── Danh mục báo cáo ────────────────────────────────────────────────────────

/**
 * Bốn loại báo cáo + câu lệnh ghim vào phiên + nhịp đề xuất. UI dịch nhãn bằng
 * `labelKey`/`aboutKey`; sidecar cố ý không ôm chuỗi hiển thị.
 */
register('infra.report-kinds', async (raw) => {
  // Không có tham số, nhưng vẫn đi qua `parse` để một payload lạ không lặng lẽ
  // được bỏ qua — biên RPC là biên, kể cả khi schema rỗng.
  z.object({}).strict().parse(raw ?? {})
  return {
    kinds: REPORT_DEFINITIONS.map((d) => ({
      kind: d.kind,
      labelKey: d.labelKey,
      aboutKey: d.aboutKey,
      prompt: d.prompt,
      schedule: d.schedule,
      scheduleGapKey: d.scheduleGapKey,
    })),
  }
})

// ─── Lưu báo cáo vào Wiki ────────────────────────────────────────────────────

const SaveParams = z.object({
  source: z.enum(['global', 'project']),
  projectId: z.string().max(200).optional(),
  path: z.string().min(1).max(400),
  title: z.string().min(1).max(MAX_TITLE_CHARS),
  description: z.string().max(2000).optional(),
  tags: z.array(z.string().max(60)).max(30).optional(),
  body: z.string().max(MAX_BODY_CHARS),
  mode: z.enum(['create', 'update']).optional(),
  reportKind: z.enum(REPORT_KINDS).optional(),
})

/**
 * Ghi một báo cáo thành trang Wiki.
 *
 * VÌ SAO KHÔNG GỌI THẲNG `wiki.savePage` TỪ UI: `wiki/store.ts` ghi thẳng `body`
 * xuống đĩa, không có lớp khử nào (grep `redact` trong `src/wiki/` ra 0 kết quả).
 * Trang Wiki lại được nạp vào context của LLM ở các phiên sau (ADR 0073), nên
 * spec (`infra-monitoring-reports.md` §"Bảo mật & chi phí") bắt buộc dữ liệu báo
 * cáo phải đi qua `redact.ts` TRƯỚC khi ghi. Chỗ duy nhất cưỡng chế được điều đó
 * là một method riêng đứng trước `saveWikiPage` — nếu UI gọi thẳng RPC của wiki
 * thì lời hứa ấy phụ thuộc vào việc mọi call site nhớ lọc, tức là không được giữ.
 *
 * `wiki/save-page.ts` cố ý KHÔNG bị sửa: nó phục vụ mọi trang Wiki do người dùng
 * tự viết, và ở đó nội dung người dùng tự gõ không phải bí mật cần khử.
 */
register('infra.report-save', async (raw) => {
  const p = SaveParams.parse(raw)
  const body = redactString(p.body)

  const page = await saveWikiPage({
    source: p.source,
    ...(p.projectId !== undefined ? { projectId: p.projectId } : {}),
    path: p.path,
    title: p.title,
    ...(p.description !== undefined ? { description: p.description } : {}),
    ...(p.tags !== undefined ? { tags: p.tags } : {}),
    body,
    ...(p.mode !== undefined ? { mode: p.mode } : {}),
  })
  // Mục lục Wiki nằm trong cache của bộ nạp context; không xoá thì phiên kế tiếp
  // vẫn thấy mục lục cũ. `wiki.savePage` làm việc này, nên đi vòng qua nó thì
  // phải tự làm.
  invalidateWikiCache()

  await recordInfraAction({
    actor: 'human',
    surface: REPORT_SURFACE_DEFAULT,
    tool: 'infra_report',
    argv: ['report', 'save', p.path, ...(p.reportKind !== undefined ? [p.reportKind] : [])],
    context: {},
    class: 'write',
    decision: 'auto',
    result: { summary: `saved report to wiki page ${page.path}` },
  })

  return { ok: true as const, page }
})
