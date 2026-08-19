// Management of the Claude Agent SDK's own session store (ADR 0058). The SDK
// writes each Anthropic session's transcript + resume state + compaction under
// <claudeHome>/projects/<cwd-hash>/<sdkSessionId>.jsonl (plus a <sdkSessionId>/
// subagents dir). Since ADR 0070 that home is the SHARED ~/.claude — AWOG no
// longer overrides CLAUDE_CONFIG_DIR — so the paths below sit next to the user's
// own CLI sessions. Everything here is keyed by an sdkSessionId AWOG itself
// created and persisted, so a cleanup can only ever touch AWOG's own artifacts.
// This is a SECOND store alongside AWOG's own session JSONL (which stays the UI
// record); the two are kept in sync by the session
// lifecycle: history-rewriting ops (truncate/edit/regenerate) drop the
// sdkSessionId so the next turn seeds a fresh SDK session, and delete/truncate
// remove the now-orphan SDK artifacts via removeSdkSession below.

import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { claudeHome } from '../../util/path.js'
import { log } from '../../util/logger.js'

// Root of the SDK's config dir — the shared Claude home (ADR 0070).
export function sdkStoreDir(): string {
  return claudeHome()
}

// Remove the SDK store artifacts for one sdkSessionId. The SDK groups sessions
// under a per-cwd project dir, so we scan the (few) project dirs and remove any
// `<id>.jsonl` transcript + `<id>/` subagents dir wherever it lives. Best-effort:
// never throws (a cleanup failure must not block a session delete/truncate), and
// `rm(force:true)` no-ops on a missing path.
export async function removeSdkSession(sdkSessionId: string): Promise<void> {
  if (!sdkSessionId) return
  const projects = join(sdkStoreDir(), 'projects')
  let dirs: string[]
  try {
    dirs = await readdir(projects)
  } catch {
    return // no SDK store yet → nothing to remove
  }
  await Promise.all(
    dirs.flatMap((dir) =>
      [`${sdkSessionId}.jsonl`, sdkSessionId].map((name) =>
        rm(join(projects, dir, name), { recursive: true, force: true }).catch((err) => {
          log.warn('removeSdkSession: failed to remove artifact', {
            sdkSessionId,
            err: err instanceof Error ? err.message : String(err),
          })
        }),
      ),
    ),
  )
}
