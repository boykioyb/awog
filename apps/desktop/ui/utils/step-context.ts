import type { InjectionKey, Ref } from 'vue'
import type { SessionStep } from '~/types'

export const SELECT_STEP_KEY: InjectionKey<(step: SessionStep) => void> = Symbol('selectStep')
export const SELECTED_STEP_ID_KEY: InjectionKey<Ref<string | null>> = Symbol('selectedStepId')
