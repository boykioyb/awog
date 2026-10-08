// `awog models ls [--provider p]` — the model catalog the picker shows in the
// app (Pi catalog + AWOG extras; `live` stays off: it needs the keychain read
// the socket shouldn't depend on for a listing).

import type { Engine } from '../transport.js'
import { note, sgr, table } from '../tty.js'

type Provider = 'anthropic' | 'openai' | 'google'

interface ModelInfo {
  id: string
  name?: string
  source?: string
}

export async function cmdModelsLs(
  engine: Engine,
  provider: string | undefined,
  json: boolean,
): Promise<void> {
  const p: Provider = (provider as Provider) ?? 'anthropic'
  const res = await engine.rpc<{ models?: ModelInfo[] } | ModelInfo[]>('models.list', {
    provider: p,
  })
  const models = Array.isArray(res) ? res : (res.models ?? [])
  if (json) {
    process.stdout.write(`${JSON.stringify(models, null, 2)}\n`)
    return
  }
  const rows = models.map((m) => [m.id, m.name ?? '', m.source ?? ''])
  process.stdout.write(`${table(['ID', 'NAME', 'SOURCE'], rows, [36, 'flex', 10])}\n`)
  note(`${sgr.accent('·')} ${sgr.dim(`${models.length} model(s) for ${p}`)}`)
}
