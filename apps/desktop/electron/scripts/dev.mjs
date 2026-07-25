// Dev orchestrator for the Electron shell.
//
// 1. Compile the engine (tsc → sidecar/dist/lib) and the Electron main/preload.
// 2. Start the Nuxt dev server (ui-next on :3031 by default) + Electron together.
// Electron retries loading the dev URL until Nuxt is listening (see window.ts),
// so we don't need to poll the port here. Killing Electron tears everything down.
//
// The UI package + dev URL are env-overridable (AWOG_UI_PKG / AWOG_DEV_URL) for
// serving an alternate Nuxt workspace; keep the two in sync (paths.ts).

import { spawn } from 'node:child_process'
import { userInfo } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const electronDir = resolve(here, '..')
const repoRoot = resolve(electronDir, '..', '..', '..')

function run(cmd, args, opts = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts })
    child.on('exit', (code) => (code === 0 ? resolveRun() : reject(new Error(`${cmd} exited ${code}`))))
    child.on('error', reject)
  })
}

async function main() {
  // Compile engine + shell up front (both must exist before Electron boots).
  await run('pnpm', ['--filter', '@awog/sidecar', 'exec', 'tsc', '-p', 'tsconfig.build.json'], {
    cwd: repoRoot,
  })
  await run('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json'], { cwd: electronDir })

  const children = []
  // Which Nuxt workspace package to serve. ui-next is the shipping UI; override
  // via AWOG_UI_PKG (keep AWOG_DEV_URL in sync, paths.ts) to serve another.
  const uiPkg = process.env.AWOG_UI_PKG ?? 'awog-ui-next'
  const nuxt = spawn('pnpm', ['--filter', uiPkg, 'dev'], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  children.push(nuxt)

  // The Electron MAIN process must NOT inherit ELECTRON_RUN_AS_NODE, or it runs
  // as plain Node (no app/BrowserWindow API). The engine child re-adds it
  // itself (engine.ts). Some shells/CI export it globally, so strip it here.
  const electronEnv = { ...process.env }
  delete electronEnv.ELECTRON_RUN_AS_NODE
  // Pin HOME to the real OS-account home (getpwuid), not an inherited shell $HOME.
  // Sandboxed/launcher shells (e.g. claude-switcher) export a custom $HOME, which
  // makes the engine resolve awogHome() (= ~/.awog) to an EMPTY dir → sessions /
  // agents / settings "disappear". os.userInfo().homedir ignores $HOME. The engine
  // child inherits this env (engine.ts spawns with { ...process.env }). Override
  // explicitly with AWOG_HOME_DIR if you really need a different home in dev.
  electronEnv.HOME = process.env.AWOG_HOME_DIR ?? userInfo().homedir
  const electron = spawn('pnpm', ['exec', 'electron', '.'], {
    cwd: electronDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: electronEnv,
  })
  children.push(electron)

  const shutdown = () => {
    children.forEach((c) => {
      if (!c.killed) c.kill()
    })
  }
  electron.on('exit', () => {
    shutdown()
    process.exit(0)
  })
  process.on('SIGINT', () => {
    shutdown()
    process.exit(0)
  })
}

main().catch((err) => {
  console.error('[electron:dev] fatal:', err)
  process.exit(1)
})
