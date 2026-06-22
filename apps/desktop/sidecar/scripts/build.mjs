// Build pipeline for the AWOG sidecar engine (Electron packaging).
//
// Produces a SELF-CONTAINED engine bundle that electron-builder ships as an
// extraResource (`<resources>/sidecar/`). The engine runs as a child of the
// Electron binary in pure-Node mode (ELECTRON_RUN_AS_NODE=1) — Electron carries
// its own Node, so we no longer bundle a Node runtime or a launcher script.
//
// Layout produced under apps/desktop/sidecar/dist/:
//   lib/            # tsc output (entry: lib/src/index.js)
//   node_modules/   # FLAT production deps (Pi runtime @earendil-works/pi-ai +
//                   # pi-agent-core — pure JS, 0 native deps; node-pty + keyring)
//   package.json    # so Node resolves deps + honours "type": "module"
//
// node_modules comes from `pnpm deploy --config.node-linker=hoisted`, which
// builds a flat, self-contained tree from the store (no re-download). We
// assemble lib/ (from tsc) on top. The Pi runtime ships entirely as JS in
// node_modules — there is no CLI binary to bundle (ADR 0029).
//
// node-pty (native) must still be rebuilt against Electron's ABI after packaging
// — see `pnpm --filter @awog/desktop rebuild` (engine.ts loads it lazily, so the
// app boots either way; only the terminal panel needs the rebuild).

import { mkdir, rm, cp, writeFile, readdir, stat, chmod } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import process from 'node:process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(__dirname, '..')
const repoRoot = resolve(pkgRoot, '..', '..', '..')
const outDir = join(pkgRoot, 'dist')

function compileTs() {
  console.error('[build] tsc -p tsconfig.build.json')
  // `shell: true` so Windows resolves `pnpm` → `pnpm.cmd` via PATHEXT.
  execFileSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.build.json'], {
    cwd: pkgRoot,
    stdio: 'inherit',
    shell: true,
  })
}

// `pnpm deploy` builds a self-contained, flat production node_modules from the
// store. We only keep its node_modules (the deploy also copies source we don't
// need); lib/ is overlaid from the tsc output.
async function stageProductionDeps() {
  const deployDir = join(outDir, '_deploy')
  await rm(deployDir, { recursive: true, force: true })
  console.error('[build] pnpm deploy (flat, prod) → node_modules')
  execFileSync(
    'pnpm',
    [
      '--filter',
      '@awog/sidecar',
      '--legacy',
      '--config.node-linker=hoisted',
      'deploy',
      '--prod',
      deployDir,
    ],
    { cwd: repoRoot, stdio: 'inherit', shell: true },
  )
  const src = join(deployDir, 'node_modules')
  if (!existsSync(src)) throw new Error(`pnpm deploy produced no node_modules at ${src}`)
  await cp(src, join(outDir, 'node_modules'), { recursive: true, verbatimSymlinks: false })
  await rm(deployDir, { recursive: true, force: true })
}

// Trim dead weight from the staged node_modules:
//  - *.pdb: Windows debug symbols (node-pty ships ~64MB of them) — never used
//    at runtime on any OS.
//  - node-pty/prebuilds for platforms other than the build host — each per-OS
//    bundle (matrix CI) only needs its own platform's prebuild.
async function pruneBundle() {
  const nmDir = join(outDir, 'node_modules')
  let pdbBytes = 0
  let pdbCount = 0
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true })
    await Promise.all(
      entries.map(async (e) => {
        const p = join(dir, e.name)
        if (e.isDirectory()) return walk(p)
        if (e.name.endsWith('.pdb')) {
          pdbBytes += (await stat(p)).size
          pdbCount += 1
          await rm(p, { force: true })
        }
        return undefined
      }),
    )
  }
  await walk(nmDir)

  // Keep only the host platform's node-pty prebuild dir.
  const prebuilds = join(nmDir, 'node-pty', 'prebuilds')
  if (existsSync(prebuilds)) {
    const keep = `${process.platform}-${process.arch}`
    const dirs = await readdir(prebuilds)
    await Promise.all(
      dirs.filter((d) => d !== keep).map((d) => rm(join(prebuilds, d), { recursive: true, force: true })),
    )
    console.error(`[build] node-pty prebuilds: kept ${keep}, dropped ${dirs.length - 1} others`)

    // node-pty's published prebuild ships `spawn-helper` WITHOUT the executable
    // bit (and pnpm's content-addressable store does not restore it on deploy).
    // The deployed bundle has only `prebuilds/` — no locally-rebuilt
    // `build/Release/` — so node-pty loads the prebuild's helper and `pty.fork`
    // fails at runtime with `posix_spawnp failed` (surfaced to the UI as a
    // generic "Internal error" when opening a terminal). Restore +x here so the
    // shipped bundle can spawn shells on Unix.
    if (process.platform !== 'win32') {
      const helper = join(prebuilds, keep, 'spawn-helper')
      if (existsSync(helper)) {
        await chmod(helper, 0o755)
        console.error('[build] node-pty: chmod +x prebuilds spawn-helper')
      }
    }
  }

  // Drop node_modules/.bin — package-executable symlinks the engine never uses
  // at runtime (it imports modules + spawns the platform CLI binary directly).
  // They are the only symlinks in the bundle; removing them avoids broken-symlink
  // errors (e.g. `xattr -dr com.apple.quarantine` on the unsigned mac app:
  // "No such file: .../node_modules/.bin/node-which") and symlink issues on Windows.
  await rm(join(nmDir, '.bin'), { recursive: true, force: true })

  console.error(`[build] pruned ${pdbCount} .pdb files (${(pdbBytes / 1048576).toFixed(0)} MB) + .bin symlinks`)
}

async function writeStagePackageJson() {
  // Minimal package.json: keep name/type/deps so Node resolves modules + treats
  // lib/*.js as ESM. Drop scripts/devDeps (not needed in the shipped bundle).
  const pkg = JSON.parse(
    execFileSync('node', ['-p', 'JSON.stringify(require("./package.json"))'], {
      cwd: pkgRoot,
    }).toString(),
  )
  const out = {
    name: pkg.name,
    private: true,
    version: pkg.version,
    type: pkg.type,
    engines: pkg.engines,
    dependencies: pkg.dependencies,
  }
  await writeFile(join(outDir, 'package.json'), `${JSON.stringify(out, null, 2)}\n`)
}

async function main() {
  if (existsSync(outDir)) await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })

  compileTs()
  await stageProductionDeps()
  await pruneBundle()
  await writeStagePackageJson()

  console.error('[build] Done. Engine bundle ready at apps/desktop/sidecar/dist/')
}

main().catch((err) => {
  console.error('[build] Fatal:', err instanceof Error ? err.stack : err)
  process.exit(1)
})
