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

// Launcher resolution:
//   BASE = dir holding lib/ + node_modules/ — siblings next to the launcher
//   (release: AWOG_SIDECAR_DIST → bundled `sidecar-runtime/` resources).
//   NODE = the BUNDLED Node at BASE/node-runtime/ (zero-dependency); falls back
//   to a system `node` only if the bundle is missing (e.g. a partial dev build).
// Tauri's externalBin copies ONLY the launcher to target/debug/ at dev time, so
// the siblings come from $AWOG_SIDECAR_DIST (set by Rust in debug builds).
const POSIX_LAUNCHER = `#!/bin/sh
DIR="$(cd "$(dirname "$0")" && pwd)"
BASE=""
if [ -d "$DIR/lib" ] && [ -d "$DIR/node_modules" ]; then
  BASE="$DIR"
elif [ -n "$AWOG_SIDECAR_DIST" ] && [ -d "$AWOG_SIDECAR_DIST/lib" ]; then
  BASE="$AWOG_SIDECAR_DIST"
fi
if [ -z "$BASE" ]; then
  echo "awog-sidecar: lib/ + node_modules/ not found and AWOG_SIDECAR_DIST unset. Run pnpm -F @awog/sidecar build." >&2
  exit 1
fi
NODE="node"
if [ -f "$BASE/node-runtime/node" ]; then
  NODE="$BASE/node-runtime/node"
  chmod +x "$NODE" 2>/dev/null || true
fi
exec "$NODE" "$BASE/lib/src/index.js" "$@"
`

const WIN_LAUNCHER = [
  '@echo off',
  'setlocal',
  'set "DIR=%~dp0"',
  'set "BASE="',
  'if exist "%DIR%lib" if exist "%DIR%node_modules" set "BASE=%DIR%"',
  'if not defined BASE if defined AWOG_SIDECAR_DIST if exist "%AWOG_SIDECAR_DIST%\\lib" set "BASE=%AWOG_SIDECAR_DIST%\\"',
  'if not defined BASE (',
  '  echo awog-sidecar: lib not found and AWOG_SIDECAR_DIST unset. 1>&2',
  '  exit /b 1',
  ')',
  'set "NODE=node"',
  'if exist "%BASE%node-runtime\\node.exe" set "NODE=%BASE%node-runtime\\node.exe"',
  '"%NODE%" "%BASE%lib\\src\\index.js" %*',
  'exit /b %ERRORLEVEL%',
  '',
].join('\r\n')

async function compileTs() {
  console.error('[build] tsc -p tsconfig.build.json')
  // `shell: true` so Windows resolves `pnpm` → `pnpm.cmd` via PATHEXT;
  // execFileSync alone throws `spawnSync pnpm ENOENT` on win32.
  execFileSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.build.json'], {
    cwd: pkgRoot,
    stdio: 'inherit',
    shell: true,
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

async function copyNodeRuntime() {
  // Bundle a SELF-CONTAINED Node so the packaged app needs NO system Node
  // (zero-dependency). We download the official nodejs.org build for the host
  // triple rather than copying process.execPath, because some installs
  // (Homebrew) ship a Node that dynamically links @rpath/libnode.dylib and is
  // NOT relocatable. Pinning to process.version guarantees the dist exists (the
  // build is running that exact release).
  const { platform, arch } = process
  const isWindows = platform === 'win32'
  const nodeName = isWindows ? 'node.exe' : 'node'
  const runtimeDir = join(outDir, 'node-runtime')
  await mkdir(runtimeDir, { recursive: true })

  const plat = platform === 'darwin' ? 'darwin' : platform === 'linux' ? 'linux' : 'win'
  const a = arch === 'arm64' ? 'arm64' : 'x64'
  const ext = isWindows ? 'zip' : 'tar.gz'
  const base = `node-${process.version}-${plat}-${a}`
  const url = `https://nodejs.org/dist/${process.version}/${base}.${ext}`

  const tmpArchive = join(outDir, `_node.${ext}`)
  const extractDir = join(outDir, '_node-extract')
  await rm(extractDir, { recursive: true, force: true })
  await mkdir(extractDir, { recursive: true })

  console.error(`[build] downloading self-contained Node: ${url}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`failed to download Node (${res.status}): ${url}`)
  await writeFile(tmpArchive, Buffer.from(await res.arrayBuffer()))

  // `tar` ships on macOS, Linux and Windows 10+ (bsdtar) and handles .tar.gz + .zip.
  execFileSync('tar', ['-xf', tmpArchive, '-C', extractDir], { stdio: 'inherit' })

  const srcNode = isWindows
    ? join(extractDir, base, nodeName)
    : join(extractDir, base, 'bin', nodeName)
  const dst = join(runtimeDir, nodeName)
  await cp(srcNode, dst, { dereference: true })
  if (!isWindows) await chmod(dst, 0o755)

  await rm(tmpArchive, { force: true })
  await rm(extractDir, { recursive: true, force: true })
  console.error(`[build] Bundled self-contained Node ${process.version} -> ${dst}`)
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
  // Mirror the bundled Node runtime too so dev (externalBin siblings) + the
  // tauri resource source stay in sync.
  const nrDst = join(binDir, 'node-runtime')
  if (existsSync(nrDst)) await rm(nrDst, { recursive: true, force: true })
  await cp(join(outDir, 'node-runtime'), nrDst, { recursive: true })
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
  await copyNodeRuntime()
  await writeLauncher(outFile, isWindows)
  console.error(`[build] Launcher: ${outFile}`)

  await mirrorIntoTauri(outFile, triple, isWindows)

  console.error('[build] Done.')
}

main().catch((err) => {
  console.error('[build] Fatal:', err instanceof Error ? err.stack : err)
  process.exit(1)
})
