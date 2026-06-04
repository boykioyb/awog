// Directory names never worth indexing / searching / watching in a workspace
// tree (build output, vendor, VCS metadata, editor caches). Single source of
// truth shared by fs.list-files (walk fallback), fs.search (literal walk) and
// the project fs-watcher — keep these in sync here, not per-file (DRY).
export const SKIP_DIRS: ReadonlySet<string> = new Set([
  '.git',
  'node_modules',
  'dist',
  '.output',
  '.nuxt',
  '.next',
  '.cache',
  '.turbo',
  'coverage',
  '.venv',
  'venv',
  '__pycache__',
  'target',
  '.idea',
  '.vscode',
])
