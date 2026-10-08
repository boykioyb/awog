// `awog login` — OAuth (Anthropic subscription, paste-code) or API key.
// Prints the authorize URL, reads the pasted code, hands both to the engine —
// the same contract the desktop sign-in dialog uses.

import type { Engine } from '../transport.js'
import { askLine, isTTY, note } from '../tty.js'

type Provider = 'anthropic' | 'openai' | 'google'

export interface LoginOptions {
  provider?: Provider | undefined
  apiKey?: string | undefined
  label?: string | undefined
  baseURL?: string | undefined
}

export async function cmdLogin(engine: Engine, o: LoginOptions): Promise<void> {
  const provider: Provider = o.provider ?? 'anthropic'

  // API-key path — works with or without a TTY.
  if (o.apiKey) {
    await engine.rpc('accounts.addApiKey', {
      provider,
      apiKey: o.apiKey,
      ...(o.label ? { label: o.label } : {}),
      ...(o.baseURL ? { baseURL: o.baseURL } : {}),
    })
    note(`· ${provider} API key saved`)
    return
  }

  if (!isTTY()) {
    note('login needs a TTY for OAuth paste-code — or use `awog login --api-key <key>`')
    process.exitCode = 1
    return
  }

  if (provider !== 'anthropic') {
    note(`OAuth only supported for anthropic — use \`awog login --provider ${provider} --api-key <key>\``)
    process.exitCode = 1
    return
  }

  const { authUrl, state } = await engine.rpc<{ authUrl: string; state: string }>(
    'auth.startOAuth',
    { provider },
  )
  note('· open this URL in your browser, then paste the code below:\n')
  process.stderr.write(`${authUrl}\n\n`)
  const code = await askLine('code: ')
  const trimmed = code.trim()
  if (!trimmed) {
    note('empty code — aborted')
    process.exitCode = 1
    return
  }
  await engine.rpc('auth.completeOAuth', {
    state,
    code: trimmed,
    ...(o.label ? { label: o.label } : {}),
  })
  note('· signed in')
}
