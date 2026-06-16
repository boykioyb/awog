// Mid-turn steering queue (Session steering — see docs/features/session-steer-queue.md).
//
// While an assistant turn is streaming, the user can "steer" it: inject extra
// user instructions that Pi's runAgentLoop picks up at the next turn boundary
// (config.getSteeringMessages). This registry is the channel between the
// `sessions.steer` RPC (producer) and the running turn's getSteeringMessages
// callback (consumer), keyed by the turn's assistant messageId — the same id
// ACTIVE_ABORTERS uses, so the lifecycle matches an in-flight turn exactly.
//
// In-memory only: a steer is meaningful solely for the live turn it targets. A
// sidecar restart drops any un-drained steers (the turn they targeted is gone).

import { randomBytes } from 'node:crypto'

export interface SteerItem {
  id: string
  text: string
}

// messageId → pending steers not yet drained by the loop. A key exists only
// between beginTurn and endTurn, so it doubles as the "is this turn steerable?"
// flag — enqueueSteer returns null when no live turn owns the messageId.
const queues = new Map<string, SteerItem[]>()

// Mark a turn as steerable. Called by sessions.send-message at turn start.
export function beginSteerTurn(messageId: string): void {
  if (!queues.has(messageId)) queues.set(messageId, [])
}

// Tear down a turn's queue. Called in send-message's finally — any steer that
// arrived after the loop's last drain is discarded (the turn is over).
export function endSteerTurn(messageId: string): void {
  queues.delete(messageId)
}

// Push a steer onto the live turn's queue. Returns the created item (with a
// generated id, reused as the timeline step id so it's idempotent) or null when
// the messageId has no live turn — the UI then knows the steer didn't land.
export function enqueueSteer(messageId: string, text: string): SteerItem | null {
  const q = queues.get(messageId)
  if (!q) return null
  const item: SteerItem = { id: `steer_${randomBytes(6).toString('hex')}`, text }
  q.push(item)
  return item
}

// Drain + clear the pending steers for a turn. Called by the loop's
// getSteeringMessages at each turn boundary; returns [] when nothing queued.
export function drainSteer(messageId: string): SteerItem[] {
  const q = queues.get(messageId)
  if (!q || q.length === 0) return []
  const items = q.splice(0, q.length)
  return items
}
