// Packaging orchestrator for the Electron app.
//
// 1. Build the Nuxt SPA (nuxt generate → ../ui-next/.output/public).
// 2. Build the engine bundle (../sidecar/dist: lib + flat node_modules, pure JS).
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

function run(cmd, args, cwd, { optional = false } = {}) {
  console.error(`\n[pack] ${cmd} ${args.join(' ')}  (cwd: ${cwd})`)
  // nuxt generate can OOM the default heap on CI runners.
  const env = { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096' }
  const res = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: isWin, env })
  if (res.status !== 0) {
    if (optional) {
      console.error(`[pack] WARN: ${cmd} ${args.join(' ')} failed (exit ${res.status}) — continuing`)
      return
    }
    console.error(`[pack] FAILED: ${cmd} ${args.join(' ')} (exit ${res.status})`)
    process.exit(res.status ?? 1)
  }
}

// 1. UI SPA (ui-next is the shipping UI; the legacy ui stays in the workspace).
run('pnpm', ['--filter', 'awog-ui-next', 'generate'], repoRoot)
// 2. Engine bundle
run('pnpm', ['--filter', '@awog/sidecar', 'build'], repoRoot)
// 3. node-pty → Electron ABI (engine bundle lives at ../sidecar/dist).
//    Optional: engine.ts loads node-pty lazily with a graceful fallback, so a
//    rebuild failure only disables the terminal panel — it must not abort a release.
run('pnpm', ['exec', 'electron-rebuild', '-f', '-w', 'node-pty', '--module-dir', '../sidecar/dist'], electronDir, { optional: true })
// 4. Electron main/preload
run('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json'], electronDir)
// 4.5 Vendor a relocatable openvpn for this host (VPN Manager, ADR 0065). Optional:
//     a build machine without openvpn simply ships without it and the app falls back
//     to a system install. Skip with AWOG_SKIP_VENDOR_OPENVPN=1.
if (process.env.AWOG_SKIP_VENDOR_OPENVPN !== '1') {
  run('node', ['scripts/vendor-openvpn.mjs'], electronDir, { optional: true })
}
// 5. Package. Default to --publish never for local builds; CI passes
//    --publish always. (With a `publish` config present, electron-builder would
//    otherwise try to build update-info and crash when no repo/token is set.)
const hasPublish = passthrough.some((a) => a === '--publish' || a.startsWith('--publish='))
const ebArgs = hasPublish ? passthrough : ['--publish', 'never', ...passthrough]
run('pnpm', ['exec', 'electron-builder', ...ebArgs], electronDir)

console.error('\n[pack] Done. Installers in apps/desktop/electron/release/')
