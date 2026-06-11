import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

// Locate + launch the VS Code `code` CLI. Used by the "Open in VS Code" file
// action. Kept here (main process) rather than the sidecar because it is a
// shell/app-launch op, same category as shell.revealPath/openPath (ipc.ts).
//
// GUI Electron apps on macOS don't inherit the user's login-shell PATH, so a
// bare `which code` often fails even when `code` works in the terminal. We probe
// the well-known per-platform install locations first, then fall back to PATH.

const execFileAsync = promisify(execFile)

// Cache only a successful resolution: a null result re-probes next time so a
// VS Code installed mid-session is picked up without an app restart.
let cachedBin: string | null = null

function candidatePaths(): string[] {
  const home = homedir()
  if (process.platform === 'darwin') {
    return [
      '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
      join(home, 'Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'),
      '/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code',
    ]
  }
  if (process.platform === 'win32') {
    // Prefer Code.exe (an .exe execFile can launch directly) over bin/code.cmd
    // (a batch file would need a shell, opening a command-injection surface).
    const localApp = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
    const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
    return [
      join(localApp, 'Programs', 'Microsoft VS Code', 'Code.exe'),
      join(programFiles, 'Microsoft VS Code', 'Code.exe'),
    ]
  }
  return ['/usr/bin/code', '/usr/local/bin/code', '/usr/share/code/bin/code', '/snap/bin/code']
}

// PATH lookup — POSIX only. On Windows `where code` resolves to a `.cmd`, which
// execFile cannot launch without a shell, so we rely on the Code.exe candidates.
async function fromPath(): Promise<string | null> {
  if (process.platform === 'win32') return null
  try {
    const { stdout } = await execFileAsync('which', ['code'])
    const first = stdout
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean)
    return first ?? null
  } catch {
    return null
  }
}

export async function resolveVscodeBin(): Promise<string | null> {
  if (cachedBin) return cachedBin
  for (const candidate of candidatePaths()) {
    if (existsSync(candidate)) {
      cachedBin = candidate
      return candidate
    }
  }
  const onPath = await fromPath()
  if (onPath) cachedBin = onPath
  return onPath
}

export async function isVscodeAvailable(): Promise<boolean> {
  return (await resolveVscodeBin()) !== null
}

// Open an absolute file/dir path in VS Code. `absPath` must already be validated
// as inside the workspace by the caller (ipc.ts resolveInsideWorkspace).
export async function openInVscode(absPath: string): Promise<void> {
  const bin = await resolveVscodeBin()
  if (!bin) throw new Error('VS Code not found')
  // Detached + unref: Code.exe (Windows) stays running, so we must not await its
  // exit. The `code` shell script (macOS/Linux) exits on its own; either way we
  // resolve on the 'spawn' event and surface only immediate launch failures.
  const child = spawn(bin, [absPath], { detached: true, stdio: 'ignore' })
  child.unref()
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })
}
