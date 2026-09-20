// Lệnh hạ tầng chạy qua `Bash` (ADR 0088 §6) — hai nửa của cùng một cái bẫy.
//
// Vì sao có file này: trước bản vá, nhánh `bashInfraCall` nhận diện lệnh hạ tầng
// bằng cách quét MỌI token của chuỗi shell, nên `rg 'aws' src` cũng bị coi là lệnh
// `aws`. Hậu quả không chỉ là một lần hỏi thừa: thẻ duyệt đổi bố cục sang dạng hạ
// tầng (mất nút "Always allow" theo LUẬT — nay nhánh hạ tầng chào allowance phiên
// thay thế, xem `suggestionType`), dán chip PRODUCTION,
// và tệ nhất là `classify('aws', [])` trả `write` cho một chuỗi không có động từ
// nào. Người dùng báo đúng ba triệu chứng đó: "tất cả các command đang đều bị dính
// vào Infrastructure command, trên form luôn bị đánh thành PRODUCTION, không có
// button alway allow".
//
// Nửa thứ hai là cột account. Cổng gửi sentinel `'__unverified__'` rồi tự gán đè
// `accountKind: 'production'` lên kết quả — nhưng cú gán đè chạy SAU `decide()`,
// nên nó chỉ sửa được cái NHÌN THẤY. Sentinel là chuỗi truthy ⇒ `accountKindOf`
// rơi xuống nhánh so với `prodAccountIds` ⇒ trả `normal` ⇒ `aws s3 rb` được chấm
// `ask` (duyệt được) trong khi thẻ hiện chip PRODUCTION. Nhãn ngược quyết định, và
// quyết định thì nghiêng về phía CẤP QUYỀN.
//
// Nửa "KHÔNG được bắt" load-bearing ngang nửa "phải bắt": một bộ nhận diện chỉ biết
// nói "có" sẽ bị tắt, và khi bị tắt thì không còn cổng hạ tầng nào cả.
//
// ⚠ Ba nhóm dưới đây khẳng định trên BA bề mặt khác nhau, đừng lẫn:
//   · thẻ hạ tầng   → `options.decisionReason.kind === 'infra'` (có prompt duyệt)
//   · nút "Always allow" → `options.suggestions` khác rỗng
//   · lệnh bị CHẶN → `result.block` — và khi đó KHÔNG có `options` nào cả, vì
//     chặn xảy ra trước khi hỏi. Nhãn production nằm trong `result.reason`.
//
// Run: `npx vitest run src/runtime/__tests__/bash-infra-gate.test.ts`
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BeforeToolCallContext } from '@earendil-works/pi-agent-core'
import { invalidateInfraPolicyCache } from '../../infra/policy-store.js'
import { makeBeforeToolCall } from '../permission.js'
import type { InfraGateConfig } from '../permission.js'
import type { CanUseTool, CanUseToolOptions, PermissionResult } from '../permission-types.js'
import { clearSessionPermissions, parkPermissionRequest } from '../../sessions/permissions.js'
import { dispatch } from '../../transport/rpc.js'
// Import CÓ TÁC DỤNG PHỤ: đăng ký `sessions.permission` để test trả lời qua ĐÚNG
// đường mà thẻ duyệt đi.
import '../../methods/sessions.permission.js'

// $HOME tạm: ma trận quyền của người chạy test không được lọt vào kết quả. Không có
// file `infra-policy.json` ⇒ `loadInfraPolicy()` trả mặc định xuất xưởng, và
// `prodAccountIds` rỗng nên `acc-1` chắc chắn là cột `normal`.
let home: string
let originalHome: string | undefined

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'awog-bash-infra-'))
  originalHome = process.env.HOME
  process.env.HOME = home
  invalidateInfraPolicyCache()
})

afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  invalidateInfraPolicyCache()
  await rm(home, { recursive: true, force: true })
  vi.restoreAllMocks()
})

// Hook chỉ đọc `toolCall.name` / `toolCall.id` / `args`.
function bashCtx(command: string): BeforeToolCallContext {
  return {
    toolCall: { id: 'tc-1', name: 'Bash', arguments: { command } },
    args: { command },
  } as unknown as BeforeToolCallContext
}

type Seen = { options: CanUseToolOptions | undefined }

/**
 * Cổng UI giả ghi lại đúng thứ thẻ duyệt đọc: `suggestions` (có ⇒ nút "Always
 * allow") và `decisionReason` (payload hạ tầng ⇒ bố cục thẻ hạ tầng + chip).
 */
function recordingGate(seen: Seen, behavior: 'allow' | 'deny' = 'allow'): CanUseTool {
  return async (_toolName, _input, options): Promise<PermissionResult> => {
    seen.options = options
    return behavior === 'allow'
      ? { behavior: 'allow' }
      : { behavior: 'deny', message: 'Denied by user.' }
  }
}

async function runBash(command: string, infraGate?: InfraGateConfig, sessionId?: string) {
  const seen: Seen = { options: undefined }
  const hook = makeBeforeToolCall(
    recordingGate(seen),
    'ask',
    sessionId,
    false,
    undefined,
    'prompt',
    undefined,
    infraGate,
  )
  const result = await hook(bashCtx(command))
  const payload = seen.options?.decisionReason as { kind?: string } & Record<string, unknown>
  const suggestion = seen.options?.suggestions?.[0]
  return {
    result,
    payload,
    infraCard: payload?.kind === 'infra',
    alwaysAllowOffered: (seen.options?.suggestions?.length ?? 0) > 0,
    // Lệnh hạ tầng chỉ được chào allowance SỐNG TRONG PHIÊN. Một `addRule` ở đây là
    // luật ghi xuống đĩa cạnh ma trận quyền — đúng thứ ADR 0088 §6 cấm.
    suggestionType: suggestion?.type,
  }
}

const PINNED: InfraGateConfig = { context: { accountId: 'acc-1', profile: 'dev' } }
const UNPINNED: InfraGateConfig = { context: {} }

describe('nhận diện: token ở VỊ TRÍ LỆNH, không phải mọi token', () => {
  // Mọi dòng ở đây từng bị coi là lệnh hạ tầng trước bản vá. Đây là nửa "KHÔNG được
  // bắt" — nếu nó đỏ, người dùng mất nút "Always allow" trên lệnh vô hại.
  const NOT_INFRA = [
    `rg 'aws' apps/desktop/sidecar/src`,
    `grep -rn kubectl docs/`,
    `git commit -m "fix aws creds"`,
    `git log --grep aws`,
    `echo aws`,
    `echo terraform`,
    // Tên binary nằm trong đối số của một lệnh khác.
    `node scripts/deploy.js --tool aws`,
  ]

  it.each(NOT_INFRA)('%s ⇒ thẻ quyền THƯỜNG, có nút "Always allow"', async (command) => {
    const { infraCard, alwaysAllowOffered } = await runBash(command, PINNED)
    expect(infraCard).toBe(false)
    expect(alwaysAllowOffered).toBe(true)
  })

  // Chuyển hướng: thứ đứng sau `>` là TÊN TỆP, không phải chương trình — nên nó
  // không được mang bố cục thẻ hạ tầng. Nhưng nó cũng KHÔNG có nút "Always allow",
  // và đó không phải lỗi của phép quét: `>` khớp `SHELL_OPERATOR_RE`
  // (`sessions/permission-rules.ts:190`) nên `ruleSubject` trả `null` — một chuỗi
  // ghép không bao giờ thành luật nhớ được. Khẳng định đúng thứ đáng khẳng định.
  it('`echo x > aws` ⇒ thẻ THƯỜNG, không phải thẻ hạ tầng', async () => {
    const { infraCard } = await runBash(`echo x > aws`, PINNED)
    expect(infraCard).toBe(false)
  })

  // Nửa "phải bắt". `sh -c "…"` là dạng mà bản quét-theo-vị-trí dễ đánh rơi nhất —
  // nó là lý do `SHELL_BINARIES` tồn tại, và cũng là dạng một model muốn lách sẽ
  // chọn. Bốn dạng còn lại là wrapper/ghép lệnh.
  const IS_INFRA = [
    `aws s3 rb s3://bucket`,
    `kubectl delete pod api-0`,
    `terraform destroy -auto-approve`,
    `sh -c "aws s3 rb s3://bucket"`,
    `bash -c "kubectl delete pod api-0"`,
    `sudo aws s3 rb s3://bucket`,
    // Phép gán env đứng trước KHÔNG phải một binary ⇒ vị trí lệnh còn nguyên.
    // Dùng biến trung tính vì `AWS_PROFILE=prod` sẽ tự kích hoạt nhánh
    // "chuỗi tự đổi ngữ cảnh" ở nhóm dưới và bị CHẶN trước khi kịp hiện thẻ —
    // đúng thiết kế, nhưng không đo được bố cục thẻ ở đây.
    `FOO=bar aws s3 rb s3://bucket`,
    `/usr/local/bin/aws s3 rb s3://bucket`,
    `cd /tmp && aws s3 rb s3://bucket`,
    `true; aws s3 rb s3://bucket`,
    `echo hi | xargs aws s3 rb s3://bucket`,
  ]

  // Trong một PHIÊN, lệnh hạ tầng có nút "Cho phép luôn" — nhưng thứ nó cấp là
  // allowance sống trong bộ nhớ, chết cùng phiên (`allowSession`), KHÔNG phải luật
  // ghi xuống đĩa (`addRule`). Đó là ranh giới ADR 0088 §6 giữ: ma trận quyền vẫn
  // là nguồn sự thật duy nhất nằm trên đĩa.
  it.each(IS_INFRA)('%s ⇒ bố cục thẻ hạ tầng + allowance phiên', async (command) => {
    const { infraCard, alwaysAllowOffered, suggestionType } = await runBash(
      command,
      PINNED,
      'ses-1',
    )
    expect(infraCard).toBe(true)
    expect(alwaysAllowOffered).toBe(true)
    expect(suggestionType).toBe('allowSession')
  })

  // Ngoài phiên (task, one-shot) không có gì để nhớ: allowance chỉ tồn tại trong
  // một phiên, nên thẻ quay về "cho phép một lần".
  it.each(IS_INFRA)('%s ⇒ không có phiên thì không chào gì cả', async (command) => {
    const { infraCard, alwaysAllowOffered } = await runBash(command, PINNED)
    expect(infraCard).toBe(true)
    expect(alwaysAllowOffered).toBe(false)
  })
})

describe('cột account: nhãn và quyết định phải khớp nhau', () => {
  it('account đã ghim, lệnh phá huỷ ⇒ chip theo account THẬT, được duyệt', async () => {
    const { payload, result } = await runBash('aws s3 rb s3://bucket', PINNED)
    expect(payload?.accountKind).toBe('normal')
    expect(payload?.mode).toBe('ask')
    expect(payload?.commandClass).toBe('destructive')
    expect(result).toBeUndefined()
  })

  // Không chứng minh được account ⇒ cột `production` THẬT ⇒ `destructive` bị CHẶN.
  //
  // Vì chặn xảy ra TRƯỚC khi hỏi nên ở đây KHÔNG có `options` nào để đọc
  // `accountKind` ra — nhãn nằm trong `result.reason`. Đây chính là chỗ bản cũ
  // trông như khớp: nó hiện chip PRODUCTION rồi vẫn cho duyệt, nên `options` có
  // tồn tại và mang một `accountKind` không ai kiểm.
  //
  // `aws_cli` chặn được cờ tự đổi bằng `findForbiddenFlag`; `Bash` thì không chặn
  // được chuỗi tuỳ ý, nên nó phải rơi về cột chặt nhất.
  const NO_HONEST_ACCOUNT: { label: string; command: string; gate: InfraGateConfig }[] = [
    { label: 'phiên không ghim account', command: 'aws s3 rb s3://bucket', gate: UNPINNED },
    {
      label: 'chuỗi tự đổi profile',
      command: 'aws s3 rb s3://bucket --profile prod',
      gate: PINNED,
    },
    {
      label: 'chuỗi tự đổi region',
      command: 'aws s3 rb s3://bucket --region us-east-1',
      gate: PINNED,
    },
    {
      label: 'chuỗi tự đổi profile bằng env',
      command: 'AWS_PROFILE=prod aws s3 rb s3://bucket',
      gate: PINNED,
    },
  ]

  it.each(NO_HONEST_ACCOUNT)('$label ⇒ cột production THẬT, bị CHẶN', async ({ command, gate }) => {
    const { payload, result } = await runBash(command, gate)
    expect(result?.block).toBe(true)
    // Nhãn đỏ phải nằm ngay trên lý do chặn, không phải chỉ trên một thẻ không bao
    // giờ hiện ra.
    expect(result?.reason).toContain('PRODUCTION')
    expect(payload).toBeUndefined()
  })

  it('lệnh ghi không kèm cờ ⇒ chấm theo account đã ghim', async () => {
    const { payload, result } = await runBash('aws s3 cp ./a s3://bucket/a', PINNED)
    expect(payload?.accountKind).toBe('normal')
    expect(result).toBeUndefined()
  })

  // `-n` đổi namespace chứ không đổi account, nên nó KHÔNG được coi là cờ tự đổi
  // ngữ cảnh. Ở đây chỉ khẳng định nó không bị đẩy lên cột production.
  it('`kubectl -n foo` không phải cờ tự đổi account', async () => {
    const { payload } = await runBash('kubectl -n kube-system delete pod x', PINNED)
    expect(payload?.accountKind).toBe('normal')
  })
})

describe('phân lớp argv lấy đúng chỗ', () => {
  // `findIndex` theo TÊN của bản cũ khớp token ĐỐI SỐ đứng trước, nên `argv` bị cắt
  // từ đó: `classify` đọc `['aws','s3','rb','s3://bucket']` + `['s3','rb',…]` = một
  // lớp sai. Lệnh ghép vốn đã bị ép `write` vì không sạch, nên chỉ khẳng định
  // `command` được giữ nguyên vẹn cho thẻ duyệt và nhật ký.
  it('lệnh ghép không cắt argv từ lần xuất hiện đầu của tên binary', async () => {
    const command = `rg aws docs/ && aws s3 rb s3://bucket`
    const { payload } = await runBash(command, PINNED)
    expect(payload?.command).toBe(command)
    expect(payload?.commandClass).toBe('write')
  })
})

// ─── "Cho phép luôn" cho lệnh hạ tầng: nhớ cho hết phiên, không chạm đĩa ─────
describe('allowance phiên cho lệnh hạ tầng', () => {
  const sessionId = 'ses-infra-allowance'

  beforeEach(() => clearSessionPermissions(sessionId))
  afterEach(() => clearSessionPermissions(sessionId))

  // Cổng UI giả trả lời qua RPC thật, nên test đi hết dây: suggestion → park →
  // sessions.permission → allowSessionTool → lời gọi sau.
  function uiGate(alwaysAllow: boolean) {
    let asked = 0
    const gate: CanUseTool = async (_tool, _input, options) => {
      asked += 1
      const requestId = `req-infra-${asked}`
      void parkPermissionRequest(requestId, options.suggestions ?? [])
      await dispatch('sessions.permission', {
        requestId,
        decision: 'allow',
        ...(alwaysAllow ? { alwaysAllow: true } : {}),
      })
      return { behavior: 'allow' }
    }
    return { gate, asked: () => asked }
  }

  function hookFor(gate: CanUseTool) {
    return makeBeforeToolCall(gate, 'ask', sessionId, false, undefined, 'prompt', undefined, PINNED)
  }

  it('lệnh cùng ô (binary, lớp, account) không hỏi lại trong phiên', async () => {
    const ui = uiGate(true)
    const hook = hookFor(ui.gate)
    await expect(hook(bashCtx('aws s3 rb s3://bucket'))).resolves.toBeUndefined()
    expect(ui.asked()).toBe(1)
    // Cùng ô — một lệnh destructive khác của `aws` trên cùng account.
    await expect(hook(bashCtx('aws s3 rb s3://other'))).resolves.toBeUndefined()
    expect(ui.asked()).toBe(1)
    // Ô khác (binary khác) ⇒ vẫn hỏi.
    await expect(hook(bashCtx('kubectl delete pod api-0'))).resolves.toBeUndefined()
    expect(ui.asked()).toBe(2)
  })

  it('bấm "cho phép" thường thì không nhớ', async () => {
    const ui = uiGate(false)
    const hook = hookFor(ui.gate)
    await hook(bashCtx('aws s3 rb s3://bucket'))
    await hook(bashCtx('aws s3 rb s3://bucket'))
    expect(ui.asked()).toBe(2)
  })
})
