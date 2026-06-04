import {
  AlertCircle,
  CheckCircle2,
  Circle,
  Clock,
  History,
  KeyRound,
  PauseCircle,
  XCircle,
} from 'lucide-vue-next'
import type { Component } from 'vue'

export type StatusKey =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'waiting_connection'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'pending'
  | 'superseded'

export interface StatusMeta {
  label: string
  icon: Component
}

export const STATUS_META: Record<StatusKey, StatusMeta> = {
  queued: { label: 'Queued', icon: Clock },
  running: { label: 'Running', icon: Circle },
  waiting_approval: { label: 'Awaiting approval', icon: AlertCircle },
  waiting_connection: { label: 'Needs key', icon: KeyRound },
  paused: { label: 'Paused', icon: PauseCircle },
  completed: { label: 'Completed', icon: CheckCircle2 },
  failed: { label: 'Failed', icon: XCircle },
  pending: { label: 'Pending', icon: Circle },
  superseded: { label: 'Superseded', icon: History },
}
