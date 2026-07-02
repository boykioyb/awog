// Management of the Claude Agent SDK's own session store (ADR 0058). AWOG points
// the SDK's CLAUDE_CONFIG_DIR at ~/.awog/claude-sdk (see run-stream.ts), so the
// SDK writes each Anthropic session's transcript + resume state + compaction
// under ~/.awog/claude-sdk/projects/<cwd-hash>/<sdkSessionId>.jsonl (plus a
// <sdkSessionId>/ subagents dir). This is a SECOND store alongside AWOG's own
// session JSONL (which stays the UI record); the two are kept in sync by the
// session lifecycle: history-rewriting ops (truncate/edit/regenerate) drop the
// sdkSessionId so the next turn seeds a fresh SDK session, and delete/truncate
// remove the now-orphan SDK artifacts via removeSdkSession below.

import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { awogHome } from '../../util/path.js'
import { log } from '../../util/logger.js'

// Root of AWOG's dedicated SDK config dir (= env.CLAUDE_CONFIG_DIR in run-stream).
export function sdkStoreDir(): string {
  return join(awogHome(), 'claude-sdk')
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
