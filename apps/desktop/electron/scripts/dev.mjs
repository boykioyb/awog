// Dev orchestrator for the Electron shell.
//
// 1. Compile the engine (tsc → sidecar/dist/lib) and the Electron main/preload.
// 2. Start the Nuxt dev server (localhost:3030) + Electron together.
// Electron retries loading the dev URL until Nuxt is listening (see window.ts),
// so we don't need to poll the port here. Killing Electron tears everything down.

import { spawn } from 'node:child_process'
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
  const nuxt = spawn('pnpm', ['--filter', 'awog-ui', 'dev'], {
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
