// Định dạng playbook + LUẬT CỨNG (hợp đồng Mốc 5 §4).
//
// MỘT BƯỚC = MỘT LỆNH. Ở tầng này `PlaybookStep` có đúng một `verb`, nên "bước
// số 3" của playbook (khái niệm người dùng nhìn thấy trên sơ đồ) là một *nhóm*
// lệnh trải trên nhiều mục: các `check`/`do`/`verify`/`rollback` có CÙNG CHỈ SỐ
// theo thứ tự khai báo bên trong nhóm verb của chúng.
//
//   check[0] do[0] verify[0] rollback[0]      ← "bước 1"
//   check[1] do[1] verify[1] rollback[1]      ← "bước 2"
//
// Đó là lý do mọi hàm ghép cặp ở đây (`missingRollbackSteps`, `verifyFor`,
// `rollbackPlan`) đều đếm THEO CHỈ SỐ chứ không theo `id`: id là slug người dùng
// tự đặt, còn thứ tự khai báo mới là thứ nói "lệnh quay lui này thuộc bước nào".
// Số thứ tự đó cũng chính là `<bước>` trong `actor: playbook:<id>#<bước>`.
//
// DỮ LIỆU L1. Playbook là file người dùng viết (và agent sinh ra được), nên mọi
// thứ ở đây bị coi là không tin: `args` phải là MẢNG (không bao giờ là chuỗi
// shell), tên `{{biến}}` phải khớp charset, giá trị nội suy phải khớp charset,
// và binary chỉ được nằm trong allowlist của `run.ts` (`InfraTool`). Không `eval`,
// không dynamic require — không có chỗ nào ở đây chạy chuỗi thành mã.

import { z } from 'zod'
import type { InfraTool } from '../types.js'

// ─── Kiểu (hợp đồng §4) ──────────────────────────────────────────────────────

export const PLAYBOOK_KINDS = ['instruction', 'deployment'] as const
export type PlaybookKind = (typeof PLAYBOOK_KINDS)[number]

export const PLAYBOOK_VERBS = ['check', 'do', 'verify', 'rollback'] as const
export type PlaybookVerb = (typeof PLAYBOOK_VERBS)[number]

export const PLAYBOOK_TIERS = ['global', 'project'] as const
export type PlaybookTier = (typeof PLAYBOOK_TIERS)[number]

export const PLAYBOOK_STATUSES = [
  'draft',
  'preflight',
  'awaiting-approval',
  'approved',
  'running',
  'done',
  'failed',
  'rolled-back',
] as const
export type PlaybookStatus = (typeof PLAYBOOK_STATUSES)[number]

export type PlaybookStep = {
  /** Slug, duy nhất trong playbook. */
  id: string
  title: string
  verb: PlaybookVerb
  tool: InfraTool
  /** MẢNG, không bao giờ là chuỗi shell; placeholder dạng `{{tên}}`. */
  args: readonly string[]
  /** Vì sao bước này tồn tại — người đọc cần. */
  note: string
}

export type PlaybookVariable = {
  name: string
  label: string
  required: boolean
  /**
   * Giá trị dùng khi người dùng để trống. `| undefined` là bắt buộc với
   * `exactOptionalPropertyTypes`: kết quả `zod.parse` của một trường `.optional()`
   * mang đúng kiểu đó, và thiếu nó thì mọi giá trị đọc từ file đều không gán được
   * vào kiểu này.
   */
  default?: string | undefined
}

export type Playbook = {
  id: string
  name: string
  description: string
  kind: PlaybookKind
  tier: PlaybookTier
  variables: readonly PlaybookVariable[]
  steps: readonly PlaybookStep[]
  updatedAt: string
}

/** Nguồn của một playbook: hai tier trên đĩa, cộng tier dựng sẵn chỉ đọc. */
export const PLAYBOOK_SOURCES = ['builtin', 'global', 'project'] as const
export type PlaybookSource = (typeof PLAYBOOK_SOURCES)[number]

// ─── Trần ────────────────────────────────────────────────────────────────────

export const MAX_STEPS = 64
export const MAX_VARIABLES = 32
export const MAX_ARGS_PER_STEP = 32
export const MAX_ARG_CHARS = 1024
export const MAX_VALUE_CHARS = 1024
const MAX_NAME_CHARS = 160
const MAX_DESC_CHARS = 1000
const MAX_TITLE_CHARS = 200
const MAX_NOTE_CHARS = 2000
const MAX_LABEL_CHARS = 160

// ─── Charset ─────────────────────────────────────────────────────────────────

// Id playbook đi THẲNG vào `actor` của nhật ký (`playbook:<id>#<bước>`), nên
// charset ở đây phải là tập con của `/^[A-Za-z0-9._-]{1,64}$/` bên `audit/store.ts`
// — nới hơn một ký tự là mọi dòng nhật ký của playbook đó bị schema từ chối.
//
// Ký tự ĐẦU không được là dấu chấm: id thành tên file `<id>.md`, mà `list` bỏ qua
// mọi tên bắt đầu bằng `.` (cùng luật với `wiki/store.ts`). Cho qua ở đây thì
// người dùng lưu được một playbook rồi nó biến mất khỏi danh sách — lưu mà không
// thấy tệ hơn là bị từ chối kèm lý do.
const PLAYBOOK_ID_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/
const STEP_ID_RE = /^[A-Za-z0-9._-]{1,64}$/
const VAR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

/**
 * Giá trị nội suy: không ký tự điều khiển, không NUL, không xuống dòng.
 *
 * Viết bằng vòng lặp chứ không bằng regex `[\x00-\x1f]` để chỗ này đọc được
 * bằng mắt — và vì "ký tự điều khiển" là một phép kiểm theo MÃ, không phải một
 * mẫu ký tự. Không có shell nên không có injection qua biến; lớp này chỉ để một
 * giá trị rác không chảy vào argv/ghi chú/nhật ký.
 */
export function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

export function isValidValue(value: string): boolean {
  return value.length <= MAX_VALUE_CHARS && !hasControlChar(value)
}

export function isValidPlaybookId(id: string): boolean {
  return PLAYBOOK_ID_RE.test(id)
}

export function isValidStepId(id: string): boolean {
  return STEP_ID_RE.test(id)
}

// ─── Issue ───────────────────────────────────────────────────────────────────

/**
 * Một chỗ sai. `code` là KHOÁ I18N (UI hiện thẳng), `message` là chi tiết tiếng
 * Anh cho log — không bao giờ đưa `message` cho người dùng cuối.
 */
export type PlaybookIssue = {
  code: string
  message: string
  stepId?: string
}

export function issue(code: string, message: string, stepId?: string): PlaybookIssue {
  return stepId === undefined ? { code, message } : { code, message, stepId }
}

// ─── Zod: hình dạng thô ──────────────────────────────────────────────────────

const TOOL_TUPLE = ['aws', 'terraform', 'kubectl'] as const satisfies readonly InfraTool[]

const StepSchema = z.object({
  id: z.string().regex(STEP_ID_RE, 'playbook.error.badStepId'),
  title: z.string().trim().min(1).max(MAX_TITLE_CHARS),
  verb: z.enum(PLAYBOOK_VERBS),
  tool: z.enum(TOOL_TUPLE),
  args: z.array(z.string().max(MAX_ARG_CHARS)).min(1).max(MAX_ARGS_PER_STEP),
  note: z.string().max(MAX_NOTE_CHARS).default(''),
})

const VariableSchema = z.object({
  name: z.string().regex(VAR_NAME_RE, 'playbook.error.badVariableName'),
  label: z.string().trim().min(1).max(MAX_LABEL_CHARS),
  required: z.boolean().default(false),
  default: z.string().max(MAX_VALUE_CHARS).optional(),
})

export const PlaybookDraftSchema = z.object({
  name: z.string().trim().min(1).max(MAX_NAME_CHARS),
  description: z.string().max(MAX_DESC_CHARS).default(''),
  kind: z.enum(PLAYBOOK_KINDS),
  variables: z.array(VariableSchema).max(MAX_VARIABLES).default([]),
  steps: z.array(StepSchema).min(1).max(MAX_STEPS),
})

export type PlaybookDraft = z.infer<typeof PlaybookDraftSchema>

/**
 * Một playbook ĐÃ GHÉP VỊ TRÍ (`id`/`tier`/`updatedAt` có mặt).
 *
 * Dùng để đọc lại bản chụp playbook nằm trong hồ sơ một lượt chạy: hồ sơ là file
 * trên đĩa người dùng sửa được, mà thứ trong đó lại là các lệnh sắp được spawn —
 * nên nó phải qua schema y như một file playbook.
 */
export const PlaybookSchema = z.object({
  id: z.string().regex(PLAYBOOK_ID_RE, 'playbook.error.badId'),
  name: z.string().trim().min(1).max(MAX_NAME_CHARS),
  description: z.string().max(MAX_DESC_CHARS),
  kind: z.enum(PLAYBOOK_KINDS),
  tier: z.enum(PLAYBOOK_TIERS),
  variables: z.array(VariableSchema).max(MAX_VARIABLES),
  steps: z.array(StepSchema).min(1).max(MAX_STEPS),
  updatedAt: z.string().min(1).max(64),
})

export function parseDraft(raw: unknown): { draft: PlaybookDraft } | { issues: PlaybookIssue[] } {
  const res = PlaybookDraftSchema.safeParse(raw)
  if (!res.success) {
    return {
      issues: res.error.issues.map((i) =>
        issue('playbook.error.invalid', `${i.path.join('.') || '<root>'}: ${i.message}`),
      ),
    }
  }
  return { draft: res.data }
}

/** Ghép phần thô với vị trí trên đĩa (`id` từ tên file, `tier` từ thư mục). */
export function buildPlaybook(
  draft: PlaybookDraft,
  meta: { id: string; tier: PlaybookTier; updatedAt: string },
): Playbook {
  return {
    id: meta.id,
    name: draft.name,
    description: draft.description,
    kind: draft.kind,
    tier: meta.tier,
    variables: draft.variables.map((v) =>
      v.default === undefined
        ? { name: v.name, label: v.label, required: v.required }
        : { name: v.name, label: v.label, required: v.required, default: v.default },
    ),
    steps: draft.steps.map((s) => ({
      id: s.id,
      title: s.title,
      verb: s.verb,
      tool: s.tool,
      args: [...s.args],
      note: s.note,
    })),
    updatedAt: meta.updatedAt,
  }
}

// ─── Quét placeholder ────────────────────────────────────────────────────────

/**
 * Tách tên biến khỏi một chuỗi argv.
 *
 * `malformed` bật khi có `{{` không đóng, `}}` mồ côi, hoặc tên sai charset
 * (`{{bad-name}}`, `{{a b}}`). Đây là chỗ duy nhất biết luật của placeholder,
 * nên cả `validatePlaybook` lẫn `interpolateArgs` đều đi qua nó.
 */
export function scanPlaceholders(text: string): { names: string[]; malformed: boolean } {
  const names: string[] = []
  let i = 0
  let malformed = false
  for (;;) {
    const open = text.indexOf('{{', i)
    if (open === -1) {
      if (text.includes('}}', i)) malformed = true
      break
    }
    const close = text.indexOf('}}', open + 2)
    if (close === -1) {
      malformed = true
      break
    }
    const name = text.slice(open + 2, close)
    if (VAR_NAME_RE.test(name)) names.push(name)
    else malformed = true
    i = close + 2
  }
  return { names, malformed }
}

// ─── Ghép cặp + luật ─────────────────────────────────────────────────────────

export const ERROR_MISSING_ROLLBACK = 'playbook.error.missingRollback'

/** Các bước theo một verb, giữ nguyên thứ tự khai báo. */
export function stepsOfVerb(playbook: Playbook, verb: PlaybookVerb): PlaybookStep[] {
  return playbook.steps.filter((s) => s.verb === verb)
}

/**
 * Cặp `do` ↔ `rollback` theo CHỈ SỐ. Trả về những bước `do` KHÔNG có bước quay
 * lui tương ứng — tức `do` thứ n vượt quá số `rollback` khai báo.
 */
export function missingRollbackSteps(playbook: Playbook): PlaybookStep[] {
  const dos = stepsOfVerb(playbook, 'do')
  const rollbacks = stepsOfVerb(playbook, 'rollback')
  return rollbacks.length >= dos.length ? [] : dos.slice(rollbacks.length)
}

/** Bước `verify` của bước `do` thứ `index` (0-based), nếu có khai báo. */
export function verifyFor(playbook: Playbook, index: number): PlaybookStep | undefined {
  return stepsOfVerb(playbook, 'verify')[index]
}

/** Bước `rollback` của bước `do` thứ `index` (0-based), nếu có khai báo. */
export function rollbackFor(playbook: Playbook, index: number): PlaybookStep | undefined {
  return stepsOfVerb(playbook, 'rollback')[index]
}

/**
 * Kế hoạch quay lui DỰNG NGƯỢC: nhận các bước `do` đã chạy THÀNH CÔNG (đúng thứ
 * tự đã chạy), trả về các bước `rollback` theo thứ tự ngược lại.
 *
 * Hàm thuần để test được mà không cần cổng CLI: đây là "soạn sẵn lúc rảnh", thứ
 * mà `playbooks.md` nói là điểm khác biệt so với nghĩ tại chỗ lúc đang cháy.
 * `unpaired` chỉ khác rỗng khi playbook vi phạm luật rollback — runner đã chặn
 * từ lúc submit, nên đây là lưới an toàn chứ không phải đường đi bình thường.
 */
export function rollbackPlan(
  playbook: Playbook,
  executedDoIds: readonly string[],
): { plan: PlaybookStep[]; unpaired: string[] } {
  const dos = stepsOfVerb(playbook, 'do')
  const indexOf = new Map(dos.map((s, i) => [s.id, i]))
  const plan: PlaybookStep[] = []
  const unpaired: string[] = []
  for (const id of [...executedDoIds].reverse()) {
    const index = indexOf.get(id)
    const rb = index === undefined ? undefined : rollbackFor(playbook, index)
    if (rb) plan.push(rb)
    else unpaired.push(id)
  }
  return { plan, unpaired }
}

/**
 * Luật cứng số một của spec: thiếu `rollback` thì **không gửi duyệt được**.
 * Cưỡng chế ở tầng runner/store, không phải gợi ý ở UI.
 */
export function canSubmit(playbook: Playbook): boolean {
  return validatePlaybook(playbook).length === 0 && missingRollbackSteps(playbook).length === 0
}

/**
 * Lỗi cấu trúc — chặn cả `save` lẫn `submit`. Luật rollback CỐ Ý không nằm ở
 * đây: phải lưu được một bản nháp còn thiếu bước quay lui để còn sửa tiếp, chỉ
 * lúc gửi duyệt nó mới bị chặn (xem `missingRollbackSteps`).
 */
export function validatePlaybook(playbook: Playbook): PlaybookIssue[] {
  const issues: PlaybookIssue[] = []

  const seenSteps = new Set<string>()
  for (const step of playbook.steps) {
    if (seenSteps.has(step.id)) {
      issues.push(issue('playbook.error.duplicateStepId', `duplicate step id ${step.id}`, step.id))
    }
    seenSteps.add(step.id)
  }

  const declared = new Set<string>()
  for (const v of playbook.variables) {
    if (declared.has(v.name)) {
      issues.push(issue('playbook.error.duplicateVariable', `duplicate variable ${v.name}`))
    }
    declared.add(v.name)
    if (v.default !== undefined && !isValidValue(v.default)) {
      issues.push(issue('playbook.error.badDefault', `bad default for ${v.name}`))
    }
  }

  for (const step of playbook.steps) {
    for (const arg of step.args) {
      const scan = scanPlaceholders(arg)
      if (scan.malformed) {
        issues.push(
          issue('playbook.error.badPlaceholder', `malformed placeholder in ${arg}`, step.id),
        )
      }
      for (const name of scan.names) {
        if (!declared.has(name)) {
          issues.push(
            issue('playbook.error.unknownVariable', `undeclared variable {{${name}}}`, step.id),
          )
        }
      }
    }
  }

  return issues
}

// ─── Nội suy biến ────────────────────────────────────────────────────────────

export type ResolveVariablesResult =
  | { ok: true; values: Record<string, string> }
  | { ok: false; missing: string[]; issues: PlaybookIssue[] }

/**
 * Ghép giá trị người dùng gửi với khai báo biến của playbook.
 *
 * Giá trị đến từ IPC (L1) nên bị soi charset tại đây; thiếu mà biến `required`
 * là lỗi, thiếu mà không `required` thì lấy `default`, còn lại là chuỗi rỗng.
 */
export function resolveVariables(
  variables: readonly PlaybookVariable[],
  provided: Record<string, string>,
): ResolveVariablesResult {
  const values: Record<string, string> = {}
  const missing: string[] = []
  const issues: PlaybookIssue[] = []

  for (const v of variables) {
    const raw = provided[v.name]
    if (raw !== undefined) {
      if (!isValidValue(raw)) {
        issues.push(issue('playbook.error.badValue', `bad value for ${v.name}`))
        continue
      }
      values[v.name] = raw
      continue
    }
    const fallback = v.default ?? ''
    if (fallback === '' && v.required) {
      missing.push(v.name)
      continue
    }
    values[v.name] = fallback
  }

  if (missing.length > 0) return { ok: false, missing, issues }
  if (issues.length > 0) return { ok: false, missing: [], issues }
  return { ok: true, values }
}

export type InterpolateResult = { ok: true; args: string[] } | { ok: false; issues: PlaybookIssue[] }

/** Thay `{{tên}}` bằng giá trị đã resolve. Chỉ thay tên CÓ trong `values`. */
export function interpolateArgs(
  args: readonly string[],
  values: Record<string, string>,
  stepId?: string,
): InterpolateResult {
  const issues: PlaybookIssue[] = []
  const out: string[] = []
  for (const arg of args) {
    const scan = scanPlaceholders(arg)
    if (scan.malformed) {
      issues.push(issue('playbook.error.badPlaceholder', `malformed placeholder in ${arg}`, stepId))
      continue
    }
    let text = arg
    for (const name of scan.names) {
      const value = values[name]
      if (value === undefined) {
        issues.push(issue('playbook.error.unknownVariable', `no value for {{${name}}}`, stepId))
        continue
      }
      text = text.split(`{{${name}}}`).join(value)
    }
    // Sau khi thay hết mọi tên khai trong `args` VÀ mọi tên có trong `values`, không
    // được còn `{{…}}` nào — còn là do CHÍNH GIÁ TRỊ mang vào. Từ chối cả tên hợp lệ
    // lẫn tên méo: một giá trị chứa `{{evil}}` mà lọt xuống argv là một chuỗi người
    // dùng điều khiển được, đứng ở vị trí mà playbook tưởng là hằng của mình.
    const after = scanPlaceholders(text)
    if (after.malformed || after.names.length > 0) {
      issues.push(issue('playbook.error.badValue', `value broke placeholder in ${arg}`, stepId))
      continue
    }
    if (text.length > MAX_ARG_CHARS) {
      issues.push(issue('playbook.error.argTooLong', `arg too long in step ${stepId ?? ''}`, stepId))
      continue
    }
    out.push(text)
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, args: out }
}

// ─── Actor ───────────────────────────────────────────────────────────────────

/**
 * `actor` của một bước trong nhật ký. `n` là số thứ tự **bước** (1-based, theo
 * nhóm verb) — cùng con số cho `check`/`do`/`verify`/`rollback` của một bước, để
 * màn Nhật ký gom lại được thành "bước 2 làm gì".
 */
export function stepActor(playbookId: string, n: number): string {
  if (!PLAYBOOK_ID_RE.test(playbookId)) {
    throw new Error(`Invalid playbook id for actor: ${playbookId}`)
  }
  if (!Number.isInteger(n) || n < 1 || n > 9999) {
    throw new Error(`Invalid playbook step number for actor: ${String(n)}`)
  }
  return `playbook:${playbookId}#${n}`
}
