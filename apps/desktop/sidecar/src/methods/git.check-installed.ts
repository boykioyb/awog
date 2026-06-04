// Bootstrap method. Does NOT need workspaceRoot — invoked at app boot to
// decide whether to render the "install git" banner.
import { register } from '../transport/rpc.js'
import { runGit } from '../git/runner.js'

const REQUIRED = '2.20'

interface Result {
  installed: boolean
  version: string
  supported: boolean
  required: string
}

function parseSemver(out: string): string {
  // "git version 2.42.0" / "git version 2.39.3 (Apple Git-145)"
  const m = /git version (\d+\.\d+(?:\.\d+)?)/.exec(out)
  return m?.[1] ?? ''
}

function meets(version: string, min: string): boolean {
  const a = version.split('.').map((p) => Number.parseInt(p, 10) || 0)
  const b = min.split('.').map((p) => Number.parseInt(p, 10) || 0)
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    if (av > bv) return true
    if (av < bv) return false
  }
  return true
}

register('git.checkInstalled', async (): Promise<Result> => {
  try {
    const r = await runGit('', ['--version'], {
      noWorkspaceCheck: true,
      timeoutMs: 3_000,
    })
    const version = parseSemver(r.stdout)
    return {
      installed: version.length > 0,
      version,
      supported: version.length > 0 && meets(version, REQUIRED),
      required: REQUIRED,
    }
  } catch {
    return { installed: false, version: '', supported: false, required: REQUIRED }
  }
})
