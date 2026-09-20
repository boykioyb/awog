// Permission-rule side of the gate card (ADR 0080). Owns the two things the raw
// "Always allow" button never had: the EXACT rule text about to be granted, and the
// tier it is written to.
//
// PURE PRESENTATION. The rule text comes in on the block itself
// (`PermBlock.suggestion`, filled by the sessions store from the very
// `session.permission-request` event that creates the block), and the one RPC of the
// whole flow goes out through `store.setPermission(…, scope)`, which hands back the
// tiers actually written. This module therefore opens no bridge listener and sends
// nothing: it formats the offer, owns the tier picker, and reports the outcome.
// A request whose suggestion the engine could not derive keeps `canAlwaysAllow`
// false and the card hides "Always allow" — never a guessed rule text (a rule the
// user did not actually read is the blind-consent hole ADR 0080 closes, pointed the
// other way).
//
// The rule content is NEVER sent back. `sessions.permission` takes a `scope` only and
// re-reads the rule from the parked suggestion — see the RPC's own comment: accepting
// rule text from the renderer would let a hand-made payload write `Bash(*)` to
// ~/.awog/permission-rules.json.
import { computed, ref } from 'vue'
import type { AppSelectOption } from '~/components/common/AppSelect.vue'
import type { PermRuleKind, PermRuleScope, PermRuleSuggestion } from '~/composables/useSessionsData'

// Names Settings → Quyền (usePermissionRules) imports. The declarations live next to
// PermBlock in useSessionsData — one type, two spellings, no second definition.
export type PermissionRuleScope = PermRuleScope
export type PermissionRuleKind = PermRuleKind

const SCOPES: readonly string[] = ['session', 'project', 'user']
const isScope = (v: unknown): v is PermissionRuleScope =>
  typeof v === 'string' && SCOPES.includes(v)

/**
 * Rule + tier state for ONE permission prompt.
 *
 * @param suggestion the rule the engine offered for this prompt (the PermBlock's
 *   `suggestion`), or undefined when it offered none.
 * @param projectId project the session is bound to ('' when none) — a rule cannot be
 *   written to a project tier that does not exist, so the option is disabled instead
 *   of silently falling back.
 */
export function useSessionPermissionRule(
  suggestion: () => PermRuleSuggestion | undefined,
  projectId: () => string,
) {
  const { t } = useI18n()

  const offer = computed<PermRuleSuggestion | undefined>(() => suggestion())
  // The exact string the user is about to grant. Rendered as a text node, never HTML.
  const rule = computed<string>(() => offer.value?.rule ?? '')
  const canAlwaysAllow = computed<boolean>(() => offer.value !== undefined)

  // Allowance chỉ sống trong phiên (cổng SSH / cổng hạ tầng) — không ghi xuống đĩa
  // được, nên picker tầng bị khoá ở "phiên này" thay vì chào hai tầng không bao giờ
  // dùng tới.
  const sessionOnly = computed<boolean>(() => offer.value?.type === 'session')

  // Nhãn đứng trước chuỗi được cấp. "Sẽ cấp luật" đúng với một luật ghi được xuống
  // đĩa; allowance phiên không phải luật nên nó nói thẳng là "sẽ cho phép".
  const ruleLabel = computed<string>(() =>
    sessionOnly.value ? t('sessionsPerm.allowanceLabel') : t('sessionsPerm.ruleLabel'),
  )

  // What the rule matches, in one sentence — "this exact command" reads very
  // differently from "every Bash call", and that difference is the whole point.
  const ruleMeaning = computed<string>(() => {
    const o = offer.value
    if (!o) return ''
    if (o.type === 'session') return t(`sessionsPerm.kind.${o.gate}`)
    if (o.ruleKind === 'bare') return t('sessionsPerm.kind.bare', { tool: o.rule })
    return t(`sessionsPerm.kind.${o.ruleKind}`)
  })
  // Why this prompt offers no rule at all.
  const noRuleReason = computed<string>(() =>
    canAlwaysAllow.value ? '' : t('sessionsPerm.noRule'),
  )

  // Least privilege by default: a remembered rule starts session-scoped.
  const scope = ref<PermissionRuleScope>('session')
  const hasProject = computed<boolean>(() => projectId().trim().length > 0)
  const scopeOptions = computed<AppSelectOption[]>(() => [
    { label: t('sessionsPerm.scope.session'), value: 'session' },
    {
      label: hasProject.value
        ? t('sessionsPerm.scope.project')
        : t('sessionsPerm.scope.projectNone'),
      value: 'project',
      // Hai tầng đĩa tắt cho allowance phiên: sidecar bỏ qua `scope` của nó, nên
      // chào ở đây là chào một lời hứa không ai giữ.
      disabled: !hasProject.value || sessionOnly.value,
    },
    { label: t('sessionsPerm.scope.user'), value: 'user', disabled: sessionOnly.value },
  ])
  const scopeHint = computed<string>(() =>
    sessionOnly.value && offer.value?.type === 'session'
      ? t(`sessionsPerm.hint.gate.${offer.value.gate}`)
      : t(`sessionsPerm.hint.${scope.value}`),
  )
  // AppSelect speaks plain strings; narrow at the boundary instead of widening the
  // ref (an unknown value would otherwise ride straight into the RPC).
  function setScope(next: string): void {
    if (sessionOnly.value) return
    if (isScope(next)) scope.value = next
  }

  // ── Outcome, as reported by the store's RPC ────────────────────────────────
  const savedScopes = ref<PermissionRuleScope[]>([])
  const saveState = ref<'idle' | 'saved' | 'failed'>('idle')
  const requestedScope = ref<PermissionRuleScope | null>(null)

  const savedScope = computed<PermissionRuleScope | null>(() => savedScopes.value[0] ?? null)
  const savedOk = computed<boolean>(() => saveState.value === 'saved')
  const savedMessage = computed<string>(() => {
    if (saveState.value === 'failed') return t('sessionsPerm.saveFailed')
    const s = savedScope.value
    if (!s) return ''
    // Allowance phiên không phải một "luật": nó không có văn bản luật, không có tầng
    // nào khác, và nói "đã ghi luật" ở đây là nói sai về thứ vừa xảy ra.
    return sessionOnly.value ? t('sessionsPerm.saved.gate') : t(`sessionsPerm.saved.${s}`)
  })
  // The engine downgrades project → session when the session has no project; say so
  // rather than letting the user believe the rule outlived the session.
  const savedDowngraded = computed<boolean>(
    () =>
      saveState.value === 'saved' &&
      requestedScope.value !== null &&
      savedScope.value !== null &&
      requestedScope.value !== savedScope.value,
  )

  // Record what came back from one "Always allow": the tier asked for and the tiers
  // written. No tier written = the turn still resumed, only the remembering failed,
  // so that is what the card says instead of a generic error.
  function recordSave(requested: PermissionRuleScope, written: PermissionRuleScope[]): void {
    requestedScope.value = requested
    savedScopes.value = written
    saveState.value = written.length > 0 ? 'saved' : 'failed'
  }

  return {
    rule,
    ruleLabel,
    ruleMeaning,
    noRuleReason,
    canAlwaysAllow,
    sessionOnly,
    scope,
    setScope,
    scopeOptions,
    scopeHint,
    savedOk,
    savedMessage,
    savedDowngraded,
    recordSave,
  }
}
