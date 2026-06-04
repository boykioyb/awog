// Build pipeline for the AWOG sidecar.
//
// Strategy: tsc → dist/ + ship node_modules/ alongside. We can no longer ncc-bundle
// because @anthropic-ai/claude-agent-sdk bundles a platform-specific Claude CLI
// binary (the SDK spawns it under the hood) plus native optional deps. The
// launcher is a tiny shell/cmd script Tauri's `externalBin` references.
//
// Layout produced under apps/desktop/sidecar/dist/:
//   awog-sidecar-<triple>           # launcher (POSIX shell) or awog-sidecar-<triple>.exe.cmd (Windows)
//   lib/                            # tsc output (index.js entry)
//   node_modules/                   # production deps incl. SDK + its bundled CLI
//
// The launcher resolves its own directory and execs `node lib/src/index.js`,
// preserving stdin/stdout/stderr exactly as the JSON-RPC transport expects.

import { mkdir, writeFile, chmod, rm, cp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import process from 'node:process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(__dirname, '..')
const outDir = join(pkgRoot, 'dist')

function targetTriple() {
  const { platform, arch } = process
  if (platform === 'darwin' && arch === 'arm64') return 'aarch64-apple-darwin'
  if (platform === 'darwin' && arch === 'x64') return 'x86_64-apple-darwin'
  if (platform === 'linux' && arch === 'x64') return 'x86_64-unknown-linux-gnu'
  if (platform === 'win32' && arch === 'x64') return 'x86_64-pc-windows-msvc'
  throw new Error(`Unsupported build target: ${platform}/${arch}`)
}

// Launcher: prefer siblings (lib/, node_modules/) next to the binary. Tauri's
// externalBin copies ONLY the launcher to target/debug/ at dev time, so siblings
// are absent there — fall back to $AWOG_SIDECAR_DIST (set by Rust in debug builds).
const POSIX_LAUNCHER = `#!/bin/sh
DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -d "$DIR/lib" ] && [ -d "$DIR/node_modules" ]; then
  exec node "$DIR/lib/src/index.js" "$@"
fi
if [ -n "$AWOG_SIDECAR_DIST" ] && [ -d "$AWOG_SIDECAR_DIST/lib" ]; then
  exec node "$AWOG_SIDECAR_DIST/lib/src/index.js" "$@"
fi
echo "awog-sidecar: lib/ + node_modules/ not found next to launcher and AWOG_SIDECAR_DIST unset. Run \\\`pnpm -F @awog/sidecar build\\\`." >&2
exit 1
`

const WIN_LAUNCHER = [
  '@echo off',
  'set DIR=%~dp0',
  'if exist "%DIR%lib" if exist "%DIR%node_modules" (',
  '  node "%DIR%lib\\src\\index.js" %*',
  '  exit /b %ERRORLEVEL%',
  ')',
  'if defined AWOG_SIDECAR_DIST if exist "%AWOG_SIDECAR_DIST%\\lib" (',
  '  node "%AWOG_SIDECAR_DIST%\\lib\\src\\index.js" %*',
  '  exit /b %ERRORLEVEL%',
  ')',
  'echo awog-sidecar: lib/ + node_modules/ not found and AWOG_SIDECAR_DIST unset. 1>&2',
  'exit /b 1',
  '',
].join('\r\n')

async function compileTs() {
  console.error('[build] tsc -p tsconfig.build.json')
  execFileSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.build.json'], {
    cwd: pkgRoot,
    stdio: 'inherit',
  })
}

async function copyProductionDeps() {
  // Copy the entire node_modules tree from the sidecar package. pnpm uses
  // symlinks into a flat .pnpm store, so we follow links via cp -L semantics.
  const src = join(pkgRoot, 'node_modules')
  const dst = join(outDir, 'node_modules')
  if (!existsSync(src)) {
    throw new Error(`node_modules not found at ${src}; run pnpm install first`)
  }
  console.error(`[build] copy ${src} → ${dst}`)
  await cp(src, dst, { recursive: true, dereference: true, verbatimSymlinks: false })
}

async function writeLauncher(outFile, isWindows) {
  await writeFile(outFile, isWindows ? WIN_LAUNCHER : POSIX_LAUNCHER, {
    encoding: 'utf8',
  })
  if (!isWindows) await chmod(outFile, 0o755)
}

async function mirrorIntoTauri(srcFile, triple, isWindows) {
  // Tauri's `externalBin` resolves a sibling file per target triple. The
  // launcher is the entry; the lib/ + node_modules/ siblings are picked up
  // implicitly by Node (which the launcher invokes).
  const binDir = resolve(pkgRoot, '..', 'src-tauri', 'binaries')
  await mkdir(binDir, { recursive: true })
  const suffix = isWindows ? '.exe' : ''
  const tauriBin = join(binDir, `awog-sidecar-${triple}${suffix}`)
  await cp(srcFile, tauriBin)
  if (!isWindows) await chmod(tauriBin, 0o755)
  // Mirror lib/ + node_modules/ alongside so the launcher's relative paths resolve.
  const libDst = join(binDir, 'lib')
  const nmDst = join(binDir, 'node_modules')
  if (existsSync(libDst)) await rm(libDst, { recursive: true, force: true })
  if (existsSync(nmDst)) await rm(nmDst, { recursive: true, force: true })
  await cp(join(outDir, 'lib'), libDst, { recursive: true })
  await cp(join(outDir, 'node_modules'), nmDst, { recursive: true, dereference: true })
  console.error(`[build] Mirrored launcher + assets → ${binDir}`)
}

async function main() {
  const triple = targetTriple()
  const isWindows = process.platform === 'win32'
  const suffix = isWindows ? '.exe' : ''
  const outFile = join(outDir, `awog-sidecar-${triple}${suffix}`)

  if (existsSync(outDir)) await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })

  await compileTs()
  await copyProductionDeps()
  await writeLauncher(outFile, isWindows)
  console.error(`[build] Launcher: ${outFile}`)

  await mirrorIntoTauri(outFile, triple, isWindows)

  console.error('[build] Done.')
}

main().catch((err) => {
  console.error('[build] Fatal:', err instanceof Error ? err.stack : err)
  process.exit(1)
})
