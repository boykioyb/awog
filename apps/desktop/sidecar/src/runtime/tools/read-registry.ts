// Read-before-write registry (Claude Code parity).
//
// WHY. Claude Code refuses an Edit/Write against a file the model has not Read
// in this conversation, and refuses one whose content changed since that Read.
// AWOG had no such gate, which left two real failure modes open:
//
//   1. Write clobbers unseen content. Write replaces the ENTIRE file, so a model
//      that "remembers" a file it never opened silently destroys whatever it did
//      not think to include. Edit is naturally protected here (its old_string
//      must match byte-for-byte, so an invented one simply fails) — Write is not
//      protected by anything at all. This is the destructive half of the
//      confabulation problem that confabulation-guard.ts only treats at the
//      prompt layer; a tool-layer gate cannot be talked out of.
//
//   2. Stale edits. The user (or a formatter, or a concurrent task) changes the
//      file after the model read it; the model then writes from a stale mental
//      copy and reverts their work. Comparing mtime+size at write time catches
//      exactly that, and the model just re-Reads.
//
// Scope: keyed per conversation (session id) so a Read in turn 1 still counts in
// turn 5 — the toolset itself is rebuilt every turn. Callers without a key
// (one-shot completions) get a throwaway registry, i.e. per-call scope, which is
// stricter, never looser.

import { stat } from 'node:fs/promises'

// What we remember about a file at the moment it was read. mtime+size is the
// same cheap staleness signal editors use; hashing every read would cost more
// than it is worth here.
interface ReadState {
  mtimeMs: number
  size: number
}

export type WriteGate = 'ok' | 'unread' | 'stale'

// Per-registry path cap. A conversation that touches more files than this evicts
// its oldest entries; the only cost of an eviction is one extra Read.
const MAX_PATHS_PER_REGISTRY = 1_000
// Registries are keyed by session id and live for the engine's lifetime, so cap
// how many we retain (oldest-first) rather than leaking one per session ever run.
const MAX_REGISTRIES = 64

export class ReadRegistry {
  private readonly files = new Map<string, ReadState>()

  // Record that `abs` was read at its current on-disk state. Also called after a
  // successful write: the model has just authored that exact content, so it is
  // by definition current for the next Edit in the same turn.
  markRead(abs: string, st: ReadState): void {
    // Re-insert so Map iteration order stays least-recently-used first.
    this.files.delete(abs)
    this.files.set(abs, { mtimeMs: st.mtimeMs, size: st.size })
    if (this.files.size > MAX_PATHS_PER_REGISTRY) {
      const oldest = this.files.keys().next()
      if (!oldest.done) this.files.delete(oldest.value)
    }
  }

  // Decide whether a write to `abs` may proceed. `current` is the file's state on
  // disk now, or null when it does not exist (creating a new file is always
  // allowed — there is nothing to clobber).
  gate(abs: string, current: ReadState | null): WriteGate {
    if (current === null) return 'ok'
    const seen = this.files.get(abs)
    if (!seen) return 'unread'
    if (seen.mtimeMs !== current.mtimeMs || seen.size !== current.size) return 'stale'
    return 'ok'
  }
}

const registries = new Map<string, ReadRegistry>()

// Resolve the registry for a conversation. Without a key the caller gets a fresh
// one, so its scope is a single toolset construction.
export function getReadRegistry(key?: string): ReadRegistry {
  if (!key) return new ReadRegistry()
  const existing = registries.get(key)
  if (existing) return existing
  const created = new ReadRegistry()
  registries.set(key, created)
  if (registries.size > MAX_REGISTRIES) {
    const oldest = registries.keys().next()
    if (!oldest.done) registries.delete(oldest.value)
  }
  return created
}

// Current on-disk state, or null when the path does not exist. Throws for a
// directory so callers surface that as its own error rather than as 'unread'.
export async function statForGate(abs: string, label: string): Promise<ReadState | null> {
  try {
    const st = await stat(abs)
    if (st.isDirectory()) throw new Error(`Path is a directory: ${label}`)
    return { mtimeMs: st.mtimeMs, size: st.size }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

// The message the model sees when the gate blocks a write. It has to say what to
// DO — an unexplained refusal just gets retried verbatim.
export function gateError(gate: Exclude<WriteGate, 'ok'>, label: string, verb: string): Error {
  if (gate === 'unread') {
    return new Error(
      `Refusing to ${verb} ${label}: you have not read this file. ` +
        `Read it first — ${verb === 'overwrite' ? 'Write replaces the whole file, so anything you did not see would be lost' : 'the edit must be based on the file as it actually is'}.`,
    )
  }
  return new Error(
    `Refusing to ${verb} ${label}: it changed on disk since you read it. ` +
      `Read it again and redo this change against the current content, or you will revert someone else's work.`,
  )
}
