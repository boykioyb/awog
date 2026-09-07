// Permission-rule side of the gate card (ADR 0080). Owns the two things the raw
// "Always allow" button never had: the EXACT rule text about to be granted, and the
// tier it is written to.
//
// WHY A LISTENER OF ITS OWN. The rule text only exists in the
// `session.permission-request` event's `suggestions[0]` (a PermissionRuleSuggestion:
// `{ type:'addRule', rule:'Bash(git status)', ruleKind, … }`). The sessions store
// consumes that event but keeps only `{ toolName, target }` on the PermBlock, so the
// text is dropped before any component can see it. Until PermBlock carries the
// suggestion, this module captures it straight off the bridge, keyed by requestId —
// the id the block already stores as `eid`.
//
// It subscribes at MODULE LOAD, not from a component: the event is what CREATES the
// perm block, so a subscription opened in the card's setup would always land one tick
// late and miss the very prompt it has to describe. A request whose suggestion was not
// captured stays `unknown` and the card hides "Always allow" — never a guessed rule
// text (a rule the user did not actually read is the blind-consent hole ADR 0080 closes,
// pointed the other way).
//
// The rule content is NEVER sent back. `sessions.permission` takes a `scope` only and
// re-reads the rule from the parked suggestion — see the RPC's own comment: accepting
// rule text from the renderer would let a hand-made payload write `Bash(*)` to
// ~/.awog/permission-rules.json.
import { computed, reactive, ref } from 'vue'
import type { AppSelectOption } from '~/components/common/AppSelect.vue'
import { useSidecar } from '~/composables/useSidecar'

export type PermissionRuleScope = 'session' | 'project' | 'user'
export type PermissionRuleKind = 'command' | 'path' | 'bare'
export type PermissionRuleOffer = { rule: string; kind: PermissionRuleKind }

// What the card knows about a request:
//   offered — the engine proposed a rule, so "Always allow" is safe to show
//   none    — the engine proposed nothing (compound shell command, relative path…)
//   unknown — no suggestion reached this window (see the module note)
export type PermissionRuleState = 'offered' | 'none' | 'unknown'

const SCOPES = ['session', 'project', 'user'] as const
const KINDS = ['command', 'path', 'bare'] as const

const isScope = (v: unknown): v is PermissionRuleScope =>
  typeof v === 'string' && (SCOPES as readonly string[]).includes(v)
const isKind = (v: unknown): v is PermissionRuleKind =>
  typeof v === 'string' && (KINDS as readonly string[]).includes(v)

// Engine payloads are L1: validate the shape and reject anything that would not
// render as a single readable line (control characters, absurd length). The sidecar
// caps a rule at tool(128) + pattern(512); this is the display-side backstop.
const MAX_RULE_LEN = 700
// Char-code scan rather than a regex: a control-character class is exactly what
// eslint's no-control-regex flags, and the loop says what it means.
function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

// requestId → offer. `null` = the engine explicitly offered no rule.
const OFFERS = reactive(new Map<string, PermissionRuleOffer | null>())
// A prompt is answered within seconds; only enough history to survive a few parallel
// gates. Oldest-first eviction (Map keeps insertion order).
const MAX_OFFERS = 64

function remember(requestId: string, offer: PermissionRuleOffer | null): void {
  OFFERS.set(requestId, offer)
  while (OFFERS.size > MAX_OFFERS) {
    const oldest = OFFERS.keys().next()
    if (oldest.done) break
    OFFERS.delete(oldest.value)
  }
}

function offerOf(suggestions: unknown): PermissionRuleOffer | null {
  if (!Array.isArray(suggestions)) return null
  for (const raw of suggestions) {
    if (!raw || typeof raw !== 'object') continue
    const s = raw as Record<string, unknown>
    if (s.type !== 'addRule' || typeof s.rule !== 'string') continue
    const rule = s.rule
    if (!rule || rule.length > MAX_RULE_LEN || hasControlChar(rule)) continue
    return { rule, kind: isKind(s.ruleKind) ? s.ruleKind : 'bare' }
  }
  return null
}

let capturing = false

function startCapture(): void {
  if (capturing) return
  capturing = true
  const sc = useSidecar()
  if (!sc.available) return
  void sc
    .onEvent((evt) => {
      if (evt.type !== 'session.permission-request') return
      const p = evt.payload
      if (!p || typeof p !== 'object') return
      const { requestId, suggestions } = p as Record<string, unknown>
      if (typeof requestId !== 'string' || !requestId) return
      remember(requestId, offerOf(suggestions))
    })
    .catch(() => {
      // No bridge / subscribe failed → every request stays `unknown`, which the card
      // renders as "allow once only". Degraded, never permissive.
      capturing = false
    })
}

// Subscribed here rather than in the composable body — see the module note.
startCapture()

function savedScopesOf(raw: unknown): PermissionRuleScope[] {
  if (!raw || typeof raw !== 'object') return []
  const scopes = (raw as Record<string, unknown>).savedScopes
  if (!Array.isArray(scopes)) return []
  return scopes.filter(isScope)
}

/**
 * Rule + tier state for ONE permission prompt.
 *
 * @param requestId engine request id of the prompt (the PermBlock's `eid`)
 * @param projectId project the session is bound to ('' when none) — a rule cannot be
 *   written to a project tier that does not exist, so the option is disabled instead
 *   of silently falling back.
 */
export function useSessionPermissionRule(
  requestId: () => string | undefined,
  projectId: () => string,
) {
  startCapture()
  const sc = useSidecar()
  const { t } = useI18n()

  const offer = computed<PermissionRuleOffer | null | undefined>(() => {
    const id = requestId()
    return id ? OFFERS.get(id) : undefined
  })
  const state = computed<PermissionRuleState>(() => {
    const o = offer.value
    if (o === undefined) return 'unknown'
    return o === null ? 'none' : 'offered'
  })
  // The exact string the user is about to grant. Rendered as a text node, never HTML.
  const rule = computed<string>(() => offer.value?.rule ?? '')
  const canAlwaysAllow = computed<boolean>(() => state.value === 'offered')

  // What the rule matches, in one sentence — "this exact command" reads very
  // differently from "every Bash call", and that difference is the whole point.
  const ruleMeaning = computed<string>(() => {
    const o = offer.value
    if (!o) return ''
    if (o.kind === 'bare') return t('sessionsPerm.kind.bare', { tool: o.rule })
    return t(`sessionsPerm.kind.${o.kind}`)
  })
  // Why this prompt offers no rule at all.
  const noRuleReason = computed<string>(() => {
    if (state.value === 'none') return t('sessionsPerm.noRule')
    if (state.value === 'unknown') return t('sessionsPerm.ruleUnknown')
    return ''
  })

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
      disabled: !hasProject.value,
    },
    { label: t('sessionsPerm.scope.user'), value: 'user' },
  ])
  const scopeHint = computed<string>(() => t(`sessionsPerm.hint.${scope.value}`))
  // AppSelect speaks plain strings; narrow at the boundary instead of widening the
  // ref (an unknown value would otherwise ride straight into the RPC).
  function setScope(next: string): void {
    if (isScope(next)) scope.value = next
  }

  // ── Outcome, straight from the RPC ─────────────────────────────────────────
  const savedScopes = ref<PermissionRuleScope[]>([])
  const saveState = ref<'idle' | 'saved' | 'failed'>('idle')
  const requestedScope = ref<PermissionRuleScope | null>(null)

  const savedScope = computed<PermissionRuleScope | null>(() => savedScopes.value[0] ?? null)
  const savedOk = computed<boolean>(() => saveState.value === 'saved')
  const savedMessage = computed<string>(() => {
    if (saveState.value === 'failed') return t('sessionsPerm.saveFailed')
    const s = savedScope.value
    return s ? t(`sessionsPerm.saved.${s}`) : ''
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

  // Answer the prompt with the chosen tier. Only the scope crosses the boundary; the
  // rule body comes from the parked suggestion inside the sidecar.
  async function grantAlways(): Promise<void> {
    const id = requestId()
    if (!id || !canAlwaysAllow.value) return
    requestedScope.value = scope.value
    if (!sc.available) return
    try {
      const res = await sc.request<unknown>('sessions.permission', {
        requestId: id,
        decision: 'allow',
        alwaysAllow: true,
        scope: scope.value,
      })
      savedScopes.value = savedScopesOf(res)
      saveState.value = savedScopes.value.length > 0 ? 'saved' : 'failed'
    } catch {
      // The turn is unblocked either way (the store's own resolve follows); only the
      // remembering failed, so say that instead of a generic error.
      saveState.value = 'failed'
    }
  }

  return {
    rule,
    ruleMeaning,
    noRuleReason,
    canAlwaysAllow,
    scope,
    setScope,
    scopeOptions,
    scopeHint,
    savedOk,
    savedMessage,
    savedDowngraded,
    grantAlways,
  }
}
