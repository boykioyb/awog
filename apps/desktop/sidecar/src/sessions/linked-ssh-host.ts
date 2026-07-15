// Linked-SSH-host context (ADR 0064, P1). When a session was opened to work with
// an SSH host (Session.aboutSshHostId), the runtime injects a <linked_ssh_host>
// block into the turn's systemPromptAppend so the agent knows which machine the
// user is asking about — its connection target, folder, tags, and auth method.
// NO secret ever reaches this block (passwords / passphrases / key material live
// only in the keychain). Built fresh each turn; best-effort — a missing/deleted
// host yields no block. This phase is context-only: the agent gets NO SSH exec /
// SFTP tools yet (that is P2).
import { loadHost } from '../ssh/store.js'
import type { SshHostConfig } from '../ssh/schema.js'

// Best-effort: return the <linked_ssh_host> block for a host id, or undefined when
// the host is missing/deleted (treated as no context — the session still works as
// a normal chat). Never throws.
export async function buildLinkedSshHostBlock(hostId: string): Promise<string | undefined> {
  let host: SshHostConfig | null
  try {
    host = await loadHost(hostId)
  } catch {
    return undefined
  }
  if (!host) return undefined

  const target = `${host.user}@${host.host}:${host.port}`
  const lines: string[] = [`SSH host "${host.name}" — ${target}.`, `Auth method: ${host.authMethod}.`]
  if (host.folder?.trim()) lines.push(`Folder: ${host.folder.trim()}.`)
  if (host.tags?.length) lines.push(`Tags: ${host.tags.join(', ')}.`)

  return `<linked_ssh_host>
This session was opened to work with the SSH host below. Use it as the machine the user is asking about. You do NOT have SSH tools in this session yet — describe or plan commands rather than claiming to run them.
${lines.join('\n')}
</linked_ssh_host>`
}
