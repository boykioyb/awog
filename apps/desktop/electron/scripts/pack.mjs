// Packaging orchestrator for the Electron app.
//
// 1. Build the Nuxt SPA (nuxt generate → ../ui/.output/public).
// 2. Build the engine bundle (../sidecar/dist: lib + flat node_modules + CLI).
// 3. Rebuild node-pty (native) for Electron's ABI inside the engine bundle.
// 4. Compile the Electron main/preload (tsc → dist).
// 5. electron-builder → release/ (dmg/nsis/AppImage/deb for the host OS).
//
// Pass extra electron-builder args through, e.g. `node scripts/pack.mjs --publish always`.

import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const electronDir = resolve(here, '..')
const repoRoot = resolve(electronDir, '..', '..', '..')
const passthrough = process.argv.slice(2)

const isWin = process.platform === 'win32'

function run(cmd, args, cwd) {
  console.error(`\n[pack] ${cmd} ${args.join(' ')}  (cwd: ${cwd})`)
  // nuxt generate can OOM the default heap on CI runners.
  const env = { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096' }
  const res = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: isWin, env })
  if (res.status !== 0) {
    console.error(`[pack] FAILED: ${cmd} ${args.join(' ')} (exit ${res.status})`)
    process.exit(res.status ?? 1)
  }
}

// 1. UI SPA
run('pnpm', ['--filter', 'awog-ui', 'generate'], repoRoot)
// 2. Engine bundle
run('pnpm', ['--filter', '@awog/sidecar', 'build'], repoRoot)
// 3. node-pty → Electron ABI (engine bundle lives at ../sidecar/dist)
run('pnpm', ['exec', 'electron-rebuild', '-f', '-w', 'node-pty', '--module-dir', '../sidecar/dist'], electronDir)
// 4. Electron main/preload
run('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json'], electronDir)
// 5. Package
run('pnpm', ['exec', 'electron-builder', ...passthrough], electronDir)

console.error('\n[pack] Done. Installers in apps/desktop/electron/release/')
