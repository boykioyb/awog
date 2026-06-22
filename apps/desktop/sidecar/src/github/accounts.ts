// Parse `gh auth status --json hosts` into the account list the UI picks from.
// NEVER pass -t/--show-token — the JSON intentionally carries NO token.
import { z } from 'zod'
import { runGhBase } from './runner.js'

export interface GhAccount {
  login: string
  active: boolean
  scopes: string
}

// gh emits hosts as a record keyed by hostname; each value is an array of
// per-account entries. Be lenient — gh adds fields across versions (state,
// tokenSource, gitProtocol, …); we pick only what we need and ignore the rest.
const HostEntry = z
  .object({
    login: z.string(),
    active: z.boolean().optional(),
    scopes: z.string().optional(),
  })
  .passthrough()

const Hosts = z.object({ hosts: z.record(z.array(HostEntry)) }).passthrough()

const GITHUB_HOST = 'github.com'

// Returns the accounts gh knows for github.com (login + active + scopes), no
// token. Empty list if gh has no github.com accounts.
export async function listGhAccounts(): Promise<GhAccount[]> {
  const stdout = await runGhBase(['auth', 'status', '--json', 'hosts'])
  const parsed = Hosts.parse(JSON.parse(stdout))
  const entries = parsed.hosts[GITHUB_HOST] ?? []
  return entries.map((e) => ({
    login: e.login,
    active: e.active === true,
    scopes: e.scopes ?? '',
  }))
}
