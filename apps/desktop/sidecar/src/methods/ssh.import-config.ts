// Dry-run: parse the user's ~/.ssh/config and return importable host candidates
// (ADR 0063). Read-only — never writes to ~/.ssh. The UI shows these in a
// picker; the user's selection is applied via ssh.importConfigApply.

import { register } from '../transport/rpc.js'
import { parseSshConfig } from '../ssh/ssh-config.js'

register('ssh.importConfig', async () => {
  const candidates = await parseSshConfig()
  return { candidates }
})
