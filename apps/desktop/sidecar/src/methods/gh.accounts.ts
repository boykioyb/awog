// gh.accounts → the github.com accounts gh knows (login + active + scopes).
// NO token: parses `gh auth status --json hosts`, which never includes a token
// (we do not pass -t/--show-token). Drives the app-level account picker.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { listGhAccounts, type GhAccount } from '../github/accounts.js'

const Params = z.object({}).strip()

interface Result {
  accounts: GhAccount[]
}

register('gh.accounts', async (raw): Promise<Result> => {
  Params.parse(raw ?? {})
  const accounts = await listGhAccounts()
  return { accounts }
})
