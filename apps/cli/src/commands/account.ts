// `awog account ls` + `awog account use <id>` — the active-account switch the
// app's Accounts page exposes, mirrored for the terminal. setActive is global
// (credentials.json) — affects new turns in the app too.
import type { Engine } from '../transport.js'
import { note, sgr, table } from '../tty.js'

type Provider = 'anthropic' | 'openai' | 'google'

interface SafeAccount {
  id: string
  label?: string
  authMode?: string
}

interface AccountsResult {
  providers?: Record<string, { activeAccountId?: string | null; accounts?: SafeAccount[] }>
}

const PROVIDERS: readonly Provider[] = ['anthropic', 'openai', 'google']

export async function cmdAccountLs(engine: Engine, json: boolean): Promise<void> {
  const res = await engine.rpc<AccountsResult>('accounts.list')
  if (json) {
    process.stdout.write(`${JSON.stringify(res.providers ?? {}, null, 2)}\n`)
    return
  }
  for (const provider of PROVIDERS) {
    const bucket = res.providers?.[provider]
    if (!bucket?.accounts?.length) continue
    process.stdout.write(`${sgr.accent(provider)}:\n`)
    const rows = bucket.accounts.map((a) => [
      a.id === bucket.activeAccountId ? sgr.ok('●') : '',
      a.id,
      a.label ?? '',
      a.authMode ?? '',
    ])
    process.stdout.write(`${table(['', 'ID', 'LABEL', 'AUTH'], rows, [1, 20, 'flex', 10])}\n`)
  }
}

export async function cmdAccountUse(
  engine: Engine,
  accountId: string,
  provider?: string,
): Promise<void> {
  // Provider optional: find which bucket holds the id.
  const res = await engine.rpc<AccountsResult>('accounts.list')
  const resolved =
    provider ??
    PROVIDERS.find((p) =>
      res.providers?.[p]?.accounts?.some((a) => a.id === accountId),
    )
  if (!resolved) throw new Error(`account not found in any provider: ${accountId}`)
  await engine.rpc('accounts.setActive', { provider: resolved, accountId })
  note(`${sgr.accent('·')} active ${sgr.bold(resolved)} account → ${sgr.bold(accountId)}`)
}
