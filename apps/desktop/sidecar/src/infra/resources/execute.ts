// Bộ thực thi của Explorer: biến một mô tả view + tham số người dùng thành MỘT
// lời gọi đi qua cổng quyền. Đây là chỗ duy nhất trong Explorer chạm tới CLI.
//
// VÌ SAO TÁCH KHỎI RPC. Ba RPC (`infra.resource-list`, `-detail`, `-action`) chia
// sẻ đúng một chuỗi: dựng argv từ mẫu → kiểm tra placeholder → `runGated()` → đọc
// JSON phòng vệ. Viết chuỗi đó ba lần là ba chỗ để một bản quên `runGated` — tức
// một đường chạy lệnh không ai duyệt. Nên nó nằm ở đây, và RPC chỉ còn là lớp
// xác thực payload IPC.
//
// EXPLORER KHÔNG CÓ ĐƯỜNG RA MẠNG RIÊNG. Mọi lệnh (`list-*`, `describe-*`,
// `put-object`, `terminate-instances`) đi qua ĐÚNG cái cổng mà agent dùng
// (`infra/gated.ts`), nên cùng một luật duyệt và cùng một dòng nhật ký. Một view
// mới không mở thêm bề mặt nào — nó chỉ khai argv.
//
// LỚP LỆNH ĐỂ `classify()` QUYẾT. `spec` có thể khai `class` ghi đè, nhưng đó chỉ
// để SỬA một chỗ `classify` đọc sai ngữ nghĩa (`s3 presign` không đổi gì trên
// AWS). Nó KHÔNG phải đường hạ lớp: giá trị ghi đè chỉ được dùng cho nhãn của hộp
// thoại, còn `runGated` vẫn tự gọi `classify()` và ma trận quyền vẫn là thứ quyết
// định chạy hay không.

import { runGated, type InfraGatedResult } from '../gated.js'
import { ensureCacheFileDir, infraCachePath } from '../cache.js'
import type { InfraSurface } from '../audit/store.js'
import type { InfraContext } from '../run.js'
import {
  buildArgs,
  listKeysOf,
  str,
  at,
  type InfraFormField,
  type InfraRow,
  type InfraViewSpec,
} from './spec.js'

/** Trần độ dài một giá trị form/placeholder — khớp `buildArgs`. */
const MAX_VALUES = 60

export type ExecuteBase = {
  spec: InfraViewSpec
  context: InfraContext
  surface: InfraSurface
  sessionId?: string | undefined
  messageId?: string | undefined
  /** Vé duyệt của lượt gọi TRƯỚC, do chính sidecar phát. */
  approvalTicket?: string | undefined
}

export type ListInput = ExecuteBase & {
  values: Record<string, string>
  token?: string | undefined
}

export type ListOutcome =
  | {
      ok: true
      rows: InfraRow[]
      nextToken: string | null
      command: string
    }
  | {
      ok: false
      /** Cổng quyền chặn: UI phải mở hộp duyệt rồi gọi lại kèm `approvalTicket`. */
      blocked: true
      requiresApproval: boolean
      approvalTicket?: string
      command: string
      reason: string
      class: string
      accountKind: 'normal' | 'production'
      mode: 'auto' | 'ask' | 'block'
    }
  | { ok: false; blocked: false; error: string; missing: string[] }

/**
 * Chạy `list` của một view. `pageSize`/`token` do SPEC quyết (cờ nào, bao nhiêu
 * dòng) chứ không do renderer — nếu renderer chọn được cờ thì nó chọn được cả
 * `--starting-token` lạ, tức tự do duyệt dữ liệu ngoài trang hiện tại.
 */
export async function runViewList(input: ListInput): Promise<ListOutcome> {
  const built = buildArgs(input.spec.list.args, input.values)
  if (!built.ok) return { ok: false, blocked: false, error: built.error, missing: built.missing }

  const args = [...built.args, input.spec.list.pageSizeFlag, String(input.spec.list.pageSize)]
  if (input.token) args.push(input.spec.list.tokenFlag, input.token)

  const gated = await runGated({
    tool: 'aws',
    args,
    context: input.context,
    surface: input.surface,
    toolName: 'infra_view',
    ...(input.approvalTicket !== undefined ? { approvalTicket: input.approvalTicket } : {}),
    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
    ...(input.messageId !== undefined ? { messageId: input.messageId } : {}),
  })

  if (gated.blocked) return blockedOf(gated)
  if (!gated.result.ok) {
    // Lỗi CLI là KẾT QUẢ hợp lệ (thiếu quyền, sai region, SSO hết phiên), không
    // phải sự cố RPC: UI phải hiện được câu của AWS.
    return { ok: false, blocked: false, error: errorText(gated.result), missing: [] }
  }
  const json = parseJson(gated.result.stdout)
  if (json === null) {
    return { ok: false, blocked: false, error: 'infra.explorer.error.badJson', missing: [] }
  }
  return {
    ok: true,
    rows: input.spec.list.pick(json),
    nextToken: str(at(json, input.spec.list.tokenPath)) || null,
    command: gated.command,
  }
}

export type DetailInput = ExecuteBase & { row: InfraRow }

export type DetailOutcome =
  | { ok: true; json: string; command: string }
  | {
      ok: false
      blocked: true
      requiresApproval: boolean
      approvalTicket?: string
      command: string
      reason: string
      class: string
      accountKind: 'normal' | 'production'
      mode: 'auto' | 'ask' | 'block'
    }
  | { ok: false; blocked: false; error: string; missing: string[] }

export async function runViewDetail(input: DetailInput): Promise<DetailOutcome> {
  const spec = input.spec.detail
  if (!spec) return { ok: false, blocked: false, error: 'infra.explorer.error.noDetail', missing: [] }
  const built = buildArgs(spec.args, rowValues(input.row))
  if (!built.ok) return { ok: false, blocked: false, error: built.error, missing: built.missing }

  const gated = await runGated({
    tool: 'aws',
    args: built.args,
    context: input.context,
    surface: input.surface,
    toolName: 'infra_view',
    ...(input.approvalTicket !== undefined ? { approvalTicket: input.approvalTicket } : {}),
    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
    ...(input.messageId !== undefined ? { messageId: input.messageId } : {}),
  })
  if (gated.blocked) return blockedOf(gated)
  if (!gated.result.ok) {
    return { ok: false, blocked: false, error: errorText(gated.result), missing: [] }
  }
  return { ok: true, json: gated.result.stdout, command: gated.command }
}

export type ActionInput = ExecuteBase & {
  /** `row:<id>` (hành động trên dòng) hoặc `form:<id>` (form cấp view). */
  actionId: string
  row?: InfraRow | undefined
  values: Record<string, string>
}

export type ActionOutcome =
  | { ok: true; command: string; stdout: string; filePath: string | null }
  | {
      ok: false
      blocked: true
      requiresApproval: boolean
      approvalTicket?: string
      command: string
      reason: string
      class: string
      accountKind: 'normal' | 'production'
      mode: 'auto' | 'ask' | 'block'
    }
  | { ok: false; blocked: false; error: string; missing: string[] }

/**
 * Chạy một hành động ngày-2 (start/stop/delete) hoặc một form nhỏ (tạo bucket,
 * upload, presign).
 *
 * HÀNH ĐỘNG TẢI VỀ đi đường riêng: đích ghi do sidecar ghép trong cache
 * (`infra/cache.ts`), nên `args` của spec cố ý KHÔNG chứa nó. Đó là điều kiện để
 * `classify()` nâng `s3api get-object` lên `read` — và cũng là lý do renderer
 * không bao giờ đặt được tên file.
 */
export async function runViewAction(input: ActionInput): Promise<ActionOutcome> {
  const isForm = input.actionId.startsWith('form:')
  const id = input.actionId.slice(input.actionId.indexOf(':') + 1)

  const values: Record<string, string> = { ...rowValues(input.row), ...input.values }
  let template: readonly string[]
  let download: { bucket: string; key: string } | undefined
  let typeNameKey: string | undefined
  let fields: readonly InfraFormField[] | undefined

  if (isForm) {
    const form = (input.spec.forms ?? []).find((f) => f.id === id)
    if (!form) return { ok: false, blocked: false, error: 'infra.explorer.error.noAction', missing: [] }
    if (form.derive) Object.assign(values, form.derive(values))
    template = form.args
    typeNameKey = form.typeNameField
    fields = form.fields
  } else {
    const action = (input.spec.actions ?? []).find((a) => a.id === id)
    if (!action) return { ok: false, blocked: false, error: 'infra.explorer.error.noAction', missing: [] }
    // Hành động MỞ VIEW không có lệnh nào để chạy. Nếu renderer hỏi nhầm (nó phải
    // tự mở view trước khi gọi), câu trả lời đúng là "việc này không chạy CLI" —
    // không phải spawn `aws` với argv rỗng rồi để ma trận quyền hỏi một câu vô nghĩa.
    if (action.opensView) {
      return {
        ok: false,
        blocked: false,
        error: 'infra.explorer.error.navigationOnly',
        missing: [],
      }
    }
    template = action.args
    download = action.download
    typeNameKey = action.typeNameKey
    fields = action.fields
  }

  // Trường "gõ tên để xác nhận" phải có mặt và khớp — kiểm ở ĐÂY chứ không chỉ ở
  // UI: hộp thoại là gợi ý, đây mới là hàng rào (payload IPC là L1).
  if (typeNameKey) {
    const expected = values[typeNameKey] ?? ''
    const typed = input.values['__typeName'] ?? expected
    if (expected !== '' && typed !== expected) {
      return { ok: false, blocked: false, error: 'infra.explorer.error.typeName', missing: [] }
    }
  }

  // `listKeysOf` suy từ CHÍNH khai báo của form/hành động: chỉ ô nào được khai
  // `list: true` mới bị tách thành nhiều token (xem `buildArgs`).
  const built = buildArgs(template, values, { listKeys: listKeysOf(fields) })
  if (!built.ok) return { ok: false, blocked: false, error: built.error, missing: built.missing }
  const args = [...built.args]

  let filePath: string | null = null
  if (download) {
    const bucket = values[download.bucket] ?? ''
    const key = values[download.key] ?? ''
    if (!bucket || !key) {
      return { ok: false, blocked: false, error: 'infra.explorer.error.noAction', missing: [] }
    }
    filePath = await ensureCacheFileDir(infraCachePath(bucket, key))
    args.push(filePath)
  }

  const gated = await runGated({
    tool: 'aws',
    args,
    context: input.context,
    surface: input.surface,
    toolName: 'infra_action',
    ...(input.approvalTicket !== undefined ? { approvalTicket: input.approvalTicket } : {}),
    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
    ...(input.messageId !== undefined ? { messageId: input.messageId } : {}),
  })
  if (gated.blocked) return blockedOf(gated)
  if (!gated.result.ok) {
    return { ok: false, blocked: false, error: errorText(gated.result), missing: [] }
  }
  return { ok: true, command: gated.command, stdout: gated.result.stdout, filePath }
}

// ─── Dùng chung ──────────────────────────────────────────────────────────────

/** Dòng chỉ chứa chuỗi (đúng kiểu `InfraRow`), nhưng vẫn cắt bớt cho chắc. */
function rowValues(row: InfraRow | undefined): Record<string, string> {
  if (!row) return {}
  const out: Record<string, string> = {}
  let n = 0
  for (const [k, v] of Object.entries(row)) {
    if (n >= MAX_VALUES) break
    if (typeof v === 'string') out[k] = v
    n++
  }
  return out
}

function blockedOf(gated: Extract<InfraGatedResult, { blocked: true }>) {
  return {
    ok: false as const,
    blocked: true as const,
    requiresApproval: gated.requiresApproval,
    ...(gated.approvalTicket !== undefined ? { approvalTicket: gated.approvalTicket } : {}),
    command: gated.command,
    reason: gated.reason,
    class: gated.class,
    // Hộp duyệt của UI đổi MÀU theo trường này (chip production đỏ + viền đỏ). Nó
    // không phải một lời khai của renderer mà là kết quả `accountKindOf()` của
    // sidecar — nếu UI tự suy từ tên profile thì hai bên có thể nói hai chuyện.
    accountKind: gated.accountKind,
    mode: gated.mode,
  }
}

function parseJson(stdout: string): unknown | null {
  const text = stdout.trim()
  if (text === '') return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function errorText(result: { stderr: string; stdout: string }): string {
  const err = result.stderr.trim()
  if (err) return err.slice(0, 2000)
  return result.stdout.trim().slice(0, 2000) || 'infra.explorer.error.cli'
}
