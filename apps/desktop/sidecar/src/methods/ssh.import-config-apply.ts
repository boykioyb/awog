// Apply an import selection from ~/.ssh/config (ADR 0063). Re-parses the config
// (the file stays the source of truth — we do NOT trust host details from the
// UI payload, only the chosen aliases) and creates a host per selected alias,
// plus a linked identity for any IdentityFile. Idempotent-ish: an alias whose
// name already exists as a host is skipped so re-import doesn't duplicate.

import { z } from 'zod'
import { homedir } from 'node:os'
import { register } from '../transport/rpc.js'
import { SshHostConfigSchema, SshIdentityConfigSchema } from '../ssh/schema.js'
import { listHosts, listIdentities, saveHost, saveIdentity } from '../ssh/store.js'
import { parseSshConfig } from '../ssh/ssh-config.js'

const Params = z.object({
  aliases: z.array(z.string().min(1).max(255)).min(1).max(500),
})

function slugifyId(s: string): string {
  const base = s
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
  // SSH_ID_RE requires a leading alnum.
  return /^[a-z0-9]/.test(base) ? base : `h-${base}`.slice(0, 120)
}

function expandHome(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/')) return `${homedir()}/${p.slice(2)}`
  return p
}

function uniqueId(seed: string, taken: Set<string>): string {
  let id = slugifyId(seed)
  let n = 2
  while (taken.has(id)) {
    id = `${slugifyId(seed)}-${n}`.slice(0, 120)
    n += 1
  }
  taken.add(id)
  return id
}

register('ssh.importConfigApply', async (raw) => {
  const params = Params.parse(raw)
  const selected = new Set(params.aliases)
  const candidates = (await parseSshConfig()).filter((c) => selected.has(c.alias))

  const existingHosts = await listHosts()
  const hostIds = new Set(existingHosts.map((h) => h.id))
  const existingNames = new Set(existingHosts.map((h) => h.name))
  const existingIdents = await listIdentities()
  const identIds = new Set(existingIdents.map((i) => i.id))
  const identByPath = new Map<string, string>()
  for (const i of existingIdents) if (i.keyPath) identByPath.set(i.keyPath, i.id)

  const now = new Date().toISOString()
  const importedIds: string[] = []
  let skipped = 0

  for (const c of candidates) {
    if (existingNames.has(c.alias)) {
      skipped += 1
      continue
    }

    let identityId: string | undefined
    if (c.identityFile) {
      const keyPath = expandHome(c.identityFile)
      const found = identByPath.get(keyPath)
      if (found) {
        identityId = found
      } else {
        const iid = uniqueId(`key-${c.alias}`, identIds)
        const identity = SshIdentityConfigSchema.parse({
          id: iid,
          name: `${c.alias} key`,
          keyPath,
          inlineStored: false,
          hasPassphrase: false,
          createdAt: now,
          updatedAt: now,
        })
        // eslint-disable-next-line no-await-in-loop
        await saveIdentity(identity)
        identByPath.set(keyPath, iid)
        identityId = iid
      }
    }

    const host = SshHostConfigSchema.parse({
      id: uniqueId(c.alias, hostIds),
      name: c.alias,
      host: c.host,
      port: c.port,
      user: c.user ?? (process.env.USER || process.env.USERNAME || 'user'),
      authMethod: identityId ? 'key' : 'agent',
      ...(identityId ? { identityId } : {}),
      createdAt: now,
      updatedAt: now,
    })
    existingNames.add(host.name)
    // eslint-disable-next-line no-await-in-loop
    await saveHost(host)
    importedIds.push(host.id)
  }

  return { imported: importedIds.length, skipped, ids: importedIds }
})
