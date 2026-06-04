// Build pipeline for the AWOG sidecar engine (Electron packaging).
//
// Produces a SELF-CONTAINED engine bundle that electron-builder ships as an
// extraResource (`<resources>/sidecar/`). The engine runs as a child of the
// Electron binary in pure-Node mode (ELECTRON_RUN_AS_NODE=1) — Electron carries
// its own Node, so we no longer bundle a Node runtime or a launcher script.
//
// Layout produced under apps/desktop/sidecar/dist/:
//   lib/            # tsc output (entry: lib/src/index.js)
//   node_modules/   # FLAT production deps incl. @anthropic-ai/claude-agent-sdk
//                   # + its platform CLI binary (@anthropic-ai/claude-agent-sdk-<os>-<arch>)
//   package.json    # so Node resolves deps + honours "type": "module"
//
// node_modules comes from `pnpm deploy --config.node-linker=hoisted`, which
// builds a flat, self-contained tree from the store (no re-download) including
// the host platform's optional CLI binary. We assemble lib/ (from tsc) on top.
// Per-OS CI builds give each platform its own CLI binary (matrix).
//
// node-pty (native) must still be rebuilt against Electron's ABI after packaging
// — see `pnpm --filter @awog/desktop rebuild` (engine.ts loads it lazily, so the
// app boots either way; only the terminal panel needs the rebuild).

import { mkdir, rm, cp, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import process from 'node:process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(__dirname, '..')
const repoRoot = resolve(pkgRoot, '..', '..', '..')
const outDir = join(pkgRoot, 'dist')

// Platform triple → name of the SDK's optional CLI package, for verification.
function cliPackageForHost() {
  const { platform, arch } = process
  const os = platform === 'darwin' ? 'darwin' : platform === 'linux' ? 'linux' : 'win32'
  const a = arch === 'arm64' ? 'arm64' : 'x64'
  return `@anthropic-ai/claude-agent-sdk-${os}-${a}`
}

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

function verifyCliBinary() {
  const pkg = cliPackageForHost()
  const binDir = join(outDir, 'node_modules', ...pkg.split('/'))
  if (!existsSync(binDir)) {
    throw new Error(
      `[build] platform CLI package missing: ${pkg}. The packaged app will fail at runtime ` +
        `("native CLI binary not found"). Ensure pnpm installed optional deps (no --omit=optional).`,
    )
  }
  console.error(`[build] verified platform CLI package present: ${pkg}`)
}

async function main() {
  if (existsSync(outDir)) await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })

  compileTs()
  await stageProductionDeps()
  await writeStagePackageJson()
  verifyCliBinary()

  console.error('[build] Done. Engine bundle ready at apps/desktop/sidecar/dist/')
}

main().catch((err) => {
  console.error('[build] Fatal:', err instanceof Error ? err.stack : err)
  process.exit(1)
})
