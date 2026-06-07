import type { InjectionKey, Ref } from 'vue'
import type { SessionStep } from '~/types'

export const SELECT_STEP_KEY: InjectionKey<(step: SessionStep) => void> = Symbol('selectStep')
export const SELECTED_STEP_ID_KEY: InjectionKey<Ref<string | null>> = Symbol('selectedStepId')

// Resolve a plan step (kind === 'plan') from its inline card. Provided by the
// session message list (which owns the sessions store); null in non-session
// contexts so the plan buttons gracefully no-op.
export type ResolvePlanDecision = 'approve' | 'reject'
export const RESOLVE_PLAN_KEY: InjectionKey<
  (stepId: string, decision: ResolvePlanDecision) => void
> = Symbol('resolvePlan')
