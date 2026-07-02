// Resolve the SDK's native `claude` binary for PACKAGED builds (ADR 0058 P3).
//
// The Claude Agent SDK ships its agent CLI as a self-contained per-platform native
// binary (optional dep `@anthropic-ai/claude-agent-sdk-{platform}-{arch}`, ~227MB).
// AWOG's build pipeline already bundles it: `pnpm deploy --prod` includes optional
// deps, build.mjs copies the deploy's node_modules into sidecar/dist (dereferencing
// symlinks → real files), and electron-builder ships sidecar/dist → resources/sidecar
// verbatim — so the binary is present at runtime with NO extra build step.
//
// The SDK auto-discovers the binary from node_modules, but that resolution is not
// guaranteed in the FLATTENED packaged layout. So we resolve it explicitly here and
// pass it as `options.pathToClaudeCodeExecutable`. In dev (the binary isn't at this
// path — the sidecar runs from tsc output with no deployed node_modules) we return
// undefined and let the SDK auto-discover from the pnpm store as usual.

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Per-platform optional-dep package that carries the native binary. Matches the
// SDK's own naming (`claude-agent-sdk-darwin-arm64`, `-win32-x64`, `-linux-x64`…).
function platformPkg(): string | undefined {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  if (process.platform === 'darwin') return `claude-agent-sdk-darwin-${arch}`
  if (process.platform === 'win32') return `claude-agent-sdk-win32-${arch}`
  if (process.platform === 'linux') return `claude-agent-sdk-linux-${arch}`
  return undefined
}

// Cached: the layout is fixed for the process lifetime.
let cached: string | null | undefined

export function resolveClaudeBinary(): string | undefined {
  if (cached !== undefined) return cached ?? undefined
  const pkg = platformPkg()
  if (!pkg) {
    cached = null
    return undefined
  }
  const bin = process.platform === 'win32' ? 'claude.exe' : 'claude'
  // This file at runtime: <sidecarRoot>/lib/src/runtime/claude-sdk/binary.js →
  // 4 levels up (claude-sdk → runtime → src → lib) reaches <sidecarRoot>, whose
  // sibling node_modules holds the flat deployed deps.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
  const candidate = join(root, 'node_modules', '@anthropic-ai', pkg, bin)
  cached = existsSync(candidate) ? candidate : null
  return cached ?? undefined
}
