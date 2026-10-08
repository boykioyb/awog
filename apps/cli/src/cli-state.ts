// Tiny persisted CLI state at ~/.awog/cli.json — currently just the default
// project picked by `awog project use`. Not engine state; the app never reads
// this file. 0600 like credentials (it stores a project path).

import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

interface CliState {
  projectId?: string
}

const FILE = join(homedir(), '.awog', 'cli.json')

export async function loadCliState(): Promise<CliState> {
  try {
    const raw = await readFile(FILE, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as CliState) : {}
  } catch {
    return {}
  }
}

export async function saveCliState(patch: Partial<CliState>): Promise<void> {
  const current = await loadCliState()
  const next: CliState = { ...current, ...patch }
  await mkdir(join(homedir(), '.awog'), { recursive: true })
  await writeFile(FILE, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  await chmod(FILE, 0o600).catch(() => {})
}
