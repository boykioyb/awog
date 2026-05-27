// Inspect a local folder and surface metadata the UI can pre-fill into the
// new-project form: name, description, gitRemote, gitBranch, language. All
// extraction is best-effort — missing pieces return empty strings rather than
// failing the whole call.

import { z } from 'zod'
import { execFile } from 'node:child_process'
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { register, RpcError } from '../transport/rpc.js'

const Params = z.object({
  path: z.string().min(1).max(4096),
})

function expandHome(input: string): string {
  if (input === '~') return homedir()
  if (input.startsWith('~/')) return resolve(homedir(), input.slice(2))
  return input
}

async function readMaybe(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8')
  } catch {
    return null
  }
}

const README_CANDIDATES = ['README.md', 'README.MD', 'Readme.md', 'readme.md', 'README']

async function findReadme(root: string): Promise<string | null> {
  for (const name of README_CANDIDATES) {
    // eslint-disable-next-line no-await-in-loop
    const text = await readMaybe(join(root, name))
    if (text !== null) return text
  }
  return null
}

// Strip markdown-ish syntax for a one-liner description. Keep it simple — we
// don't ship a markdown parser just for this.
function extractDescription(readme: string): string {
  const lines = readme.split('\n')
  let i = 0
  // Skip blank lines and the leading H1/H2 if present.
  while (i < lines.length && lines[i]!.trim() === '') i += 1
  if (i < lines.length && /^#{1,2}\s/.test(lines[i]!)) i += 1
  while (i < lines.length && lines[i]!.trim() === '') i += 1
  // Skip badges row (lines starting with [![ or containing only images).
  while (i < lines.length && /^\s*\[!\[/.test(lines[i]!)) i += 1
  while (i < lines.length && lines[i]!.trim() === '') i += 1

  const paragraph: string[] = []
  while (i < lines.length && lines[i]!.trim() !== '') {
    paragraph.push(lines[i]!)
    i += 1
  }
  const raw = paragraph.join(' ').trim()
  const stripped = raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return stripped.length > 240 ? `${stripped.slice(0, 237).trimEnd()}…` : stripped
}

// Marker-file based language detection — fast, deterministic, no extension
// counting heuristic. Order matters: more specific wins.
async function detectLanguage(root: string, entries: string[]): Promise<string> {
  const has = (n: string) => entries.includes(n)
  if (has('package.json')) {
    if (has('tsconfig.json')) return 'TypeScript'
    // Look for any .ts file in the top level as a secondary signal.
    if (entries.some((e) => e.endsWith('.ts') || e.endsWith('.tsx'))) return 'TypeScript'
    return 'JavaScript'
  }
  if (has('pyproject.toml') || has('requirements.txt') || has('setup.py') || has('Pipfile')) {
    return 'Python'
  }
  if (has('go.mod')) return 'Go'
  if (has('Cargo.toml')) return 'Rust'
  if (has('pom.xml') || has('build.gradle') || has('build.gradle.kts')) return 'Java'
  if (has('Gemfile')) return 'Ruby'
  if (has('composer.json')) return 'PHP'
  if (has('mix.exs')) return 'Elixir'
  if (entries.some((e) => e.endsWith('.csproj') || e.endsWith('.sln'))) return 'C#'
  // Fallback: check for a `src/` dir of any flavour — not informative, leave blank.
  void root
  return ''
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise<string>((res) => {
    execFile('git', args, { cwd }, (err, stdout) => {
      if (err || !stdout) {
        res('')
        return
      }
      res(stdout.trim())
    })
  })
}

async function detectGit(root: string): Promise<{ gitRemote: string; gitBranch: string }> {
  // Cheap pre-check: only invoke git if .git exists (file for worktrees, dir for normal repos).
  try {
    await stat(join(root, '.git'))
  } catch {
    return { gitRemote: '', gitBranch: '' }
  }
  const [remote, branch] = await Promise.all([
    runGit(root, ['config', '--get', 'remote.origin.url']),
    runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
  ])
  return { gitRemote: remote, gitBranch: branch }
}

register('projects.inspect', async (raw) => {
  const params = Params.parse(raw)
  if (params.path.includes('..')) {
    throw new RpcError(-32602, 'Path must not contain ".."')
  }
  const expanded = expandHome(params.path)
  if (!isAbsolute(expanded)) {
    throw new RpcError(-32602, 'Path must be absolute (or start with "~/")')
  }
  const root = resolve(expanded)

  let stats
  try {
    stats = await stat(root)
  } catch {
    throw new RpcError(-32602, `Path does not exist: ${root}`)
  }
  if (!stats.isDirectory()) {
    throw new RpcError(-32602, `Path is not a directory: ${root}`)
  }

  const name = basename(root)
  let topEntries: string[] = []
  try {
    topEntries = await readdir(root)
  } catch {
    // Permission denied or other — keep going with what we have.
  }

  const readme = await findReadme(root)
  const description = readme ? extractDescription(readme) : ''
  const language = await detectLanguage(root, topEntries)
  const git = await detectGit(root)

  return {
    name,
    description,
    language,
    gitRemote: git.gitRemote,
    gitBranch: git.gitBranch,
    path: root,
  }
})
