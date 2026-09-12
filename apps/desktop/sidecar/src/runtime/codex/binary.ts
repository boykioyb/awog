// Resolve the `codex` native binary (ADR 0087).
//
// `@openai/codex` ships the same way the Claude Agent SDK does: a tiny JS shim
// plus a per-platform optional dependency carrying the real executable
// (`@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex`, ~285MB).
// AWOG's build pipeline already handles that shape — `pnpm deploy --prod`
// includes optional deps, build.mjs copies the deploy's node_modules into
// sidecar/dist, and electron-builder ships sidecar/dist verbatim — so the binary
// is present at runtime with no extra build step.
//
// We spawn the NATIVE binary, never `bin/codex.js`: the shim only re-spawns the
// same executable through Node, and build.mjs drops `node_modules/.bin`, so the
// shim's own launcher path is not something to rely on.

import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { delimiter, dirname, join } from 'node:path'

// Target triple + platform package, mirroring @openai/codex's own bin/codex.js.
// Kept as one table so a new platform is one row, not three switches.
const TARGETS: Record<string, { triple: string; pkg: string } | undefined> = {
  'darwin-arm64': { triple: 'aarch64-apple-darwin', pkg: 'codex-darwin-arm64' },
  'darwin-x64': { triple: 'x86_64-apple-darwin', pkg: 'codex-darwin-x64' },
  'linux-arm64': { triple: 'aarch64-unknown-linux-musl', pkg: 'codex-linux-arm64' },
  'linux-x64': { triple: 'x86_64-unknown-linux-musl', pkg: 'codex-linux-x64' },
  'win32-arm64': { triple: 'aarch64-pc-windows-msvc', pkg: 'codex-win32-arm64' },
  'win32-x64': { triple: 'x86_64-pc-windows-msvc', pkg: 'codex-win32-x64' },
}

function exeName(): string {
  return process.platform === 'win32' ? 'codex.exe' : 'codex'
}

// The flattened bundle root: this file at runtime is
// <sidecarRoot>/lib/src/runtime/codex/binary.js, so four levels up is
// <sidecarRoot>, whose sibling node_modules holds the deployed deps.
function bundledCandidate(): string | undefined {
  const target = TARGETS[`${process.platform}-${process.arch}`]
  if (!target) return undefined
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
  return join(
    root,
    'node_modules',
    '@openai',
    target.pkg,
    'vendor',
    target.triple,
    'bin',
    exeName(),
  )
}

// Dev (pnpm's symlinked store): the platform package is NOT a sibling of
// `@openai/codex` in any directory we could guess — pnpm links it inside that
// package's own node_modules. So resolve it the way the package's own launcher
// does: ask Node, starting from `@openai/codex`, which is the one package the
// sidecar declares a dependency on.
function resolvedCandidate(): string | undefined {
  const target = TARGETS[`${process.platform}-${process.arch}`]
  if (!target) return undefined
  try {
    const here = createRequire(import.meta.url)
    const codexPkg = here.resolve('@openai/codex/package.json')
    const fromCodex = createRequire(codexPkg)
    const platformPkg = fromCodex.resolve(`@openai/${target.pkg}/package.json`)
    const candidate = join(dirname(platformPkg), 'vendor', target.triple, 'bin', exeName())
    return existsSync(candidate) ? candidate : undefined
  } catch {
    // The optional dep is absent (a platform it does not publish for, or an
    // install that skipped optionals). Fall through to the other candidates.
    return undefined
  }
}

// Last resort: a `codex` the user installed themselves. Deliberately last — a
// globally installed CLI may be a different version than the protocol subset in
// protocol.ts was generated against, and `app-server` is an experimental
// surface. It exists so a dev checkout without the optional dep still runs.
function pathCandidate(): string | undefined {
  const raw = process.env.PATH
  if (!raw) return undefined
  for (const dir of raw.split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, exeName())
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

let cached: string | null | undefined

export class CodexBinaryMissingError extends Error {
  constructor() {
    super(
      `CODEX_UNAVAILABLE: no codex binary for ${process.platform}-${process.arch}. ` +
        'Reinstall the app, or install the CLI (`npm i -g @openai/codex`) and set AWOG_CODEX_BIN.',
    )
    this.name = 'CodexBinaryMissingError'
  }
}

// Resolved once — the layout is fixed for the process lifetime. Throws rather
// than returning undefined: unlike the Claude SDK (which can auto-discover its
// own binary when ours is absent), nothing downstream can proceed without a path.
export function resolveCodexBinary(): string {
  if (cached === undefined) {
    const override = process.env.AWOG_CODEX_BIN?.trim()
    cached =
      (override && existsSync(override) ? override : undefined) ??
      resolvedCandidate() ??
      (() => {
        const bundled = bundledCandidate()
        return bundled && existsSync(bundled) ? bundled : undefined
      })() ??
      pathCandidate() ??
      null
  }
  if (!cached) throw new CodexBinaryMissingError()
  return cached
}

// Test seam: binary resolution is cached for the process, and the tests need to
// exercise more than one layout.
export function resetCodexBinaryCache(): void {
  cached = undefined
}
