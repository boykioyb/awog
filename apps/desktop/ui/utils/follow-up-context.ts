import type { InjectionKey, Ref } from 'vue'
import type { SessionFollowUp } from '~/types'

export interface FollowUpController {
  pending: Ref<SessionFollowUp[]>
  add: (followUp: Omit<SessionFollowUp, 'id'>) => void
  update: (id: string, patch: Partial<Pick<SessionFollowUp, 'note' | 'selectedText'>>) => void
  remove: (id: string) => void
  clear: () => void
}

export const FOLLOW_UP_KEY: InjectionKey<FollowUpController> = Symbol('followUp')
