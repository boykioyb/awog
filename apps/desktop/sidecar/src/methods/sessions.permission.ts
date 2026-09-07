import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { getPermissionSuggestions, resolvePermissionRequest } from '../sessions/permissions.js'
import {
  parsePermissionRule,
  persistRule,
  ruleMatchesOverriddenInput,
} from '../sessions/permission-rules.js'
import { isSafeToolInputOverride } from '../runtime/permission.js'
import { log } from '../util/logger.js'
import type { PermissionResult, PermissionUpdate } from '../runtime/permission-types.js'
import type { ParsedPermissionRule, PermissionRuleScope } from '../sessions/permission-rules.js'

const Params = z.object({
  requestId: z.string().min(1),
  decision: z.enum(['allow', 'deny']),
  alwaysAllow: z.boolean().optional(),
  // Tầng lưu luật khi alwaysAllow (ADR 0080). Vắng ⇒ 'session' như hành vi cũ.
  scope: z.enum(['session', 'project', 'user']).optional(),
  // Tham số người dùng sửa trước khi đồng ý. Dữ liệu L1 đi thẳng vào một sink
  // đột biến (runtime/permission.ts ghi đè args của tool) nên phải validate
  // NGAY Ở BIÊN, không chỉ ở sink: `z.custom` chạy trên giá trị THÔ nên nó thấy
  // được cả khoá `__proto__` do `JSON.parse` sinh ra (F13).
  updatedInput: z
    .custom<Record<string, unknown>>(isSafeToolInputOverride, {
      message: 'updatedInput must be a plain object without prototype keys',
    })
    .optional(),
})

// Luật SẼ ghi được lấy TỪ suggestion đã park (do runtime/permission.ts sinh), KHÔNG
// từ payload của UI: UI chỉ được chọn TẦNG, không được tự soạn nội dung luật. Nếu
// nhận văn bản luật từ UI thì một payload dựng tay có thể ghi thẳng `Bash(*)` vào
// `~/.awog/permission-rules.json` — đúng cái lỗ hổng đang vá.
function ruleOfSuggestion(suggestion: PermissionUpdate): ParsedPermissionRule | null {
  if (suggestion.type !== 'addRule') return null
  const text = suggestion.rule
  if (typeof text !== 'string') return null
  return parsePermissionRule(text, 'allow')
}

function sessionIdOfSuggestion(suggestion: PermissionUpdate): string | undefined {
  return typeof suggestion.sessionId === 'string' ? suggestion.sessionId : undefined
}

// Resolves a parked canUseTool promise with the user's choice from the UI.
// Idempotent: if the request was already handled (race with cancel), returns
// `{ resolved: false }` so the UI knows the prompt is stale and can dismiss it.
register('sessions.permission', async (raw) => {
  const params = Params.parse(raw)

  let result: PermissionResult
  // Tầng thật sự đã ghi (có thể bị hạ cấp: xin 'project' mà phiên không thuộc
  // project nào ⇒ rơi về 'session'). Trả lên UI để hiện đúng thứ vừa xảy ra.
  const savedScopes: PermissionRuleScope[] = []
  // true khi người dùng bấm "Always allow" NHƯNG luật không được ghi vì chính họ
  // vừa sửa tham số (xem dưới). Trả lên UI để thẻ xin quyền nói thật: lần sau
  // vẫn hỏi.
  let ruleSkipped = false
  if (params.decision === 'allow') {
    const allowed: PermissionResult = { behavior: 'allow' }
    if (params.updatedInput !== undefined) allowed.updatedInput = params.updatedInput
    if (params.alwaysAllow) {
      const suggestions = getPermissionSuggestions(params.requestId) ?? []
      const applied: PermissionUpdate[] = []
      for (const suggestion of suggestions) {
        const rule = ruleOfSuggestion(suggestion)
        if (!rule) {
          log.warn('sessions.permission: suggestion carries no usable rule, ignored', {
            requestId: params.requestId,
          })
          continue
        }
        // `alwaysAllow` + `updatedInput` (F13): luật được park mô tả args GỐC,
        // còn thứ SẮP CHẠY là args đã ghi đè. Ghi luật cũ xuống đĩa là ghi nhớ
        // một câu người dùng đã đọc trong khi cấp cho một câu khác; sinh luật
        // từ args ghi đè thì nội dung luật lại đến từ payload UI — đúng điều
        // ADR 0080 mục 5 cấm. Nên: chỉ nhớ khi ghi đè KHÔNG đụng tới chủ thể của
        // luật, còn lại thì cho chạy lần này và hỏi lại lần sau.
        if (
          params.updatedInput !== undefined &&
          !ruleMatchesOverriddenInput(rule, params.updatedInput)
        ) {
          ruleSkipped = true
          log.warn('sessions.permission: input override changes the rule subject, rule not saved', {
            requestId: params.requestId,
            rule: rule.text,
          })
          continue
        }
        const sessionId = sessionIdOfSuggestion(suggestion)
        try {
          // Tuần tự: hai luật cùng ghi một file phải nối đuôi, không đua nhau.
          // eslint-disable-next-line no-await-in-loop
          const scope = await persistRule(params.scope ?? 'session', rule, {
            ...(sessionId ? { sessionId } : {}),
          })
          savedScopes.push(scope)
          applied.push({ ...suggestion, destination: scope })
        } catch (err) {
          // Ghi luật hỏng KHÔNG được treo lượt: vẫn cho phép lần gọi này rồi
          // hỏi lại lần sau (fail-safe theo hướng hỏi nhiều hơn).
          log.warn('sessions.permission: failed to persist rule', {
            requestId: params.requestId,
            rule: rule.text,
            err: err instanceof Error ? err.message : String(err),
          })
        }
      }
      // `updatedPermissions` vẫn round-trip về runtime để giữ nguyên contract cũ —
      // nhưng việc NHỚ đã do đây làm, gate không nhớ gì thêm.
      if (applied.length > 0) allowed.updatedPermissions = applied
    }
    result = allowed
  } else {
    result = { behavior: 'deny', message: 'User denied via UI' }
  }

  const resolved = resolvePermissionRequest(params.requestId, result)
  log.info('sessions.permission', {
    requestId: params.requestId,
    decision: params.decision,
    alwaysAllow: params.alwaysAllow === true,
    savedScopes,
    ruleSkipped,
    resolved,
  })
  return { resolved, savedScopes, ruleSkipped }
})
